import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

import { PostgresOutbox } from "../../src/control-store/postgres-outbox.mjs";
import { createLocalTestSignalExporter, createUsageOutboxDispatcher, ManagementUsageRecorder, OperationalTelemetry, UsageMeter } from "../../src/observability/index.mjs";

const { Pool } = pg;
const connectionString = process.env.MOLIT_POSTGRES_INTEGRATION_URL;

async function createLogin(admin, prefix) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const role = `${prefix}_${suffix}`;
  const password = `UsageTest-${suffix}-9`;
  const quoted = await admin.query("SELECT quote_ident($1) AS role, quote_literal($2) AS password", [role, password]);
  await admin.query(`CREATE ROLE ${quoted.rows[0].role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${quoted.rows[0].password}`);
  return { password, quoted: quoted.rows[0].role, role };
}

function roleConnection(base, role, password) {
  const url = new URL(base);
  url.username = role;
  url.password = password;
  return url.toString();
}

function context(tenantId, suffix) {
  return { accessMode: "service", actorId: "service:usage-meter", correlationId: `corr-usage-${suffix}`, tenantId, traceId: suffix.repeat(32).slice(0, 32) };
}

function event(sourceEventId, quantity, occurredAt, suffix, dimensions = { operation: "connector.ensure" }) {
  return { meterName: "api.request", quantity, occurredAt, sourceEventId, sourceEventDigest: suffix.repeat(64).slice(0, 64), dimensions };
}

