import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DsaasControlPlane } from "../../src/dsaas/service.mjs";
import { createDsaasServer } from "../../src/dsaas/server.mjs";
import { FileDsaasStore } from "../../src/dsaas/store.mjs";
import { loadApprovalDecisionRegistry } from "../../src/dsaas/approval-registry.mjs";
import { loadServiceRegistry } from "../../src/dsaas/service-registry.mjs";

const PROFILE = { iri: "https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1", version: "1.0.0-rc.1", sha256: "a".repeat(64) };
const GOVERNANCE = { iri: "https://data.molit.go.kr/governance/molit-dataspace/1", version: "1", sha256: "b".repeat(64) };

function body() {
  return {
    schemaVersion: "molit.dsaas-dataspace/1",
    dataspaceId: "molit-api",
    name: "국토교통 API 시험",
    operatorOrganizationId: "org:molit:operator",
    namespaceBase: "https://data.molit.go.kr/id/",
    metadataProfile: PROFILE,
    governanceBundle: GOVERNANCE,
    protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" },
    connectorPlanId: "edc-isolated",
    deploymentMode: "isolated",
    requiredServiceIds: ["caas-primary"],
    desiredState: "ACTIVE",
  };
}

function rawRequestWithBody(url, { method = "GET", headers = {}, body: requestBody = "{}" } = {}) {
  const target = new URL(url);
  const bytes = Buffer.from(requestBody);
  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method,
      headers: { ...headers, "content-length": bytes.length },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        status: response.statusCode,
      }));
    });
    request.once("error", reject);
    request.end(bytes);
  });
}

function lifecycleConfig() {
  return {
    listenHost: "127.0.0.1",
    port: 0,
    publicOrigin: "http://127.0.0.1",
    allowedHosts: ["127.0.0.1"],
    limits: {
      maxRequestBytes: 65_536,
      headerTimeoutMs: 10_000,
      requestTimeoutMs: 10_000,
      keepAliveTimeoutMs: 5_000,
      gracefulShutdownMs: 1_000,
    },
  };
}

const LIFECYCLE_ACTOR = Object.freeze({
  subject: "operator",
  principalId: "operator",
  clientId: "operator-client",
  keyId: "operator-key-1",
  roles: Object.freeze(["dsaas.operator"]),
  dataspaceIds: Object.freeze([]),
});

