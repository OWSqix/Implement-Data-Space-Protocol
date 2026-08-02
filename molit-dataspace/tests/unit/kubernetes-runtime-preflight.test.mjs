import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { validateKubernetesRuntimeFiles } from "../../src/operations/kubernetes-preflight.mjs";

test("Kubernetes runtime preflight resolves mounted identity, observability, TLS, and outbound mTLS files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-kube-preflight-"));
  const file = async (name, content = "material") => {
    const path = join(directory, name);
    await writeFile(path, content);
    return path;
  };
  const ca = await file("ca.crt");
  const cert = await file("tls.crt");
  const key = await file("tls.key");
  const clientCa = await file("client-ca.crt");
  const token = await file("token");
  const salt = await file("salt");
  const identitySecret = await file("identity-secret");
  const clientSecret = await file("caas-client-secret");
  const reference = (path) => pathToFileURL(path).href;
  const identityPath = await file("identity.json", JSON.stringify({ introspection: { clientSecretRef: reference(identitySecret) } }));
  const backendTls = { caRef: reference(ca), certificateRef: reference(cert), privateKeyRef: reference(key), serverName: "telemetry.example", reloadIntervalMs: 30_000 };
  const observabilityPath = await file("observability.json", JSON.stringify({
    tracing: { endpoint: "https://telemetry.example/v1/traces", authorizationRef: reference(token), tenantSaltRef: reference(salt), tls: backendTls },
    metrics: { endpoint: "https://telemetry.example/v1/metrics", authorizationRef: reference(token), tls: backendTls },
    logs: { endpoint: "https://telemetry.example/v1/logs", authorizationRef: reference(token), tls: backendTls },
    audit: { baseUrl: "https://audit.example/", authorizationRef: reference(token), tls: { ...backendTls, serverName: "audit.example" } },
    usageMeter: { outbox: { maxAttempts: 12, batchSize: 50, leaseMs: 30_000, pollIntervalMs: 1_000, retryBaseMs: 1_000, retryMaxMs: 300_000, healthIntervalMs: 30_000 } },
  }));
  const schemaReceiptPath = await file("control-store-receipt.json", JSON.stringify({
    schemaVersion: "molit.control-store-schema-receipt/1",
    migration: { component: "postgres-scoped-control-store", version: 4 },
    components: ["caas", "dsaas"].map((component) => ({
      component,
      mode: "scoped-authoritative",
      sourceKind: component === "dsaas" ? "legacy-file-snapshot" : "fresh-install",
      sourceSnapshotRevision: 1,
      sourceSnapshotSha256: "a".repeat(64),
      sourceApprovalEvidenceSha256: component === "dsaas" ? "d".repeat(64) : null,
      legacyKeyConversionCount: component === "dsaas" ? 2 : 0,
      scopeMapSha256: null,
      scopeMapApprovalEvidenceSha256: null,
      currentStateRootSha256: component === "caas" ? "b".repeat(64) : "e".repeat(64),
      stateRootSha256: component === "caas" ? "b".repeat(64) : "c".repeat(64),
      cutoverAt: "2026-07-14T00:00:00.000Z",
    })),
  }));
  const runtimePath = await file("runtime.json", JSON.stringify({
    environment: "production",
    identityConfigPath: identityPath,
    observabilityConfigPath: observabilityPath,
    tls: { certFile: cert, keyFile: key, clientCaFile: clientCa },
    caas: { auth: { caFile: ca, certFile: cert, keyFile: key, clientSecretRef: reference(clientSecret) } },
  }));
  const probed = [];
  const databases = [];
  const result = await validateKubernetesRuntimeFiles({
    runtimePath,
    schemaReceiptPath,
    service: "dsaas",
    endpointProbe: async (endpoint) => { probed.push(new URL(endpoint).origin); },
    databaseProbe: async (value) => { databases.push(value); },
  });
  assert.deepEqual(result.backendOrigins, ["https://audit.example", "https://telemetry.example"]);
  assert.deepEqual(probed.sort(), result.backendOrigins);
  assert.equal(result.controlStore.migrationVersion, 4);
  assert.equal(result.controlStore.mode, "scoped-authoritative");
  assert.equal(result.controlStore.cutoverStateRootSha256, "c".repeat(64));
  assert.equal(databases[0].expected.sourceKind, "legacy-file-snapshot");
  assert.equal(databases[0].expected.sourceApprovalEvidenceSha256, "d".repeat(64));
  assert.equal(databases[0].expected.legacyKeyConversionCount, 2);
});

test("Kubernetes runtime preflight rejects an unapproved legacy-file cutover receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-kube-preflight-receipt-"));
  const receiptPath = join(directory, "receipt.json");
  await writeFile(receiptPath, JSON.stringify({
    schemaVersion: "molit.control-store-schema-receipt/1",
    migration: { component: "postgres-scoped-control-store", version: 4 },
    components: ["caas", "dsaas"].map((component) => ({
      component,
      mode: "scoped-authoritative",
      sourceKind: "legacy-file-snapshot",
      sourceSnapshotRevision: 1,
      sourceSnapshotSha256: "a".repeat(64),
      sourceApprovalEvidenceSha256: null,
      legacyKeyConversionCount: 1,
      scopeMapSha256: null,
      scopeMapApprovalEvidenceSha256: null,
      currentStateRootSha256: "b".repeat(64),
      stateRootSha256: "b".repeat(64),
      cutoverAt: "2026-07-14T00:00:00.000Z",
    })),
  }));
  await assert.rejects(validateKubernetesRuntimeFiles({
    runtimePath: join(directory, "runtime.json"),
    schemaReceiptPath: receiptPath,
    service: "caas",
    endpointProbe: async () => {},
    databaseProbe: async () => {},
  }), /receipt/u);
});

test("Kubernetes runtime preflight fails closed when mounted material is absent", async () => {
  await assert.rejects(validateKubernetesRuntimeFiles({
    runtimePath: "Z:/absent/runtime.json",
    schemaReceiptPath: "Z:/absent/receipt.json",
    service: "caas",
    endpointProbe: async () => {},
    databaseProbe: async () => {},
  }));
});
