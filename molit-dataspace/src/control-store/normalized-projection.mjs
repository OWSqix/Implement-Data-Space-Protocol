import { digest } from "../discovery/stable-json.mjs";
import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { tenantSecretReference } from "./postgres-tenant-store.mjs";
import { normalizeCaasIdempotencyRecordKey } from "./idempotency-record-key.mjs";

const MIGRATION_COMPONENT = "postgres-normalized-projection";
const MIGRATION_VERSION = 2;
const COMPONENTS = new Set(["caas", "dsaas"]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,511}$/u;
const TENANT_IDENTIFIER = /^[a-z][a-z0-9-]{2,62}$/u;
const PLATFORM_TENANT_ID = "molit-platform";
const DEFAULT_CODES = Object.freeze({
  conflict: "CONTROL_PROJECTION_CONFLICT",
  invalid: "CONTROL_PROJECTION_INVALID",
  migration: "CONTROL_PROJECTION_MIGRATION_REQUIRED",
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resourceRows(component, state) {
  if (component === "caas") {
    return Object.entries(asObject(state.tenants)).map(([resourceId, payload]) => ({
      kind: "tenant",
      resourceId,
      tenantId: resourceId,
      payload,
    }));
  }
  const rows = [];
  for (const [dataspaceId, payload] of Object.entries(asObject(state.dataspaces))) {
    rows.push({
      kind: "dataspace",
      resourceId: dataspaceId,
      tenantId: dataspaceId,
      payload,
    });
    for (const [participantId, participant] of Object.entries(asObject(payload?.participants))) {
      rows.push({
        kind: "participant",
        resourceId: `${dataspaceId}/${participantId}`,
        tenantId: dataspaceId,
        payload: participant,
      });
    }
  }
  return rows;
}

function idempotencyRows(component, state) {
  const records = component === "caas" ? asObject(state.requests) : asObject(state.idempotency);
  return Object.entries(records).map(([sourceRecordKey, payload]) => ({
    recordKey: component === "caas" ? normalizeCaasIdempotencyRecordKey(sourceRecordKey).recordKey : sourceRecordKey,
    tenantId: component === "caas"
      ? payload?.result?.tenantId ?? payload?.result?.connectorId ?? PLATFORM_TENANT_ID
      : payload?.response?.dataspaceId ?? PLATFORM_TENANT_ID,
    payload,
  }));
}

function auditTenantId(component, event) {
  if (component === "caas") return event?.tenantId ?? PLATFORM_TENANT_ID;
  const match = /^dataspace:([^/]+)(?:\/|$)/u.exec(event?.resource ?? "");
  return match?.[1] ?? PLATFORM_TENANT_ID;
}

function auditRows(component, state) {
  const events = component === "caas" ? state.audit : state.audit?.events;
  return (Array.isArray(events) ? events : []).map((event) => ({
    sequence: event.sequence,
    eventId: component === "caas" ? event.eventDigest : event.hash,
    occurredAt: component === "caas" ? event.occurredAt : event.at,
    previousDigest: component === "caas" ? event.previousDigest : event.previousHash,
    eventDigest: component === "caas" ? event.eventDigest : event.hash,
    tenantId: auditTenantId(component, event),
    payload: event,
  }));
}

function secretRows(component, state, invalidCode) {
  if (component !== "caas") return [];
  const rows = [];
  for (const [tenantId, tenant] of Object.entries(asObject(state.tenants))) {
    for (const [purpose, reference] of Object.entries(asObject(tenant?.deploymentSecretRefs))) {
      let canonical;
      try { canonical = tenantSecretReference(tenantId, reference); }
      catch {
        assertRuntime(false, invalidCode, "normalized projection secret reference is outside the tenant namespace", { purpose, tenantId });
      }
      rows.push({ purpose, reference: canonical, tenantId });
    }
  }
  return rows;
}

function outboxId(component, type, kind, resourceId, payloadSha256, revision, tenantId) {
  return digest({ component, kind, payloadSha256, resourceId, revision: String(revision), tenantId, type });
}

async function setServiceContext(client, component, tenantId) {
  await client.query(
    `SELECT
       set_config('molit.tenant_id', $1, true),
       set_config('molit.actor_id', $2, true),
       set_config('molit.access_mode', 'service', true),
       set_config('molit.break_glass_reason', '', true),
       set_config('molit.break_glass_expires_at', '', true)`,
    [tenantId, `service:${component}-normalized-projection`],
  );
}

async function enqueue(client, {
  component,
  eventId,
  aggregateKind,
  aggregateId,
  tenantId,
  eventType,
  payload,
  createdAt,
  conflictCode,
}) {
  const payloadSha256 = digest(payload);
  await client.query(
    `INSERT INTO molit_control_store.outbox_event
       (component, event_id, aggregate_kind, aggregate_id, tenant_id, event_type,
        payload, payload_sha256, created_at, available_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz, $9::timestamptz)
     ON CONFLICT (component, event_id) DO NOTHING`,
    [component, eventId, aggregateKind, aggregateId, tenantId, eventType,
      JSON.stringify(payload), payloadSha256, createdAt],
  );
  const stored = await client.query(
    `SELECT aggregate_kind, aggregate_id, tenant_id, event_type, payload_sha256
     FROM molit_control_store.outbox_event
     WHERE component = $1 AND event_id = $2`,
    [component, eventId],
  );
  assertRuntime(stored.rowCount === 1
    && stored.rows[0].aggregate_kind === aggregateKind
    && stored.rows[0].aggregate_id === aggregateId
    && stored.rows[0].tenant_id === tenantId
    && stored.rows[0].event_type === eventType
    && stored.rows[0].payload_sha256 === payloadSha256,
  conflictCode, "outbox event ID is already bound to different content", { eventId });
}

export class NormalizedControlProjection {
  constructor({ component, codes = {} }) {
    const resolvedCodes = { ...DEFAULT_CODES, ...codes };
    assertRuntime(COMPONENTS.has(component), resolvedCodes.invalid, "normalized projection component is invalid");
    this.component = component;
    this.codes = resolvedCodes;
  }

  async verifyMigration(client) {
    const result = await client.query(
      "SELECT version FROM molit_control_store.schema_migration WHERE component = $1",
      [MIGRATION_COMPONENT],
    );
    assertRuntime(result.rowCount === 1 && Number(result.rows[0].version) === MIGRATION_VERSION,
      this.codes.migration, "normalized control-store migration is missing or incompatible", {
        actual: result.rowCount === 1 ? result.rows[0].version : null,
        expected: MIGRATION_VERSION,
      });
    await client.query("SELECT component, resource_kind, resource_id, tenant_id, revision, payload, payload_sha256 FROM molit_control_store.resource_state WHERE false");
    await client.query("SELECT component, tenant_id, record_key, payload, payload_sha256, snapshot_revision FROM molit_control_store.idempotency_record WHERE false");
    await client.query("SELECT component, tenant_id, sequence, event_id, event_digest, event FROM molit_control_store.audit_event WHERE false");
    await client.query("SELECT component, tenant_id, event_id, aggregate_kind, aggregate_id, event_type, payload_sha256 FROM molit_control_store.outbox_event WHERE false");
    await client.query("SELECT component, tenant_id, first_seen_at, last_seen_at FROM molit_control_store.projection_tenant_registry WHERE false");
    const enrollment = await client.query(
      "SELECT to_regprocedure('molit_control_store.enroll_current_service_principal(text,text)') IS NOT NULL AS installed",
    );
    assertRuntime(enrollment.rows[0]?.installed === true, this.codes.migration,
      "tenant service-principal enrollment function is missing");
  }

  async initialize(context) {
    await this.verifyMigration(context.client);
    await this.apply(context);
  }

  async apply({ client, nextState, snapshotRevision, now }) {
    assertRuntime(nextState && typeof nextState === "object", this.codes.invalid, "normalized projection state is invalid");
    assertRuntime(/^[1-9][0-9]*$/u.test(String(snapshotRevision)), this.codes.invalid, "normalized projection revision is invalid");
    const resources = resourceRows(this.component, nextState);
    const current = new Set();
    const ledger = idempotencyRows(this.component, nextState);
    const audits = auditRows(this.component, nextState);
    const secrets = secretRows(this.component, nextState, this.codes.invalid);
    const currentTenantIds = new Set([
      PLATFORM_TENANT_ID,
      ...resources.map(({ tenantId }) => tenantId),
      ...ledger.map(({ tenantId }) => tenantId),
      ...audits.map(({ tenantId }) => tenantId),
      ...secrets.map(({ tenantId }) => tenantId),
    ]);
    await setServiceContext(client, this.component, PLATFORM_TENANT_ID);
    const registered = await client.query(
      "SELECT tenant_id FROM molit_control_store.projection_tenant_registry WHERE component = $1",
      [this.component],
    );
    const knownTenantIds = new Set([...currentTenantIds, ...registered.rows.map(({ tenant_id: tenantId }) => tenantId)]);
    for (const tenantId of currentTenantIds) {
      assertRuntime(TENANT_IDENTIFIER.test(tenantId), this.codes.invalid, "normalized projection tenant ID is invalid", { tenantId });
      if (tenantId !== PLATFORM_TENANT_ID) {
        await client.query(
          "SELECT molit_control_store.enroll_current_service_principal($1, $2) AS enrolled",
          [tenantId, this.component],
        );
      }
      await client.query(
        `INSERT INTO molit_control_store.projection_tenant_registry
           (component, tenant_id, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3::timestamptz, $3::timestamptz)
         ON CONFLICT (component, tenant_id) DO UPDATE
         SET last_seen_at = GREATEST(molit_control_store.projection_tenant_registry.last_seen_at, EXCLUDED.last_seen_at)`,
        [this.component, tenantId, now],
      );
    }
    for (const row of resources) {
      assertRuntime(IDENTIFIER.test(row.resourceId), this.codes.invalid, "normalized projection resource ID is invalid", { resourceId: row.resourceId });
      assertRuntime(TENANT_IDENTIFIER.test(row.tenantId), this.codes.invalid, "normalized projection tenant ID is invalid", { tenantId: row.tenantId });
      const key = `${row.tenantId}\0${row.kind}\0${row.resourceId}`;
      current.add(key);
      const payloadSha256 = digest(row.payload);
      await setServiceContext(client, this.component, row.tenantId);
      await client.query(
        `INSERT INTO molit_control_store.resource_state
           (component, resource_kind, resource_id, tenant_id, revision, payload, payload_sha256, updated_at)
         VALUES ($1, $2, $3, $4, $5::bigint, $6::jsonb, $7, $8::timestamptz)
         ON CONFLICT (component, tenant_id, resource_kind, resource_id) DO UPDATE
         SET revision = EXCLUDED.revision,
             payload = EXCLUDED.payload,
             payload_sha256 = EXCLUDED.payload_sha256,
             updated_at = EXCLUDED.updated_at
         WHERE molit_control_store.resource_state.payload_sha256 <> EXCLUDED.payload_sha256`,
        [this.component, row.kind, row.resourceId, row.tenantId, String(snapshotRevision), JSON.stringify(row.payload), payloadSha256, now],
      );
    }
    for (const tenantId of knownTenantIds) {
      await setServiceContext(client, this.component, tenantId);
      const storedResources = await client.query(
        `SELECT resource_kind, resource_id
         FROM molit_control_store.resource_state
         WHERE component = $1 AND tenant_id = $2`,
        [this.component, tenantId],
      );
      for (const stored of storedResources.rows) {
        const key = `${tenantId}\0${stored.resource_kind}\0${stored.resource_id}`;
        if (current.has(key)) continue;
        await client.query(
          "DELETE FROM molit_control_store.resource_state WHERE component = $1 AND tenant_id = $2 AND resource_kind = $3 AND resource_id = $4",
          [this.component, tenantId, stored.resource_kind, stored.resource_id],
        );
      }
    }

    const currentSecrets = new Set();
    for (const row of secrets) {
      assertRuntime(IDENTIFIER.test(row.purpose), this.codes.invalid, "normalized projection secret purpose is invalid", { purpose: row.purpose });
      currentSecrets.add(`${row.tenantId}\0${row.purpose}`);
      await setServiceContext(client, this.component, row.tenantId);
      await client.query(
        `INSERT INTO molit_control_store.tenant_secret_reference
           (component, tenant_id, purpose, secret_ref, created_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)
         ON CONFLICT (component, tenant_id, purpose) DO UPDATE
         SET secret_ref = EXCLUDED.secret_ref, created_at = EXCLUDED.created_at`,
        [this.component, row.tenantId, row.purpose, row.reference, now],
      );
    }
    for (const tenantId of knownTenantIds) {
      await setServiceContext(client, this.component, tenantId);
      const storedSecrets = await client.query(
        `SELECT purpose FROM molit_control_store.tenant_secret_reference
         WHERE component = $1 AND tenant_id = $2`,
        [this.component, tenantId],
      );
      for (const stored of storedSecrets.rows) {
        if (currentSecrets.has(`${tenantId}\0${stored.purpose}`)) continue;
        await client.query(
          `DELETE FROM molit_control_store.tenant_secret_reference
           WHERE component = $1 AND tenant_id = $2 AND purpose = $3`,
          [this.component, tenantId, stored.purpose],
        );
      }
    }

    const ledgerKeys = new Set();
    for (const row of ledger) {
      assertRuntime(TENANT_IDENTIFIER.test(row.tenantId), this.codes.invalid, "normalized idempotency tenant ID is invalid", { tenantId: row.tenantId });
      ledgerKeys.add(`${row.tenantId}\0${row.recordKey}`);
      const payloadSha256 = digest(row.payload);
      await setServiceContext(client, this.component, row.tenantId);
      await client.query(
        `INSERT INTO molit_control_store.idempotency_record
           (component, tenant_id, record_key, payload, payload_sha256, snapshot_revision, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::bigint, $7::timestamptz)
         ON CONFLICT (component, tenant_id, record_key) DO UPDATE
         SET payload = EXCLUDED.payload,
             payload_sha256 = EXCLUDED.payload_sha256,
             snapshot_revision = EXCLUDED.snapshot_revision,
             updated_at = EXCLUDED.updated_at
         WHERE molit_control_store.idempotency_record.payload_sha256 <> EXCLUDED.payload_sha256`,
        [this.component, row.tenantId, row.recordKey, JSON.stringify(row.payload), payloadSha256, String(snapshotRevision), now],
      );
    }
    for (const tenantId of knownTenantIds) {
      await setServiceContext(client, this.component, tenantId);
      const storedLedger = await client.query(
        "SELECT record_key FROM molit_control_store.idempotency_record WHERE component = $1 AND tenant_id = $2",
        [this.component, tenantId],
      );
      for (const stored of storedLedger.rows) {
        if (ledgerKeys.has(`${tenantId}\0${stored.record_key}`)) continue;
        await client.query(
          "DELETE FROM molit_control_store.idempotency_record WHERE component = $1 AND tenant_id = $2 AND record_key = $3",
          [this.component, tenantId, stored.record_key],
        );
      }
    }

    for (const row of audits) {
      await setServiceContext(client, this.component, row.tenantId);
      await client.query(
        `INSERT INTO molit_control_store.audit_event
           (component, tenant_id, sequence, event_id, occurred_at, previous_digest, event_digest, event)
         VALUES ($1, $2, $3::bigint, $4, $5::timestamptz, $6, $7, $8::jsonb)
         ON CONFLICT (component, sequence) DO NOTHING`,
        [this.component, row.tenantId, String(row.sequence), row.eventId, row.occurredAt, row.previousDigest, row.eventDigest, JSON.stringify(row.payload)],
      );
      const stored = await client.query(
        `SELECT tenant_id, event_id, previous_digest, event_digest, event
         FROM molit_control_store.audit_event
         WHERE component = $1 AND sequence = $2::bigint`,
        [this.component, String(row.sequence)],
      );
      assertRuntime(stored.rowCount === 1
        && stored.rows[0].tenant_id === row.tenantId
        && stored.rows[0].event_id === row.eventId
        && stored.rows[0].previous_digest === row.previousDigest
        && stored.rows[0].event_digest === row.eventDigest
        && digest(stored.rows[0].event) === digest(row.payload),
        this.codes.conflict, "audit sequence is already bound to different content", {
          sequence: row.sequence,
        });
      await enqueue(client, {
        component: this.component,
        eventId: outboxId(this.component, "audit.appended", "audit", row.eventId, row.eventDigest, row.sequence, row.tenantId),
        aggregateKind: "audit",
        aggregateId: row.eventId,
        tenantId: row.tenantId,
        eventType: "audit.appended",
        payload: {
          schemaVersion: "molit.audit-outbox/1",
          sourceComponent: this.component,
          sourceSequence: row.sequence,
          sourceEventDigest: row.eventDigest,
          auditEvent: row.payload,
          auditEventPayloadSha256: digest(row.payload),
        },
        createdAt: row.occurredAt,
        conflictCode: this.codes.conflict,
      });
    }

    const stateSha256 = nextState.integrity?.snapshotDigest ?? digest(nextState);
    await setServiceContext(client, this.component, PLATFORM_TENANT_ID);
    await client.query(
      `INSERT INTO molit_control_store.projection_checkpoint
         (component, snapshot_revision, state_sha256, resource_count, idempotency_count, audit_count, updated_at)
       VALUES ($1, $2::bigint, $3, $4, $5, $6::bigint, $7::timestamptz)
       ON CONFLICT (component) DO UPDATE
       SET snapshot_revision = EXCLUDED.snapshot_revision,
           state_sha256 = EXCLUDED.state_sha256,
           resource_count = EXCLUDED.resource_count,
           idempotency_count = EXCLUDED.idempotency_count,
           audit_count = EXCLUDED.audit_count,
           updated_at = EXCLUDED.updated_at`,
      [this.component, String(snapshotRevision), stateSha256, resources.length, ledger.length,
        String(audits.length), now],
    );
  }
}

export function createNormalizedControlProjection(options) {
  return new NormalizedControlProjection(options);
}