test("DSaaS HTTP API applies authentication, idempotency and revision ETag", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-dsaas-api-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const serviceRegistry = { byId: new Map([["caas-primary", { serviceId: "caas-primary", serviceType: "caas", status: "READY", endpoint: "https://caas.example/", evidence: { observedAt: "2026-07-13T00:00:00Z", sha256: "c".repeat(64) } }]]) };
  const controlPlane = new DsaasControlPlane({
    store: new FileDsaasStore({ path: join(directory, "state.json") }),
    caas: { async ensureConnector() { throw new Error("not used"); } },
    serviceRegistry,
    approvalDecisionRegistry: { status: "READY" },
    approvedMetadataProfiles: [PROFILE],
    approvedGovernanceBundles: [GOVERNANCE],
    connectorPlanIds: ["edc-isolated"],
    allowedNamespaceOrigins: ["https://data.molit.go.kr"],
  });
  const config = {
    listenHost: "127.0.0.1",
    port: 0,
    publicOrigin: "http://127.0.0.1",
    allowedHosts: ["127.0.0.1"],
    limits: {
      maxRequestBytes: 65_536,
      headerTimeoutMs: 10_000,
      requestTimeoutMs: 10_000,
      keepAliveTimeoutMs: 5_000,
      gracefulShutdownMs: 5_000,
    },
  };
  const authenticator = {
    async authenticate(request) {
      if (request.headers.authorization === "Bearer missing-introspection-config") {
        const error = new Error("introspection client credentials are unavailable");
        error.code = "DSAAS_AUTH_CONFIGURATION_ERROR";
        throw error;
      }
      if (request.headers.authorization === "Bearer forbidden-test-token") {
        return { subject: "auditor", principalId: "auditor", clientId: "auditor-client", keyId: "auditor-key-1", roles: ["dsaas.auditor"], dataspaceIds: [] };
      }
      if (request.headers.authorization !== "Bearer integration-test-token") {
        const error = new Error("invalid token");
        error.code = "DSAAS_UNAUTHENTICATED";
        throw error;
      }
      return { subject: "operator", principalId: "operator", clientId: "operator-client", keyId: "operator-key-1", roles: ["dsaas.operator"], dataspaceIds: [] };
    },
  };
  let schedulerStarts = 0;
  let schedulerStops = 0;
  const schedulerStatus = {
    ready: false,
    status: "NOT_READY",
    lastTickCompletedAt: null,
    lastFatalErrorCode: null,
    lastFailureCodes: [],
    lagMs: 0,
    skippedOverlappingTicks: 0,
  };
  const scheduler = {
    async start() { schedulerStarts += 1; },
    async stop() { schedulerStops += 1; },
    readiness() { return schedulerStatus; },
  };
  const usageRecords = [];
  let spanSequence = 0;
  const tracer = { startIncomingSpan() { spanSequence += 1; const context = { traceId: spanSequence.toString(16).padStart(32, "0"), spanId: spanSequence.toString(16).padStart(16, "0") }; return { context, outboundHeaders: (headers) => ({ ...headers, traceparent: `00-${context.traceId}-${context.spanId}-01` }), async end() {} }; } };
  const runtime = createDsaasServer({ config, controlPlane, authenticator, scheduler, tracer, usageRecorder: { async record(value) { usageRecords.push(value); } } });
  const address = await runtime.start();
  assert.equal(schedulerStarts, 1);
  t.after(async () => {
    await runtime.close();
    assert.equal(schedulerStops, 1);
  });
  const origin = `http://127.0.0.1:${address.port}`;
  config.allowedHosts.push(`127.0.0.1:${address.port}`);

  const livenessDuringInitialTick = await fetch(`${origin}/healthz`);
  assert.equal(livenessDuringInitialTick.status, 200);
  const wrongHealthMethod = await fetch(`${origin}/healthz`, { method: "POST", body: "{}" });
  assert.equal(wrongHealthMethod.status, 405);
  assert.equal((await wrongHealthMethod.json()).code, "DSAAS_METHOD_NOT_ALLOWED");
  const healthBody = await rawRequestWithBody(`${origin}/healthz`);
  assert.equal(healthBody.status, 400);
  assert.equal(JSON.parse(healthBody.body).code, "DSAAS_BODY_FORBIDDEN");
  const initialNotReady = await fetch(`${origin}/readyz`);
  assert.equal(initialNotReady.status, 503);
  assert.equal((await initialNotReady.json()).checks.reconcileScheduler, "NOT_READY");
  schedulerStatus.ready = true;
  schedulerStatus.status = "READY";
  schedulerStatus.lastTickCompletedAt = "2026-07-13T00:00:00Z";

  const health = await fetch(`${origin}/readyz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ready: true,
    scope: "LOCAL_CONTROL_PLANE",
    checks: { state: "READY", serviceRegistry: "READY", approvalRegistry: "READY", caas: "NOT_VERIFIED", reconcileScheduler: "READY" },
    failureCodes: [],
    scheduler: schedulerStatus,
    status: "ok",
  });
  const unauthorized = await fetch(`${origin}/v1/dataspaces/molit-api`);
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get("content-type"), /^application\/problem\+json/u);
  const authUnavailable = await fetch(`${origin}/v1/dataspaces/molit-api`, {
    headers: { authorization: "Bearer missing-introspection-config" },
  });
  assert.equal(authUnavailable.status, 503);
  assert.equal((await authUnavailable.json()).code, "DSAAS_AUTH_CONFIGURATION_ERROR");

  const create = await fetch(`${origin}/v1/dataspaces`, {
    method: "POST",
    headers: { authorization: "Bearer integration-test-token", "content-type": "application/json", "idempotency-key": "api-create-key-0001" },
    body: JSON.stringify(body()),
  });
  assert.equal(create.status, 201);
  assert.equal(create.headers.get("etag"), '"1"');
  const created = await create.json();
  assert.equal(created.spec.dataspaceId, "molit-api");
  assert.deepEqual(usageRecords.at(-1) && { tenantId: usageRecords.at(-1).tenantId, operation: usageRecords.at(-1).operation }, { tenantId: "molit-api", operation: "dataspace.create" });
  const missingDataspace = await fetch(`${origin}/v1/dataspaces/missing-space`, {
    headers: { authorization: "Bearer integration-test-token" },
  });
  assert.equal(missingDataspace.status, 404);
  await missingDataspace.json();
  assert.deepEqual(
    { tenantId: usageRecords.at(-1).tenantId, operation: usageRecords.at(-1).operation, statusCode: usageRecords.at(-1).statusCode },
    { tenantId: "molit-platform", operation: "dataspace.read", statusCode: 404 },
  );
  const forbiddenDataspace = await fetch(`${origin}/v1/dataspaces/molit-api`, {
    headers: { authorization: "Bearer forbidden-test-token" },
  });
  assert.equal(forbiddenDataspace.status, 403);
  await forbiddenDataspace.json();
  assert.deepEqual(
    { tenantId: usageRecords.at(-1).tenantId, operation: usageRecords.at(-1).operation, statusCode: usageRecords.at(-1).statusCode },
    { tenantId: "molit-platform", operation: "dataspace.read", statusCode: 403 },
  );
  const invalidApprovals = [
    null,
    { unexpected: true },
    { decisionId: "x", evidenceSha256: "a".repeat(64) },
    { decisionId: "decision:valid-shape", evidenceSha256: "not-a-digest" },
  ];
  for (const [index, approval] of invalidApprovals.entries()) {
    const response = await fetch(`${origin}/v1/dataspaces/molit-api/participants/road-provider/approval`, {
      method: "POST",
      headers: {
        authorization: "Bearer integration-test-token",
        "content-type": "application/json",
        "idempotency-key": `invalid-approval-${index.toString().padStart(4, "0")}`,
      },
      body: JSON.stringify(approval),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, "DSAAS_APPROVAL_INVALID");
  }
  const registryErrors = [
    "DSAAS_APPROVAL_REGISTRY_DIGEST_MISMATCH",
    "DSAAS_APPROVAL_REGISTRY_DUPLICATE",
    "DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED",
    "DSAAS_APPROVAL_REGISTRY_STALE",
    "DSAAS_APPROVAL_REVALIDATION_FAILED",
    "DSAAS_SERVICE_REGISTRY_DIGEST_MISMATCH",
    "DSAAS_SERVICE_REGISTRY_DUPLICATE",
    "DSAAS_SERVICE_REGISTRY_REFRESH_FAILED",
    "DSAAS_SERVICE_REGISTRY_STALE",
  ];
  const originalApproveParticipant = controlPlane.approveParticipant;
  try {
    for (const [index, code] of registryErrors.entries()) {
      controlPlane.approveParticipant = async () => {
        const error = new Error("trusted registry is unavailable");
        error.code = code;
        throw error;
      };
      const response = await fetch(`${origin}/v1/dataspaces/molit-api/participants/road-provider/approval`, {
        method: "POST",
        headers: {
          authorization: "Bearer integration-test-token",
          "content-type": "application/json",
          "idempotency-key": `registry-error-${index.toString().padStart(4, "0")}`,
        },
        body: JSON.stringify({ decisionId: "decision:valid-shape", evidenceSha256: "a".repeat(64) }),
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "60");
      assert.equal((await response.json()).code, code);
    }
  } finally {
    controlPlane.approveParticipant = originalApproveParticipant;
  }

  const stateFailures = [
    "DSAAS_RECONCILE_FENCE_LOST",
    "DSAAS_STATE_ABORTED",
    "DSAAS_STATE_CLOSED",
    "DSAAS_STATE_COMMIT_UNKNOWN",
    "DSAAS_STATE_TIMEOUT",
    "DSAAS_STATE_UNAVAILABLE",
  ];
  const originalCreateDataspace = controlPlane.createDataspace;
  try {
    for (const [index, code] of stateFailures.entries()) {
      controlPlane.createDataspace = async () => {
        const error = new Error("control-store request can be retried with the same idempotency key");
        error.code = code;
        throw error;
      };
      const response = await fetch(`${origin}/v1/dataspaces`, {
        method: "POST",
        headers: {
          authorization: "Bearer integration-test-token",
          "content-type": "application/json",
          "idempotency-key": `state-error-${index.toString().padStart(4, "0")}`,
        },
        body: JSON.stringify(body()),
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "1");
      assert.equal((await response.json()).code, code);
    }
    for (const [index, code] of [
      "DSAAS_STATE_LOCKED",
      "DSAAS_STATE_MIGRATION_REQUIRED",
      "DSAAS_STATE_MISSING",
    ].entries()) {
      controlPlane.createDataspace = async () => {
        const error = new Error("control-store requires operator recovery");
        error.code = code;
        throw error;
      };
      const response = await fetch(`${origin}/v1/dataspaces`, {
        method: "POST",
        headers: {
          authorization: "Bearer integration-test-token",
          "content-type": "application/json",
          "idempotency-key": `state-operator-action-${index.toString().padStart(4, "0")}`,
        },
        body: JSON.stringify(body()),
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), null);
      assert.equal((await response.json()).code, code);
    }
    controlPlane.createDataspace = async () => {
      const error = new Error("control-store state exceeds its configured byte limit");
      error.code = "DSAAS_STATE_TOO_LARGE";
      throw error;
    };
    const capacity = await fetch(`${origin}/v1/dataspaces`, {
      method: "POST",
      headers: {
        authorization: "Bearer integration-test-token",
        "content-type": "application/json",
        "idempotency-key": "state-too-large-0001",
      },
      body: JSON.stringify(body()),
    });
    assert.equal(capacity.status, 507);
    assert.equal(capacity.headers.get("retry-after"), null);
    assert.equal((await capacity.json()).code, "DSAAS_STATE_TOO_LARGE");
  } finally {
    controlPlane.createDataspace = originalCreateDataspace;
  }

  const malformedApprovalPath = join(directory, "approval-registry-malformed.json");
  const missingApprovalPath = join(directory, "approval-registry-missing.json");
  await writeFile(malformedApprovalPath, "{not-json");
  const originalApprovalProvider = controlPlane.approvalDecisionRegistryProvider;
  try {
    for (const [index, path] of [missingApprovalPath, malformedApprovalPath].entries()) {
      controlPlane.approvalDecisionRegistryProvider = () => loadApprovalDecisionRegistry(path, "0".repeat(64));
      const response = await fetch(`${origin}/v1/dataspaces/molit-api/participants/road-provider/approval`, {
        method: "POST",
        headers: {
          authorization: "Bearer integration-test-token",
          "content-type": "application/json",
          "idempotency-key": `registry-file-error-${index.toString().padStart(4, "0")}`,
        },
        body: JSON.stringify({ decisionId: "decision:valid-shape", evidenceSha256: "a".repeat(64) }),
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "60");
      assert.equal((await response.json()).code, "DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED");
    }
  } finally {
    controlPlane.approvalDecisionRegistryProvider = originalApprovalProvider;
  }

  const malformedServicePath = join(directory, "service-registry-malformed.json");
  await writeFile(malformedServicePath, "{not-json");
  const originalServiceProvider = controlPlane.serviceRegistryProvider;
  try {
    controlPlane.serviceRegistryProvider = () => loadServiceRegistry(malformedServicePath, "0".repeat(64));
    const registryNotReady = await fetch(`${origin}/readyz`);
    assert.equal(registryNotReady.status, 503);
    assert.equal(registryNotReady.headers.get("retry-after"), "60");
    assert.deepEqual((await registryNotReady.json()).failureCodes, ["DSAAS_SERVICE_REGISTRY_REFRESH_FAILED"]);
  } finally {
    controlPlane.serviceRegistryProvider = originalServiceProvider;
  }
  const getBody = await rawRequestWithBody(`${origin}/v1/dataspaces/molit-api`, {
    headers: { authorization: "Bearer integration-test-token" },
  });
  assert.equal(getBody.status, 400);
  assert.equal(JSON.parse(getBody.body).code, "DSAAS_BODY_FORBIDDEN");

  const replay = await fetch(`${origin}/v1/dataspaces`, {
    method: "POST",
    headers: { authorization: "Bearer integration-test-token", "content-type": "application/json", "idempotency-key": "api-create-key-0001" },
    body: JSON.stringify(body()),
  });
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), created);

  schedulerStatus.ready = false;
  schedulerStatus.status = "NOT_READY";
  schedulerStatus.lagMs = 180_001;
  const schedulerNotReady = await fetch(`${origin}/readyz`);
  assert.equal(schedulerNotReady.status, 503);
  const schedulerNotReadyBody = await schedulerNotReady.json();
  assert.equal(schedulerNotReadyBody.checks.reconcileScheduler, "NOT_READY");
  assert.deepEqual(schedulerNotReadyBody.failureCodes, ["DSAAS_RECONCILE_SCHEDULER_NOT_READY"]);
  schedulerStatus.ready = true;
  schedulerStatus.status = "READY";
  schedulerStatus.lagMs = 0;

  const statePath = join(directory, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.dataspaces["molit-api"].spec.name = "tampered";
  await writeFile(statePath, JSON.stringify(state));
  const notReady = await fetch(`${origin}/readyz`);
  assert.equal(notReady.status, 503);
  const notReadyBody = await notReady.json();
  assert.equal(notReadyBody.ready, false);
  assert.equal(notReadyBody.checks.state, "NOT_READY");
  assert.equal(notReadyBody.checks.approvalRegistry, "READY");
  assert.deepEqual(notReadyBody.failureCodes, ["DSAAS_STATE_SNAPSHOT_INVALID"]);
});

test("listen failure does not launch the initial scheduler tick", async (t) => {
  const blocker = http.createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const address = blocker.address();
  let schedulerStarts = 0;
  let schedulerStops = 0;
  const runtime = createDsaasServer({
    config: {
      listenHost: "127.0.0.1",
      port: address.port,
      publicOrigin: "http://127.0.0.1",
      allowedHosts: [`127.0.0.1:${address.port}`],
      limits: {
        maxRequestBytes: 65_536,
        headerTimeoutMs: 10_000,
        requestTimeoutMs: 10_000,
        keepAliveTimeoutMs: 5_000,
        gracefulShutdownMs: 1_000,
      },
    },
    controlPlane: {},
    authenticator: {},
    scheduler: {
      async start() { schedulerStarts += 1; },
      async stop() { schedulerStops += 1; },
    },
  });
  await assert.rejects(runtime.start(), { code: "EADDRINUSE" });
  assert.equal(schedulerStarts, 0);
  assert.equal(schedulerStops, 1);
});

test("close during listen prevents a late scheduler start and listener resurrection", async () => {
  let schedulerStarts = 0;
  let schedulerStops = 0;
  const runtime = createDsaasServer({
    config: lifecycleConfig(),
    controlPlane: {},
    authenticator: {},
    scheduler: {
      async start() { schedulerStarts += 1; },
      async stop() { schedulerStops += 1; },
    },
  });

  const starting = runtime.start();
  const closing = runtime.close({ timeoutMs: 200 });
  await closing;
  await assert.rejects(starting, { code: "DSAAS_START_ABORTED" });
  assert.equal(runtime.server.listening, false);
  assert.equal(schedulerStarts, 0);
  assert.ok(schedulerStops >= 1);
});

test("close after the listen callback wins the epoch race before scheduler start", async () => {
  let schedulerStarts = 0;
  let schedulerStops = 0;
  const runtime = createDsaasServer({
    config: lifecycleConfig(),
    controlPlane: {},
    authenticator: {},
    scheduler: {
      async start() { schedulerStarts += 1; },
      async stop() { schedulerStops += 1; },
    },
  });

  const starting = runtime.start();
  let closing;
  runtime.server.once("listening", () => {
    closing = runtime.close({ timeoutMs: 200 });
  });

  await assert.rejects(starting, { code: "DSAAS_START_ABORTED" });
  await closing;
  assert.equal(runtime.server.listening, false);
  assert.equal(schedulerStarts, 0);
  assert.ok(schedulerStops >= 1);
});

test("readiness, authentication, and read handlers share the request deadline signal", async () => {
  const config = lifecycleConfig();
  config.limits.requestTimeoutMs = 30;
  const received = [];
  const waitForAbort = (component, signal) => {
    received.push({ component, signal });
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const runtime = createDsaasServer({
    config,
    controlPlane: {
      readiness({ signal }) { return waitForAbort("readiness", signal); },
      getDataspace(_dataspaceId, _actor, { signal }) { return waitForAbort("dataspace", signal); },
    },
    authenticator: {
      async authenticate(_request, { signal }) {
        received.push({ component: "authentication", signal });
        return LIFECYCLE_ACTOR;
      },
    },
    scheduler: { async start() {}, async stop() {} },
  });
  const address = await runtime.start();
  config.allowedHosts.push(`127.0.0.1:${address.port}`);
  const origin = `http://127.0.0.1:${address.port}`;
  const dataspace = await fetch(`${origin}/v1/dataspaces/slow`, { headers: { authorization: "Bearer token" } });
  assert.equal(dataspace.status, 408);
  assert.equal((await dataspace.json()).code, "DSAAS_REQUEST_TIMEOUT");
  const readiness = await fetch(`${origin}/readyz`);
  assert.equal(readiness.status, 408);
  assert.equal((await readiness.json()).code, "DSAAS_REQUEST_TIMEOUT");
  assert.deepEqual(received.map(({ component }) => component), ["authentication", "dataspace", "readiness"]);
  for (const { signal } of received) {
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason.code, "DSAAS_REQUEST_TIMEOUT");
  }
  await runtime.close();
});

