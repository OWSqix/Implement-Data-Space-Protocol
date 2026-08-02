import { assertObservability, ObservabilityError } from "./errors.mjs";

const MAX_BATCH_ITEMS = 1_000;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const METRIC_NAME = /^[a-z][a-z0-9_.]{2,127}$/u;
const ATTRIBUTE_KEY = /^[a-z][a-z0-9_.-]{0,127}$/u;
const HEX_TRACE_ID = /^[0-9a-f]{32}$/u;
const HEX_SPAN_ID = /^[0-9a-f]{16}$/u;
const SEVERITY = Object.freeze({
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
});

function anyValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (Number.isSafeInteger(value)) return { intValue: String(value) };
  if (typeof value === "number" && Number.isFinite(value)) return { doubleValue: value };
  throw new ObservabilityError("OBS_OTLP_ATTRIBUTE_INVALID", "OTLP attributes must be scalar JSON values");
}

function attributes(values = {}) {
  assertObservability(values && typeof values === "object" && !Array.isArray(values), "OBS_OTLP_ATTRIBUTE_INVALID", "OTLP attributes must be an object");
  return Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => {
    assertObservability(ATTRIBUTE_KEY.test(key), "OBS_OTLP_ATTRIBUTE_INVALID", "OTLP attribute key is invalid");
    return { key, value: anyValue(value) };
  });
}

function validatedEndpoint(endpoint, signal, allowInsecureLoopback) {
  const url = new URL(endpoint);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  assertObservability(url.protocol === "https:" || (allowInsecureLoopback && loopback && url.protocol === "http:"), "OBS_OTLP_TLS_REQUIRED", "operational OTLP endpoint must use HTTPS");
  assertObservability(url.pathname.endsWith(`/v1/${signal}`) && !url.username && !url.password && !url.search && !url.hash, "OBS_OTLP_ENDPOINT_INVALID", `OTLP endpoint must be an uncredentialed /v1/${signal} URL`);
  return url;
}

async function boundedResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ObservabilityError("OBS_OTLP_RESPONSE_TOO_LARGE", "OTLP response exceeded its byte limit");
    }
  }
}

function metricToOtlp(metric) {
  assertObservability(METRIC_NAME.test(metric?.name ?? ""), "OBS_METRIC_INVALID", "metric name is invalid");
  assertObservability(typeof metric.unit === "string" && metric.unit.length <= 63, "OBS_METRIC_INVALID", "metric unit is invalid");
  assertObservability(["sum", "gauge", "histogram"].includes(metric.type), "OBS_METRIC_INVALID", "metric type is invalid");
  assertObservability(Array.isArray(metric.points) && metric.points.length >= 1 && metric.points.length <= MAX_BATCH_ITEMS, "OBS_METRIC_INVALID", "metric data points are invalid");
  const points = metric.points.map((point) => {
    assertObservability(/^[0-9]{16,20}$/u.test(point.timeUnixNano ?? ""), "OBS_METRIC_INVALID", "metric timestamp is invalid");
    const base = { attributes: attributes(point.attributes), timeUnixNano: point.timeUnixNano };
    if (metric.type !== "histogram") {
      assertObservability(Number.isFinite(point.value), "OBS_METRIC_INVALID", "metric value must be finite");
      return { ...base, asDouble: point.value };
    }
    assertObservability(Number.isSafeInteger(point.count) && point.count >= 0 && Number.isFinite(point.sum), "OBS_METRIC_INVALID", "histogram count or sum is invalid");
    assertObservability(Array.isArray(point.explicitBounds) && point.explicitBounds.every(Number.isFinite), "OBS_METRIC_INVALID", "histogram bounds are invalid");
    assertObservability(Array.isArray(point.bucketCounts) && point.bucketCounts.length === point.explicitBounds.length + 1 && point.bucketCounts.every((value) => Number.isSafeInteger(value) && value >= 0), "OBS_METRIC_INVALID", "histogram bucket counts are invalid");
    assertObservability(point.bucketCounts.reduce((total, value) => total + value, 0) === point.count, "OBS_METRIC_INVALID", "histogram bucket counts do not equal count");
    return { ...base, count: String(point.count), sum: point.sum, explicitBounds: point.explicitBounds, bucketCounts: point.bucketCounts.map(String) };
  });
  if (metric.type === "sum") return { name: metric.name, unit: metric.unit, sum: { aggregationTemporality: 1, isMonotonic: metric.monotonic !== false, dataPoints: points } };
  if (metric.type === "gauge") return { name: metric.name, unit: metric.unit, gauge: { dataPoints: points } };
  return { name: metric.name, unit: metric.unit, histogram: { aggregationTemporality: 1, dataPoints: points } };
}

