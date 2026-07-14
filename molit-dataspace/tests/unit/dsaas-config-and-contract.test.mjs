import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { assertDsaasEnvironment, loadDsaasConfig } from "../../src/dsaas/config.mjs";
import { HttpCaasClient } from "../../src/dsaas/caas-client.mjs";
import { validateContract } from "../../src/dsaas/contracts.mjs";
import { loadApprovalDecisionRegistry } from "../../src/dsaas/approval-registry.mjs";
import { loadServiceRegistry } from "../../src/dsaas/service-registry.mjs";
import { digest } from "../../src/discovery/stable-json.mjs";

const CONFIG = new URL("../../fixtures/dsaas/config.example.json", import.meta.url);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("production DSaaS config and pinned service registry validate", async () => {
  const config = await loadDsaasConfig(fileURLToPath(CONFIG));
  assert.equal(config.environment, "production");
  assert.equal(config.stateStore.type, "postgres");
  assert.equal(config.stateStore.tls.mode, "verify-full");
  assert.equal(config.stateStore.maxPoolSize, 20);
  assert.equal(config.stateStore.maxLeasePoolSize, 20);
  assert.equal(config.network.allowHttp, false);
  assert.equal(config.network.allowPrivate, false);
  assert.equal(config.reconcileScheduler.intervalMs, 60_000);
  assert.ok(config.reconcileScheduler.readinessMaxLagMs >= config.reconcileScheduler.intervalMs * 2);
  assert.equal(config.reconcileScheduler.caasRetryBaseMs, 60_000);
  assert.equal(config.reconcileScheduler.caasRetryMaxMs, 3_600_000);
  const registry = await loadServiceRegistry(config.serviceRegistryPath, config.serviceRegistrySha256, {
    clock: () => new Date("2026-07-13T01:00:00Z"),
    maxAgeSeconds: config.serviceRegistryMaxAgeSeconds,
  });
  assert.equal(registry.byId.size, 3);
  assert.equal(registry.byId.get("caas-primary").status, "NOT_READY");
  const approvalRegistry = await loadApprovalDecisionRegistry(config.approvalDecisionRegistryPath, config.approvalDecisionRegistrySha256, {
    clock: () => new Date("2026-07-13T01:00:00Z"),
    maxAgeSeconds: config.approvalDecisionRegistryMaxAgeSeconds,
  });
  assert.equal(approvalRegistry.status, "NOT_CONFIGURED");
  assert.doesNotThrow(() => assertDsaasEnvironment(config, {
    MOLIT_DSAAS_INTROSPECTION_CLIENT_ID: "client",
    MOLIT_DSAAS_INTROSPECTION_CLIENT_SECRET: "secret",
    MOLIT_CAAS_DSAAS_CONTROLLER_TOKEN: "caas-controller-token",
    MOLIT_DSAAS_POSTGRES_URL: "postgresql://dsaas:secret@postgres.example/dsaas",
    MOLIT_DSAAS_INSTANCE_ID: "dsaas-instance-01",
    MOLIT_DSAAS_POSTGRES_CA_PEM: "test-ca",
  }));
  assert.throws(() => assertDsaasEnvironment(config, {}), { code: "DSAAS_SECRET_ENV_MISSING" });
});

test("CaaS ensurePath rejects query, authority, traversal and separator ambiguity", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-dsaas-config-path-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = JSON.parse(await readFile(CONFIG, "utf8"));
  for (const [index, ensurePath] of [
    "/v1/connectors/ensure?access_token=secret",
    "//attacker.example/ensure",
    "/v1/../admin",
    "/v1\\ensure",
    "/v1/%2Fadmin",
    "/v1/ensure#fragment",
  ].entries()) {
    const path = join(directory, `config-${index}.json`);
    await writeFile(path, JSON.stringify({ ...source, caas: { ...source.caas, ensurePath } }));
    await assert.rejects(loadDsaasConfig(path), { code: "DSAAS_CONFIG_INVALID" });
  }
});

test("HTTP CaaS client forwards the scheduler AbortSignal unchanged", async () => {
  const controller = new AbortController();
  let observedOptions;
  const client = new HttpCaasClient({
    config: {
      auth: null,
      baseUrl: "https://caas.example/",
      ensurePath: "/v1/connectors/ensure",
      supportsIdempotencyKey: true,
    },
    http: {
      async json(_endpoint, options) {
        observedOptions = options;
        return { status: 202, value: { accepted: true } };
      },
    },
  });

  assert.deepEqual(await client.ensureConnector({ desiredState: "ACTIVE" }, "dsaas-test-key", { signal: controller.signal }), { accepted: true });
  assert.equal(observedOptions.signal, controller.signal);
  assert.equal(observedOptions.headers["idempotency-key"], "dsaas-test-key");
});

test("production DSaaS config rejects a non-loopback plain HTTP listener", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-dsaas-config-listen-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = JSON.parse(await readFile(CONFIG, "utf8"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify({ ...source, listenHost: "0.0.0.0" }));
  await assert.rejects(loadDsaasConfig(path), (error) => error.code === "DSAAS_CONFIG_INVALID" && /loopback/u.test(error.message));
});

