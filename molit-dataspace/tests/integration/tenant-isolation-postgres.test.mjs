import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

import { digest } from "../../src/discovery/stable-json.mjs";
import { NormalizedControlProjection } from "../../src/control-store/normalized-projection.mjs";
import { PostgresJsonStore } from "../../src/control-store/postgres-json-store.mjs";
import { PostgresOutbox } from "../../src/control-store/postgres-outbox.mjs";
import { PostgresTenantStore } from "../../src/control-store/postgres-tenant-store.mjs";
import { createLocalTestWormBackend, createWormOutboxDispatcher, WormAuditExporter } from "../../src/observability/index.mjs";

const { Pool } = pg;
const connectionString = process.env.MOLIT_POSTGRES_INTEGRATION_URL;

function accessContext(tenantId, actorId, accessMode, overrides = {}) {
  const seed = randomUUID();
  return {
    accessMode,
    actorId,
    actorKind: accessMode === "tenant" ? "user" : "service",
    correlationId: `corr-${seed}`,
    tenantId,
    traceId: createHash("sha256").update(seed).digest("hex").slice(0, 32),
    ...overrides,
  };
}

function roleConnection(base, role, password) {
  const url = new URL(base);
  url.username = role;
  url.password = password;
  return url.toString();
}

function emptyProjectionState() {
  return {
    schemaVersion: "test.caas-production-state/1",
    tenants: {},
    requests: {},
    audit: [],
    integrity: { snapshotDigest: digest({ requests: {}, tenants: {} }) },
  };
}

function projectionAudit(sequence, tenantId, action, occurredAt) {
  const unsigned = { action, occurredAt, previousDigest: null, sequence, tenantId };
  return { ...unsigned, eventDigest: digest(unsigned) };
}

async function createLogin(admin, prefix) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const role = `${prefix}_${suffix}`;
  const password = `TenantTest-${suffix}-9`;
  const quoted = await admin.query("SELECT quote_ident($1) AS role, quote_literal($2) AS password", [role, password]);
  await admin.query(`CREATE ROLE ${quoted.rows[0].role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${quoted.rows[0].password}`);
  return { password, quoted: quoted.rows[0].role, role };
}