test("production server refuses static authentication and a missing direct TLS context", async () => {
  const config = { ...lifecycleConfig(), environment: "production" };
  let schedulerStarts = 0;
  const scheduler = {
    async start() { schedulerStarts += 1; },
    async stop() {},
  };
  const staticAuth = createDsaasServer({
    config,
    controlPlane: { async readiness() { return { ready: true, failureCodes: [] }; } },
    authenticator: { async authenticate() { return LIFECYCLE_ACTOR; } },
    scheduler,
  });
  await assert.rejects(staticAuth.start(), { code: "DSAAS_PRODUCTION_AUTH_REQUIRED" });
  assert.equal(staticAuth.server.listening, false);

  const notReady = createDsaasServer({
    config,
    controlPlane: { async readiness() { return { ready: false, failureCodes: ["DSAAS_EXTERNAL_APPROVAL_GATE_BLOCKED"] }; } },
    authenticator: { productionEligible: true, async initialize() {}, async readiness() { return { ready: true }; }, async authenticate() { return LIFECYCLE_ACTOR; } },
    scheduler,
  });
  await assert.rejects(notReady.start(), { code: "DSAAS_PRODUCTION_TLS_REQUIRED" });
  assert.equal(notReady.server.listening, false);

  const [cert, key, ca] = await Promise.all([
    readFile(new URL("../fixtures/identity-tls/server-one.crt", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/identity-tls/server-one.key", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/identity-tls/root.crt", import.meta.url), "utf8"),
  ]);
  const observationBlocked = createDsaasServer({
    config,
    controlPlane: { async readiness() { return { ready: true, failureCodes: [] }; } },
    authenticator: { productionEligible: true, async initialize() {}, async readiness() { return { ready: true }; }, async authenticate() { return LIFECYCLE_ACTOR; } },
    scheduler,
    tlsRuntime: { readiness() { return { ready: true }; }, serverOptions() { return { cert, key, ca }; }, attach() {}, async close() {} },
    observabilityReadiness: async () => ({ ready: false }),
  });
  await assert.rejects(observationBlocked.start(), { code: "DSAAS_OBSERVABILITY_NOT_READY" });
  assert.equal(observationBlocked.server.listening, false);
  assert.equal(schedulerStarts, 0);
});

