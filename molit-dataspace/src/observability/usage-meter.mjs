import { assertObservability, ObservabilityError } from "./errors.mjs";
import { sha256 } from "./stable-json.mjs";

const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const METER_NAME = /^[a-z][a-z0-9._-]{1,95}$/u;
const UNIT = /^(?:[A-Za-z][A-Za-z0-9./{}_-]{0,31}|\{[A-Za-z][A-Za-z0-9_-]{0,29}\})$/u;
const DIMENSION_KEY = /^[a-z][a-z0-9._-]{0,63}$/u;
const DIMENSION_VALUE = /^[\x20-\x7e]{1,128}$/u;
const QUANTITY = /^(?:0|[1-9][0-9]{0,20})(?:\.[0-9]{1,9})?$/u;
const TRACE_ID = /^[a-f0-9]{32}$/u;
const ACCESS_MODES = new Set(["tenant", "service"]);
const PURPOSES = new Set(["operational-non-billable", "billing-candidate"]);
const MIGRATION_COMPONENT = "usage-metering";
const MIGRATION_VERSION = 3;

function normalizeQuantity(value) {
  assertObservability(typeof value === "string" && QUANTITY.test(value), "OBS_USAGE_QUANTITY_INVALID", "usage quantity must be a fixed-point decimal string with at most nine fractional digits");
  const [integer, fraction = ""] = value.split(".");
  const normalizedFraction = fraction.replace(/0+$/u, "");
  const normalized = normalizedFraction ? `${integer}.${normalizedFraction}` : integer;
  assertObservability(!/^0(?:\.0*)?$/u.test(normalized), "OBS_USAGE_QUANTITY_INVALID", "usage quantity must be greater than zero");
  return normalized;
}

function normalizedDefinitions(definitions) {
  assertObservability(definitions && typeof definitions === "object" && !Array.isArray(definitions), "OBS_USAGE_CONFIG_INVALID", "meter definitions are required");
  const result = new Map();
  for (const [name, definition] of Object.entries(definitions)) {
    assertObservability(METER_NAME.test(name) && definition && typeof definition === "object" && !Array.isArray(definition), "OBS_USAGE_CONFIG_INVALID", "meter definition is invalid");
    assertObservability(PURPOSES.has(definition.purpose) && UNIT.test(definition.unit ?? "") && Array.isArray(definition.dimensionKeys) && definition.dimensionKeys.length <= 16, "OBS_USAGE_CONFIG_INVALID", "meter purpose, unit, or dimensions are invalid");
    assertObservability(definition.dimensionKeys.every((key) => DIMENSION_KEY.test(key) && !/(?:tenant|secret|token|credential)/iu.test(key)) && new Set(definition.dimensionKeys).size === definition.dimensionKeys.length, "OBS_USAGE_CONFIG_INVALID", "meter dimension allowlist is invalid");
    result.set(name, Object.freeze({ purpose: definition.purpose, unit: definition.unit, dimensionKeys: new Set(definition.dimensionKeys) }));
  }
  assertObservability(result.size > 0, "OBS_USAGE_CONFIG_INVALID", "at least one meter definition is required");
  return result;
}

function validateContext(context) {
  assertObservability(context && typeof context === "object", "OBS_USAGE_CONTEXT_INVALID", "usage meter access context is required");
  assertObservability(typeof context.tenantId === "string" && context.tenantId.length >= 3 && context.tenantId.length <= 128, "OBS_USAGE_CONTEXT_INVALID", "usage meter tenant is invalid");
  assertObservability(typeof context.actorId === "string" && context.actorId.length >= 3 && context.actorId.length <= 256, "OBS_USAGE_CONTEXT_INVALID", "usage meter actor is invalid");
  assertObservability(ACCESS_MODES.has(context.accessMode), "OBS_USAGE_CONTEXT_INVALID", "usage meter access mode is invalid");
  assertObservability(TRACE_ID.test(context.traceId ?? "") && IDENTIFIER.test(context.correlationId ?? ""), "OBS_USAGE_CONTEXT_INVALID", "usage meter correlation fields are invalid");
  return Object.freeze({
    accessMode: context.accessMode,
    actorId: context.actorId,
    correlationId: context.correlationId,
    tenantId: context.tenantId,
    traceId: context.traceId,
  });
}

