import { digest } from "../discovery/stable-json.mjs";
import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { randomBytes, randomUUID } from "node:crypto";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_:-]{0,63}$/u;
const EVENT_TYPE = /^[a-z][a-z0-9._-]{2,127}$/u;
const TENANT_ID = /^[a-z][a-z0-9-]{2,62}$/u;

function validatedEventTypes(eventTypes, code = "OUTBOX_CONFIG_INVALID") {
  assertRuntime(Array.isArray(eventTypes) && eventTypes.length <= 64
    && eventTypes.every((value) => typeof value === "string" && EVENT_TYPE.test(value))
    && new Set(eventTypes).size === eventTypes.length,
  code, "outbox event type filter is invalid");
  return [...eventTypes];
}

function abortError(signal) {
  if (!signal?.aborted) return null;
  if (signal.reason instanceof Error) return signal.reason;
  return new RuntimeError("OUTBOX_ABORTED", "outbox operation was aborted");
}

function throwIfAborted(signal) {
  const error = abortError(signal);
  if (error) throw error;
}

function eventRow(row) {
  return Object.freeze({
    aggregateId: row.aggregate_id,
    aggregateKind: row.aggregate_kind,
    attempts: Number(row.attempts),
    component: row.component,
    createdAt: new Date(row.created_at).toISOString(),
    eventId: row.event_id,
    eventType: row.event_type,
    payload: structuredClone(row.payload),
    payloadSha256: row.payload_sha256,
    tenantId: row.tenant_id,
  });
}

async function rollback(client) {
  try { await client.query("ROLLBACK"); } catch { /* connection will be discarded */ }
}

export class PostgresOutbox {
  constructor({ pool, component, workerId, eventTypes = [], maxAttempts = 12, maxTenantScopes = 10_000, statementTimeoutMs = 30_000, tenantService = null }) {
    assertRuntime(pool && typeof pool.connect === "function", "OUTBOX_CONFIG_INVALID", "outbox pool is invalid");
    assertRuntime(IDENTIFIER.test(component), "OUTBOX_CONFIG_INVALID", "outbox component is invalid");
    assertRuntime(IDENTIFIER.test(workerId), "OUTBOX_CONFIG_INVALID", "outbox worker ID is invalid");
    assertRuntime(Number.isSafeInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 100,
      "OUTBOX_CONFIG_INVALID", "outbox maxAttempts is invalid");
    assertRuntime(Number.isSafeInteger(statementTimeoutMs) && statementTimeoutMs >= 100 && statementTimeoutMs <= 120_000,
      "OUTBOX_CONFIG_INVALID", "outbox statement timeout is invalid");
    assertRuntime(Number.isSafeInteger(maxTenantScopes) && maxTenantScopes >= 1 && maxTenantScopes <= 1_000_000,
      "OUTBOX_CONFIG_INVALID", "outbox tenant scope bound is invalid");
    assertRuntime(tenantService === null || (tenantService && typeof tenantService === "object"
      && tenantService.discoverFromRegistry === true && IDENTIFIER.test(tenantService.actorId ?? "")
      && [undefined, "projection", "scoped-authoritative"].includes(tenantService.registryMode)),
    "OUTBOX_CONFIG_INVALID", "outbox tenant service policy is invalid");
    Object.assign(this, {
      pool,
      component,
      workerId,
      eventTypes: validatedEventTypes(eventTypes),
      maxAttempts,
      maxTenantScopes,
      statementTimeoutMs,
      tenantService: tenantService ? Object.freeze({ registryMode: "projection", ...tenantService }) : null,
    });
    this.claimedTenants = new Map();
    this.tenantCursor = 0;
  }