test("COM-OBS-001: tenant usage events are durable, idempotent, isolated, and reprocessable", { skip: !connectionString, timeout: 60_000 }, async (t) => {
  const admin = new Pool({ connectionString, max: 4, ssl: false });
  for (const migration of ["001_control_store.sql", "002_normalized_projection.sql", "003_usage_metering.sql"]) {
    await admin.query(await readFile(new URL(`../../deploy/control-store/postgres/${migration}`, import.meta.url), "utf8"));
  }
  const tenantA = "tenant-seoul-01";
  const tenantB = "tenant-busan-01";
  const component = `usage-it-${randomUUID()}`;
  const loginA = await createLogin(admin, "molit_usage_a");
  const loginB = await createLogin(admin, "molit_usage_b");
  const dispatcherLogin = await createLogin(admin, "molit_usage_dispatcher");
  const roles = [loginA, loginB, dispatcherLogin];
  const roleList = roles.map(({ quoted }) => quoted).join(", ");
  await admin.query(`GRANT USAGE ON SCHEMA molit_control_store TO ${roleList}`);
  await admin.query(`GRANT SELECT ON molit_control_store.schema_migration TO ${roleList}`);
  for (const table of ["usage_meter_event", "usage_meter_rollup", "usage_meter_reprocess", "outbox_event", "projection_tenant_registry"]) {
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON molit_control_store.${table} TO ${roleList}`);
  }
  await admin.query(
    `INSERT INTO molit_control_store.tenant_database_principal
       (database_role, tenant_id, access_mode, active, approved_by, approval_reference)
     VALUES ($1, $2, 'service', true, 'integration-test', 'COM-OBS-001/A'),
            ($1, 'molit-platform', 'service', true, 'integration-test', 'COM-OBS-001/A-platform'),
            ($3, $4, 'service', true, 'integration-test', 'COM-OBS-001/B'),
            ($5, 'molit-platform', 'service', true, 'integration-test', 'COM-OBS-001/dispatcher'),
            ($5, $2, 'service', true, 'integration-test', 'COM-OBS-001/dispatcher-A'),
            ($5, $4, 'service', true, 'integration-test', 'COM-OBS-001/dispatcher-B')`,
    [loginA.role, tenantA, loginB.role, tenantB, dispatcherLogin.role],
  );
  await admin.query(
    `INSERT INTO molit_control_store.projection_tenant_registry (component, tenant_id, first_seen_at, last_seen_at)
     VALUES ($1, $2, clock_timestamp(), clock_timestamp()), ($1, $3, clock_timestamp(), clock_timestamp())
     ON CONFLICT (component, tenant_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
    [component, tenantA, tenantB],
  );
  const poolA = new Pool({ connectionString: roleConnection(connectionString, loginA.role, loginA.password), max: 2, ssl: false });
  const poolB = new Pool({ connectionString: roleConnection(connectionString, loginB.role, loginB.password), max: 2, ssl: false });
  const dispatcherPool = new Pool({ connectionString: roleConnection(connectionString, dispatcherLogin.role, dispatcherLogin.password), max: 2, ssl: false });
  t.after(async () => {
    await Promise.allSettled([poolA.end(), poolB.end(), dispatcherPool.end()]);
    await admin.query("DELETE FROM molit_control_store.tenant_database_principal WHERE database_role = ANY($1::name[])", [roles.map(({ role }) => role)]).catch(() => {});
    for (const { quoted } of roles) {
      await admin.query(`DROP OWNED BY ${quoted}`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS ${quoted}`).catch(() => {});
    }
    await admin.end().catch(() => {});
  });
  const definitions = {
    "api.request": { purpose: "operational-non-billable", unit: "request", dimensionKeys: ["operation"] },
    "management.api.request": { purpose: "operational-non-billable", unit: "{request}", dimensionKeys: ["operation", "outcome"] },
  };
  const meterA = new UsageMeter({ pool: poolA, component, meterDefinitions: definitions, clock: () => new Date("2026-07-14T13:00:00.000Z") });
  const meterB = new UsageMeter({ pool: poolB, component, meterDefinitions: definitions, clock: () => new Date("2026-07-14T13:00:00.000Z") });
  await Promise.all([meterA.initialize(), meterB.initialize()]);
  const contextA = context(tenantA, "a");
  const contextB = context(tenantB, "b");
  const occurredAt = "2026-07-14T12:10:00.000Z";
  const first = await meterA.record(contextA, event("source-event-a01", "1.000", occurredAt, "a"));
  const replay = await meterA.record(contextA, event("source-event-a01", "1.000", occurredAt, "a"));
  await meterA.record(contextA, event("source-event-a02", "2.500", "2026-07-14T12:20:00.000Z", "b"));
  await meterB.record(contextB, event("source-event-b01", "9", occurredAt, "c"));
  const metricExporter = createLocalTestSignalExporter({ environment: "test", signal: "metrics" });
  const logExporter = createLocalTestSignalExporter({ environment: "test", signal: "logs" });
  const telemetry = new OperationalTelemetry({ metricExporter, logExporter, tenantSalt: "usage-meter-postgres-integration-salt", component: "molit-caas", environment: "test", clock: () => new Date("2026-07-14T13:00:00.000Z") });
  const recorder = new ManagementUsageRecorder({
    meter: meterA,
    telemetry,
    component: "caas",
    config: { purpose: "operational-non-billable", meterName: "management.api.request", unit: "{request}", dimensionKeys: ["operation", "outcome"], maximumEventAgeDays: 400, maximumFutureSkewMs: 300_000, maxAttempts: 3, retryBaseMs: 10 },
    clock: () => new Date("2026-07-14T12:30:00.000Z"),
  });
  await recorder.record({ tenantId: tenantA, operation: "connector.ensure", statusCode: 200, requestId: "request-postgres-usage-001", traceId: "d".repeat(32), spanId: "e".repeat(16) });
  await recorder.record({ tenantId: "molit-platform", operation: "tenant.read", statusCode: 404, requestId: "request-postgres-usage-404", traceId: "f".repeat(32), spanId: "1".repeat(16) });
  assert.equal((await recorder.readiness()).ready, true);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.eventId, first.eventId);
  await assert.rejects(meterA.record(contextA, event("source-event-a01", "2", occurredAt, "a")), { code: "OBS_USAGE_IDEMPOTENCY_CONFLICT" });

  let rollups = await meterA.listRollups(contextA, { meterName: "api.request", periodFrom: "2026-07-14T12:00:00.000Z", periodTo: "2026-07-14T13:00:00.000Z" });
  assert.equal(rollups.length, 1);
  assert.equal(rollups[0].quantity, "3.5");
  assert.equal(rollups[0].eventCount, "2");
  assert.equal((await meterB.listRollups(contextB, { meterName: "api.request", periodFrom: "2026-07-14T12:00:00.000Z", periodTo: "2026-07-14T13:00:00.000Z" }))[0].quantity, "9");

  const clientA = await poolA.connect();
  try {
    await clientA.query("BEGIN");
    await clientA.query("SELECT set_config('molit.tenant_id', $1, true), set_config('molit.access_mode', 'service', true)", [tenantA]);
    const invisible = await clientA.query("SELECT count(*)::integer AS count FROM molit_control_store.usage_meter_event WHERE tenant_id = $1", [tenantB]);
    assert.equal(invisible.rows[0].count, 0);
    await assert.rejects(clientA.query("UPDATE molit_control_store.usage_meter_event SET quantity = 99 WHERE component = $1", [component]), /append-only/u);
    await clientA.query("ROLLBACK");
  } finally {
    clientA.release();
  }

  const tamper = await poolA.connect();
  try {
    await tamper.query("BEGIN");
    await tamper.query("SELECT set_config('molit.tenant_id', $1, true), set_config('molit.access_mode', 'service', true)", [tenantA]);
    await tamper.query("UPDATE molit_control_store.usage_meter_rollup SET quantity = 999 WHERE component = $1 AND tenant_id = $2", [component, tenantA]);
    await tamper.query("COMMIT");
  } finally {
    tamper.release();
  }
  const reprocessed = await meterA.reprocess(contextA, { operationId: "reprocess-usage-001", meterName: "api.request", periodFrom: "2026-07-14T12:00:00.000Z", periodTo: "2026-07-14T13:00:00.000Z" });
  assert.equal(reprocessed.replayed, false);
  assert.equal(reprocessed.sourceEventCount, 2);
  assert.equal((await meterA.reprocess(contextA, { operationId: "reprocess-usage-001", meterName: "api.request", periodFrom: "2026-07-14T12:00:00.000Z", periodTo: "2026-07-14T13:00:00.000Z" })).replayed, true);
  rollups = await meterA.listRollups(contextA, { meterName: "api.request", periodFrom: "2026-07-14T12:00:00.000Z", periodTo: "2026-07-14T13:00:00.000Z" });
  assert.equal(rollups[0].quantity, "3.5");

  const outbox = await admin.query(
    `SELECT tenant_id, event_type, payload
     FROM molit_control_store.outbox_event
     WHERE component = $1 ORDER BY created_at, event_id`,
    [component],
  );
  assert.equal(outbox.rows.filter((row) => row.tenant_id === tenantA && row.event_type === "usage.meter.recorded").length, 3);
  assert.equal(outbox.rows.find((row) => row.event_type === "usage.meter.recorded").payload.usageEvent.traceId.length, 32);
  assert.equal(outbox.rows.filter((row) => row.tenant_id === tenantA && row.event_type === "usage.meter.reprocessed").length, 1);
  assert.equal(outbox.rows.filter((row) => row.tenant_id === "molit-platform" && row.event_type === "usage.meter.recorded").length, 1);

  const usageOutbox = new PostgresOutbox({
    pool: dispatcherPool,
    component,
    workerId: "usage-integration-dispatcher",
    eventTypes: ["usage.meter.recorded", "usage.meter.reprocessed"],
    maxAttempts: 3,
    tenantService: { actorId: "service:usage-integration-dispatcher", discoverFromRegistry: true },
  });
  const emptyOutbox = new PostgresOutbox({
    pool: dispatcherPool,
    component: `${component}-empty`,
    workerId: "usage-empty-dispatcher",
    eventTypes: ["usage.meter.recorded"],
    tenantService: { actorId: "service:usage-empty-dispatcher", discoverFromRegistry: true },
  });
  assert.deepEqual(await emptyOutbox.readiness(), { deadLettered: 0, oldestPendingAt: null, pending: 0, ready: true });
  const firstTenant = (await usageOutbox.claim({ limit: 1, leaseMs: 5_000 }))[0];
  await usageOutbox.reject(firstTenant.eventId, "USAGE_FAIRNESS_PROBE", { delayMs: 0 });
  const secondTenant = (await usageOutbox.claim({ limit: 1, leaseMs: 5_000 }))[0];
  await usageOutbox.reject(secondTenant.eventId, "USAGE_FAIRNESS_PROBE", { delayMs: 0 });
  assert.notEqual(firstTenant.tenantId, secondTenant.tenantId, "global batch limit must rotate the first tenant between claims");
  const dispatcher = createUsageOutboxDispatcher({ outbox: usageOutbox, telemetry, pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100, healthIntervalMs: 1_000, clock: () => new Date("2026-07-14T13:00:00.000Z") });
  const delivery = await dispatcher.runOnce();
  assert.deepEqual(delivery, { acknowledged: 6, claimed: 6, deadLettered: 0, rejected: 0 });
  const published = await admin.query(
    `SELECT event_id, event_type, publish_receipt
     FROM molit_control_store.outbox_event
     WHERE component = $1 AND event_type LIKE 'usage.meter.%'
     ORDER BY event_id`,
    [component],
  );
  assert.equal(published.rows.every(({ publish_receipt: receipt }) => receipt.idempotencyKey && receipt.deliveryPurpose === "usage-integrity" && receipt.sink === "otlp-log"), true);
  assert.equal(logExporter.items.filter(({ eventName }) => eventName === "molit.usage.meter.exported").length, 6);
  assert.equal(logExporter.items.find(({ eventName }) => eventName === "molit.usage.meter.committed").attributes["molit.delivery_stage"], "ledger_commit");
  assert.equal(metricExporter.items.some(({ name }) => name === "molit.outbox.dead_lettered"), true);
  await admin.query(
    `UPDATE molit_control_store.tenant_database_principal SET active = false
     WHERE database_role = $1 AND tenant_id = $2 AND access_mode = 'service'`,
    [dispatcherLogin.role, tenantB],
  );
  await assert.rejects(dispatcher.readiness(), { code: "OUTBOX_TENANT_BINDING_INACTIVE" });
  await assert.rejects(dispatcher.runOnce(), { code: "OUTBOX_TENANT_BINDING_INACTIVE" });
  await admin.query(
    `UPDATE molit_control_store.tenant_database_principal SET active = true
     WHERE database_role = $1 AND tenant_id = $2 AND access_mode = 'service'`,
    [dispatcherLogin.role, tenantB],
  );
  await recorder.close();
  await telemetry.close();
});