function logToOtlp(record) {
  assertObservability(Object.hasOwn(SEVERITY, record?.severity), "OBS_LOG_INVALID", "log severity is invalid");
  assertObservability(typeof record.eventName === "string" && /^[a-z][a-z0-9._-]{2,127}$/u.test(record.eventName), "OBS_LOG_INVALID", "log event name is invalid");
  assertObservability(/^[0-9]{16,20}$/u.test(record.timeUnixNano ?? ""), "OBS_LOG_INVALID", "log timestamp is invalid");
  assertObservability(record.traceId === undefined || HEX_TRACE_ID.test(record.traceId), "OBS_LOG_INVALID", "log trace identifier is invalid");
  assertObservability(record.spanId === undefined || HEX_SPAN_ID.test(record.spanId), "OBS_LOG_INVALID", "log span identifier is invalid");
  return {
    timeUnixNano: record.timeUnixNano,
    observedTimeUnixNano: record.observedTimeUnixNano ?? record.timeUnixNano,
    severityNumber: SEVERITY[record.severity],
    severityText: record.severity,
    body: { stringValue: record.eventName },
    attributes: attributes(record.attributes),
    ...(record.traceId ? { traceId: record.traceId } : {}),
    ...(record.spanId ? { spanId: record.spanId } : {}),
  };
}

class OtlpHttpJsonSignalExporter {
  constructor({ signal, endpoint, serviceName, serviceVersion, environment, authorization, dispatcher, timeoutMs = 5_000, allowInsecureLoopback = false, fetchImpl = fetch }) {
    assertObservability(["metrics", "logs"].includes(signal), "OBS_OTLP_SIGNAL_INVALID", "OTLP signal is invalid");
    assertObservability(typeof serviceName === "string" && serviceName.length > 0, "OBS_SERVICE_NAME_REQUIRED", "OTLP service name is required");
    assertObservability(typeof fetchImpl === "function", "OBS_FETCH_REQUIRED", "OTLP fetch implementation is required");
    assertObservability(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30_000, "OBS_OTLP_TIMEOUT_INVALID", "OTLP timeout is invalid");
    this.mode = "operational";
    this.signal = signal;
    this.endpoint = validatedEndpoint(endpoint, signal, allowInsecureLoopback);
    this.authorization = authorization;
    this.dispatcher = dispatcher;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.resource = { attributes: attributes({
      "service.name": serviceName,
      ...(serviceVersion ? { "service.version": serviceVersion } : {}),
      ...(environment ? { "deployment.environment.name": environment } : {}),
    }) };
  }

  async export(items, { signal } = {}) {
    assertObservability(Array.isArray(items) && items.length >= 1 && items.length <= MAX_BATCH_ITEMS, "OBS_OTLP_BATCH_INVALID", "OTLP batch size is invalid");
    const payload = this.signal === "metrics"
      ? { resourceMetrics: [{ resource: this.resource, scopeMetrics: [{ scope: { name: "molit.observability", version: "1" }, metrics: items.map(metricToOtlp) }] }] }
      : { resourceLogs: [{ resource: this.resource, scopeLogs: [{ scope: { name: "molit.observability", version: "1" }, logRecords: items.map(logToOtlp) }] }] };
    const body = JSON.stringify(payload);
    assertObservability(Buffer.byteLength(body) <= MAX_REQUEST_BYTES, "OBS_OTLP_REQUEST_TOO_LARGE", "OTLP request exceeded its byte limit");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const token = await this.authorization?.({ signal: combined });
    assertObservability(!token || (typeof token === "string" && !/[\r\n]/u.test(token)), "OBS_OTLP_AUTH_INVALID", "OTLP authorization value is invalid");
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
        body,
        redirect: "error",
        signal: combined,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
    } catch (error) {
      throw new ObservabilityError("OBS_OTLP_UNAVAILABLE", `OTLP ${this.signal} export failed`, { cause: error });
    }
    await boundedResponse(response);
    assertObservability(response.status >= 200 && response.status < 300, "OBS_OTLP_REJECTED", `OTLP collector rejected ${this.signal} with HTTP ${response.status}`);
    return Object.freeze({ accepted: items.length, signal: this.signal, status: response.status });
  }
}

export class OtlpMetricExporter extends OtlpHttpJsonSignalExporter {
  constructor(options) { super({ ...options, signal: "metrics" }); }
}

export class OtlpLogExporter extends OtlpHttpJsonSignalExporter {
  constructor(options) { super({ ...options, signal: "logs" }); }
}

export function severityNumber(severity) {
  assertObservability(Object.hasOwn(SEVERITY, severity), "OBS_LOG_INVALID", "log severity is invalid");
  return SEVERITY[severity];
}
