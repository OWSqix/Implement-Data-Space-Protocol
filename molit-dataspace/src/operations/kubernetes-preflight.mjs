#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

const { Pool } = pg;

const MAX_FILE_BYTES = 1024 * 1024;

async function readBounded(path, label) {
  const information = await stat(path);
  if (!information.isFile() || information.size < 1 || information.size > MAX_FILE_BYTES) {
    throw new Error(`${label} is absent, empty, or exceeds ${MAX_FILE_BYTES} bytes`);
  }
  return readFile(path);
}

async function readJson(path, label) {
  const value = JSON.parse((await readBounded(path, label)).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function fileReferencePath(reference, label) {
  const value = new URL(reference);
  if (value.protocol !== "file:" || value.hostname || value.username || value.password || value.search || value.hash) {
    throw new Error(`${label} must be one local file reference`);
  }
  return fileURLToPath(value);
}

async function requireReference(reference, label) {
  return readBounded(fileReferencePath(reference, label), label);
}

function validateReloadInterval(tls, label) {
  if (!Number.isSafeInteger(tls?.reloadIntervalMs) || tls.reloadIntervalMs < 250 || tls.reloadIntervalMs > 300_000) {
    throw new Error(`${label} mTLS reloadIntervalMs must be between 250 and 300000`);
  }
}

function validateUsageOutbox(observability) {
  const outbox = observability.usageMeter?.outbox;
  const bounds = {
    maxAttempts: [1, 100],
    batchSize: [1, 500],
    leaseMs: [1_000, 900_000],
    pollIntervalMs: [10, 60_000],
    retryBaseMs: [10, 86_400_000],
    retryMaxMs: [10, 86_400_000],
    healthIntervalMs: [1_000, 300_000],
  };
  for (const [name, [minimum, maximum]] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(outbox?.[name]) || outbox[name] < minimum || outbox[name] > maximum) {
      throw new Error(`usageMeter.outbox.${name} is absent or outside the operational range`);
    }
  }
  if (outbox.retryMaxMs < outbox.retryBaseMs) throw new Error("usageMeter.outbox.retryMaxMs must be at least retryBaseMs");
}

function expectedScopedReceipt(receipt, service) {
  const migration = receipt?.migration;
  const components = receipt?.components;
  const row = Array.isArray(components) ? components.find((entry) => entry?.component === service) : undefined;
  const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const optionalSha256 = (value) => value === null || sha256(value);
  const validComponent = (entry) => entry?.mode === "scoped-authoritative"
    && ["json-snapshot", "fresh-install", "legacy-file-snapshot"].includes(entry.sourceKind)
    && Number.isSafeInteger(entry.sourceSnapshotRevision) && entry.sourceSnapshotRevision >= 1
    && sha256(entry.sourceSnapshotSha256)
    && optionalSha256(entry.sourceApprovalEvidenceSha256)
    && Number.isSafeInteger(entry.legacyKeyConversionCount) && entry.legacyKeyConversionCount >= 0
    && optionalSha256(entry.scopeMapSha256) && optionalSha256(entry.scopeMapApprovalEvidenceSha256)
    && (entry.scopeMapSha256 === null) === (entry.scopeMapApprovalEvidenceSha256 === null)
    && (entry.sourceKind !== "legacy-file-snapshot" || sha256(entry.sourceApprovalEvidenceSha256))
    && sha256(entry.stateRootSha256) && sha256(entry.currentStateRootSha256)
    && Number.isFinite(Date.parse(entry.cutoverAt));
  if (receipt?.schemaVersion !== "molit.control-store-schema-receipt/1"
    || migration?.component !== "postgres-scoped-control-store" || migration?.version !== 4
    || components?.length !== 2 || new Set(components.map((entry) => entry?.component)).size !== 2
    || !components.every((entry) => ["caas", "dsaas"].includes(entry?.component))
    || !components.every(validComponent) || !row) {
    throw new Error("control-store schema receipt is absent, incomplete, or not scoped-authoritative");
  }
  return row;
}

export async function probeScopedDatabase({ runtime, service, expected, environment = process.env }) {
  const store = runtime.stateStore;
  const connectionString = environment[store?.connectionStringEnv];
  const ca = environment[store?.tls?.caEnv];
  if (store?.type !== "postgres" || store.tls?.mode !== "verify-full"
    || typeof connectionString !== "string" || typeof ca !== "string"
    || !ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
    throw new Error("production scoped control store requires PostgreSQL verify-full credentials");
  }
  const pool = new Pool({
    connectionString,
    ssl: { ca, rejectUnauthorized: true },
    application_name: `molit-${service}-preflight`,
    max: 1,
    connectionTimeoutMillis: store.connectionTimeoutMs,
    idleTimeoutMillis: store.idleTimeoutMs,
    statement_timeout: store.statementTimeoutMs,
    lock_timeout: store.lockTimeoutMs,
  });
  let client;
  let transaction = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    transaction = true;
    await client.query("SELECT set_config('molit.tenant_id', 'molit-platform', true), set_config('molit.access_mode', 'service', true)");
    const result = await client.query(
      `SELECT migration.version, mode.mode, mode.source_kind, mode.source_snapshot_revision::text,
              mode.source_snapshot_sha256, mode.source_approval_evidence_sha256,
              mode.legacy_key_conversion_count::text, mode.scope_map_sha256,
              mode.scope_map_approval_evidence_sha256,
              mode.cutover_state_root_sha256, mode.state_root_sha256 AS current_state_root_sha256,
              mode.cutover_at,
              head.state_root_sha256 AS audit_state_root_sha256,
              molit_control_store.component_principal_active($1) AS component_principal_active,
              has_table_privilege(session_user, 'molit_control_store.json_snapshot', 'SELECT') AS snapshot_readable,
              has_table_privilege(session_user, 'molit_control_store.json_snapshot', 'UPDATE') AS snapshot_writable
       FROM molit_control_store.schema_migration migration
       JOIN molit_control_store.control_store_mode mode ON mode.component = $1
       JOIN molit_control_store.component_audit_head head ON head.component = mode.component
       WHERE migration.component = 'postgres-scoped-control-store'`,
      [service],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || Number(row.version) !== 4 || row.mode !== "scoped-authoritative"
      || row.source_kind !== expected.sourceKind
      || Number(row.source_snapshot_revision) !== expected.sourceSnapshotRevision
      || row.source_snapshot_sha256 !== expected.sourceSnapshotSha256
      || row.source_approval_evidence_sha256 !== expected.sourceApprovalEvidenceSha256
      || Number(row.legacy_key_conversion_count) !== expected.legacyKeyConversionCount
      || row.scope_map_sha256 !== expected.scopeMapSha256
      || row.scope_map_approval_evidence_sha256 !== expected.scopeMapApprovalEvidenceSha256
      || row.cutover_state_root_sha256 !== expected.stateRootSha256
      || row.current_state_root_sha256 !== row.audit_state_root_sha256
      || new Date(row.cutover_at).toISOString() !== new Date(expected.cutoverAt).toISOString()
      || row.component_principal_active !== true || row.snapshot_readable !== false || row.snapshot_writable !== false) {
      throw new Error(`${service} control-store migration, cutover, runtime binding, or receipt verification failed`);
    }
    await client.query("COMMIT");
    transaction = false;
    return {
      component: service,
      cutoverStateRootSha256: row.cutover_state_root_sha256,
      currentStateRootSha256: row.current_state_root_sha256,
      mode: row.mode,
    };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release(transaction);
    await pool.end();
  }
}