test("signal-style void shutdown keeps the process alive through its deadline", { timeout: 5_000 }, async () => {
  const serverModule = new URL("../../src/dsaas/server.mjs", import.meta.url).href;
  const script = `
    import { createDsaasServer } from ${JSON.stringify(serverModule)};
    const config = {
      listenHost: "127.0.0.1",
      port: 0,
      publicOrigin: "http://127.0.0.1",
      allowedHosts: ["127.0.0.1"],
      limits: {
        maxRequestBytes: 65536,
        headerTimeoutMs: 10000,
        requestTimeoutMs: 10000,
        keepAliveTimeoutMs: 5000,
        gracefulShutdownMs: 80,
      },
    };
    const runtime = createDsaasServer({
      config,
      controlPlane: {},
      authenticator: {},
      scheduler: {
        async start() {},
        async stop() { return new Promise(() => {}); },
      },
    });
    await runtime.start();
    process.once("SIGTERM", () => {
      process.stdout.write("closing\\n");
      void runtime.close().then(() => process.stdout.write("closed\\n"));
    });
    process.stdout.write("started\\n");
    process.emit("SIGTERM");
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");

  assert.equal(signal, null);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^started\nclosing\nclosed\n$/u);
});

test("all management mutation routes receive a request AbortSignal", async (t) => {
  const signals = [];
  const capture = (signal) => {
    assert.ok(signal instanceof AbortSignal);
    signals.push(signal);
    return { revision: 1 };
  };
  const config = lifecycleConfig();
  const runtime = createDsaasServer({
    config,
    authenticator: { async authenticate() { return LIFECYCLE_ACTOR; } },
    controlPlane: {
      async createDataspace(_body, _actor, _key, { signal }) { return capture(signal); },
      async setDesiredState(_dataspaceId, _state, _revision, _actor, _key, { signal }) { return capture(signal); },
      async reconcile(_dataspaceId, _actor, _key, _mode, { signal }) { return capture(signal); },
      async submitParticipant(_dataspaceId, _body, _actor, _key, { signal }) { return capture(signal); },
      async approveParticipant(_dataspaceId, _participantId, _body, _actor, _key, { signal }) { return capture(signal); },
    },
    scheduler: { async start() {}, async stop() {} },
  });
  const address = await runtime.start();
  t.after(() => runtime.close());
  config.allowedHosts.push(`127.0.0.1:${address.port}`);
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: "Bearer token", "idempotency-key": "mutation-key-0001" };
  const jsonHeaders = { ...headers, "content-type": "application/json" };
  const responses = await Promise.all([
    fetch(`${origin}/v1/dataspaces`, { method: "POST", headers: jsonHeaders, body: "{}" }),
    fetch(`${origin}/v1/dataspaces/space-one/desired-state`, { method: "PUT", headers: { ...jsonHeaders, "if-match": '"1"' }, body: JSON.stringify({ desiredState: "ACTIVE" }) }),
    fetch(`${origin}/v1/dataspaces/space-one/reconcile`, { method: "POST", headers }),
    fetch(`${origin}/v1/dataspaces/space-one/participants`, { method: "POST", headers: jsonHeaders, body: "{}" }),
    fetch(`${origin}/v1/dataspaces/space-one/participants/participant-one/approval`, { method: "POST", headers: jsonHeaders, body: "{}" }),
  ]);

  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 200, 200, 201, 201]);
  assert.equal(signals.length, 5);
  assert.equal(new Set(signals).size, 5);
  assert.ok(signals.every(({ aborted }) => aborted === false));
});

test("deadline abort prevents an accepted management write from committing after close", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-dsaas-deadline-write-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileDsaasStore({ path: join(directory, "state.json") });
  const service = new DsaasControlPlane({
    store,
    caas: { async ensureConnector() { throw new Error("not used"); } },
    serviceRegistry: { byId: new Map() },
    approvalDecisionRegistry: { status: "READY" },
    approvedMetadataProfiles: [PROFILE],
    approvedGovernanceBundles: [GOVERNANCE],
    connectorPlanIds: ["edc-isolated"],
    allowedNamespaceOrigins: ["https://data.molit.go.kr"],
  });
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const finished = Promise.withResolvers();
  const createDataspace = service.createDataspace.bind(service);
  service.createDataspace = async (...args) => {
    entered.resolve();
    await release.promise;
    try { return await createDataspace(...args); } finally { finished.resolve(); }
  };
  const config = lifecycleConfig();
  const runtime = createDsaasServer({
    config,
    authenticator: { async authenticate() { return LIFECYCLE_ACTOR; } },
    controlPlane: service,
    scheduler: { async start() {}, async stop() {} },
  });
  const address = await runtime.start();
  t.after(() => release.resolve());
  t.after(() => runtime.close());
  config.allowedHosts.push(`127.0.0.1:${address.port}`);
  const request = fetch(`http://127.0.0.1:${address.port}/v1/dataspaces`, {
    method: "POST",
    headers: {
      authorization: "Bearer token",
      "content-type": "application/json",
      "idempotency-key": "create-after-close-0001",
    },
    body: JSON.stringify(body()),
  }).catch(() => null);
  await entered.promise;

  await runtime.close({ timeoutMs: 25 });
  assert.deepEqual(await store.read((state) => Object.keys(state.dataspaces)), []);
  release.resolve();
  await finished.promise;
  await request;
  assert.deepEqual(await store.read((state) => Object.keys(state.dataspaces)), []);
});

