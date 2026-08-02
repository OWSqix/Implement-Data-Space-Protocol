import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { digest } from "../discovery/stable-json.mjs";

const MIGRATION_COMPONENT = "postgres-normalized-projection";
const MIGRATION_VERSION = 2;
const TENANT_ID = /^[a-z][a-z0-9-]{2,62}$/u;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/u;
const RESOURCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,1023}$/u;
const EVENT_TYPE = /^[a-z][a-z0-9._-]{2,127}$/u;
const ACTOR = /^[^\s\u0000-\u001f\u007f]{3,256}$/u;
const TRACE_ID = /^[a-f0-9]{32}$/u;
const CORRELATION_ID = /^[^\s\u0000-\u001f\u007f]{8,128}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_:-]{2,63}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ACCESS_MODES = new Set(["tenant", "service", "break-glass"]);
const ACTOR_KINDS = new Set(["user", "service", "workload", "operator"]);
const SECRET_FIELD = /(?:password|passphrase|secret|token|credential|private[-_]?key)/iu;
const SECRET_REFERENCE = /^(?:env:\/\/[A-Z_][A-Z0-9_]*|vault:\/\/[A-Za-z0-9][A-Za-z0-9._/-]*|k8s-secret:\/\/[A-Za-z0-9][A-Za-z0-9._/#-]*)$/u;

function clone(value) {
  return structuredClone(value);
}

function postgresError(error, code = "TENANT_STORE_UNAVAILABLE") {
  if (error instanceof RuntimeError) return error;
  return new RuntimeError(code, "tenant control-store request failed", { causeCode: error?.code ?? "POSTGRES_ERROR" });
}

async function rollback(client) {
  try { await client.query("ROLLBACK"); } catch { /* the caller discards the connection */ }
}

function assertJsonObject(value, code, message) {
  assertRuntime(value && typeof value === "object" && !Array.isArray(value), code, message);
}

function assertReferenceOnly(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertReferenceOnly(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (SECRET_FIELD.test(key) && typeof entry === "string" && !SECRET_REFERENCE.test(entry)) {
      throw new RuntimeError("TENANT_SECRET_VALUE_FORBIDDEN", "secret-bearing fields must contain a reference, never secret material", { path: nextPath });
    }
    assertReferenceOnly(entry, nextPath);
  }
}

function normalizedContext(context, now) {
  assertJsonObject(context, "TENANT_CONTEXT_INVALID", "tenant access context is required");
  assertRuntime(TENANT_ID.test(context.tenantId ?? ""), "TENANT_CONTEXT_INVALID", "session tenant ID is invalid");
  assertRuntime(ACTOR.test(context.actorId ?? "") && ACTOR_KINDS.has(context.actorKind),
    "TENANT_CONTEXT_INVALID", "tenant actor attribution is invalid");
  assertRuntime(ACCESS_MODES.has(context.accessMode), "TENANT_CONTEXT_INVALID", "tenant access mode is invalid");
  assertRuntime(TRACE_ID.test(context.traceId ?? ""), "TENANT_CONTEXT_INVALID", "trace ID must be a W3C 16-byte lowercase hexadecimal identifier");
  assertRuntime(CORRELATION_ID.test(context.correlationId ?? ""), "TENANT_CONTEXT_INVALID", "correlation ID is invalid");
  const expiresAt = context.breakGlassExpiresAt ?? null;
  const expiresMs = expiresAt === null ? Number.NaN : Date.parse(expiresAt);
  return Object.freeze({
    accessMode: context.accessMode,
    actorId: context.actorId,
    actorKind: context.actorKind,
    breakGlassExpiresAt: Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : null,
    breakGlassReason: typeof context.breakGlassReason === "string" ? context.breakGlassReason : "",
    correlationId: context.correlationId,
    now: now.toISOString(),
    tenantId: context.tenantId,
    traceId: context.traceId,
  });
}

function authorization(context, requestedTenantId, at) {
  if (context.accessMode !== "break-glass") {
    return context.tenantId === requestedTenantId
      ? { allowed: true, reasonCode: context.accessMode === "service" ? "SERVICE_SCOPE_MATCH" : "TENANT_SCOPE_MATCH" }
      : { allowed: false, reasonCode: "TENANT_BINDING_MISMATCH" };
  }
  const expiresMs = Date.parse(context.breakGlassExpiresAt ?? "");
  if (context.breakGlassReason.length < 8 || !Number.isFinite(expiresMs) || expiresMs <= at.getTime()) {
    return { allowed: false, reasonCode: "BREAK_GLASS_INVALID" };
  }
  return { allowed: true, reasonCode: "BREAK_GLASS_ACTIVE" };
}

function resourceRow(row) {
  return Object.freeze({
    payload: clone(row.payload),
    payloadSha256: row.payload_sha256,
    resourceId: row.resource_id,
    resourceKind: row.resource_kind,
    revision: Number(row.revision),
    tenantId: row.tenant_id,
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

export function tenantObjectKey(tenantId, suffix) {
  assertRuntime(TENANT_ID.test(tenantId ?? ""), "TENANT_OBJECT_KEY_INVALID", "object tenant ID is invalid");
  assertRuntime(typeof suffix === "string" && suffix.length >= 1 && suffix.length <= 900
    && !suffix.startsWith("/") && !suffix.includes("//")
    && !suffix.split("/").some((part) => part === "" || part === "." || part === ".."),
  "TENANT_OBJECT_KEY_INVALID", "object key suffix is not canonical");
  return `tenants/${tenantId}/${suffix}`;
}

export function tenantSecretReference(tenantId, reference) {
  assertRuntime(TENANT_ID.test(tenantId ?? ""), "TENANT_SECRET_REF_INVALID", "secret tenant ID is invalid");
  const vaultPrefix = `vault://tenants/${tenantId}/`;
  const kubernetesPrefix = `k8s-secret://molit-caas-${tenantId}/`;
  const vaultTail = typeof reference === "string" && reference.startsWith(vaultPrefix)
    ? reference.slice(vaultPrefix.length) : null;
  const kubernetesTail = typeof reference === "string" && reference.startsWith(kubernetesPrefix)
    ? reference.slice(kubernetesPrefix.length) : null;
  const validVaultTail = vaultTail !== null && vaultTail.length > 0 && !vaultTail.includes("#")
    && vaultTail.split("/").every((part) => part !== "" && part !== "." && part !== "..");
  const validKubernetesTail = kubernetesTail !== null
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}#[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/u.test(kubernetesTail);
  const canonical = typeof reference === "string" && reference.length <= 512
    && !reference.includes("?") && (validVaultTail || validKubernetesTail);
  assertRuntime(canonical, "TENANT_SECRET_REF_INVALID", "secret reference is not bound to the tenant namespace");
  return reference;
}

export function bindTenantMetricLabels(tenantId, labels = {}) {
  assertRuntime(TENANT_ID.test(tenantId ?? ""), "TENANT_METRIC_LABEL_INVALID", "metric tenant ID is invalid");
  assertJsonObject(labels, "TENANT_METRIC_LABEL_INVALID", "metric labels must be an object");
  assertRuntime(labels["tenant.id"] === undefined || labels["tenant.id"] === tenantId,
    "TENANT_METRIC_LABEL_MISMATCH", "metric tenant label differs from the authorized tenant");
  return Object.freeze({ ...clone(labels), "tenant.id": tenantId });
}

export class PostgresTenantStore {
  constructor({ pool, component, clock = () => new Date(), statementTimeoutMs = 30_000 }) {
    assertRuntime(pool && typeof pool.connect === "function", "TENANT_STORE_CONFIG_INVALID", "PostgreSQL pool is invalid");
    assertRuntime(COMPONENT.test(component ?? ""), "TENANT_STORE_CONFIG_INVALID", "tenant store component is invalid");
    assertRuntime(typeof clock === "function", "TENANT_STORE_CONFIG_INVALID", "tenant store clock is invalid");
    assertRuntime(Number.isSafeInteger(statementTimeoutMs) && statementTimeoutMs >= 100 && statementTimeoutMs <= 120_000,
      "TENANT_STORE_CONFIG_INVALID", "tenant store statement timeout is invalid");
    Object.assign(this, { pool, component, clock, statementTimeoutMs });
    this.initialized = false;
  }

  async initialize() {
    const client = await this.pool.connect();
    try {
      const migration = await client.query(
        "SELECT version FROM molit_control_store.schema_migration WHERE component = $1",
        [MIGRATION_COMPONENT],
      );
      assertRuntime(migration.rowCount === 1 && Number(migration.rows[0].version) === MIGRATION_VERSION,
        "TENANT_STORE_MIGRATION_REQUIRED", "tenant isolation migration is missing or incompatible", {
          actual: migration.rows[0]?.version ?? null,
          expected: MIGRATION_VERSION,
        });
      for (const table of [
        "resource_state", "idempotency_record", "audit_event", "outbox_event",
        "tenant_security_audit", "tenant_audit_head", "tenant_object_reference",
        "tenant_secret_reference", "tenant_metric_sample",
      ]) {
        await client.query(`SELECT tenant_id FROM molit_control_store.${table} WHERE false`);
      }
      this.initialized = true;
    } catch (error) {
      throw postgresError(error, "TENANT_STORE_MIGRATION_REQUIRED");
    } finally {
      client.release();
    }
  }

  #assertReady() {
    assertRuntime(this.initialized, "TENANT_STORE_MIGRATION_REQUIRED", "tenant store has not verified its migration");
  }

  async #setContext(client, context, { denialAudit = false } = {}) {
    const accessMode = context.accessMode;
    const breakGlassReason = denialAudit && accessMode === "break-glass"
      ? "record denied break-glass request"
      : context.breakGlassReason;
    const breakGlassExpiresAt = denialAudit && accessMode === "break-glass"
      ? new Date(this.clock().getTime() + 60_000).toISOString()
      : context.breakGlassExpiresAt ?? "";
    await client.query(
      `SELECT
         set_config('molit.tenant_id', $1, true),
         set_config('molit.actor_id', $2, true),
         set_config('molit.access_mode', $3, true),
         set_config('molit.trace_id', $4, true),
         set_config('molit.correlation_id', $5, true),
         set_config('molit.break_glass_reason', $6, true),
         set_config('molit.break_glass_expires_at', $7, true),
         set_config('statement_timeout', $8, true)`,
      [context.tenantId, context.actorId, accessMode, context.traceId, context.correlationId,
        breakGlassReason,
        breakGlassExpiresAt,
        `${this.statementTimeoutMs}ms`],
    );
  }

  async #appendAccessAudit(client, context, {
    accessMode = context.accessMode,
    decision,
    reasonCode,
    requestedTenantId,
    resourceId,
    resourceKind,
  }) {
    assertRuntime(["PERMIT", "DENY"].includes(decision), "TENANT_AUDIT_INVALID", "tenant audit decision is invalid");
    assertRuntime(ERROR_CODE.test(reasonCode), "TENANT_AUDIT_INVALID", "tenant audit reason code is invalid");
    const bindingTenantId = context.tenantId;
    const occurredAt = this.clock().toISOString();
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [JSON.stringify([this.component, "tenant-security-audit", bindingTenantId])],
    );
    const head = await client.query(
      `SELECT sequence::text, event_digest
       FROM molit_control_store.tenant_audit_head
       WHERE component = $1 AND tenant_id = $2
       FOR UPDATE`,
      [this.component, bindingTenantId],
    );
    const priorSequence = head.rowCount === 0 ? 0 : Number(head.rows[0].sequence);
    const previousDigest = head.rowCount === 0 ? null : head.rows[0].event_digest;
    const unsigned = {
      accessMode,
      actorId: context.actorId,
      actorKind: context.actorKind,
      correlationId: context.correlationId,
      decision,
      occurredAt,
      previousDigest,
      reasonCode,
      requestedTenantId,
      resourceId,
      resourceKind,
      schemaVersion: "molit.tenant-access-audit/1",
      sequence: priorSequence + 1,
      sessionTenantId: context.tenantId,
      tenantId: bindingTenantId,
      traceId: context.traceId,
    };
    const eventDigest = digest(unsigned);
    const event = { ...unsigned, eventDigest };
    await client.query(
      `INSERT INTO molit_control_store.tenant_security_audit
         (component, tenant_id, sequence, event_id, occurred_at, actor_id, actor_kind,
          session_tenant_id, requested_tenant_id, access_mode, resource_kind, resource_id,
          decision, reason_code, trace_id, correlation_id, previous_digest, event_digest, event)
       VALUES ($1, $2, $3::bigint, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19::jsonb)`,
      [this.component, bindingTenantId, String(unsigned.sequence), eventDigest, occurredAt,
        context.actorId, context.actorKind, context.tenantId, requestedTenantId, accessMode,
        resourceKind, resourceId, decision, reasonCode, context.traceId, context.correlationId,
        previousDigest, eventDigest, JSON.stringify(event)],
    );
    const advanced = await client.query(
      `INSERT INTO molit_control_store.tenant_audit_head
         (component, tenant_id, sequence, event_digest, updated_at)
       VALUES ($1, $2, $3::bigint, $4, $5::timestamptz)
       ON CONFLICT (component, tenant_id) DO UPDATE
       SET sequence = EXCLUDED.sequence,
           event_digest = EXCLUDED.event_digest,
           updated_at = EXCLUDED.updated_at
       WHERE molit_control_store.tenant_audit_head.sequence = $6::bigint`,
      [this.component, bindingTenantId, String(unsigned.sequence), eventDigest, occurredAt, String(priorSequence)],
    );
    assertRuntime(advanced.rowCount === 1, "TENANT_AUDIT_CONFLICT", "tenant audit head compare-and-set failed");
    const outboxPayload = {
      auditEvent: event,
      auditEventPayloadSha256: digest(event),
      schemaVersion: "molit.tenant-access-outbox/1",
    };
    const outboxEventId = digest({ component: this.component, eventDigest, type: "tenant.security.access" });
    await client.query(
      `INSERT INTO molit_control_store.outbox_event
         (component, event_id, aggregate_kind, aggregate_id, tenant_id, event_type,
          payload, payload_sha256, created_at, available_at)
       VALUES ($1, $2, 'tenant-security-audit', $3, $4, 'tenant.security.access',
         $5::jsonb, $6, $7::timestamptz, $7::timestamptz)`,
      [this.component, outboxEventId, eventDigest, bindingTenantId, JSON.stringify(outboxPayload),
        digest(outboxPayload), occurredAt],
    );
    return Object.freeze({ eventDigest, eventId: eventDigest, sequence: unsigned.sequence });
  }

  async #recordDenial(context, requestedTenantId, resourceKind, resourceId, reasonCode, reportedAccessMode = context.accessMode) {
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN");
      transaction = true;
      await this.#setContext(client, context, { denialAudit: true });
      const audit = await this.#appendAccessAudit(client, context, {
        accessMode: reportedAccessMode,
        decision: "DENY",
        reasonCode,
        requestedTenantId,
        resourceId,
        resourceKind,
      });
      await client.query("COMMIT");
      transaction = false;
      return audit;
    } catch (error) {
      if (transaction) await rollback(client);
      throw postgresError(error, "TENANT_DENIAL_AUDIT_FAILED");
    } finally {
      client.release(transaction);
    }
  }

  async #deny(context, requestedTenantId, resourceKind, resourceId, reasonCode) {
    const audit = await this.#recordDenial(context, requestedTenantId, resourceKind, resourceId, reasonCode);
    throw new RuntimeError("TENANT_ACCESS_DENIED", "tenant-bound resource access was denied", {
      auditEventId: audit.eventId,
      requestedTenantId,
      resourceId,
      resourceKind,
    });
  }

  async #validateReferenceOnly(contextInput, requestedTenantId, resourceKind, resourceId, payload) {
    const now = this.clock();
    const context = normalizedContext(contextInput, now);
    const access = authorization(context, requestedTenantId, now);
    if (!access.allowed) return this.#deny(context, requestedTenantId, resourceKind, resourceId, access.reasonCode);
    try {
      assertReferenceOnly(payload);
    } catch (error) {
      await this.#recordDenial(context, requestedTenantId, resourceKind, resourceId, "SECRET_VALUE_FORBIDDEN");
      throw error;
    }
  }

  async #execute(contextInput, requestedTenantId, resourceKind, resourceId, operation) {
    this.#assertReady();
    assertRuntime(TENANT_ID.test(requestedTenantId ?? ""), "TENANT_REQUEST_INVALID", "requested tenant ID is invalid");
    assertRuntime(RESOURCE.test(resourceKind ?? "") && RESOURCE.test(resourceId ?? ""),
      "TENANT_REQUEST_INVALID", "tenant resource identifier is invalid");
    const now = this.clock();
    const context = normalizedContext(contextInput, now);
    const access = authorization(context, requestedTenantId, now);
    if (!access.allowed) return this.#deny(context, requestedTenantId, resourceKind, resourceId, access.reasonCode);

    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN");
      transaction = true;
      await this.#setContext(client, context);
      if (context.accessMode !== "tenant") {
        await this.#appendAccessAudit(client, context, {
          decision: "PERMIT",
          reasonCode: access.reasonCode,
          requestedTenantId,
          resourceId,
          resourceKind,
        });
      }
      const result = await operation(client, context);
      await client.query("COMMIT");
      transaction = false;
      return clone(result);
    } catch (error) {
      if (transaction) await rollback(client);
      if (error?.code === "42501") {
        await this.#recordDenial(context, requestedTenantId, resourceKind, resourceId, "DATABASE_RLS_DENIED");
        throw new RuntimeError("TENANT_ACCESS_DENIED", "PostgreSQL row policy denied tenant access", {
          requestedTenantId,
          resourceId,
          resourceKind,
        });
      }
      throw postgresError(error);
    } finally {
      client.release(transaction);
    }
  }

  async putResource(context, { expectedRevision, payload, resourceId, resourceKind, tenantId = context?.tenantId }) {
    assertRuntime(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0,
      "TENANT_RESOURCE_REVISION_INVALID", "expected resource revision is invalid");
    assertJsonObject(payload, "TENANT_RESOURCE_INVALID", "tenant resource payload must be an object");
    await this.#validateReferenceOnly(context, tenantId, resourceKind, resourceId, payload);
    return this.#execute(context, tenantId, resourceKind, resourceId, async (client) => {
      const current = await client.query(
        `SELECT revision::text FROM molit_control_store.resource_state
         WHERE component = $1 AND tenant_id = $2 AND resource_kind = $3 AND resource_id = $4
         FOR UPDATE`,
        [this.component, tenantId, resourceKind, resourceId],
      );
      const actualRevision = current.rowCount === 0 ? 0 : Number(current.rows[0].revision);
      assertRuntime(actualRevision === expectedRevision, "TENANT_RESOURCE_REVISION_CONFLICT",
        "tenant resource revision compare-and-set failed", { actualRevision, expectedRevision });
      const revision = actualRevision + 1;
      const now = this.clock().toISOString();
      const payloadSha256 = digest(payload);
      if (actualRevision === 0) {
        await client.query(
          `INSERT INTO molit_control_store.resource_state
             (component, tenant_id, resource_kind, resource_id, revision, payload, payload_sha256, updated_at)
           VALUES ($1, $2, $3, $4, $5::bigint, $6::jsonb, $7, $8::timestamptz)`,
          [this.component, tenantId, resourceKind, resourceId, String(revision), JSON.stringify(payload), payloadSha256, now],
        );
      } else {
        const updated = await client.query(
          `UPDATE molit_control_store.resource_state
           SET revision = $5::bigint, payload = $6::jsonb, payload_sha256 = $7, updated_at = $8::timestamptz
           WHERE component = $1 AND tenant_id = $2 AND resource_kind = $3 AND resource_id = $4
             AND revision = $9::bigint`,
          [this.component, tenantId, resourceKind, resourceId, String(revision), JSON.stringify(payload),
            payloadSha256, now, String(expectedRevision)],
        );
        assertRuntime(updated.rowCount === 1, "TENANT_RESOURCE_REVISION_CONFLICT", "tenant resource revision fence was lost");
      }
      const outboxPayload = { payloadSha256, resourceId, resourceKind, revision, tenantId };
      const eventId = digest({ component: this.component, ...outboxPayload, type: "tenant.resource.upserted" });
      await client.query(
        `INSERT INTO molit_control_store.outbox_event
           (component, event_id, aggregate_kind, aggregate_id, tenant_id, event_type,
            payload, payload_sha256, created_at, available_at)
         VALUES ($1, $2, $3, $4, $5, 'tenant.resource.upserted', $6::jsonb, $7, $8::timestamptz, $8::timestamptz)`,
        [this.component, eventId, resourceKind, resourceId, tenantId, JSON.stringify(outboxPayload), digest(outboxPayload), now],
      );
      return { payload: clone(payload), payloadSha256, resourceId, resourceKind, revision, tenantId, updatedAt: now };
    });
  }

  async getResource(context, { resourceId, resourceKind, tenantId = context?.tenantId }) {
    return this.#execute(context, tenantId, resourceKind, resourceId, async (client) => {
      const result = await client.query(
        `SELECT tenant_id, resource_kind, resource_id, revision, payload, payload_sha256, updated_at
         FROM molit_control_store.resource_state
         WHERE component = $1 AND tenant_id = $2 AND resource_kind = $3 AND resource_id = $4`,
        [this.component, tenantId, resourceKind, resourceId],
      );
      assertRuntime(result.rowCount === 1, "TENANT_RESOURCE_NOT_FOUND", "tenant resource does not exist");
      return resourceRow(result.rows[0]);
    });
  }

  async putIdempotency(context, { payload, recordKey, snapshotRevision = 1, tenantId = context?.tenantId }) {
    assertRuntime(RESOURCE.test(recordKey ?? ""), "TENANT_IDEMPOTENCY_INVALID", "idempotency record key is invalid");
    assertRuntime(Number.isSafeInteger(snapshotRevision) && snapshotRevision >= 1,
      "TENANT_IDEMPOTENCY_INVALID", "idempotency snapshot revision is invalid");
    assertJsonObject(payload, "TENANT_IDEMPOTENCY_INVALID", "idempotency payload must be an object");
    await this.#validateReferenceOnly(context, tenantId, "idempotency", recordKey, payload);
    return this.#execute(context, tenantId, "idempotency", recordKey, async (client) => {
      const payloadSha256 = digest(payload);
      const now = this.clock().toISOString();
      await client.query(
        `INSERT INTO molit_control_store.idempotency_record
           (component, tenant_id, record_key, payload, payload_sha256, snapshot_revision, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::bigint, $7::timestamptz)
         ON CONFLICT (component, tenant_id, record_key) DO NOTHING`,
        [this.component, tenantId, recordKey, JSON.stringify(payload), payloadSha256, String(snapshotRevision), now],
      );
      const stored = await client.query(
        `SELECT payload, payload_sha256, snapshot_revision::text, updated_at
         FROM molit_control_store.idempotency_record
         WHERE component = $1 AND tenant_id = $2 AND record_key = $3`,
        [this.component, tenantId, recordKey],
      );
      assertRuntime(stored.rowCount === 1 && stored.rows[0].payload_sha256 === payloadSha256,
        "TENANT_IDEMPOTENCY_CONFLICT", "idempotency key is already bound to different content");
      return {
        payload: clone(stored.rows[0].payload),
        payloadSha256,
        recordKey,
        snapshotRevision: Number(stored.rows[0].snapshot_revision),
        tenantId,
        updatedAt: new Date(stored.rows[0].updated_at).toISOString(),
      };
    });
  }

  async enqueue(context, { eventType, messageId, payload, tenantId = context?.tenantId }) {
    assertRuntime(EVENT_TYPE.test(eventType ?? "") && RESOURCE.test(messageId ?? ""),
      "TENANT_QUEUE_INVALID", "tenant queue event type or message ID is invalid");
    assertJsonObject(payload, "TENANT_QUEUE_INVALID", "tenant queue payload must be an object");
    await this.#validateReferenceOnly(context, tenantId, "queue-message", messageId, payload);
    return this.#execute(context, tenantId, "queue-message", messageId, async (client) => {
      const createdAt = this.clock().toISOString();
      const payloadSha256 = digest(payload);
      const eventId = digest({ component: this.component, eventType, messageId, tenantId });
      await client.query(
        `INSERT INTO molit_control_store.outbox_event
           (component, event_id, aggregate_kind, aggregate_id, tenant_id, event_type,
            payload, payload_sha256, created_at, available_at)
         VALUES ($1, $2, 'queue-message', $3, $4, $5, $6::jsonb, $7, $8::timestamptz, $8::timestamptz)
         ON CONFLICT (component, event_id) DO NOTHING`,
        [this.component, eventId, messageId, tenantId, eventType, JSON.stringify(payload), payloadSha256, createdAt],
      );
      const stored = await client.query(
        `SELECT payload_sha256 FROM molit_control_store.outbox_event
         WHERE component = $1 AND tenant_id = $2 AND event_id = $3`,
        [this.component, tenantId, eventId],
      );
      assertRuntime(stored.rowCount === 1 && stored.rows[0].payload_sha256 === payloadSha256,
        "TENANT_QUEUE_CONFLICT", "tenant queue message ID is bound to different content");
      return { createdAt, eventId, eventType, messageId, payloadSha256, tenantId };
    });
  }

  async claimQueue(context, { eventTypes = [], leaseMs = 30_000, limit = 50, tenantId = context?.tenantId, workerId }) {
    assertRuntime(RESOURCE.test(workerId ?? "") && Number.isSafeInteger(limit) && limit >= 1 && limit <= 500
      && Number.isSafeInteger(leaseMs) && leaseMs >= 1_000 && leaseMs <= 900_000
      && Array.isArray(eventTypes) && eventTypes.length <= 64 && eventTypes.every((entry) => EVENT_TYPE.test(entry)),
    "TENANT_QUEUE_INVALID", "tenant queue claim is invalid");
    return this.#execute(context, tenantId, "queue", workerId, async (client) => {
      const result = await client.query(
        `WITH ready AS (
           SELECT component, event_id
           FROM molit_control_store.outbox_event
           WHERE component = $1 AND tenant_id = $2
             AND aggregate_kind = 'queue-message'
             AND (cardinality($3::text[]) = 0 OR event_type = ANY($3::text[]))
             AND published_at IS NULL AND dead_lettered_at IS NULL
             AND available_at <= clock_timestamp()
             AND (claimed_until IS NULL OR claimed_until <= clock_timestamp())
           ORDER BY created_at, event_id
           FOR UPDATE SKIP LOCKED
           LIMIT $4
         )
         UPDATE molit_control_store.outbox_event target
         SET claimed_by = $5,
             claimed_until = clock_timestamp() + ($6::integer * interval '1 millisecond'),
             attempts = target.attempts + 1
         FROM ready
         WHERE target.component = ready.component AND target.event_id = ready.event_id
         RETURNING target.*`,
        [this.component, tenantId, eventTypes, limit, workerId, leaseMs],
      );
      return result.rows.map((row) => ({
        attempts: Number(row.attempts),
        eventId: row.event_id,
        eventType: row.event_type,
        messageId: row.aggregate_id,
        payload: clone(row.payload),
        tenantId: row.tenant_id,
      }));
    });
  }

  async acknowledgeQueue(context, { eventId, receipt, tenantId = context?.tenantId, workerId }) {
    assertRuntime(SHA256.test(eventId ?? "") && RESOURCE.test(workerId ?? ""),
      "TENANT_QUEUE_INVALID", "tenant queue acknowledgement is invalid");
    assertJsonObject(receipt, "TENANT_QUEUE_INVALID", "tenant queue receipt must be an object");
    await this.#validateReferenceOnly(context, tenantId, "queue-message", eventId, receipt);
    return this.#execute(context, tenantId, "queue-message", eventId, async (client) => {
      const receiptSha256 = digest(receipt);
      const result = await client.query(
        `UPDATE molit_control_store.outbox_event
         SET published_at = clock_timestamp(), publish_receipt = $5::jsonb,
             publish_receipt_sha256 = $6, claimed_by = NULL, claimed_until = NULL
         WHERE component = $1 AND tenant_id = $2 AND event_id = $3 AND claimed_by = $4
           AND published_at IS NULL AND dead_lettered_at IS NULL
         RETURNING published_at`,
        [this.component, tenantId, eventId, workerId, JSON.stringify(receipt), receiptSha256],
      );
      assertRuntime(result.rowCount === 1, "TENANT_QUEUE_CLAIM_LOST", "tenant queue claim is no longer current");
      return { eventId, publishedAt: new Date(result.rows[0].published_at).toISOString(), receiptSha256, tenantId };
    });
  }

  async registerObject(context, { mediaType, objectKey, objectSha256, tenantId = context?.tenantId }) {
    const now = this.clock();
    const normalized = normalizedContext(context, now);
    const access = authorization(normalized, tenantId, now);
    if (!access.allowed) return this.#deny(normalized, tenantId, "object", "object-reference", access.reasonCode);
    let canonical;
    try {
      const prefix = `tenants/${tenantId}/`;
      assertRuntime(typeof objectKey === "string" && objectKey.startsWith(prefix),
        "TENANT_OBJECT_KEY_INVALID", "object key is outside the tenant namespace");
      canonical = tenantObjectKey(tenantId, objectKey.slice(prefix.length));
      assertRuntime(SHA256.test(objectSha256 ?? "") && typeof mediaType === "string" && mediaType.length >= 3 && mediaType.length <= 255,
        "TENANT_OBJECT_INVALID", "object reference metadata is invalid");
    } catch (error) {
      await this.#recordDenial(normalized, tenantId, "object", "object-reference", "OBJECT_NAMESPACE_MISMATCH");
      throw error;
    }
    return this.#execute(normalized, tenantId, "object", canonical, async (client) => {
      const createdAt = this.clock().toISOString();
      await client.query(
        `INSERT INTO molit_control_store.tenant_object_reference
           (component, tenant_id, object_key, object_sha256, media_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
         ON CONFLICT (component, tenant_id, object_key) DO NOTHING`,
        [this.component, tenantId, canonical, objectSha256, mediaType, createdAt],
      );
      const stored = await client.query(
        `SELECT object_sha256, media_type, created_at FROM molit_control_store.tenant_object_reference
         WHERE component = $1 AND tenant_id = $2 AND object_key = $3`,
        [this.component, tenantId, canonical],
      );
      assertRuntime(stored.rowCount === 1 && stored.rows[0].object_sha256 === objectSha256 && stored.rows[0].media_type === mediaType,
        "TENANT_OBJECT_CONFLICT", "object key is already bound to different content");
      return { createdAt: new Date(stored.rows[0].created_at).toISOString(), mediaType, objectKey: canonical, objectSha256, tenantId };
    });
  }

  async getObject(context, { objectKey, tenantId = context?.tenantId }) {
    return this.#execute(context, tenantId, "object", objectKey, async (client) => {
      const result = await client.query(
        `SELECT object_key, object_sha256, media_type, created_at
         FROM molit_control_store.tenant_object_reference
         WHERE component = $1 AND tenant_id = $2 AND object_key = $3`,
        [this.component, tenantId, objectKey],
      );
      assertRuntime(result.rowCount === 1, "TENANT_OBJECT_NOT_FOUND", "tenant object reference does not exist");
      return {
        createdAt: new Date(result.rows[0].created_at).toISOString(),
        mediaType: result.rows[0].media_type,
        objectKey: result.rows[0].object_key,
        objectSha256: result.rows[0].object_sha256,
        tenantId,
      };
    });
  }

  async registerSecretReference(context, { purpose, reference, tenantId = context?.tenantId }) {
    const now = this.clock();
    const normalized = normalizedContext(context, now);
    const access = authorization(normalized, tenantId, now);
    if (!access.allowed) return this.#deny(normalized, tenantId, "secret-reference", purpose ?? "secret-reference", access.reasonCode);
    let canonical;
    try {
      assertRuntime(RESOURCE.test(purpose ?? ""), "TENANT_SECRET_REF_INVALID", "secret reference purpose is invalid");
      canonical = tenantSecretReference(tenantId, reference);
    } catch (error) {
      await this.#recordDenial(normalized, tenantId, "secret-reference", purpose ?? "secret-reference", "SECRET_NAMESPACE_MISMATCH");
      throw error;
    }
    return this.#execute(normalized, tenantId, "secret-reference", purpose, async (client) => {
      const createdAt = this.clock().toISOString();
      await client.query(
        `INSERT INTO molit_control_store.tenant_secret_reference
           (component, tenant_id, purpose, secret_ref, created_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)
         ON CONFLICT (component, tenant_id, purpose) DO UPDATE
         SET secret_ref = EXCLUDED.secret_ref, created_at = EXCLUDED.created_at`,
        [this.component, tenantId, purpose, canonical, createdAt],
      );
      return { createdAt, purpose, reference: canonical, tenantId };
    });
  }

  async getSecretReference(context, { purpose, tenantId = context?.tenantId }) {
    return this.#execute(context, tenantId, "secret-reference", purpose, async (client) => {
      const result = await client.query(
        `SELECT purpose, secret_ref, created_at FROM molit_control_store.tenant_secret_reference
         WHERE component = $1 AND tenant_id = $2 AND purpose = $3`,
        [this.component, tenantId, purpose],
      );
      assertRuntime(result.rowCount === 1, "TENANT_SECRET_REF_NOT_FOUND", "tenant secret reference does not exist");
      return { createdAt: new Date(result.rows[0].created_at).toISOString(), purpose, reference: result.rows[0].secret_ref, tenantId };
    });
  }

  async recordMetric(context, { labels = {}, metricName, observedAt = this.clock().toISOString(), tenantId = context?.tenantId, value }) {
    const now = this.clock();
    const normalized = normalizedContext(context, now);
    const access = authorization(normalized, tenantId, now);
    if (!access.allowed) return this.#deny(normalized, tenantId, "metric", metricName ?? "metric", access.reasonCode);
    let boundLabels;
    try {
      assertRuntime(EVENT_TYPE.test(metricName ?? "") && Number.isFinite(value) && Number.isFinite(Date.parse(observedAt)),
        "TENANT_METRIC_INVALID", "metric sample is invalid");
      boundLabels = bindTenantMetricLabels(tenantId, labels);
    } catch (error) {
      await this.#recordDenial(normalized, tenantId, "metric", metricName ?? "metric", "METRIC_TENANT_LABEL_MISMATCH");
      throw error;
    }
    return this.#execute(normalized, tenantId, "metric", metricName, async (client) => {
      await client.query(
        `INSERT INTO molit_control_store.tenant_metric_sample
           (component, tenant_id, metric_name, observed_at, value, labels)
         VALUES ($1, $2, $3, $4::timestamptz, $5, $6::jsonb)`,
        [this.component, tenantId, metricName, observedAt, value, JSON.stringify(boundLabels)],
      );
      return { labels: boundLabels, metricName, observedAt: new Date(observedAt).toISOString(), tenantId, value };
    });
  }

  async listMetrics(context, { metricName, tenantId = context?.tenantId }) {
    return this.#execute(context, tenantId, "metric", metricName, async (client) => {
      const result = await client.query(
        `SELECT metric_name, observed_at, value, labels
         FROM molit_control_store.tenant_metric_sample
         WHERE component = $1 AND tenant_id = $2 AND metric_name = $3
         ORDER BY observed_at`,
        [this.component, tenantId, metricName],
      );
      return result.rows.map((row) => ({
        labels: clone(row.labels),
        metricName: row.metric_name,
        observedAt: new Date(row.observed_at).toISOString(),
        tenantId,
        value: Number(row.value),
      }));
    });
  }

  async audit(context, { tenantId = context?.tenantId } = {}) {
    return this.#execute(context, tenantId, "security-audit", tenantId, async (client) => {
      const result = await client.query(
        `SELECT event FROM molit_control_store.tenant_security_audit
         WHERE component = $1 AND tenant_id = $2
         ORDER BY sequence`,
        [this.component, tenantId],
      );
      return result.rows.map((row) => clone(row.event));
    });
  }

  async recordDenial(contextInput, {
    reasonCode,
    requestedTenantId,
    resourceId,
    resourceKind,
    reportedAccessMode,
  }) {
    this.#assertReady();
    const context = normalizedContext(contextInput, this.clock());
    assertRuntime(TENANT_ID.test(requestedTenantId ?? "")
      && RESOURCE.test(resourceKind ?? "") && RESOURCE.test(resourceId ?? "")
      && ERROR_CODE.test(reasonCode ?? "")
      && (reportedAccessMode === undefined || ACCESS_MODES.has(reportedAccessMode)),
    "TENANT_DENIAL_INVALID", "tenant denial audit input is invalid");
    return this.#recordDenial(
      context,
      requestedTenantId,
      resourceKind,
      resourceId,
      reasonCode,
      reportedAccessMode,
    );
  }

  async readiness(context) {
    try {
      this.#assertReady();
      const now = this.clock();
      const normalized = normalizedContext(context, now);
      const client = await this.pool.connect();
      let transaction = false;
      try {
        await client.query("BEGIN READ ONLY");
        transaction = true;
        await this.#setContext(client, normalized);
        await client.query("SELECT 1 FROM molit_control_store.resource_state WHERE false");
        await client.query("COMMIT");
        transaction = false;
      } catch (error) {
        if (transaction) await rollback(client);
        throw error;
      } finally {
        client.release(transaction);
      }
      return Object.freeze({ failureCode: null, ready: true, status: "READY" });
    } catch (error) {
      return Object.freeze({ failureCode: error?.code ?? "TENANT_STORE_UNAVAILABLE", ready: false, status: "NOT_READY" });
    }
  }
}

export const POSTGRES_TENANT_STORE_MIGRATION = Object.freeze({
  component: MIGRATION_COMPONENT,
  version: MIGRATION_VERSION,
});
