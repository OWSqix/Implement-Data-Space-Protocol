import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import pg from "pg";

import { createPostgresPool } from "../../src/control-store/postgres-json-store.mjs";
import { PostgresScopedControlStore } from "../../src/control-store/postgres-scoped-control-store.mjs";
import { prepareScopedControlStoreCutover } from "../../src/control-store/scoped-cutover.mjs";
import { identityTlsFixtures } from "../fixtures/identity-tls/generate.mjs";

const { Pool } = pg;
const connectionString = process.env.MOLIT_POSTGRES_INTEGRATION_URL;

function withHost(base, host, role, password) {
  const url = new URL(base);
  url.hostname = host;
  if (role) url.username = role;
  if (password) url.password = password;
  return url.toString();
}

function poolConfiguration() {
  return {
    connectionStringEnv: "PG_TLS_URL",
    holderIdEnv: "PG_TLS_HOLDER",
    applicationName: "molit-scoped-tls-integration",
    tls: { mode: "verify-full", caEnv: "PG_TLS_CA" },
    maxPoolSize: 2,
    maxLeasePoolSize: 1,
    connectionTimeoutMs: 3_000,
    idleTimeoutMs: 3_000,
    statementTimeoutMs: 5_000,
    lockTimeoutMs: 2_000,
  };
}

async function closePools(created) {
  await Promise.allSettled([created.pool.end(), created.leasePool.end()]);
}