test("draining rejects a pipelined management request with 503", async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let authentications = 0;
  let reads = 0;
  const config = lifecycleConfig();
  const runtime = createDsaasServer({
    config,
    authenticator: {
      async authenticate() {
        authentications += 1;
        return LIFECYCLE_ACTOR;
      },
    },
    controlPlane: {
      async getDataspace(dataspaceId) {
        reads += 1;
        entered.resolve();
        await release.promise;
        return { dataspaceId, revision: 1 };
      },
    },
    scheduler: { async start() {}, async stop() {} },
  });
  const address = await runtime.start();
  config.allowedHosts.push(`127.0.0.1:${address.port}`);
  const socket = net.createConnection({ host: "127.0.0.1", port: address.port });
  t.after(() => socket.destroy());
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  const socketClosed = new Promise((resolve) => socket.once("close", resolve));
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const host = `127.0.0.1:${address.port}`;
  socket.write(`GET /v1/dataspaces/first HTTP/1.1\r\nHost: ${host}\r\nAuthorization: Bearer token\r\nConnection: keep-alive\r\nContent-Length: 0\r\n\r\n`);
  await entered.promise;

  const closing = runtime.close({ timeoutMs: 1_000 });
  assert.equal(runtime.server.listening, false);
  socket.write(`GET /v1/dataspaces/second HTTP/1.1\r\nHost: ${host}\r\nAuthorization: Bearer token\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  release.resolve();
  await closing;
  await socketClosed;

  const response = Buffer.concat(chunks).toString("utf8");
  assert.match(response, /HTTP\/1\.1 200[\s\S]+HTTP\/1\.1 503/u);
  assert.match(response, /"code":"DSAAS_SHUTTING_DOWN"/u);
  assert.equal(authentications, 1);
  assert.equal(reads, 1);
});

test("scheduler stop and HTTP drain share one absolute shutdown budget", async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let stopOptions;
  const config = lifecycleConfig();
  const runtime = createDsaasServer({
    config,
    authenticator: { async authenticate() { return LIFECYCLE_ACTOR; } },
    controlPlane: {
      async getDataspace(dataspaceId) {
        entered.resolve();
        await release.promise;
        return { dataspaceId, revision: 1 };
      },
    },
    scheduler: {
      async start() {},
      async stop(options) {
        stopOptions = options;
        await new Promise((resolve) => setTimeout(resolve, options.timeoutMs));
      },
    },
  });
  const address = await runtime.start();
  config.allowedHosts.push(`127.0.0.1:${address.port}`);
  const pendingRequest = fetch(`http://127.0.0.1:${address.port}/v1/dataspaces/slow`, {
    headers: { authorization: "Bearer token" },
  });
  const requestSettled = pendingRequest.catch(() => null);
  await entered.promise;

  const timeoutMs = 100;
  const startedAt = performance.now();
  const closing = runtime.close({ timeoutMs });
  assert.equal(runtime.server.listening, false);
  await closing;
  const elapsedMs = performance.now() - startedAt;
  release.resolve();
  await requestSettled;

  assert.ok(stopOptions.deadline <= Date.now());
  assert.ok(stopOptions.timeoutMs <= timeoutMs);
  assert.ok(elapsedMs < timeoutMs * 1.8, `close took ${elapsedMs.toFixed(1)} ms for a ${timeoutMs} ms budget`);
  t.after(() => runtime.close());
});

