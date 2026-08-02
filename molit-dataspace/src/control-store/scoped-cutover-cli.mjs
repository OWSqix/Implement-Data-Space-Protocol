import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { prepareScopedControlStoreCutover } from "./scoped-cutover.mjs";

const MAX_SCOPE_MAP_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

async function readApprovedScopeMap(path) {
  if (!path) return undefined;
  const metadata = await stat(path);
  assertRuntime(metadata.isFile() && metadata.size <= MAX_SCOPE_MAP_BYTES,
    "CONTROL_CUTOVER_SCOPE_MAP_INVALID", "approved scope map is absent or exceeds its byte limit");
  let parsed;
  try { parsed = JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    throw new RuntimeError("CONTROL_CUTOVER_SCOPE_MAP_INVALID", "approved scope map is not valid JSON", { causeCode: error?.code ?? error?.name });
  }
  return parsed;
}

async function readApprovedLegacySource(path) {
  if (!path) return undefined;
  const metadata = await stat(path);
  assertRuntime(metadata.isFile() && metadata.size <= MAX_SCOPE_MAP_BYTES,
    "CONTROL_CUTOVER_LEGACY_SOURCE_INVALID", "approved legacy source is absent or exceeds its byte limit");
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    throw new RuntimeError("CONTROL_CUTOVER_LEGACY_SOURCE_INVALID", "approved legacy source is not valid JSON", { causeCode: error?.code ?? error?.name });
  }
}

export async function runScopedCutover({
  databaseUrl,
  databaseCaFile,
  caasScopeMapPath,
  dsaasScopeMapPath,
  caasLegacySourcePath,
  dsaasLegacySourcePath,
  poolFactory = (configuration) => new pg.Pool(configuration),
} = {}) {
  assertRuntime(typeof databaseUrl === "string" && databaseUrl.length >= 12 && databaseUrl.length <= 8_192,
    "CONTROL_CUTOVER_CONFIG_INVALID", "migration database URL is required");
  const ca = databaseCaFile ? await readFile(databaseCaFile, "utf8") : undefined;
  assertRuntime(ca === undefined || (ca.includes("-----BEGIN CERTIFICATE-----") && ca.includes("-----END CERTIFICATE-----")),
    "CONTROL_CUTOVER_CONFIG_INVALID", "migration database CA is not a PEM certificate");
  const pool = poolFactory({
    connectionString: databaseUrl,
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    max: 1,
    application_name: "molit-scoped-control-store-cutover",
  });
  try {
    const caasScopeMap = await readApprovedScopeMap(caasScopeMapPath);
    const dsaasScopeMap = await readApprovedScopeMap(dsaasScopeMapPath);
    const caasLegacySource = await readApprovedLegacySource(caasLegacySourcePath);
    const dsaasLegacySource = await readApprovedLegacySource(dsaasLegacySourcePath);
    for (const [component, approvedScopeMap, legacySource] of [
      ["caas", caasScopeMap, caasLegacySource],
      ["dsaas", dsaasScopeMap, dsaasLegacySource],
    ]) {
      await prepareScopedControlStoreCutover({ pool, component, approvedScopeMap, legacySource });
    }
    const verified = await pool.query(
      `SELECT migration.version, mode.component, mode.mode, mode.source_kind,
              mode.source_snapshot_revision::text, mode.source_snapshot_sha256,
              mode.source_approval_evidence_sha256, mode.legacy_key_conversion_count,
              mode.scope_map_sha256, mode.scope_map_approval_evidence_sha256,
              mode.cutover_state_root_sha256, mode.state_root_sha256, mode.cutover_at,
              head.state_root_sha256 AS audit_state_root_sha256
       FROM molit_control_store.schema_migration migration
       CROSS JOIN molit_control_store.control_store_mode mode
       JOIN molit_control_store.component_audit_head head ON head.component = mode.component
       WHERE migration.component = 'postgres-scoped-control-store'
         AND mode.component = ANY($1::text[])
       ORDER BY mode.component`,
      [["caas", "dsaas"]],
    );
    assertRuntime(verified.rows.length === 2 && verified.rows.every((row) => Number(row.version) === 4
      && row.mode === "scoped-authoritative" && ["json-snapshot", "fresh-install", "legacy-file-snapshot"].includes(row.source_kind)
      && Number(row.source_snapshot_revision) > 0 && SHA256.test(row.source_snapshot_sha256 ?? "")
      && (row.scope_map_sha256 === null || SHA256.test(row.scope_map_sha256))
      && (row.scope_map_approval_evidence_sha256 === null || SHA256.test(row.scope_map_approval_evidence_sha256))
      && (row.source_kind !== "legacy-file-snapshot" || SHA256.test(row.source_approval_evidence_sha256 ?? ""))
      && Number.isSafeInteger(Number(row.legacy_key_conversion_count)) && Number(row.legacy_key_conversion_count) >= 0
      && SHA256.test(row.cutover_state_root_sha256 ?? "")
      && SHA256.test(row.state_root_sha256 ?? "") && row.state_root_sha256 === row.audit_state_root_sha256
      && Number.isFinite(new Date(row.cutover_at).valueOf())),
    "CONTROL_CUTOVER_RECEIPT_INVALID", "scoped-authoritative cutover receipt is incomplete or inconsistent");
    return Object.freeze({
      schemaVersion: "molit.control-store-schema-receipt/1",
      migration: Object.freeze({ component: "postgres-scoped-control-store", version: 4 }),
      components: Object.freeze(verified.rows.map((row) => Object.freeze({
        component: row.component,
        mode: row.mode,
        sourceKind: row.source_kind,
        sourceSnapshotRevision: Number(row.source_snapshot_revision),
        sourceSnapshotSha256: row.source_snapshot_sha256,
        sourceApprovalEvidenceSha256: row.source_approval_evidence_sha256,
        legacyKeyConversionCount: Number(row.legacy_key_conversion_count),
        scopeMapSha256: row.scope_map_sha256,
        scopeMapApprovalEvidenceSha256: row.scope_map_approval_evidence_sha256,
        currentStateRootSha256: row.state_root_sha256,
        stateRootSha256: row.cutover_state_root_sha256,
        cutoverAt: new Date(row.cutover_at).toISOString(),
      }))),
    });
  } finally {
    await pool.end();
  }
}

async function main() {
  const receipt = await runScopedCutover({
    databaseUrl: process.env.MOLIT_CONTROL_STORE_MIGRATION_DATABASE_URL,
    databaseCaFile: process.env.MOLIT_CONTROL_STORE_MIGRATION_CA_FILE,
    caasScopeMapPath: process.env.MOLIT_CAAS_SCOPE_MAP_PATH,
    dsaasScopeMapPath: process.env.MOLIT_DSAAS_SCOPE_MAP_PATH,
    caasLegacySourcePath: process.env.MOLIT_CAAS_LEGACY_SOURCE_PATH,
    dsaasLegacySourcePath: process.env.MOLIT_DSAAS_LEGACY_SOURCE_PATH,
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ code: error?.code ?? "CONTROL_CUTOVER_FAILED", message: error?.message ?? "control-store cutover failed" })}\n`);
    process.exitCode = 1;
  });
}
