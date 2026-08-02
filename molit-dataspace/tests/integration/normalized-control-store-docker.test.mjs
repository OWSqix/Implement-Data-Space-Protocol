import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

import { digest } from "../../src/discovery/stable-json.mjs";
import { NormalizedControlProjection } from "../../src/control-store/normalized-projection.mjs";
import { PostgresJsonStore, createPostgresPool } from "../../src/control-store/postgres-json-store.mjs";
import { PostgresOutbox } from "../../src/control-store/postgres-outbox.mjs";

const { Pool } = pg;
const connectionString = process.env.MOLIT_POSTGRES_INTEGRATION_URL;

function emptyState() {
  return {
    schemaVersion: "test.normalized-caas-state/1",
    tenants: {},
    requests: {},
    audit: [],
    integrity: { snapshotDigest: digest({ tenants: {}, requests: {} }) },
  };
}

function validateState(state) {
  assert.equal(state?.schemaVersion, "test.normalized-caas-state/1");
  assert.equal(typeof state.tenants, "object");
  assert.equal(typeof state.requests, "object");
  assert.equal(Array.isArray(state.audit), true);
  return state;
}

function sealState(state) {
  state.integrity = { snapshotDigest: digest({ tenants: state.tenants, requests: state.requests }) };
  return state;
}

function createAuditEvent(sequence, previousDigest, action, occurredAt) {
  const unsigned = { action, occurredAt, previousDigest, sequence };
  return { ...unsigned, eventDigest: digest(unsigned) };
}

function roleConnection(base, role, password) {
  const url = new URL(base);
  url.username = role;
  url.password = password;
  return url.toString();
}

async function createLogin(admin) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const role = `molit_normalized_runtime_${suffix}`;
  const password = `NormalizedTest-${suffix}-9`;
  const quoted = await admin.query("SELECT quote_ident($1) AS role, quote_literal($2) AS password", [role, password]);
  await admin.query(`CREATE ROLE ${quoted.rows[0].role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${quoted.rows[0].password}`);
  return { password, quoted: quoted.rows[0].role, role };
}

function runtimePools(holderId, databaseUrl = connectionString) {
  return createPostgresPool({
    config: {
      connectionStringEnv: "POSTGRES_URL",
      holderIdEnv: "POSTGRES_HOLDER_ID",
      applicationName: "molit-normalized-control-store-it",
      tls: { mode: "disable" },
      maxPoolSize: 2,
      maxLeasePoolSize: 1,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 5_000,
      statementTimeoutMs: 10_000,
      lockTimeoutMs: 5_000,
    },
    env: { POSTGRES_HOLDER_ID: holderId, POSTGRES_URL: databaseUrl },
  });
}

