import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { POSTGRES_JSON_STORE_MIGRATION } from "../../src/control-store/postgres-json-store.mjs";

const migration = await readFile(
  new URL("../../deploy/control-store/postgres/001_control_store.sql", import.meta.url),
  "utf8",
);
const normalized = migration.replace(/\s+/gu, " ").trim();

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