  async #setTenantContext(client, tenantId) {
    if (!this.tenantService) return;
    await client.query(
      `SELECT
         set_config('molit.tenant_id', $1, true),
         set_config('molit.actor_id', $2, true),
         set_config('molit.access_mode', 'service', true),
         set_config('molit.trace_id', $3, true),
         set_config('molit.correlation_id', $4, true),
         set_config('molit.break_glass_reason', '', true),
         set_config('molit.break_glass_expires_at', '', true),
         set_config('statement_timeout', $5, true)`,
      [tenantId, this.tenantService.actorId, randomBytes(16).toString("hex"),
        `${this.component}:${this.workerId}:${randomUUID()}`, `${this.statementTimeoutMs}ms`],
    );
    const binding = await client.query(
      `SELECT molit_control_store.tenant_principal_active('service') AS tenant_active,
              CASE WHEN $1 = 'molit-platform'
                THEN molit_control_store.platform_service_active()
                ELSE true
              END AS platform_active`,
      [tenantId],
    );
    assertRuntime(binding.rows[0]?.tenant_active === true && binding.rows[0]?.platform_active === true,
      "OUTBOX_TENANT_BINDING_INACTIVE", "outbox database principal has no active service binding for the selected tenant", { tenantId });
  }

  async #tenantIds(signal, { rotate = false } = {}) {
    if (!this.tenantService) return [null];
    throwIfAborted(signal);
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN READ ONLY");
      transaction = true;
      await this.#setTenantContext(client, "molit-platform");
      let result;
      if (this.tenantService.registryMode === "scoped-authoritative") {
        const mode = await client.query(
          `SELECT mode FROM molit_control_store.control_store_mode
           WHERE component = $1`,
          [this.component],
        );
        assertRuntime(mode.rowCount === 1 && mode.rows[0].mode === "scoped-authoritative",
          "OUTBOX_SCOPED_CUTOVER_REQUIRED", "outbox registry discovery requires scoped-authoritative control-store mode");
        result = await client.query(
          `SELECT tenant_id FROM molit_control_store.control_scope_registry
           WHERE component = $1 ORDER BY tenant_id LIMIT $2`,
          [this.component, this.maxTenantScopes + 2],
        );
      } else {
        result = await client.query(
          `SELECT tenant_id FROM molit_control_store.projection_tenant_registry
           WHERE component = $1 ORDER BY tenant_id LIMIT $2`,
          [this.component, this.maxTenantScopes + 2],
        );
      }
      throwIfAborted(signal);
      await client.query("COMMIT");
      transaction = false;
      const registeredTenantIds = result.rows.map(({ tenant_id: tenantId }) => tenantId);
      assertRuntime(registeredTenantIds.length <= this.maxTenantScopes + 1,
        "OUTBOX_TENANT_REGISTRY_CAPACITY", "outbox tenant registry exceeds its configured bound");
      if (this.tenantService.registryMode === "scoped-authoritative") {
        assertRuntime(registeredTenantIds.filter((tenantId) => tenantId === "molit-platform").length === 1,
          "OUTBOX_TENANT_REGISTRY_INVALID", "outbox tenant registry has no unique platform scope");
      }
      const tenantIds = [...new Set([...registeredTenantIds.filter((tenantId) => tenantId !== "molit-platform"), "molit-platform"])];
      assertRuntime(tenantIds.every((tenantId) => TENANT_ID.test(tenantId)),
        "OUTBOX_TENANT_REGISTRY_INVALID", "outbox tenant registry contains an invalid tenant identifier");
      if (rotate && tenantIds.length > 1) {
        const offset = this.tenantCursor % tenantIds.length;
        this.tenantCursor = (offset + 1) % tenantIds.length;
        return [...tenantIds.slice(offset), ...tenantIds.slice(0, offset)];
      }
      return tenantIds;
    } catch (error) {
      if (transaction) await rollback(client);
      throw error;
    } finally {
      client.release(transaction);
    }
  }

  async claim({ limit = 50, leaseMs = 30_000, eventTypes = this.eventTypes, signal } = {}) {
    assertRuntime(Number.isSafeInteger(limit) && limit >= 1 && limit <= 500,
      "OUTBOX_CLAIM_INVALID", "outbox claim limit is invalid");
    assertRuntime(Number.isSafeInteger(leaseMs) && leaseMs >= 1_000 && leaseMs <= 900_000,
      "OUTBOX_CLAIM_INVALID", "outbox claim lease is invalid");
    const selectedEventTypes = validatedEventTypes(eventTypes, "OUTBOX_CLAIM_INVALID");
    throwIfAborted(signal);
    const claimed = [];
    for (const tenantId of await this.#tenantIds(signal, { rotate: true })) {
      if (claimed.length >= limit) break;
      const client = await this.pool.connect();
      let transaction = false;
      try {
        await client.query("BEGIN");
        transaction = true;
        if (tenantId === null) await client.query("SELECT set_config('statement_timeout', $1, true)", [`${this.statementTimeoutMs}ms`]);
        else await this.#setTenantContext(client, tenantId);
        const result = await client.query(
        `WITH ready AS (
           SELECT component, event_id
           FROM molit_control_store.outbox_event
           WHERE component = $1
              AND (cardinality($6::text[]) = 0 OR event_type = ANY($6::text[]))
              AND ($7::text IS NULL OR tenant_id = $7)
             AND published_at IS NULL
             AND dead_lettered_at IS NULL
             AND available_at <= clock_timestamp()
             AND (claimed_until IS NULL OR claimed_until <= clock_timestamp())
             AND attempts < $2
           ORDER BY created_at, event_id
           FOR UPDATE SKIP LOCKED
           LIMIT $3
         )
         UPDATE molit_control_store.outbox_event AS target
         SET claimed_by = $4,
             claimed_until = clock_timestamp() + ($5::integer * interval '1 millisecond'),
             attempts = target.attempts + 1
         FROM ready
         WHERE target.component = ready.component AND target.event_id = ready.event_id
         RETURNING target.*`,
          [this.component, this.maxAttempts, limit - claimed.length, this.workerId, leaseMs, selectedEventTypes, tenantId],
        );
        throwIfAborted(signal);
        await client.query("COMMIT");
        transaction = false;
        const events = result.rows.map(eventRow);
        for (const event of events) this.claimedTenants.set(event.eventId, event.tenantId);
        claimed.push(...events);
      } catch (error) {
        if (transaction) await rollback(client);
        throwIfAborted(signal);
        throw error;
      } finally {
        client.release(transaction);
      }
    }
    return claimed;
  }

  async acknowledge(eventId, receipt, { signal, tenantId = this.claimedTenants.get(eventId) } = {}) {
    assertRuntime(IDENTIFIER.test(eventId), "OUTBOX_ACK_INVALID", "outbox event ID is invalid");
    assertRuntime(receipt && typeof receipt === "object" && !Array.isArray(receipt),
      "OUTBOX_ACK_INVALID", "outbox publish receipt is invalid");
    throwIfAborted(signal);
    const receiptSha256 = digest(receipt);
    if (this.tenantService) assertRuntime(TENANT_ID.test(tenantId ?? ""), "OUTBOX_ACK_INVALID", "outbox acknowledgement tenant is missing");
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN");
      transaction = true;
      if (this.tenantService) await this.#setTenantContext(client, tenantId);
      const result = await client.query(
      `UPDATE molit_control_store.outbox_event
       SET published_at = clock_timestamp(),
           publish_receipt = $4::jsonb,
           publish_receipt_sha256 = $5,
           claimed_by = NULL,
           claimed_until = NULL,
           last_error_code = NULL
       WHERE component = $1 AND event_id = $2 AND claimed_by = $3
         AND ($6::text IS NULL OR tenant_id = $6)
         AND published_at IS NULL AND dead_lettered_at IS NULL
       RETURNING published_at`,
        [this.component, eventId, this.workerId, JSON.stringify(receipt), receiptSha256, tenantId ?? null],
      );
      assertRuntime(result.rowCount === 1, "OUTBOX_CLAIM_LOST", "outbox event is no longer claimed by this worker", { eventId });
      await client.query("COMMIT");
      transaction = false;
      this.claimedTenants.delete(eventId);
      return Object.freeze({ eventId, publishedAt: new Date(result.rows[0].published_at).toISOString(), receiptSha256 });
    } catch (error) {
      if (transaction) await rollback(client);
      throw error;
    } finally {
      client.release(transaction);
    }
  }

  async reject(eventId, errorCode, { delayMs = 1_000, signal, tenantId = this.claimedTenants.get(eventId) } = {}) {
    assertRuntime(IDENTIFIER.test(eventId), "OUTBOX_REJECT_INVALID", "outbox event ID is invalid");
    assertRuntime(ERROR_CODE.test(errorCode), "OUTBOX_REJECT_INVALID", "outbox error code is invalid");
    assertRuntime(Number.isSafeInteger(delayMs) && delayMs >= 0 && delayMs <= 86_400_000,
      "OUTBOX_REJECT_INVALID", "outbox retry delay is invalid");
    throwIfAborted(signal);
    if (this.tenantService) assertRuntime(TENANT_ID.test(tenantId ?? ""), "OUTBOX_REJECT_INVALID", "outbox rejection tenant is missing");
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN");
      transaction = true;
      if (this.tenantService) await this.#setTenantContext(client, tenantId);
      const result = await client.query(
      `UPDATE molit_control_store.outbox_event
       SET claimed_by = NULL,
           claimed_until = NULL,
           available_at = CASE WHEN attempts >= $4 THEN available_at
             ELSE clock_timestamp() + ($5::integer * interval '1 millisecond') END,
           dead_lettered_at = CASE WHEN attempts >= $4 THEN clock_timestamp() ELSE NULL END,
           last_error_code = $6
       WHERE component = $1 AND event_id = $2 AND claimed_by = $3
         AND ($7::text IS NULL OR tenant_id = $7)
         AND published_at IS NULL AND dead_lettered_at IS NULL
       RETURNING attempts, available_at, dead_lettered_at`,
        [this.component, eventId, this.workerId, this.maxAttempts, delayMs, errorCode, tenantId ?? null],
      );
      assertRuntime(result.rowCount === 1, "OUTBOX_CLAIM_LOST", "outbox event is no longer claimed by this worker", { eventId });
      await client.query("COMMIT");
      transaction = false;
      this.claimedTenants.delete(eventId);
      return Object.freeze({
        attempts: Number(result.rows[0].attempts),
        availableAt: new Date(result.rows[0].available_at).toISOString(),
        deadLettered: result.rows[0].dead_lettered_at !== null,
        eventId,
      });
    } catch (error) {
      if (transaction) await rollback(client);
      throw error;
    } finally {
      client.release(transaction);
    }
  }

  async readiness({ eventTypes = this.eventTypes, signal } = {}) {
    throwIfAborted(signal);
    const selectedEventTypes = validatedEventTypes(eventTypes, "OUTBOX_READINESS_INVALID");
    let pending = 0;
    let deadLettered = 0;
    let oldestPendingAt = null;
    for (const tenantId of await this.#tenantIds(signal)) {
      const client = await this.pool.connect();
      let transaction = false;
      try {
        await client.query("BEGIN READ ONLY");
        transaction = true;
        if (this.tenantService) await this.#setTenantContext(client, tenantId);
        const result = await client.query(
      `SELECT
         count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL)::integer AS pending,
         count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::integer AS dead_lettered,
         min(created_at) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL) AS oldest_pending
       FROM molit_control_store.outbox_event
       WHERE component = $1
          AND (cardinality($2::text[]) = 0 OR event_type = ANY($2::text[]))
          AND ($3::text IS NULL OR tenant_id = $3)`,
          [this.component, selectedEventTypes, tenantId],
        );
        await client.query("COMMIT");
        transaction = false;
        const row = result.rows[0];
        pending += Number(row.pending);
        deadLettered += Number(row.dead_lettered);
        const candidate = row.oldest_pending ? new Date(row.oldest_pending).toISOString() : null;
        if (candidate && (!oldestPendingAt || candidate < oldestPendingAt)) oldestPendingAt = candidate;
      } catch (error) {
        if (transaction) await rollback(client);
        throw error;
      } finally {
        client.release(transaction);
      }
    }
    return Object.freeze({
      deadLettered,
      oldestPendingAt,
      pending,
      ready: deadLettered === 0,
    });
  }
}
