import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

import { PostgresOutbox } from "../../src/control-store/postgres-outbox.mjs";
import { digest } from "../../src/discovery/stable-json.mjs";
import { auditOutboxEventToWormEvent, createLocalTestWormBackend, createWormOutboxDispatcher, WormAuditExporter } from "../../src/observability/index.mjs";

const { Pool } = pg;
const connectionString = process.env.MOLIT_POSTGRES_INTEGRATION_URL;

function auditPayload() {
  const unsigned = {
    sequence: 1,
    previousDigest: null,
    occurredAt: "2026-07-14T03:00:00.000Z",
    action: "TENANT_CREATED",
    actorRole: "admin",
    actorPrincipalId: "urn:molit:operator:integration",
    actorClientId: "integration-client",
    actorKeyId: "integration-key",
  };
  const auditEvent = { ...unsigned, eventDigest: digest(unsigned) };
  return {
    schemaVersion: "molit.audit-outbox/1",
    sourceComponent: "caas",
    sourceSequence: 1,
    sourceEventDigest: auditEvent.eventDigest,
    auditEventPayloadSha256: digest(auditEvent),
    auditEvent,
  };
}

function securityPayload() {
  const unsigned = {
    accessMode: "service",
    actorId: "service:caas-authorizer",
    actorKind: "service",
    correlationId: "security-postgres-integration-0001",
    decision: "PERMIT",
    occurredAt: "2026-07-14T03:30:00.000Z",
    previousDigest: null,
    reasonCode: "SERVICE_SCOPE_MATCH",
    requestedTenantId: "tenant-integration",
    resourceId: "tenant-integration",
    resourceKind: "tenant",
    schemaVersion: "molit.tenant-access-audit/1",
    sequence: 1,
    sessionTenantId: "tenant-integration",
    tenantId: "tenant-integration",
    traceId: "d".repeat(32),
  };
  const auditEvent = { ...unsigned, eventDigest: digest(unsigned) };
  return {
    auditEvent,
    auditEventPayloadSha256: digest(auditEvent),
    schemaVersion: "molit.tenant-access-outbox/1",
  };
}