test("COM-TEN-001: two PostgreSQL tenant principals remain isolated across state, queue, object, secret, metric, and audit", {
  skip: !connectionString,
  timeout: 60_000,
}, async (t) => {
  const admin = new Pool({ connectionString, max: 6, ssl: false });
  const migration1 = await readFile(new URL("../../deploy/control-store/postgres/001_control_store.sql", import.meta.url), "utf8");
  const migration2 = await readFile(new URL("../../deploy/control-store/postgres/002_normalized_projection.sql", import.meta.url), "utf8");
  await admin.query(migration1);
  await admin.query(migration2);
  await admin.query(
    `TRUNCATE
       molit_control_store.tenant_principal_change_audit,
       molit_control_store.tenant_security_audit,
       molit_control_store.tenant_audit_head,
       molit_control_store.tenant_object_reference,
       molit_control_store.tenant_secret_reference,
       molit_control_store.tenant_metric_sample,
       molit_control_store.projection_tenant_registry,
       molit_control_store.outbox_event,
       molit_control_store.audit_event,
       molit_control_store.idempotency_record,
       molit_control_store.resource_state,
       molit_control_store.projection_checkpoint,
       molit_control_store.resource_fence,
       molit_control_store.json_snapshot`,
  );

  const tenantA = "tenant-seoul-01";
  const tenantB = "tenant-busan-01";
  const component = `tenant-it-${randomUUID()}`;
  const loginA = await createLogin(admin, "molit_tenant_a");
  const loginB = await createLogin(admin, "molit_tenant_b");
  const loginService = await createLogin(admin, "molit_service_a");
  const loginBreakGlass = await createLogin(admin, "molit_break_glass");
  const logins = [loginA, loginB, loginService, loginBreakGlass];
  const roleList = logins.map(({ quoted }) => quoted).join(", ");

  await admin.query(`GRANT USAGE ON SCHEMA molit_control_store TO ${roleList}`);
  await admin.query(`GRANT EXECUTE ON FUNCTION molit_control_store.enroll_current_service_principal(text, text) TO ${roleList}`);
  for (const table of [
    "resource_state", "idempotency_record", "audit_event", "outbox_event",
    "tenant_security_audit", "tenant_audit_head", "tenant_object_reference",
    "tenant_secret_reference", "tenant_metric_sample",
  ]) {
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON molit_control_store.${table} TO ${roleList}`);
  }
  await admin.query(`GRANT SELECT ON molit_control_store.schema_migration TO ${roleList}`);
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE
     ON molit_control_store.json_snapshot,
        molit_control_store.resource_fence,
        molit_control_store.projection_checkpoint,
        molit_control_store.projection_tenant_registry
     TO ${loginService.quoted}`,
  );
  await admin.query(
    `INSERT INTO molit_control_store.tenant_database_principal
       (database_role, tenant_id, access_mode, active, valid_until, approved_by, approval_reference)
     VALUES
       ($1, $2, 'tenant', true, NULL, 'integration-test', 'COM-TEN-001/A'),
       ($3, $4, 'tenant', true, NULL, 'integration-test', 'COM-TEN-001/B'),
       ($5, 'molit-platform', 'service', true, NULL, 'integration-test', 'COM-TEN-001/PLATFORM'),
       ($6, 'molit-platform', 'break-glass', true, clock_timestamp() + interval '1 hour', 'integration-test', 'COM-TEN-001/BREAK-GLASS')`,
    [loginA.role, tenantA, loginB.role, tenantB, loginService.role, loginBreakGlass.role],
  );

  const poolA = new Pool({ connectionString: roleConnection(connectionString, loginA.role, loginA.password), max: 3, ssl: false });
  const poolB = new Pool({ connectionString: roleConnection(connectionString, loginB.role, loginB.password), max: 3, ssl: false });
  const servicePool = new Pool({ connectionString: roleConnection(connectionString, loginService.role, loginService.password), max: 2, ssl: false });
  const breakGlassPool = new Pool({ connectionString: roleConnection(connectionString, loginBreakGlass.role, loginBreakGlass.password), max: 2, ssl: false });
  const projectionPool = new Pool({ connectionString: roleConnection(connectionString, loginService.role, loginService.password), max: 3, ssl: false });
  const projectionLeasePool = new Pool({ connectionString: roleConnection(connectionString, loginService.role, loginService.password), max: 2, ssl: false });
  const outboxPool = new Pool({ connectionString: roleConnection(connectionString, loginService.role, loginService.password), max: 3, ssl: false });
  const pools = [poolA, poolB, servicePool, breakGlassPool, projectionPool, projectionLeasePool, outboxPool];
  t.after(async () => {
    await Promise.allSettled(pools.map((pool) => pool.end()));
    await admin.query("DELETE FROM molit_control_store.tenant_database_principal WHERE database_role = ANY($1::name[])", [logins.map(({ role }) => role)]).catch(() => {});
    for (const { quoted } of logins) {
      await admin.query(`DROP OWNED BY ${quoted}`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS ${quoted}`).catch(() => {});
    }
    await admin.end().catch(() => {});
  });

  const storeA = new PostgresTenantStore({ pool: poolA, component });
  const storeB = new PostgresTenantStore({ pool: poolB, component });
  const serviceStore = new PostgresTenantStore({ pool: servicePool, component });
  const breakGlassStore = new PostgresTenantStore({ pool: breakGlassPool, component });
  await Promise.all([storeA.initialize(), storeB.initialize(), serviceStore.initialize(), breakGlassStore.initialize()]);

  const contextA = accessContext(tenantA, "user:seoul-admin", "tenant");
  const contextB = accessContext(tenantB, "user:busan-admin", "tenant");
  await storeA.putResource(contextA, {
    expectedRevision: 0,
    payload: { deploymentSecretRef: "vault://tenants/tenant-seoul-01/edc/runtime", state: "ACTIVE" },
    resourceId: "connector-primary",
    resourceKind: "connector",
  });
  await storeB.putResource(contextB, {
    expectedRevision: 0,
    payload: { deploymentSecretRef: "vault://tenants/tenant-busan-01/edc/runtime", state: "ACTIVE" },
    resourceId: "connector-primary",
    resourceKind: "connector",
  });
  assert.equal((await storeA.getResource(contextA, { resourceId: "connector-primary", resourceKind: "connector" })).payload.state, "ACTIVE");
  assert.equal((await storeB.getResource(contextB, { resourceId: "connector-primary", resourceKind: "connector" })).tenantId, tenantB);
  await assert.rejects(
    storeA.getResource(contextA, { resourceId: "connector-primary", resourceKind: "connector", tenantId: tenantB }),
    { code: "TENANT_ACCESS_DENIED" },
  );
  await assert.rejects(
    storeA.putResource(contextA, {
      expectedRevision: 0,
      payload: { accessToken: "canary-secret-must-not-be-persisted" },
      resourceId: "connector-secret-canary",
      resourceKind: "connector",
    }),
    { code: "TENANT_SECRET_VALUE_FORBIDDEN" },
  );

  await storeA.putIdempotency(contextA, { payload: { result: "A" }, recordKey: "request-shared-001" });
  await storeB.putIdempotency(contextB, { payload: { result: "B" }, recordKey: "request-shared-001" });
  const idempotency = await admin.query(
    `SELECT tenant_id, payload ->> 'result' AS result
     FROM molit_control_store.idempotency_record
     WHERE component = $1 AND record_key = 'request-shared-001'
     ORDER BY tenant_id`,
    [component],
  );
  assert.deepEqual(idempotency.rows, [
    { result: "B", tenant_id: tenantB },
    { result: "A", tenant_id: tenantA },
  ]);

  await storeA.enqueue(contextA, { eventType: "connector.reconcile", messageId: "queue-shared-001", payload: { generation: 1 } });
  await storeB.enqueue(contextB, { eventType: "connector.reconcile", messageId: "queue-shared-001", payload: { generation: 2 } });
  const claimedA = await storeA.claimQueue(contextA, { eventTypes: ["connector.reconcile"], limit: 10, workerId: "worker-seoul" });
  assert.equal(claimedA.length, 1);
  assert.equal(claimedA[0].tenantId, tenantA);
  assert.equal(claimedA[0].payload.generation, 1);
  await storeA.acknowledgeQueue(contextA, { eventId: claimedA[0].eventId, receipt: { offset: "seoul:1" }, workerId: "worker-seoul" });
  const claimedB = await storeB.claimQueue(contextB, { eventTypes: ["connector.reconcile"], limit: 10, workerId: "worker-busan" });
  assert.equal(claimedB.length, 1);
  assert.equal(claimedB[0].payload.generation, 2);

  const shaA = digest({ body: "seoul" });
  const shaB = digest({ body: "busan" });
  await storeA.registerObject(contextA, { mediaType: "application/json", objectKey: `${"tenants/tenant-seoul-01"}/exports/catalog.json`, objectSha256: shaA });
  await storeB.registerObject(contextB, { mediaType: "application/json", objectKey: `${"tenants/tenant-busan-01"}/exports/catalog.json`, objectSha256: shaB });
  assert.equal((await storeA.getObject(contextA, { objectKey: "tenants/tenant-seoul-01/exports/catalog.json" })).objectSha256, shaA);
  await assert.rejects(
    storeA.getObject(contextA, { objectKey: "tenants/tenant-busan-01/exports/catalog.json", tenantId: tenantB }),
    { code: "TENANT_ACCESS_DENIED" },
  );
  await assert.rejects(
    storeA.registerObject(contextA, { mediaType: "application/json", objectKey: "tenants/tenant-busan-01/exports/stolen.json", objectSha256: shaA }),
    { code: "TENANT_OBJECT_KEY_INVALID" },
  );

  await storeA.registerSecretReference(contextA, { purpose: "edc-control-plane", reference: "vault://tenants/tenant-seoul-01/edc/control-plane" });
  await storeB.registerSecretReference(contextB, { purpose: "edc-control-plane", reference: "vault://tenants/tenant-busan-01/edc/control-plane" });
  assert.match((await storeA.getSecretReference(contextA, { purpose: "edc-control-plane" })).reference, /^vault:\/\/tenants\/tenant-seoul-01\//u);
  await assert.rejects(
    storeA.getSecretReference(contextA, { purpose: "edc-control-plane", tenantId: tenantB }),
    { code: "TENANT_ACCESS_DENIED" },
  );
  await assert.rejects(
    storeA.registerSecretReference(contextA, { purpose: "wrong-tenant", reference: "vault://tenants/tenant-busan-01/edc/control-plane" }),
    { code: "TENANT_SECRET_REF_INVALID" },
  );
  const secretRows = await admin.query(
    "SELECT secret_ref FROM molit_control_store.tenant_secret_reference WHERE component = $1 ORDER BY tenant_id",
    [component],
  );
  assert.equal(secretRows.rows.length, 2);
  assert.equal(secretRows.rows.some(({ secret_ref }) => secret_ref.includes("plain-text-secret")), false);

  await storeA.recordMetric(contextA, { labels: { operation: "reconcile" }, metricName: "connector.reconcile.count", observedAt: "2026-07-14T12:00:00.000Z", value: 1 });
  await storeB.recordMetric(contextB, { labels: { operation: "reconcile" }, metricName: "connector.reconcile.count", observedAt: "2026-07-14T12:00:00.000Z", value: 2 });
  assert.deepEqual((await storeA.listMetrics(contextA, { metricName: "connector.reconcile.count" }))[0].labels, {
    operation: "reconcile",
    "tenant.id": tenantA,
  });
  await assert.rejects(
    storeA.listMetrics(contextA, { metricName: "connector.reconcile.count", tenantId: tenantB }),
    { code: "TENANT_ACCESS_DENIED" },
  );
  await assert.rejects(
    storeA.recordMetric(contextA, { labels: { "tenant.id": tenantB }, metricName: "connector.reconcile.denied", value: 1 }),
    { code: "TENANT_METRIC_LABEL_MISMATCH" },
  );

  const direct = await poolA.connect();
  try {
    await direct.query("BEGIN");
    await direct.query(
      `SELECT set_config('molit.tenant_id', $1, true), set_config('molit.actor_id', 'user:seoul-admin', true),
        set_config('molit.access_mode', 'tenant', true)`,
      [tenantA],
    );
    const visible = await direct.query(
      "SELECT tenant_id FROM molit_control_store.resource_state WHERE component = $1 ORDER BY tenant_id",
      [component],
    );
    assert.deepEqual(visible.rows, [{ tenant_id: tenantA }]);
    await assert.rejects(
      direct.query(
        `INSERT INTO molit_control_store.resource_state
           (component, tenant_id, resource_kind, resource_id, revision, payload, payload_sha256, updated_at)
         VALUES ($1, $2, 'connector', 'direct-cross-write', 1, '{}'::jsonb, $3, clock_timestamp())`,
        [component, tenantB, digest({})],
      ),
      (error) => error.code === "42501",
    );
    await direct.query("ROLLBACK");
  } finally {
    direct.release();
  }

  const unauthorizedEnrollment = await poolA.connect();
  try {
    await unauthorizedEnrollment.query("BEGIN");
    await unauthorizedEnrollment.query(
      `SELECT
         set_config('molit.tenant_id', 'molit-platform', true),
         set_config('molit.actor_id', 'service:caas-normalized-projection', true),
         set_config('molit.access_mode', 'service', true),
         set_config('molit.trace_id', $1, true),
         set_config('molit.correlation_id', 'unauthorized-enrollment', true)`,
      ["b".repeat(32)],
    );
    await assert.rejects(
      unauthorizedEnrollment.query(
        "SELECT molit_control_store.enroll_current_service_principal($1, 'caas')",
        [tenantB],
      ),
      (error) => error.code === "42501",
    );
    await unauthorizedEnrollment.query("ROLLBACK");
  } finally {
    unauthorizedEnrollment.release();
  }

  const serviceContext = accessContext(tenantA, "service:caas-controller", "service");
  const breakGlassContext = accessContext("molit-platform", "operator:on-call-01", "break-glass", {
    actorKind: "operator",
    breakGlassExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    breakGlassReason: "approved incident INC-2026-0714",
  });
  assert.equal((await breakGlassStore.getResource(breakGlassContext, {
    resourceId: "connector-primary",
    resourceKind: "connector",
    tenantId: tenantB,
  })).tenantId, tenantB);
  const expiredBreakGlass = { ...breakGlassContext, breakGlassExpiresAt: "2026-01-01T00:00:00.000Z", correlationId: `expired-${randomUUID()}` };
  await assert.rejects(
    breakGlassStore.getResource(expiredBreakGlass, { resourceId: "connector-primary", resourceKind: "connector", tenantId: tenantB }),
    { code: "TENANT_ACCESS_DENIED" },
  );

  const projectionStore = new PostgresJsonStore({
    pool: projectionPool,
    leasePool: projectionLeasePool,
    component: "caas",
    holderId: "service-caas-control-store-it",
    initialState: emptyProjectionState,
    validateState(state) {
      assert.equal(state.schemaVersion, "test.caas-production-state/1");
      return state;
    },
    sealState(state) {
      state.integrity = { snapshotDigest: digest({ requests: state.requests, tenants: state.tenants }) };
      return state;
    },
    projection: new NormalizedControlProjection({ component: "caas" }),
    databaseContext: {
      accessMode: "service",
      actorId: "service:caas-control-store:integration",
      tenantId: "molit-platform",
    },
  });
  await projectionStore.initialize();
  const projectionOccurredAt = new Date(Date.now() - 60_000).toISOString();
  await projectionStore.transact((state) => {
    state.tenants[tenantA] = {
      deploymentSecretRefs: { databaseAccess: "vault://tenants/tenant-seoul-01/edc/database" },
      state: "ACTIVE",
      tenantId: tenantA,
    };
    state.tenants[tenantB] = {
      deploymentSecretRefs: { databaseAccess: "vault://tenants/tenant-busan-01/edc/database" },
      state: "ACTIVE",
      tenantId: tenantB,
    };
    state.requests["projection-request-001"] = { result: { status: "CREATED", tenantId: tenantA } };
    state.audit.push(projectionAudit(1, tenantA, "TENANT_CREATED", projectionOccurredAt));
    state.audit.push(projectionAudit(2, tenantB, "TENANT_CREATED", projectionOccurredAt));
  });

  const noContextSnapshot = await projectionPool.query(
    "SELECT component FROM molit_control_store.json_snapshot WHERE component = 'caas'",
  );
  assert.equal(noContextSnapshot.rowCount, 0);
  const normalizedReader = new PostgresTenantStore({ pool: projectionPool, component: "caas" });
  await normalizedReader.initialize();
  assert.equal((await serviceStore.getResource(serviceContext, {
    resourceId: "connector-primary",
    resourceKind: "connector",
  })).tenantId, tenantA);
  assert.equal((await serviceStore.getResource({ ...serviceContext, tenantId: tenantB }, {
    resourceId: "connector-primary",
    resourceKind: "connector",
  })).tenantId, tenantB);
  assert.equal((await normalizedReader.getResource(serviceContext, {
    resourceId: tenantA,
    resourceKind: "tenant",
  })).payload.state, "ACTIVE");
  const projectedSecret = await normalizedReader.getSecretReference(serviceContext, {
    purpose: "databaseAccess",
  });
  assert.equal(projectedSecret.reference, "vault://tenants/tenant-seoul-01/edc/database");

  const enrolled = await admin.query(
    `SELECT tenant_id, active, valid_until
     FROM molit_control_store.tenant_database_principal
     WHERE database_role = $1 AND access_mode = 'service' AND tenant_id = ANY($2::text[])
     ORDER BY tenant_id`,
    [loginService.role, [tenantA, tenantB]],
  );
  assert.deepEqual(enrolled.rows, [
    { active: true, tenant_id: tenantB, valid_until: null },
    { active: true, tenant_id: tenantA, valid_until: null },
  ]);
  const enrollmentAudit = await admin.query(
    `SELECT tenant_id, action, actor_id, trace_id, correlation_id
     FROM molit_control_store.tenant_principal_change_audit
     WHERE database_role = $1 AND tenant_id = ANY($2::text[])
     ORDER BY tenant_id`,
    [loginService.role, [tenantA, tenantB]],
  );
  assert.equal(enrollmentAudit.rowCount, 2);
  for (const row of enrollmentAudit.rows) {
    assert.equal(row.action, "INSERT");
    assert.equal(row.actor_id, "service:caas-normalized-projection");
    assert.match(row.trace_id, /^[a-f0-9]{32}$/u);
    assert.ok(row.correlation_id.length >= 8);
  }
  await assert.rejects(
    admin.query(
      "UPDATE molit_control_store.tenant_principal_change_audit SET actor_id = 'tampered' WHERE database_role = $1",
      [loginService.role],
    ),
    (error) => error.code === "55000",
  );

  const tenantOutbox = new PostgresOutbox({
    pool: outboxPool,
    component: "caas",
    eventTypes: ["audit.appended"],
    workerId: "worm-service-worker",
    tenantService: {
      actorId: "service:worm-outbox-dispatcher",
      discoverFromRegistry: true,
    },
  });
  const projectedAudit = await tenantOutbox.claim({ limit: 10, leaseMs: 5_000 });
  assert.equal(projectedAudit.length, 2);
  assert.deepEqual(new Set(projectedAudit.map(({ tenantId }) => tenantId)), new Set([tenantA, tenantB]));
  const eventA = projectedAudit.find(({ tenantId }) => tenantA === tenantId);
  const eventB = projectedAudit.find(({ tenantId }) => tenantB === tenantId);
  await tenantOutbox.acknowledge(eventA.eventId, { wormOffset: "tenant-a:1" });
  await assert.rejects(
    tenantOutbox.acknowledge(eventB.eventId, { wormOffset: "wrong-tenant" }, { tenantId: tenantA }),
    { code: "OUTBOX_CLAIM_LOST" },
  );
  await tenantOutbox.reject(eventB.eventId, "WORM_BACKEND_RETRY", { delayMs: 0 });
  const retriedAudit = await tenantOutbox.claim({ limit: 10, leaseMs: 5_000 });
  assert.equal(retriedAudit.length, 1);
  assert.equal(retriedAudit[0].tenantId, tenantB);
  await tenantOutbox.acknowledge(retriedAudit[0].eventId, { wormOffset: "tenant-b:1" });
  assert.equal((await tenantOutbox.readiness()).ready, true);

  await admin.query(
    `UPDATE molit_control_store.tenant_database_principal SET active = false
     WHERE database_role = $1 AND tenant_id = $2 AND access_mode = 'service'`,
    [loginService.role, tenantA],
  );
  await assert.rejects(tenantOutbox.readiness(), { code: "OUTBOX_TENANT_BINDING_INACTIVE" });
  await assert.rejects(tenantOutbox.claim({ limit: 1, leaseMs: 5_000 }), { code: "OUTBOX_TENANT_BINDING_INACTIVE" });
  await admin.query(
    `UPDATE molit_control_store.tenant_database_principal SET active = true
     WHERE database_role = $1 AND tenant_id = $2 AND access_mode = 'service'`,
    [loginService.role, tenantA],
  );
  await admin.query(
    `UPDATE molit_control_store.tenant_database_principal SET valid_until = created_at + interval '1 millisecond'
     WHERE database_role = $1 AND tenant_id = $2 AND access_mode = 'service'`,
    [loginService.role, tenantB],
  );
  await assert.rejects(tenantOutbox.readiness(), { code: "OUTBOX_TENANT_BINDING_INACTIVE" });
  await assert.rejects(tenantOutbox.claim({ limit: 1, leaseMs: 5_000 }), { code: "OUTBOX_TENANT_BINDING_INACTIVE" });
  await admin.query(
    `UPDATE molit_control_store.tenant_database_principal SET valid_until = NULL
     WHERE database_role = $1 AND tenant_id = $2 AND access_mode = 'service'`,
    [loginService.role, tenantB],
  );

  const unauthorizedOutbox = new PostgresOutbox({
    pool: poolA,
    component: "caas",
    eventTypes: ["audit.appended"],
    workerId: "tenant-a-forbidden-worker",
    tenantService: {
      actorId: "service:tenant-a-forbidden-worker",
      discoverFromRegistry: true,
    },
  });
  await assert.rejects(
    unauthorizedOutbox.claim({ limit: 10, leaseMs: 5_000 }),
    (error) => error.code === "OUTBOX_TENANT_BINDING_INACTIVE",
  );

  const auditA = await storeA.audit(contextA);
  const denialsA = auditA.filter(({ decision }) => decision === "DENY");
  assert.ok(denialsA.length >= 8);
  let previousDigest = null;
  for (const event of auditA) {
    const { eventDigest, ...unsigned } = event;
    assert.equal(event.previousDigest, previousDigest);
    assert.equal(eventDigest, digest(unsigned));
    assert.equal(typeof event.actorId, "string");
    assert.equal(typeof event.requestedTenantId, "string");
    assert.equal(typeof event.resourceId, "string");
    assert.match(event.decision, /^(?:PERMIT|DENY)$/u);
    assert.match(event.traceId, /^[a-f0-9]{32}$/u);
    assert.ok(event.correlationId.length >= 8);
    previousDigest = eventDigest;
  }
  const denialOutbox = await admin.query(
    `SELECT count(*)::integer AS count
     FROM molit_control_store.outbox_event
     WHERE component = $1 AND event_type = 'tenant.security.access'
       AND payload #>> '{auditEvent,decision}' = 'DENY'`,
    [component],
  );
  const allDenials = await admin.query(
    "SELECT count(*)::integer AS count FROM molit_control_store.tenant_security_audit WHERE component = $1 AND decision = 'DENY'",
    [component],
  );
  assert.equal(denialOutbox.rows[0].count, allDenials.rows[0].count);
  assert.ok(allDenials.rows[0].count >= denialsA.length + 1);
  const registryClient = await projectionPool.connect();
  try {
    await registryClient.query("BEGIN");
    await registryClient.query(
      `SELECT set_config('molit.tenant_id', 'molit-platform', true),
              set_config('molit.actor_id', 'service:tenant-security-test-registry', true),
              set_config('molit.access_mode', 'service', true),
              set_config('molit.trace_id', $1, true),
              set_config('molit.correlation_id', $2, true)`,
      ["e".repeat(32), "tenant-security-registry-0001"],
    );
    await registryClient.query(
      `INSERT INTO molit_control_store.projection_tenant_registry
         (component, tenant_id, first_seen_at, last_seen_at)
       SELECT $1, tenant_id, clock_timestamp(), clock_timestamp()
       FROM unnest($2::text[]) AS source(tenant_id)
       ON CONFLICT (component, tenant_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [component, [tenantA, tenantB]],
    );
    await registryClient.query("COMMIT");
  } catch (error) {
    await registryClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    registryClient.release();
  }
  const securityOutbox = new PostgresOutbox({
    pool: outboxPool,
    component,
    eventTypes: ["audit.appended", "tenant.security.access"],
    workerId: "tenant-security-worm-worker",
    tenantService: {
      actorId: "service:tenant-security-worm-dispatcher",
      discoverFromRegistry: true,
    },
  });
  const securityExporter = new WormAuditExporter({
    backend: createLocalTestWormBackend({ environment: "test", backendId: "tenant-security-worm" }),
    environment: "test",
  });
  const securityDispatcher = createWormOutboxDispatcher({
    outbox: securityOutbox,
    exporter: securityExporter,
    batchSize: 500,
    pollIntervalMs: 10,
    retryBaseMs: 10,
    retryMaxMs: 100,
  });
  let securityAcknowledged = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const result = await securityDispatcher.runOnce();
    securityAcknowledged += result.acknowledged;
    if (result.claimed === 0) break;
  }
  const securityFailures = await admin.query(
    `SELECT last_error_code, count(*)::integer AS count
     FROM molit_control_store.outbox_event
     WHERE component = $1 AND event_type = 'tenant.security.access' AND published_at IS NULL
     GROUP BY last_error_code ORDER BY last_error_code`,
    [component],
  );
  assert.ok(securityAcknowledged >= allDenials.rows[0].count,
    JSON.stringify({ acknowledged: securityAcknowledged, denials: allDenials.rows[0].count, failures: securityFailures.rows }));
  const securityReadiness = await securityDispatcher.readiness();
  assert.equal(securityReadiness.pending, 0);
  assert.equal(securityReadiness.deadLettered, 0);
  const securityPublished = await admin.query(
    `SELECT count(*)::integer AS count
     FROM molit_control_store.outbox_event
     WHERE component = $1 AND event_type = 'tenant.security.access' AND published_at IS NOT NULL`,
    [component],
  );
  const allSecurityAudits = await admin.query(
    "SELECT count(*)::integer AS count FROM molit_control_store.tenant_security_audit WHERE component = $1",
    [component],
  );
  assert.equal(securityPublished.rows[0].count, allSecurityAudits.rows[0].count);
  const leakedCanary = await admin.query(
    `SELECT count(*)::integer AS count
     FROM molit_control_store.resource_state
     WHERE component = $1 AND payload::text LIKE '%canary-secret-must-not-be-persisted%'`,
    [component],
  );
  assert.equal(leakedCanary.rows[0].count, 0);

  await assert.rejects(
    admin.query("UPDATE molit_control_store.tenant_security_audit SET decision = 'PERMIT' WHERE component = $1", [component]),
    (error) => error.code === "55000",
  );
  await projectionStore.close();
});