test("production DSaaS requires PostgreSQL with verify-full TLS", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-dsaas-config-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = JSON.parse(await readFile(CONFIG, "utf8"));
  const fileConfig = join(directory, "file.json");
  await writeFile(fileConfig, JSON.stringify({
    ...source,
    stateStore: { type: "file", path: "state.json" },
  }));
  await assert.rejects(loadDsaasConfig(fileConfig), (error) => error.code === "DSAAS_CONFIG_INVALID" && /PostgreSQL control store/u.test(error.message));

  const insecureConfig = join(directory, "insecure.json");
  await writeFile(insecureConfig, JSON.stringify({
    ...source,
    stateStore: { ...source.stateStore, tls: { mode: "disable" } },
  }));
  await assert.rejects(loadDsaasConfig(insecureConfig), (error) => error.code === "DSAAS_CONFIG_INVALID" && /verify-full/u.test(error.message));
});

test("development and test DSaaS retain the file store", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-dsaas-config-file-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = JSON.parse(await readFile(CONFIG, "utf8"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify({
    ...source,
    environment: "development",
    stateStore: { type: "file", path: "state.json" },
  }));
  const config = await loadDsaasConfig(path);
  assert.equal(config.stateStore.type, "file");
  assert.equal(config.stateStore.path, join(directory, "state.json"));
});

test("example dataspace and participant satisfy strict contracts", async () => {
  const dataspace = JSON.parse(await readFile(new URL("../../fixtures/dsaas/dataspace.example.json", import.meta.url), "utf8"));
  const participant = JSON.parse(await readFile(new URL("../../fixtures/dsaas/participant.example.json", import.meta.url), "utf8"));
  const approvalRegistry = JSON.parse(await readFile(new URL("../../fixtures/dsaas/approval-decision-registry.example.json", import.meta.url), "utf8"));
  await assert.doesNotReject(validateContract("dataspace", dataspace));
  await assert.doesNotReject(validateContract("participant", participant));
  await assert.doesNotReject(validateContract("approvalDecisionRegistry", approvalRegistry));
});

test("trusted registries fail closed after validUntil or maxAge", async () => {
  const config = await loadDsaasConfig(fileURLToPath(CONFIG));
  await assert.rejects(
    loadServiceRegistry(config.serviceRegistryPath, config.serviceRegistrySha256, {
      clock: () => new Date("2026-07-14T00:00:01Z"),
      maxAgeSeconds: config.serviceRegistryMaxAgeSeconds,
    }),
    { code: "DSAAS_SERVICE_REGISTRY_STALE" },
  );
  await assert.rejects(
    loadApprovalDecisionRegistry(config.approvalDecisionRegistryPath, config.approvalDecisionRegistrySha256, {
      clock: () => new Date("2026-07-14T00:00:01Z"),
      maxAgeSeconds: config.approvalDecisionRegistryMaxAgeSeconds,
    }),
    { code: "DSAAS_APPROVAL_REGISTRY_STALE" },
  );
});

test("trusted registry read and JSON failures use typed refresh errors", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-dsaas-registry-refresh-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const missing = join(directory, "missing.json");
  const malformed = join(directory, "malformed.json");
  await writeFile(malformed, "{not-json");

  await assert.rejects(
    loadServiceRegistry(missing, "0".repeat(64)),
    { code: "DSAAS_SERVICE_REGISTRY_REFRESH_FAILED", details: { causeCode: "ENOENT" } },
  );
  await assert.rejects(
    loadServiceRegistry(malformed, "0".repeat(64)),
    { code: "DSAAS_SERVICE_REGISTRY_REFRESH_FAILED", details: { causeCode: "JSON_INVALID" } },
  );
  await assert.rejects(
    loadApprovalDecisionRegistry(missing, "0".repeat(64)),
    { code: "DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED", details: { causeCode: "ENOENT" } },
  );
  await assert.rejects(
    loadApprovalDecisionRegistry(malformed, "0".repeat(64)),
    { code: "DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED", details: { causeCode: "JSON_INVALID" } },
  );
});

test("trusted registry identifiers and endpoints reject URL credentials, query and fragment", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-dsaas-registry-url-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const serviceRegistry = JSON.parse(await readFile(new URL("../../fixtures/dsaas/service-registry.example.json", import.meta.url), "utf8"));
  serviceRegistry.services[0].endpoint = "https://user:password@caas.data.molit.go.kr/";
  const servicePath = join(directory, "service-registry.json");
  await writeFile(servicePath, JSON.stringify(serviceRegistry));
  await assert.rejects(
    loadServiceRegistry(servicePath, digest(serviceRegistry), { clock: () => new Date("2026-07-13T01:00:00Z") }),
    { code: "DSAAS_SECRET_MATERIAL_FORBIDDEN" },
  );

  const approvalRegistry = JSON.parse(await readFile(new URL("../../fixtures/dsaas/approval-decision-registry.example.json", import.meta.url), "utf8"));
  approvalRegistry.registryId = "https://approval.data.molit.go.kr/registry?view=current";
  const approvalPath = join(directory, "approval-registry.json");
  await writeFile(approvalPath, JSON.stringify(approvalRegistry));
  await assert.rejects(
    loadApprovalDecisionRegistry(approvalPath, digest(approvalRegistry), { clock: () => new Date("2026-07-13T01:00:00Z") }),
    { code: "DSAAS_URI_COMPONENT_FORBIDDEN" },
  );
});

test("approved artifact digests remain bound to repository bytes", async () => {
  const config = await loadDsaasConfig(fileURLToPath(CONFIG));
  const profileManifest = await readFile(new URL("../../profiles/molit-dcat-ap/releases/1.0.0-rc.1/manifest.json", import.meta.url));
  const governance = await readFile(new URL("../../governance/molit-dataspace-governance.v1.json", import.meta.url));
  assert.equal(sha256(profileManifest), config.approvedMetadataProfiles[0].sha256);
  assert.equal(sha256(governance), config.approvedGovernanceBundles[0].sha256);
});