test("P0 scoped runtime negotiates verify-full PostgreSQL TLS and rejects wrong trust", {
  skip: !connectionString,
  timeout: 60_000,
}, async () => {
  // The PostgreSQL container is started from deploy/control-store/postgres/compose.test.yml,
  // which bind-mounts tests/fixtures/identity-tls and serves server-one.crt issued by root.crt.
  // This test must therefore trust the same on-disk anchor the container was handed, so it reads
  // the materialized file rather than generating a fresh one. Produce it before compose starts:
  //   node tests/fixtures/identity-tls/generate.mjs
  const rootCa = await readFile(new URL("../fixtures/identity-tls/root.crt", import.meta.url), "utf8").catch((cause) => {
    throw new Error("tests/fixtures/identity-tls/root.crt is missing; run `node tests/fixtures/identity-tls/generate.mjs` before starting the PostgreSQL TLS compose stack", { cause });
  });
  // The wrong-trust anchor has no such constraint: any CA that did not issue the server
  // certificate proves the negative, so it is generated in-process and never touches disk.
  const wrongCa = identityTlsFixtures().untrusted;
  const admin = new Pool({
    connectionString: withHost(connectionString, "localhost"),
    max: 2,
    ssl: { ca: rootCa, rejectUnauthorized: true },
  });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const role = `molit_caas_tls_${suffix}`;
  const password = `Scoped-TLS-${suffix}-9`;
  const quoted = await admin.query("SELECT quote_ident($1) AS role, quote_literal($2) AS password", [role, password]);
  try {
    await admin.query("DROP SCHEMA IF EXISTS molit_control_store CASCADE");
    for (const name of ["001_control_store.sql", "002_normalized_projection.sql", "003_usage_metering.sql", "004_authoritative_scoped_state.sql"]) {
      await admin.query(await readFile(new URL(`../../deploy/control-store/postgres/${name}`, import.meta.url), "utf8"));
    }
    await prepareScopedControlStoreCutover({ pool: admin, component: "caas" });
    await prepareScopedControlStoreCutover({ pool: admin, component: "dsaas" });
    await admin.query(
      `CREATE ROLE ${quoted.rows[0].role}
       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
       PASSWORD ${quoted.rows[0].password}`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA molit_control_store TO ${quoted.rows[0].role}`);
    await admin.query(`GRANT SELECT ON molit_control_store.schema_migration, molit_control_store.control_store_mode TO ${quoted.rows[0].role}`);
    await admin.query(`GRANT UPDATE (state_root_sha256, updated_at) ON molit_control_store.control_store_mode TO ${quoted.rows[0].role}`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON
         molit_control_store.resource_fence,
         molit_control_store.resource_state,
         molit_control_store.idempotency_record,
         molit_control_store.audit_event,
         molit_control_store.outbox_event,
         molit_control_store.tenant_security_audit,
         molit_control_store.tenant_audit_head,
         molit_control_store.tenant_object_reference,
         molit_control_store.tenant_secret_reference,
         molit_control_store.tenant_metric_sample,
         molit_control_store.usage_meter_event,
         molit_control_store.usage_meter_rollup,
         molit_control_store.usage_meter_reprocess,
         molit_control_store.scoped_control_state,
         molit_control_store.control_scope_registry,
         molit_control_store.component_audit_head
       TO ${quoted.rows[0].role}`,
    );
    await admin.query(
      `GRANT EXECUTE ON FUNCTION
         molit_control_store.enroll_scoped_service_principal(text, text),
         molit_control_store.component_principal_active(text),
         molit_control_store.component_tenant_row_visible(text, text),
         molit_control_store.component_platform_row_visible(text)
       TO ${quoted.rows[0].role}`,
    );
    await admin.query(
      `INSERT INTO molit_control_store.control_component_principal
         (database_role, component, active, approved_by, approval_reference)
       VALUES ($1, 'caas', true, 'integration-test', 'P0-TLS-COMPONENT')`,
      [role],
    );
    await admin.query(
      `INSERT INTO molit_control_store.tenant_database_principal
         (database_role, tenant_id, access_mode, active, valid_until, approved_by, approval_reference)
       VALUES ($1, 'molit-platform', 'service', true, NULL, 'integration-test', 'P0-TLS-PLATFORM')`,
      [role],
    );

    const runtimeUrl = withHost(connectionString, "localhost", role, password);
    const created = createPostgresPool({
      config: poolConfiguration(),
      env: { PG_TLS_CA: rootCa, PG_TLS_HOLDER: "scoped-tls-runtime", PG_TLS_URL: runtimeUrl },
    });
    const store = new PostgresScopedControlStore({
      pool: created.pool,
      leasePool: created.leasePool,
      component: "caas",
      holderId: created.holderId,
      maxScopes: 10,
    });
    await store.initialize();
    assert.deepEqual(await store.readiness(), { ready: true, status: "READY", failureCode: null });
    await store.close();

    const wrongTrust = createPostgresPool({
      config: poolConfiguration(),
      env: { PG_TLS_CA: wrongCa, PG_TLS_HOLDER: "scoped-tls-wrong-ca", PG_TLS_URL: runtimeUrl },
    });
    try {
      await assert.rejects(wrongTrust.pool.query("SELECT 1"), (error) => /certificate|self-signed|issuer/iu.test(error.message));
    } finally { await closePools(wrongTrust); }

    const wrongHost = createPostgresPool({
      config: poolConfiguration(),
      env: {
        PG_TLS_CA: rootCa,
        PG_TLS_HOLDER: "scoped-tls-wrong-host",
        PG_TLS_URL: withHost(connectionString, "127.0.0.1.sslip.io", role, password),
      },
    });
    try {
      await assert.rejects(wrongHost.pool.query("SELECT 1"), (error) => error.code === "ERR_TLS_CERT_ALTNAME_INVALID"
        || /hostname|IP.*certificate|not in the cert/iu.test(error.message));
    } finally { await closePools(wrongHost); }
  } finally {
    await admin.query("DELETE FROM molit_control_store.control_component_principal WHERE database_role = $1", [role]).catch(() => {});
    await admin.query("DELETE FROM molit_control_store.tenant_database_principal WHERE database_role = $1", [role]).catch(() => {});
    await admin.query(`DROP OWNED BY ${quoted.rows[0].role}`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${quoted.rows[0].role}`).catch(() => {});
    await admin.end();
  }
});
