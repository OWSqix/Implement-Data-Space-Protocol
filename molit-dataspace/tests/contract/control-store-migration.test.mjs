import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { POSTGRES_JSON_STORE_MIGRATION } from "../../src/control-store/postgres-json-store.mjs";

const migration = await readFile(
  new URL("../../deploy/control-store/postgres/001_control_store.sql", import.meta.url),
  "utf8",
);
const normalized = migration.replace(/\s+/gu, " ").trim();
const projectionMigration = await readFile(
  new URL("../../deploy/control-store/postgres/002_normalized_projection.sql", import.meta.url),
  "utf8",
);

function tableBody(tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`CREATE TABLE IF NOT EXISTS ${escaped} \\(([\\s\\S]*?)\\);`, "u").exec(migration);
  assert.ok(match, `migration must create ${tableName}`);
  return match[1];
}

test("CONTROL-STORE-MIGRATION-001: runtime migration identity matches the SQL artifact", () => {
  assert.equal(POSTGRES_JSON_STORE_MIGRATION.component, "postgres-json-store");
  assert.equal(POSTGRES_JSON_STORE_MIGRATION.version, 1);
  assert.ok(normalized.startsWith("BEGIN;"));
  assert.ok(normalized.endsWith("COMMIT;"));
  assert.ok(normalized.includes(
    `INSERT INTO molit_control_store.schema_migration (component, version) VALUES ('${POSTGRES_JSON_STORE_MIGRATION.component}', ${POSTGRES_JSON_STORE_MIGRATION.version})`,
  ));
});

test("CONTROL-STORE-MIGRATION-002: snapshot and fence tables retain the runtime contract", () => {
  const snapshot = tableBody("molit_control_store.json_snapshot");
  assert.match(snapshot, /component text PRIMARY KEY/u);
  assert.match(snapshot, /revision bigint NOT NULL CHECK \(revision > 0\)/u);
  assert.match(snapshot, /state jsonb NOT NULL/u);
  assert.match(snapshot, /updated_at timestamptz NOT NULL/u);

  const fence = tableBody("molit_control_store.resource_fence");
  assert.match(fence, /component text NOT NULL/u);
  assert.match(fence, /resource_id text NOT NULL/u);
  assert.match(fence, /fencing_token bigint NOT NULL CHECK \(fencing_token > 0\)/u);
  assert.match(fence, /holder_id text NOT NULL/u);
  assert.match(fence, /acquired_at timestamptz NOT NULL/u);
  assert.match(fence, /released_at timestamptz/u);
  assert.match(fence, /PRIMARY KEY \(component, resource_id\)/u);
});

test("CONTROL-STORE-MIGRATION-003: normalized state, outbox, and append-only audit contracts are installed", () => {
  const compact = projectionMigration.replace(/\s+/gu, " ").trim();
  assert.ok(compact.startsWith("BEGIN;"));
  assert.ok(compact.endsWith("COMMIT;"));
  assert.match(compact, /VALUES \('postgres-normalized-projection', 2, clock_timestamp\(\)\)/u);
  for (const table of [
    "resource_state", "idempotency_record", "audit_event", "outbox_event", "projection_checkpoint",
    "tenant_security_audit", "tenant_audit_head", "tenant_object_reference",
    "tenant_secret_reference", "tenant_metric_sample", "tenant_database_principal",
    "tenant_principal_change_audit", "projection_tenant_registry",
  ]) {
    assert.match(compact, new RegExp(`CREATE TABLE IF NOT EXISTS molit_control_store\\.${table} \\(`, "u"));
  }
  assert.match(compact, /BEFORE UPDATE OR DELETE ON molit_control_store\.audit_event/u);
  assert.match(compact, /published_at IS NULL OR dead_lettered_at IS NULL/u);
  assert.match(compact, /\(published_at IS NULL\) = \(publish_receipt IS NULL\)/u);
  assert.match(compact, /publish_receipt_sha256 text CHECK/u);
  assert.match(compact, /WHERE published_at IS NULL AND dead_lettered_at IS NULL/u);
  assert.match(compact, /resource_state FORCE ROW LEVEL SECURITY/u);
  assert.match(compact, /idempotency_record FORCE ROW LEVEL SECURITY/u);
  assert.match(compact, /outbox_event FORCE ROW LEVEL SECURITY/u);
  assert.match(compact, /json_snapshot FORCE ROW LEVEL SECURITY/u);
  assert.match(compact, /resource_fence FORCE ROW LEVEL SECURITY/u);
  assert.match(compact, /projection_checkpoint FORCE ROW LEVEL SECURITY/u);
  assert.match(compact, /projection_tenant_registry FORCE ROW LEVEL SECURITY/u);
  assert.match(compact, /tenant_database_principal binding WHERE binding\.database_role = session_user/u);
  assert.match(compact, /CREATE OR REPLACE FUNCTION molit_control_store\.enroll_current_service_principal/u);
  assert.match(compact, /caller_role\.rolsuper[\s\S]*caller_role\.rolbypassrls/u);
  assert.match(compact, /current_setting\('molit\.actor_id', true\) IS DISTINCT FROM expected_actor_id/u);
  assert.match(compact, /REVOKE ALL ON FUNCTION molit_control_store\.enroll_current_service_principal\(text, text\) FROM PUBLIC/u);
  assert.match(compact, /CREATE POLICY platform_service_only ON molit_control_store\.json_snapshot/u);
  assert.match(compact, /CREATE POLICY platform_service_only ON molit_control_store\.projection_tenant_registry/u);
  assert.match(compact, /tenant_security_audit_append_only/u);
  assert.match(compact, /tenant_database_principal_change_audit/u);
  assert.match(compact, /tenant_principal_change_audit_append_only/u);
  assert.match(compact, /labels ->> 'tenant\.id' = tenant_id/u);
});
