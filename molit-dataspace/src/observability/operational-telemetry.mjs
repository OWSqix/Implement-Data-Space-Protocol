import { assertObservability, ObservabilityError } from "./errors.mjs";
import { redact, tenantBucket } from "./redaction.mjs";

const OPERATION = /^[a-z][a-z0-9._-]{1,95}$/u;
const TRACE_ID = /^[0-9a-f]{32}$/u;
const SPAN_ID = /^[0-9a-f]{16}$/u;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const DURATION_BOUNDS_MS = Object.freeze([5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000]);

function unixNanos(clock) {
  const now = clock();
  assertObservability(now instanceof Date && Number.isFinite(now.valueOf()), "OBS_CLOCK_INVALID", "telemetry clock is invalid");
  return { now, nanos: (BigInt(now.valueOf()) * 1_000_000n).toString() };
}

function requestMetricPoints({ durationMs, operation, outcome, statusCode, tenant, nanos }) {
  const attributes = {
    "http.response.status_code": statusCode,
    "molit.operation": operation,
    "molit.outcome": outcome,
    "molit.tenant_bucket": tenant,
  };
  const bucketCounts = Array.from({ length: DURATION_BOUNDS_MS.length + 1 }, () => 0);
  const bucket = DURATION_BOUNDS_MS.findIndex((bound) => durationMs <= bound);
  bucketCounts[bucket === -1 ? DURATION_BOUNDS_MS.length : bucket] = 1;
  return [
    {
      name: "molit.request.count",
      type: "sum",
      unit: "{request}",
      monotonic: true,
      points: [{ attributes, timeUnixNano: nanos, value: 1 }],
    },
    {
      name: "molit.request.duration",
      type: "histogram",
      unit: "ms",
      points: [{ attributes, timeUnixNano: nanos, count: 1, sum: durationMs, explicitBounds: DURATION_BOUNDS_MS, bucketCounts }],
    },
  ];
}

function validatedCorrelation({ correlationId, traceId, spanId }) {
  assertObservability(CORRELATION_ID.test(correlationId ?? ""), "OBS_CORRELATION_INVALID", "correlation identifier is invalid");
  assertObservability(TRACE_ID.test(traceId ?? ""), "OBS_CORRELATION_INVALID", "trace identifier is invalid");
  assertObservability(spanId === undefined || SPAN_ID.test(spanId), "OBS_CORRELATION_INVALID", "span identifier is invalid");
  return { correlationId, traceId, ...(spanId ? { spanId } : {}) };
}

function sanitizedLogAttributes(values) {
  const safe = {};
  for (const [key, value] of Object.entries(redact(values))) {
    if (!/^(?:http\.response\.status_code|molit\.(?:operation|outcome|tenant_bucket|correlation_id|meter_name|meter_unit|event_id|event_type|payload_sha256|purpose|result|delivery_stage|sink))$/u.test(key)) continue;
    if (["string", "boolean", "number"].includes(typeof value)) safe[key] = value;
  }
  return safe;
}

export class OperationalTelemetry {
  constructor({ metricExporter, logExporter, tenantSalt, tenantBucketCount = 64, component, environment = "production", readinessMaxAgeMs = 60_000, clock = () => new Date() }) {
    assertObservability(metricExporter?.export && ["operational", "local-test"].includes(metricExporter.mode), "OBS_METRIC_EXPORTER_INVALID", "classified metric exporter is required");
    assertObservability(logExporter?.export && ["operational", "local-test"].includes(logExporter.mode), "OBS_LOG_EXPORTER_INVALID", "classified log exporter is required");
    assertObservability(environment === "test" || (metricExporter.mode === "operational" && logExporter.mode === "operational"), "OBS_OPERATIONAL_EXPORTER_REQUIRED", "production telemetry requires operational exporters");
    assertObservability(typeof component === "string" && component.length > 0, "OBS_COMPONENT_REQUIRED", "telemetry component is required");
    assertObservability(Number.isSafeInteger(readinessMaxAgeMs) && readinessMaxAgeMs >= 1_000 && readinessMaxAgeMs <= 300_000, "OBS_TELEMETRY_CONFIG_INVALID", "telemetry readiness age is invalid");
    tenantBucket("configuration-check", { bucketCount: tenantBucketCount, salt: tenantSalt });
    Object.assign(this, { metricExporter, logExporter, tenantSalt, tenantBucketCount, component, clock, readinessMaxAgeMs });
    this.closed = false;
    this.lastExportAt = null;
    this.lastFailure = null;
    this.probePromise = null;
    this.signalState = {
      metrics: { lastExportAt: null, lastFailure: null },
      logs: { lastExportAt: null, lastFailure: null },
    };
  }