export async function probeTlsEndpoint(endpoint, tls, { timeoutMs = 5_000 } = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(`backend endpoint must use HTTPS: ${endpoint}`);
  await lookup(url.hostname, { all: true });
  const [ca, cert, key] = await Promise.all([
    requireReference(tls.caRef, "backend CA"),
    requireReference(tls.certificateRef, "backend client certificate"),
    requireReference(tls.privateKeyRef, "backend client private key"),
  ]);
  await new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host: url.hostname,
      port: Number(url.port || 443),
      servername: tls.serverName,
      ca,
      cert,
      key,
      rejectUnauthorized: true,
    });
    const timer = setTimeout(() => socket.destroy(new Error(`TLS preflight timed out for ${url.origin}`)), timeoutMs);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function validateKubernetesRuntimeFiles({
  runtimePath,
  schemaReceiptPath,
  service,
  endpointProbe = probeTlsEndpoint,
  databaseProbe = probeScopedDatabase,
}) {
  if (!["caas", "dsaas"].includes(service)) throw new Error("service must be caas or dsaas");
  const runtime = await readJson(runtimePath, "runtime configuration");
  if (runtime.environment !== "production") throw new Error("Kubernetes HA preflight requires a production runtime configuration");
  const [identity, observability, schemaReceipt] = await Promise.all([
    readJson(runtime.identityConfigPath, "identity configuration"),
    readJson(runtime.observabilityConfigPath, "observability configuration"),
    readJson(schemaReceiptPath, "control-store schema receipt"),
  ]);
  const expectedReceipt = expectedScopedReceipt(schemaReceipt, service);
  if (identity.introspection?.clientSecretRef) await requireReference(identity.introspection.clientSecretRef, "identity introspection secret");
  await Promise.all([runtime.tls?.certFile, runtime.tls?.keyFile, runtime.tls?.clientCaFile]
    .map((path, index) => readBounded(path, ["inbound TLS certificate", "inbound TLS private key", "inbound client CA"][index])));
  const backendEntries = [
    ["tracing", observability.tracing?.endpoint, observability.tracing],
    ["metrics", observability.metrics?.endpoint, observability.metrics],
    ["logs", observability.logs?.endpoint, observability.logs],
    ["audit", observability.audit?.baseUrl, observability.audit],
  ];
  validateUsageOutbox(observability);
  const uniqueBackends = new Map();
  const referencedSecrets = [];
  for (const [name, endpoint, signal] of backendEntries) {
    const tls = signal?.tls;
    if (!endpoint || !tls) throw new Error("all operational observability backends require an endpoint and mTLS policy");
    validateReloadInterval(tls, name);
    referencedSecrets.push(requireReference(signal.authorizationRef, `${name} authorization secret`));
    const url = new URL(endpoint);
    const identity = [url.origin, tls.caRef, tls.certificateRef, tls.privateKeyRef, tls.serverName ?? ""].join("\0");
    uniqueBackends.set(identity, [endpoint, tls]);
  }
  referencedSecrets.push(requireReference(observability.tracing.tenantSaltRef, "tenant hashing salt"));
  await Promise.all([
    ...referencedSecrets,
    ...[...uniqueBackends.values()].map(([endpoint, tls]) => endpointProbe(endpoint, tls)),
    databaseProbe({ runtime, service, expected: expectedReceipt }),
  ]);
  if (service === "dsaas") {
    await Promise.all([
      readBounded(runtime.caas.auth.caFile, "CaaS client CA"),
      readBounded(runtime.caas.auth.certFile, "CaaS client certificate"),
      readBounded(runtime.caas.auth.keyFile, "CaaS client private key"),
      requireReference(runtime.caas.auth.clientSecretRef, "CaaS OAuth client secret"),
    ]);
  }
  return {
    service,
    backendOrigins: [...new Set([...uniqueBackends.values()].map(([endpoint]) => new URL(endpoint).origin))].sort(),
    controlStore: {
      cutoverStateRootSha256: expectedReceipt.stateRootSha256,
      migrationVersion: 4,
      mode: "scoped-authoritative",
    },
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateKubernetesRuntimeFiles({
    runtimePath: argument("--runtime"),
    schemaReceiptPath: argument("--schema-receipt"),
    service: argument("--service"),
  })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ code: "MOLIT_KUBERNETES_PREFLIGHT_FAILED", message: error.message })}\n`);
      process.exitCode = 1;
    });
}