test("DSaaS close drains request finalizers after the HTTP response has ended", async (t) => {
  const finalizerEntered = Promise.withResolvers();
  const releaseFinalizer = Promise.withResolvers();
  const config = lifecycleConfig();
  const tracer = {
    startIncomingSpan() {
      const context = { traceId: "c".repeat(32), spanId: "d".repeat(16) };
      return {
        context,
        outboundHeaders(headers) { return { ...headers, traceparent: `00-${context.traceId}-${context.spanId}-01` }; },
        async end() {
          finalizerEntered.resolve();
          await releaseFinalizer.promise;
        },
      };
    },
  };
  const runtime = createDsaasServer({
    config,
    authenticator: { async authenticate() { return LIFECYCLE_ACTOR; } },
    controlPlane: {
      async getDataspace(dataspaceId) { return { dataspaceId, revision: 1 }; },
    },
    scheduler: { async start() {}, async stop() {} },
    tracer,
  });
  const address = await runtime.start();
  config.allowedHosts.push(`127.0.0.1:${address.port}`);
  t.after(async () => {
    releaseFinalizer.resolve();
    await runtime.close();
  });

  const completed = await fetch(`http://127.0.0.1:${address.port}/v1/dataspaces/finalizer-test`, {
    headers: { authorization: "Bearer token" },
  });
  assert.equal(completed.status, 200);
  await completed.json();
  await finalizerEntered.promise;

  let closed = false;
  const closing = runtime.close({ timeoutMs: 1_000 }).then(() => { closed = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(closed, false, "response completion must not hide an unfinished request finalizer");
  releaseFinalizer.resolve();
  await closing;
  assert.equal(closed, true);
});