function normalizeDimensions(values, definition) {
  assertObservability(values && typeof values === "object" && !Array.isArray(values), "OBS_USAGE_DIMENSIONS_INVALID", "usage dimensions must be an object");
  const keys = Object.keys(values).sort();
  assertObservability(keys.length <= 16 && keys.every((key) => definition.dimensionKeys.has(key)), "OBS_USAGE_DIMENSIONS_INVALID", "usage dimensions contain a key outside the meter allowlist");
  const result = {};
  for (const key of keys) {
    assertObservability(typeof values[key] === "string" && DIMENSION_VALUE.test(values[key]) && !/[\r\n]/u.test(values[key]), "OBS_USAGE_DIMENSIONS_INVALID", "usage dimension value is invalid");
    result[key] = values[key];
  }
  return result;
}

function occurredAt(value) {
  const time = new Date(value);
  assertObservability(typeof value === "string" && Number.isFinite(time.valueOf()) && time.toISOString() === value, "OBS_USAGE_TIME_INVALID", "usage occurrence time must be a canonical UTC timestamp");
  return time.toISOString();
}

function hourBoundary(value, code = "OBS_USAGE_REPROCESS_INVALID") {
  const time = new Date(value);
  assertObservability(typeof value === "string" && Number.isFinite(time.valueOf()) && time.toISOString() === value && time.getUTCMinutes() === 0 && time.getUTCSeconds() === 0 && time.getUTCMilliseconds() === 0, code, "usage reprocessing boundaries must be whole UTC hours");
  return time;
}

function postgresError(error, fallbackCode) {
  if (error instanceof ObservabilityError) return error;
  return new ObservabilityError(fallbackCode, "usage meter PostgreSQL operation failed", { cause: error });
}

async function rollback(client) {
  try { await client.query("ROLLBACK"); } catch { /* the pool will discard an unusable connection */ }
}

export function buildUsageMeterEvent({ component, context, input, meterDefinitions }) {
  assertObservability(COMPONENT.test(component ?? ""), "OBS_USAGE_CONFIG_INVALID", "usage meter component is invalid");
  const normalizedContext = validateContext(context);
  const definitions = meterDefinitions instanceof Map ? meterDefinitions : normalizedDefinitions(meterDefinitions);
  const definition = definitions.get(input?.meterName);
  assertObservability(definition, "OBS_USAGE_METER_UNKNOWN", "usage meter is not registered");
  assertObservability(input.tenantId === undefined || input.tenantId === normalizedContext.tenantId, "OBS_USAGE_TENANT_MISMATCH", "usage event tenant does not match the access context");
  assertObservability(IDENTIFIER.test(input.sourceEventId ?? "") && /^[a-f0-9]{64}$/u.test(input.sourceEventDigest ?? ""), "OBS_USAGE_SOURCE_INVALID", "usage source event identity is invalid");
  assertObservability(input.traceId === undefined || input.traceId === normalizedContext.traceId, "OBS_USAGE_CORRELATION_MISMATCH", "usage trace does not match the access context");
  assertObservability(input.correlationId === undefined || input.correlationId === normalizedContext.correlationId, "OBS_USAGE_CORRELATION_MISMATCH", "usage correlation identifier does not match the access context");
  const dimensions = normalizeDimensions(input.dimensions ?? {}, definition);
  const quantity = normalizeQuantity(input.quantity);
  const eventId = input.eventId ?? sha256({ component, tenantId: normalizedContext.tenantId, meterName: input.meterName, sourceEventId: input.sourceEventId });
  assertObservability(IDENTIFIER.test(eventId), "OBS_USAGE_EVENT_ID_INVALID", "usage event identifier is invalid");
  return Object.freeze({
    schemaVersion: "molit.usage-meter-event/1",
    component,
    tenantId: normalizedContext.tenantId,
    eventId,
    meterName: input.meterName,
    purpose: definition.purpose,
    quantity,
    unit: definition.unit,
    occurredAt: occurredAt(input.occurredAt),
    traceId: normalizedContext.traceId,
    correlationId: normalizedContext.correlationId,
    sourceEventId: input.sourceEventId,
    sourceEventDigest: input.sourceEventDigest,
    dimensions,
  });
}