test("Postgres audit outbox publishes state and tenant security audits and fails closed on an invalid security event", {
  skip: !connectionString,
  timeout: 30_000,
}, async (context) => {
  const pool = new Pool({ connectionString, max: 4, ssl: false });
  context.after(() => pool.end());
  await pool.query(await readFile(new URL("../../deploy/control-store/postgres/001_control_store.sql", import.meta.url), "utf8"));
  await pool.query(await readFile(new URL("../../deploy/control-store/postgres/002_normalized_projection.sql", import.meta.url), "utf8"));
  await pool.query("TRUNCATE molit_control_store.outbox_event, molit_control_store.audit_event, molit_control_store.idempotency_record, molit_control_store.resource_state, molit_control_store.projection_checkpoint, molit_control_store.resource_fence, molit_control_store.json_snapshot");

  const payload = auditPayload();
  const security = securityPayload();
  const auditEventId = digest({ kind: "audit", sequence: 1 });
  const securityEventId = digest({ component: "caas", eventDigest: security.auditEvent.eventDigest, type: "tenant.security.access" });
  const resourceEventId = digest({ kind: "resource", sequence: 1 });
  await pool.query(
    `INSERT INTO molit_control_store.outbox_event
       (component, tenant_id, event_id, aggregate_kind, aggregate_id, event_type, payload, payload_sha256, created_at, available_at)
     VALUES
       ('caas', 'tenant-integration', $1, 'audit', $2, 'audit.appended', $3::jsonb, $4, clock_timestamp(), clock_timestamp()),
       ('caas', 'tenant-integration', $5, 'tenant-security-audit', $6, 'tenant.security.access', $7::jsonb, $8, clock_timestamp(), clock_timestamp()),
       ('caas', 'tenant-integration', $9, 'tenant', 'tenant-integration', 'resource.upserted', '{}'::jsonb, $10, clock_timestamp(), clock_timestamp())`,
    [auditEventId, payload.sourceEventDigest, JSON.stringify(payload), digest(payload), securityEventId,
      security.auditEvent.eventDigest, JSON.stringify(security), digest(security), resourceEventId, digest({})],
  );

  const outbox = new PostgresOutbox({ pool, component: "caas", workerId: "worm-integration", eventTypes: ["audit.appended", "tenant.security.access"], maxAttempts: 3 });
  const backend = createLocalTestWormBackend({ environment: "test", backendId: "postgres-worm-integration" });
  const exporter = new WormAuditExporter({ backend, environment: "test", clock: () => new Date("2026-07-14T04:00:00.000Z") });
  const dispatcher = createWormOutboxDispatcher({ outbox, exporter, pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100 });
  assert.deepEqual(await dispatcher.runOnce(), { acknowledged: 2, claimed: 2, rejected: 0 });

  const stored = await pool.query("SELECT event_id, event_type, published_at, publish_receipt FROM molit_control_store.outbox_event ORDER BY event_type");
  const audit = stored.rows.find((row) => row.event_type === "audit.appended");
  const securityAudit = stored.rows.find((row) => row.event_type === "tenant.security.access");
  const resource = stored.rows.find((row) => row.event_type === "resource.upserted");
  assert.ok(audit.published_at);
  assert.equal(audit.publish_receipt.wormReceipt.sequence, 1);
  assert.ok(securityAudit.published_at);
  assert.equal(securityAudit.publish_receipt.schemaVersion, "molit.security-audit-publish-receipt/1");
  assert.equal(securityAudit.publish_receipt.sourceEventDigest, security.auditEvent.eventDigest);
  assert.equal(securityAudit.publish_receipt.wormReceipt.sequence, 2);
  assert.equal(resource.published_at, null);
  assert.deepEqual(await dispatcher.readiness(), {
    deadLettered: 0,
    initialized: true,
    lastError: null,
    lastSuccessAt: dispatcher.lastSuccessAt,
    oldestPendingAt: null,
    pending: 0,
    ready: false,
    running: false,
    stopping: false,
  });

  const claimedShape = { aggregateId: payload.sourceEventDigest, aggregateKind: "audit", component: "caas", eventId: auditEventId, eventType: "audit.appended", payload, payloadSha256: digest(payload), tenantId: "tenant-integration" };
  const recovery = await exporter.append(auditOutboxEventToWormEvent(claimedShape));
  assert.equal(recovery.replayed, true);
  assert.equal(recovery.receipt.sequence, 1);

  const invalidSecurity = structuredClone(security);
  invalidSecurity.auditEvent.sequence = 2;
  invalidSecurity.auditEvent.previousDigest = security.auditEvent.eventDigest;
  invalidSecurity.auditEvent.correlationId = "security-postgres-integration-0002";
  invalidSecurity.auditEvent.occurredAt = "2026-07-14T03:31:00.000Z";
  const invalidUnsigned = structuredClone(invalidSecurity.auditEvent);
  delete invalidUnsigned.eventDigest;
  invalidSecurity.auditEvent.eventDigest = digest(invalidUnsigned);
  invalidSecurity.auditEvent.decision = "ALLOW";
  invalidSecurity.auditEventPayloadSha256 = digest(invalidSecurity.auditEvent);
  const invalidEventId = digest({ component: "caas", eventDigest: invalidSecurity.auditEvent.eventDigest, type: "tenant.security.access" });
  await pool.query(
    `INSERT INTO molit_control_store.outbox_event
       (component, tenant_id, event_id, aggregate_kind, aggregate_id, event_type, payload, payload_sha256, created_at, available_at)
     VALUES ('caas', 'tenant-integration', $1, 'tenant-security-audit', $2, 'tenant.security.access', $3::jsonb, $4, clock_timestamp(), clock_timestamp())`,
    [invalidEventId, invalidSecurity.auditEvent.eventDigest, JSON.stringify(invalidSecurity), digest(invalidSecurity)],
  );
  const deadLetterOutbox = new PostgresOutbox({ pool, component: "caas", workerId: "worm-dead-letter-integration", eventTypes: ["audit.appended", "tenant.security.access"], maxAttempts: 1 });
  const deadLetterDispatcher = createWormOutboxDispatcher({ outbox: deadLetterOutbox, exporter, pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100 });
  assert.deepEqual(await deadLetterDispatcher.runOnce(), { acknowledged: 0, claimed: 1, rejected: 1 });
  const failed = await deadLetterDispatcher.readiness();
  assert.equal(failed.deadLettered, 1);
  assert.equal(failed.ready, false);
});