test("normalized projection and transactional outbox remain consistent under competing workers", {
  skip: !connectionString,
  timeout: 45_000,
}, async (t) => {
  const admin = new Pool({ connectionString, max: 4, ssl: false });
  const migration1 = await readFile(new URL("../../deploy/control-store/postgres/001_control_store.sql", import.meta.url), "utf8");
  const migration2 = await readFile(new URL("../../deploy/control-store/postgres/002_normalized_projection.sql", import.meta.url), "utf8");
  await admin.query(migration1);
  await admin.query(migration2);

  const component = "caas";
  await admin.query("TRUNCATE molit_control_store.tenant_principal_change_audit, molit_control_store.projection_tenant_registry, molit_control_store.outbox_event, molit_control_store.audit_event, molit_control_store.idempotency_record, molit_control_store.resource_state, molit_control_store.projection_checkpoint, molit_control_store.resource_fence, molit_control_store.json_snapshot");
  const runtimeLogin = await createLogin(admin);
  await admin.query(`GRANT USAGE ON SCHEMA molit_control_store TO ${runtimeLogin.quoted}`);
  await admin.query(`GRANT SELECT ON molit_control_store.schema_migration TO ${runtimeLogin.quoted}`);
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE
     ON molit_control_store.json_snapshot,
        molit_control_store.resource_fence,
        molit_control_store.projection_checkpoint,
        molit_control_store.projection_tenant_registry,
        molit_control_store.resource_state,
        molit_control_store.idempotency_record,
        molit_control_store.audit_event,
        molit_control_store.outbox_event,
        molit_control_store.tenant_secret_reference
     TO ${runtimeLogin.quoted}`,
  );
  await admin.query(`GRANT EXECUTE ON FUNCTION molit_control_store.enroll_current_service_principal(text, text) TO ${runtimeLogin.quoted}`);
  await admin.query(
    `INSERT INTO molit_control_store.tenant_database_principal
       (database_role, tenant_id, access_mode, approved_by, approval_reference)
     VALUES ($1, 'molit-platform', 'service', 'integration-test', 'NORMALIZED-PROJECTION/PLATFORM')`,
    [runtimeLogin.role],
  );
  const runtimeUrl = roleConnection(connectionString, runtimeLogin.role, runtimeLogin.password);
  const pools = runtimePools(`normalized-it-${randomUUID()}`, runtimeUrl);
  const projection = new NormalizedControlProjection({ component });
  const store = new PostgresJsonStore({
    pool: pools.pool,
    leasePool: pools.leasePool,
    component,
    holderId: pools.holderId,
    initialState: emptyState,
    validateState,
    sealState,
    projection,
    databaseContext: {
      accessMode: "service",
      actorId: "service:caas-control-store:normalized-integration",
      tenantId: "molit-platform",
    },
    statementTimeoutMs: 10_000,
    lockTimeoutMs: 5_000,
  });
  t.after(async () => {
    await store.close().catch(() => {});
    await admin.query("DELETE FROM molit_control_store.tenant_database_principal WHERE database_role = $1", [runtimeLogin.role]).catch(() => {});
    await admin.query(`DROP OWNED BY ${runtimeLogin.quoted}`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${runtimeLogin.quoted}`).catch(() => {});
    await admin.end().catch(() => {});
  });
  await store.initialize();

  const occurredAt = "2026-07-14T03:00:00.000Z";
  const event = createAuditEvent(1, null, "TENANT_CREATED", occurredAt);
  await store.transact((state) => {
    state.tenants["tenant-seoul-01"] = { spec: { organizationId: "org-seoul" }, status: "ACTIVE" };
    state.requests["request-create-01"] = { completedAt: occurredAt, result: { status: "CREATED" } };
    state.audit.push(event);
  });

  const projected = await admin.query(
    `SELECT
       (SELECT count(*)::integer FROM molit_control_store.resource_state WHERE component = $1) AS resources,
       (SELECT count(*)::integer FROM molit_control_store.idempotency_record WHERE component = $1) AS idempotency,
       (SELECT count(*)::integer FROM molit_control_store.audit_event WHERE component = $1) AS audit,
       (SELECT count(*)::integer FROM molit_control_store.outbox_event WHERE component = $1) AS outbox`,
    [component],
  );
  assert.deepEqual(projected.rows[0], { audit: 1, idempotency: 1, outbox: 1, resources: 1 });
  const dynamicBinding = await admin.query(
    `SELECT active FROM molit_control_store.tenant_database_principal
     WHERE database_role = $1 AND tenant_id = 'tenant-seoul-01' AND access_mode = 'service'`,
    [runtimeLogin.role],
  );
  assert.deepEqual(dynamicBinding.rows, [{ active: true }]);

  const failedTenantId = "tenant-atomic-fail";
  const conflictingUnsigned = {
    action: "TENANT_CREATED_CONFLICT",
    occurredAt,
    previousDigest: null,
    sequence: 1,
    tenantId: failedTenantId,
  };
  await assert.rejects(store.transact((state) => {
    state.tenants[failedTenantId] = { spec: { organizationId: "org-atomic-fail" }, status: "ACTIVE" };
    state.audit.push({ ...conflictingUnsigned, eventDigest: digest(conflictingUnsigned) });
  }));
  assert.equal((await store.read((state) => state.tenants[failedTenantId] ?? null)), null);
  const atomicRollback = await admin.query(
    `SELECT
       (SELECT count(*)::integer FROM molit_control_store.tenant_database_principal
        WHERE database_role = $1 AND tenant_id = $2 AND access_mode = 'service') AS bindings,
       (SELECT count(*)::integer FROM molit_control_store.tenant_principal_change_audit
        WHERE database_role = $1 AND tenant_id = $2) AS principal_audit,
       (SELECT count(*)::integer FROM molit_control_store.resource_state
        WHERE component = $3 AND tenant_id = $2) AS resources`,
    [runtimeLogin.role, failedTenantId, component],
  );
  assert.deepEqual(atomicRollback.rows[0], { bindings: 0, principal_audit: 0, resources: 0 });
  const checkpoint = await admin.query(
    "SELECT snapshot_revision::text, resource_count, idempotency_count, audit_count::text FROM molit_control_store.projection_checkpoint WHERE component = $1",
    [component],
  );
  assert.deepEqual(checkpoint.rows[0], {
    audit_count: "1",
    idempotency_count: 1,
    resource_count: 1,
    snapshot_revision: "2",
  });

  await assert.rejects(
    admin.query("UPDATE molit_control_store.audit_event SET event_id = 'tampered' WHERE component = $1", [component]),
    (error) => error.code === "55000",
  );
  await assert.rejects(
    admin.query("DELETE FROM molit_control_store.audit_event WHERE component = $1", [component]),
    (error) => error.code === "55000",
  );

  const workerA = new PostgresOutbox({ pool: admin, component, workerId: "worker-a", maxAttempts: 2 });
  const workerB = new PostgresOutbox({ pool: admin, component, workerId: "worker-b", maxAttempts: 2 });
  const [claimedA, claimedB] = await Promise.all([
    workerA.claim({ limit: 10, leaseMs: 5_000 }),
    workerB.claim({ limit: 10, leaseMs: 5_000 }),
  ]);
  const claimed = [...claimedA, ...claimedB];
  assert.equal(claimed.length, 1);
  assert.equal(new Set(claimed.map(({ eventId }) => eventId)).size, 1);

  const ownerFor = (target) => claimedA.some(({ eventId }) => eventId === target.eventId) ? workerA : workerB;
  const first = claimed[0];
  const receipt = await ownerFor(first).acknowledge(first.eventId, { brokerOffset: "partition-0:1" });
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(await ownerFor(first).readiness(), {
    deadLettered: 0,
    oldestPendingAt: null,
    pending: 0,
    ready: true,
  });

  await store.transact((state) => {
    delete state.tenants["tenant-seoul-01"];
    delete state.requests["request-create-01"];
  });
  const auditOnly = new PostgresOutbox({
    pool: admin,
    component,
    workerId: "worker-audit-only",
    eventTypes: ["audit.appended"],
  });
  assert.deepEqual(await auditOnly.claim({ limit: 1, leaseMs: 5_000 }), []);
  assert.deepEqual(await workerA.claim({ limit: 1, leaseMs: 5_000 }), []);
  const remaining = await admin.query("SELECT count(*)::integer AS count FROM molit_control_store.resource_state WHERE component = $1", [component]);
  assert.equal(remaining.rows[0].count, 0);
  const unconsumedResourceEvents = await admin.query(
    "SELECT count(*)::integer AS count FROM molit_control_store.outbox_event WHERE component = $1 AND event_type IN ('resource.upserted', 'resource.deleted')",
    [component],
  );
  assert.equal(unconsumedResourceEvents.rows[0].count, 0);

  const conflicting = structuredClone(await store.read());
  conflicting.audit[0] = createAuditEvent(1, null, "DIFFERENT_EVENT", occurredAt);
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(
      projection.apply({ client, nextState: conflicting, previousState: conflicting, snapshotRevision: "4", now: occurredAt }),
      { code: "CONTROL_PROJECTION_CONFLICT" },
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});