export class UsageMeter {
  constructor({ pool, component, meterDefinitions, clock = () => new Date(), statementTimeoutMs = 30_000, maximumEventAgeDays = 400, maximumFutureSkewMs = 300_000 }) {
    assertObservability(pool && typeof pool.connect === "function", "OBS_USAGE_CONFIG_INVALID", "usage meter PostgreSQL pool is invalid");
    assertObservability(COMPONENT.test(component ?? ""), "OBS_USAGE_CONFIG_INVALID", "usage meter component is invalid");
    assertObservability(typeof clock === "function" && Number.isSafeInteger(statementTimeoutMs) && statementTimeoutMs >= 100 && statementTimeoutMs <= 120_000, "OBS_USAGE_CONFIG_INVALID", "usage meter runtime configuration is invalid");
    assertObservability(Number.isSafeInteger(maximumEventAgeDays) && maximumEventAgeDays >= 1 && maximumEventAgeDays <= 3_650 && Number.isSafeInteger(maximumFutureSkewMs) && maximumFutureSkewMs >= 0 && maximumFutureSkewMs <= 3_600_000, "OBS_USAGE_CONFIG_INVALID", "usage meter event time bounds are invalid");
    Object.assign(this, { pool, component, definitions: normalizedDefinitions(meterDefinitions), clock, statementTimeoutMs, maximumEventAgeDays, maximumFutureSkewMs });
    this.initialized = false;
  }

  async initialize() {
    const client = await this.pool.connect();
    try {
      const migration = await client.query("SELECT version FROM molit_control_store.schema_migration WHERE component = $1", [MIGRATION_COMPONENT]);
      assertObservability(migration.rowCount === 1 && Number(migration.rows[0].version) === MIGRATION_VERSION, "OBS_USAGE_MIGRATION_REQUIRED", "usage meter migration is missing or incompatible");
      for (const table of ["usage_meter_event", "usage_meter_rollup", "usage_meter_reprocess", "outbox_event"]) await client.query(`SELECT tenant_id FROM molit_control_store.${table} WHERE false`);
      this.initialized = true;
    } catch (error) {
      throw postgresError(error, "OBS_USAGE_MIGRATION_REQUIRED");
    } finally {
      client.release();
    }
  }