  #assertOpen() {
    assertObservability(!this.closed, "OBS_TELEMETRY_CLOSED", "operational telemetry is closed");
  }

  async #export(metrics, logs, signal) {
    const attempts = [];
    if (metrics.length > 0) attempts.push({ name: "metrics", promise: this.metricExporter.export(metrics, { signal }) });
    if (logs.length > 0) attempts.push({ name: "logs", promise: this.logExporter.export(logs, { signal }) });
    const results = await Promise.allSettled(attempts.map(({ promise }) => promise));
    const completedAt = this.clock().toISOString();
    results.forEach((result, index) => {
      const state = this.signalState[attempts[index].name];
      if (result.status === "rejected") state.lastFailure = { at: completedAt, code: result.reason?.code ?? "OBS_EXPORT_FAILED" };
      else {
        state.lastFailure = null;
        state.lastExportAt = completedAt;
      }
    });
    const failure = results.find((result) => result.status === "rejected");
    this.lastFailure = this.signalState.metrics.lastFailure ?? this.signalState.logs.lastFailure;
    const successfulAt = [this.signalState.metrics.lastExportAt, this.signalState.logs.lastExportAt].filter(Boolean).sort();
    this.lastExportAt = successfulAt.length === 2 ? successfulAt[0] : null;
    if (failure) {
      throw failure.reason;
    }
  }

  async recordRequest({ tenantId, operation, statusCode, durationMs, correlationId, traceId, spanId, signal }) {
    this.#assertOpen();
    assertObservability(typeof tenantId === "string" && tenantId.length >= 3 && tenantId.length <= 128, "OBS_TENANT_ID_REQUIRED", "tenant identifier is required");
    assertObservability(OPERATION.test(operation ?? ""), "OBS_OPERATION_INVALID", "request operation is invalid");
    assertObservability(Number.isSafeInteger(statusCode) && statusCode >= 100 && statusCode <= 599, "OBS_REQUEST_INVALID", "HTTP status code is invalid");
    assertObservability(Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= 86_400_000, "OBS_REQUEST_INVALID", "request duration is invalid");
    const correlation = validatedCorrelation({ correlationId, traceId, spanId });
    const { now, nanos } = unixNanos(this.clock);
    const bucket = tenantBucket(tenantId, { bucketCount: this.tenantBucketCount, salt: this.tenantSalt });
    const outcome = statusCode >= 500 ? "error" : "success";
    const metrics = requestMetricPoints({ durationMs, operation, outcome, statusCode, tenant: bucket, nanos });
    const logs = [{
      eventName: "molit.request.completed",
      severity: outcome === "error" ? "ERROR" : "INFO",
      timeUnixNano: nanos,
      traceId,
      ...(spanId ? { spanId } : {}),
      attributes: sanitizedLogAttributes({
        "http.response.status_code": statusCode,
        "molit.operation": operation,
        "molit.outcome": outcome,
        "molit.tenant_bucket": bucket,
        "molit.correlation_id": correlationId,
      }),
    }];
    await this.#export(metrics, logs, signal);
    return Object.freeze({ ...correlation, completedAt: now.toISOString(), outcome, tenantBucket: bucket });
  }

  async recordMeterCommit({ tenantId, meterName, unit, eventId, purpose = "operational-non-billable", result = "committed", correlationId, traceId, spanId, signal }) {
    this.#assertOpen();
    assertObservability(typeof tenantId === "string" && tenantId.length >= 3, "OBS_TENANT_ID_REQUIRED", "tenant identifier is required");
    assertObservability(OPERATION.test(meterName ?? "") && /^(?:[A-Za-z][A-Za-z0-9./{}_-]{0,31}|\{[A-Za-z][A-Za-z0-9_-]{0,29}\})$/u.test(unit ?? ""), "OBS_METER_LOG_INVALID", "meter log identity is invalid");
    assertObservability(["operational-non-billable", "billing-candidate"].includes(purpose), "OBS_METER_LOG_INVALID", "meter purpose is invalid");
    assertObservability(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(eventId ?? ""), "OBS_METER_LOG_INVALID", "meter event identifier is invalid");
    const correlation = validatedCorrelation({ correlationId, traceId, spanId });
    const { now, nanos } = unixNanos(this.clock);
    const bucket = tenantBucket(tenantId, { bucketCount: this.tenantBucketCount, salt: this.tenantSalt });
    await this.#export([], [{
      eventName: "molit.usage.meter.committed",
      severity: "INFO",
      timeUnixNano: nanos,
      traceId,
      ...(spanId ? { spanId } : {}),
      attributes: sanitizedLogAttributes({
        "molit.tenant_bucket": bucket,
        "molit.correlation_id": correlationId,
        "molit.meter_name": meterName,
        "molit.meter_unit": unit,
        "molit.event_id": eventId,
        "molit.purpose": purpose,
        "molit.result": result,
        "molit.delivery_stage": "ledger_commit",
      }),
    }], signal);
    return Object.freeze({ ...correlation, eventId, loggedAt: now.toISOString(), tenantBucket: bucket });
  }

  async recordUsageOutboxDelivery({ tenantId, eventType, eventId, payloadSha256, purpose, meterName, unit, correlationId, traceId, signal }) {
    this.#assertOpen();
    assertObservability(typeof tenantId === "string" && tenantId.length >= 3, "OBS_TENANT_ID_REQUIRED", "tenant identifier is required");
    assertObservability(["usage.meter.recorded", "usage.meter.reprocessed"].includes(eventType), "OBS_USAGE_DELIVERY_INVALID", "usage delivery event type is invalid");
    assertObservability(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(eventId ?? "") && /^[a-f0-9]{64}$/u.test(payloadSha256 ?? ""), "OBS_USAGE_DELIVERY_INVALID", "usage delivery identity is invalid");
    assertObservability(["operational-non-billable", "billing-candidate"].includes(purpose) && OPERATION.test(meterName ?? "")
      && /^(?:[A-Za-z][A-Za-z0-9./{}_-]{0,31}|\{[A-Za-z][A-Za-z0-9_-]{0,29}\})$/u.test(unit ?? ""),
    "OBS_USAGE_DELIVERY_INVALID", "usage delivery meter classification is invalid");
    const correlation = validatedCorrelation({ correlationId, traceId });
    const { now, nanos } = unixNanos(this.clock);
    const bucket = tenantBucket(tenantId, { bucketCount: this.tenantBucketCount, salt: this.tenantSalt });
    await this.#export([], [{
      eventName: "molit.usage.meter.exported",
      severity: "INFO",
      timeUnixNano: nanos,
      traceId,
      attributes: sanitizedLogAttributes({
        "molit.tenant_bucket": bucket,
        "molit.correlation_id": correlationId,
        "molit.event_type": eventType,
        "molit.event_id": eventId,
        "molit.payload_sha256": payloadSha256,
        "molit.purpose": purpose,
        "molit.meter_name": meterName,
        "molit.meter_unit": unit,
        "molit.delivery_stage": "sink_delivery",
        "molit.sink": "otlp-log",
      }),
    }], signal);
    return Object.freeze({ ...correlation, deliveredAt: now.toISOString(), eventId, idempotencyKey: eventId, sink: "otlp-log", tenantBucket: bucket });
  }

  async recordOutboxHealth({ tenantId, eventType, pending, deadLettered, oldestPendingAgeSeconds = 0, signal }) {
    this.#assertOpen();
    assertObservability(typeof tenantId === "string" && tenantId.length >= 3, "OBS_TENANT_ID_REQUIRED", "tenant identifier is required");
    assertObservability(/^[a-z][a-z0-9._-]{2,127}$/u.test(eventType ?? ""), "OBS_OUTBOX_METRIC_INVALID", "outbox event type is invalid");
    assertObservability(Number.isSafeInteger(pending) && pending >= 0 && Number.isSafeInteger(deadLettered) && deadLettered >= 0 && Number.isFinite(oldestPendingAgeSeconds) && oldestPendingAgeSeconds >= 0, "OBS_OUTBOX_METRIC_INVALID", "outbox health values are invalid");
    const { now, nanos } = unixNanos(this.clock);
    const bucket = tenantBucket(tenantId, { bucketCount: this.tenantBucketCount, salt: this.tenantSalt });
    const attributes = { "molit.event_type": eventType, "molit.tenant_bucket": bucket };
    const metrics = [
      { name: "molit.outbox.pending", type: "gauge", unit: "{event}", points: [{ attributes, timeUnixNano: nanos, value: pending }] },
      { name: "molit.outbox.dead_lettered", type: "gauge", unit: "{event}", points: [{ attributes, timeUnixNano: nanos, value: deadLettered }] },
      { name: "molit.outbox.oldest_pending_age", type: "gauge", unit: "s", points: [{ attributes, timeUnixNano: nanos, value: oldestPendingAgeSeconds }] },
    ];
    const logs = [{
      eventName: "molit.outbox.health",
      severity: deadLettered > 0 ? "ERROR" : "INFO",
      timeUnixNano: nanos,
      attributes: sanitizedLogAttributes({
        "molit.event_type": eventType,
        "molit.tenant_bucket": bucket,
        "molit.delivery_stage": "durable_queue_probe",
        "molit.result": deadLettered > 0 ? "dead_lettered" : "healthy",
      }),
    }];
    await this.#export(metrics, logs, signal);
    return Object.freeze({ deadLettered, eventType, observedAt: now.toISOString(), pending, tenantBucket: bucket });
  }

  async initialize({ signal, force = false } = {}) {
    this.#assertOpen();
    if (!force && this.readiness().ready) return this.readiness();
    if (this.probePromise) return this.probePromise;
    const { nanos } = unixNanos(this.clock);
    this.probePromise = this.#export(
      [{ name: "molit.telemetry.readiness", type: "gauge", unit: "{probe}", points: [{ attributes: { "molit.operation": "telemetry.readiness" }, timeUnixNano: nanos, value: 1 }] }],
      [{ eventName: "molit.telemetry.readiness", severity: "INFO", timeUnixNano: nanos, attributes: { "molit.operation": "telemetry.readiness", "molit.result": "healthy" } }],
      signal,
    ).then(() => this.readiness()).finally(() => { this.probePromise = null; });
    return this.probePromise;
  }

  async probeReadiness({ signal } = {}) {
    if (!this.readiness().ready && !this.closed) {
      try { await this.initialize({ signal, force: true }); } catch {}
    }
    return this.readiness();
  }

  readiness() {
    const now = this.clock().getTime();
    const signals = Object.freeze(Object.fromEntries(Object.entries(this.signalState).map(([name, state]) => {
      const ageMs = state.lastExportAt ? Math.max(0, now - Date.parse(state.lastExportAt)) : null;
      const ready = !this.closed && state.lastFailure === null && ageMs !== null && ageMs <= this.readinessMaxAgeMs;
      return [name, Object.freeze({ ...state, ageMs, ready })];
    })));
    const ageMs = Math.max(...Object.values(signals).map((state) => state.ageMs ?? Number.POSITIVE_INFINITY));
    const ready = !this.closed && Object.values(signals).every((state) => state.ready);
    return Object.freeze({
      failureCode: this.lastFailure?.code ?? null,
      lastExportAt: this.lastExportAt,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      maxAgeMs: this.readinessMaxAgeMs,
      ready,
      signals,
      status: ready ? "READY" : "NOT_READY",
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([this.metricExporter.close?.(), this.logExporter.close?.()]);
  }
}

export function correlatedAuditEvent({ type, actor, subject, data, eventId, occurredAt, traceId, correlationId }) {
  const correlation = validatedCorrelation({ correlationId, traceId });
  assertObservability(typeof type === "string" && /^[a-z][a-z0-9._-]{2,127}$/u.test(type), "OBS_AUDIT_TYPE_INVALID", "audit event type is invalid");
  return Object.freeze({
    type,
    ...(eventId ? { eventId } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    traceId,
    actor: { ...redact(actor ?? {}), correlationId },
    subject: redact(subject ?? {}),
    data: redact(data ?? {}),
    correlation,
  });
}

export function createLocalTestSignalExporter({ environment, signal }) {
  assertObservability(environment === "test" && ["metrics", "logs"].includes(signal), "OBS_LOCAL_SINK_FORBIDDEN", "local signal exporter is allowed only in tests");
  const items = [];
  return Object.freeze({
    mode: "local-test",
    signal,
    items,
    async export(batch) {
      items.push(...structuredClone(batch));
      return Object.freeze({ accepted: batch.length, signal, status: 200 });
    },
  });
}

export { DURATION_BOUNDS_MS };