  #assertReady() {
    assertObservability(this.initialized, "OBS_USAGE_MIGRATION_REQUIRED", "usage meter has not verified its migration");
  }

  async #setContext(client, context) {
    await client.query(
      `SELECT set_config('molit.tenant_id', $1, true),
              set_config('molit.actor_id', $2, true),
              set_config('molit.access_mode', $3, true),
              set_config('molit.trace_id', $4, true),
              set_config('molit.correlation_id', $5, true),
              set_config('statement_timeout', $6, true)`,
      [context.tenantId, context.actorId, context.accessMode, context.traceId, context.correlationId, `${this.statementTimeoutMs}ms`],
    );
  }

  async record(contextInput, input) {
    this.#assertReady();
    const context = validateContext(contextInput);
    const event = buildUsageMeterEvent({ component: this.component, context, input, meterDefinitions: this.definitions });
    const now = this.clock();
    assertObservability(now instanceof Date && Number.isFinite(now.valueOf()), "OBS_CLOCK_INVALID", "usage meter clock is invalid");
    const eventTime = Date.parse(event.occurredAt);
    assertObservability(eventTime <= now.valueOf() + this.maximumFutureSkewMs && eventTime >= now.valueOf() - this.maximumEventAgeDays * 86_400_000, "OBS_USAGE_TIME_OUT_OF_RANGE", "usage event falls outside the accepted ingestion window");
    const eventSha256 = sha256(event);
    const dimensionsSha256 = sha256(event.dimensions);
    const outboxPayload = { schemaVersion: "molit.usage-meter-outbox/1", usageEvent: event, usageEventSha256: eventSha256 };
    const outboxEventId = sha256({ component: this.component, tenantId: event.tenantId, eventId: event.eventId, type: "usage.meter.recorded" });
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN");
      transaction = true;
      await this.#setContext(client, context);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify([this.component, event.tenantId, event.meterName])]);
      const inserted = await client.query(
        `INSERT INTO molit_control_store.usage_meter_event
           (component, tenant_id, event_id, meter_name, purpose, quantity, unit, occurred_at,
            trace_id, correlation_id, source_event_id, source_event_digest, dimensions,
            dimensions_sha256, event, event_sha256)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8::timestamptz, $9, $10, $11, $12,
           $13::jsonb, $14, $15::jsonb, $16)
         ON CONFLICT DO NOTHING
         RETURNING event_id`,
        [this.component, event.tenantId, event.eventId, event.meterName, event.purpose, event.quantity, event.unit,
          event.occurredAt, event.traceId, event.correlationId, event.sourceEventId, event.sourceEventDigest,
          JSON.stringify(event.dimensions), dimensionsSha256,
          JSON.stringify(event), eventSha256],
      );
      let replayed = inserted.rowCount === 0;
      if (replayed) {
        const existing = await client.query(
          `SELECT event_id, source_event_id, event_sha256
           FROM molit_control_store.usage_meter_event
           WHERE component = $1 AND tenant_id = $2
             AND (event_id = $3 OR source_event_id = $4)`,
          [this.component, event.tenantId, event.eventId, event.sourceEventId],
        );
        assertObservability(existing.rowCount === 1 && existing.rows[0].event_id === event.eventId && existing.rows[0].source_event_id === event.sourceEventId && existing.rows[0].event_sha256 === eventSha256, "OBS_USAGE_IDEMPOTENCY_CONFLICT", "usage idempotency key is already bound to different content", { status: 409 });
      } else {
        await client.query(
          `INSERT INTO molit_control_store.usage_meter_rollup
             (component, tenant_id, meter_name, purpose, unit, period_start, period_seconds,
              dimensions, dimensions_sha256, quantity, event_count, rebuilt_at)
           VALUES ($1, $2, $3, $4, $5, date_trunc('hour', $6::timestamptz), 3600,
             $7::jsonb, $8, $9::numeric, 1, clock_timestamp())
           ON CONFLICT (component, tenant_id, meter_name, unit, period_start, dimensions_sha256)
           DO UPDATE SET quantity = molit_control_store.usage_meter_rollup.quantity + EXCLUDED.quantity,
                         event_count = molit_control_store.usage_meter_rollup.event_count + 1,
                         rebuilt_at = clock_timestamp()`,
          [this.component, event.tenantId, event.meterName, event.purpose, event.unit, event.occurredAt,
            JSON.stringify(event.dimensions), dimensionsSha256, event.quantity],
        );
        await client.query(
          `INSERT INTO molit_control_store.outbox_event
             (component, event_id, aggregate_kind, aggregate_id, tenant_id, event_type,
              payload, payload_sha256, created_at, available_at)
           VALUES ($1, $2, 'usage-meter-event', $3, $4, 'usage.meter.recorded',
             $5::jsonb, $6, clock_timestamp(), clock_timestamp())`,
          [this.component, outboxEventId, event.eventId, event.tenantId,
            JSON.stringify(outboxPayload), sha256(outboxPayload)],
        );
      }
      await client.query("COMMIT");
      transaction = false;
      return Object.freeze({ correlationId: event.correlationId, eventId: event.eventId, eventSha256, meterName: event.meterName, purpose: event.purpose, quantity: event.quantity, replayed, tenantId: event.tenantId, traceId: event.traceId, unit: event.unit });
    } catch (error) {
      if (transaction) await rollback(client);
      throw postgresError(error, "OBS_USAGE_RECORD_FAILED");
    } finally {
      client.release(transaction);
    }
  }

  async reprocess(contextInput, { operationId, meterName, periodFrom, periodTo }) {
    this.#assertReady();
    const context = validateContext(contextInput);
    assertObservability(IDENTIFIER.test(operationId ?? "") && this.definitions.has(meterName), "OBS_USAGE_REPROCESS_INVALID", "usage reprocessing identity is invalid");
    const from = hourBoundary(periodFrom);
    const to = hourBoundary(periodTo);
    assertObservability(to > from && to.valueOf() - from.valueOf() <= 366 * 86_400_000, "OBS_USAGE_REPROCESS_INVALID", "usage reprocessing range is invalid");
    const definition = this.definitions.get(meterName);
    const request = {
      meterName,
      operationId,
      periodFrom: from.toISOString(),
      periodTo: to.toISOString(),
      tenantId: context.tenantId,
      purpose: definition.purpose,
      unit: definition.unit,
      traceId: context.traceId,
      correlationId: context.correlationId,
    };
    const requestSha256 = sha256(request);
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN");
      transaction = true;
      await this.#setContext(client, context);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify([this.component, context.tenantId, meterName])]);
      const prior = await client.query(
        `SELECT request_sha256, result FROM molit_control_store.usage_meter_reprocess
         WHERE component = $1 AND tenant_id = $2 AND operation_id = $3`,
        [this.component, context.tenantId, operationId],
      );
      if (prior.rowCount === 1) {
        assertObservability(prior.rows[0].request_sha256 === requestSha256, "OBS_USAGE_REPROCESS_CONFLICT", "usage reprocessing operation ID is bound to a different range", { status: 409 });
        await client.query("COMMIT");
        transaction = false;
        return Object.freeze({ ...prior.rows[0].result, replayed: true });
      }
      await client.query(
        `DELETE FROM molit_control_store.usage_meter_rollup
         WHERE component = $1 AND tenant_id = $2 AND meter_name = $3
           AND period_start >= $4::timestamptz AND period_start < $5::timestamptz`,
        [this.component, context.tenantId, meterName, periodFrom, periodTo],
      );
      const rebuilt = await client.query(
        `INSERT INTO molit_control_store.usage_meter_rollup
           (component, tenant_id, meter_name, purpose, unit, period_start, period_seconds,
            dimensions, dimensions_sha256, quantity, event_count, rebuilt_at)
         SELECT component, tenant_id, meter_name, purpose, unit, date_trunc('hour', occurred_at), 3600,
                dimensions, dimensions_sha256, sum(quantity), count(*), clock_timestamp()
         FROM molit_control_store.usage_meter_event
         WHERE component = $1 AND tenant_id = $2 AND meter_name = $3
           AND occurred_at >= $4::timestamptz AND occurred_at < $5::timestamptz
         GROUP BY component, tenant_id, meter_name, purpose, unit, date_trunc('hour', occurred_at),
                  dimensions, dimensions_sha256
         RETURNING quantity, event_count`,
        [this.component, context.tenantId, meterName, periodFrom, periodTo],
      );
      const result = {
        completedAt: this.clock().toISOString(),
        meterName,
        operationId,
        periodFrom,
        periodTo,
        rollupCount: rebuilt.rowCount,
        sourceEventCount: rebuilt.rows.reduce((total, row) => total + Number(row.event_count), 0),
        tenantId: context.tenantId,
      };
      await client.query(
        `INSERT INTO molit_control_store.usage_meter_reprocess
           (component, tenant_id, operation_id, meter_name, period_from, period_to,
            request_sha256, result, completed_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8::jsonb, $9::timestamptz)`,
        [this.component, context.tenantId, operationId, meterName, periodFrom, periodTo,
          requestSha256, JSON.stringify(result), result.completedAt],
      );
      const outboxPayload = { schemaVersion: "molit.usage-meter-reprocess-outbox/1", request, requestSha256, result };
      const outboxEventId = sha256({ component: this.component, tenantId: context.tenantId, operationId, type: "usage.meter.reprocessed" });
      await client.query(
        `INSERT INTO molit_control_store.outbox_event
           (component, event_id, aggregate_kind, aggregate_id, tenant_id, event_type,
            payload, payload_sha256, created_at, available_at)
         VALUES ($1, $2, 'usage-meter-reprocess', $3, $4, 'usage.meter.reprocessed',
           $5::jsonb, $6, clock_timestamp(), clock_timestamp())`,
        [this.component, outboxEventId, operationId, context.tenantId,
          JSON.stringify(outboxPayload), sha256(outboxPayload)],
      );
      await client.query("COMMIT");
      transaction = false;
      return Object.freeze({ ...result, replayed: false });
    } catch (error) {
      if (transaction) await rollback(client);
      throw postgresError(error, "OBS_USAGE_REPROCESS_FAILED");
    } finally {
      client.release(transaction);
    }
  }

  async listRollups(contextInput, { meterName, periodFrom, periodTo }) {
    this.#assertReady();
    const context = validateContext(contextInput);
    assertObservability(this.definitions.has(meterName), "OBS_USAGE_METER_UNKNOWN", "usage meter is not registered");
    const from = hourBoundary(periodFrom, "OBS_USAGE_QUERY_INVALID");
    const to = hourBoundary(periodTo, "OBS_USAGE_QUERY_INVALID");
    assertObservability(to > from, "OBS_USAGE_QUERY_INVALID", "usage rollup query range is invalid");
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN READ ONLY");
      transaction = true;
      await this.#setContext(client, context);
      const rows = await client.query(
        `SELECT meter_name, purpose, unit, period_start, period_seconds, dimensions, quantity::text, event_count::text, rebuilt_at
         FROM molit_control_store.usage_meter_rollup
         WHERE component = $1 AND tenant_id = $2 AND meter_name = $3
           AND period_start >= $4::timestamptz AND period_start < $5::timestamptz
         ORDER BY period_start, dimensions_sha256`,
        [this.component, context.tenantId, meterName, from.toISOString(), to.toISOString()],
      );
      await client.query("COMMIT");
      transaction = false;
      return rows.rows.map((row) => Object.freeze({ dimensions: structuredClone(row.dimensions), eventCount: row.event_count, meterName: row.meter_name, purpose: row.purpose, periodSeconds: Number(row.period_seconds), periodStart: new Date(row.period_start).toISOString(), quantity: normalizeQuantity(row.quantity), rebuiltAt: new Date(row.rebuilt_at).toISOString(), tenantId: context.tenantId, unit: row.unit }));
    } catch (error) {
      if (transaction) await rollback(client);
      throw postgresError(error, "OBS_USAGE_QUERY_FAILED");
    } finally {
      client.release(transaction);
    }
  }

  async readiness(contextInput) {
    let client;
    let transaction = false;
    try {
      this.#assertReady();
      const context = validateContext(contextInput);
      client = await this.pool.connect();
      await client.query("BEGIN READ ONLY");
      transaction = true;
      await this.#setContext(client, context);
      await client.query("SELECT 1 FROM molit_control_store.usage_meter_event WHERE false");
      await client.query("COMMIT");
      transaction = false;
      return Object.freeze({ failureCode: null, ready: true, status: "READY" });
    } catch (error) {
      if (transaction) await rollback(client);
      return Object.freeze({ failureCode: error?.code ?? "OBS_USAGE_UNAVAILABLE", ready: false, status: "NOT_READY" });
    } finally {
      client?.release(transaction);
    }
  }
}
