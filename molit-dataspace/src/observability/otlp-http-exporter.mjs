import { assertObservability, ObservabilityError } from "./errors.mjs";

const MAX_RESPONSE_BYTES = 64 * 1024;

function otlpValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (Number.isInteger(value)) return { intValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  return { stringValue: JSON.stringify(value) };
}

function attributes(values) {
  return Object.entries(values ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({ key, value: otlpValue(value) }));
}

function spanToOtlp(span) {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    traceState: span.tracestate ?? "",
    flags: Number.parseInt(span.traceFlags, 16) & 1,
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: attributes(span.attributes),
    status: { code: span.status === "ERROR" ? 2 : 1, ...(span.statusMessage ? { message: span.statusMessage } : {}) },
  };
}

async function boundedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ObservabilityError("OBS_OTLP_RESPONSE_TOO_LARGE", "OTLP response exceeded its byte limit");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

export class OtlpHttpJsonExporter {
  constructor({ endpoint, serviceName, serviceVersion, environment, authorization, dispatcher, timeoutMs = 5_000, readinessMaxAgeMs = 60_000, allowInsecureLoopback = false, fetchImpl = fetch, clock = () => new Date() }) {
    const url = new URL(endpoint);
    const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
    assertObservability(url.protocol === "https:" || (allowInsecureLoopback && loopback && url.protocol === "http:"), "OBS_OTLP_TLS_REQUIRED", "operational OTLP endpoint must use HTTPS");
    assertObservability(url.pathname.endsWith("/v1/traces") && !url.username && !url.password && !url.search && !url.hash, "OBS_OTLP_ENDPOINT_INVALID", "OTLP endpoint must be an uncredentialed /v1/traces URL");
    assertObservability(typeof serviceName === "string" && serviceName.length > 0, "OBS_SERVICE_NAME_REQUIRED", "OTLP service name is required");
    assertObservability(typeof fetchImpl === "function", "OBS_FETCH_REQUIRED", "OTLP fetch implementation is required");
    assertObservability(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30_000, "OBS_OTLP_TIMEOUT_INVALID", "OTLP timeout is invalid");
    assertObservability(Number.isSafeInteger(readinessMaxAgeMs) && readinessMaxAgeMs >= 1_000 && readinessMaxAgeMs <= 300_000, "OBS_OTLP_READINESS_INVALID", "OTLP readiness age is invalid");
    this.mode = "operational";
    this.endpoint = url;
    this.fetchImpl = fetchImpl;
    this.authorization = authorization;
    this.dispatcher = dispatcher;
    this.timeoutMs = timeoutMs;
    this.readinessMaxAgeMs = readinessMaxAgeMs;
    this.clock = clock;
    this.lastFailure = null;
    this.lastExportAt = null;
    this.probePromise = null;
    this.closed = false;
    this.resourceAttributes = {
      "service.name": serviceName,
      ...(serviceVersion ? { "service.version": serviceVersion } : {}),
      ...(environment ? { "deployment.environment.name": environment } : {}),
    };
  }

  async export(spans, { signal } = {}) {
    assertObservability(!this.closed, "OBS_OTLP_CLOSED", "OTLP trace exporter is closed");
    assertObservability(Array.isArray(spans) && spans.length > 0, "OBS_SPANS_REQUIRED", "at least one span is required");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const body = JSON.stringify({ resourceSpans: [{ resource: { attributes: attributes(this.resourceAttributes) }, scopeSpans: [{ scope: { name: "molit.observability", version: "1" }, spans: spans.map(spanToOtlp) }] }] });
    try {
      const token = await this.authorization?.({ signal: combined });
      assertObservability(!token || (typeof token === "string" && !/[\r\n]/u.test(token)), "OBS_OTLP_AUTH_INVALID", "OTLP authorization value is invalid");
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
        body,
        redirect: "error",
        signal: combined,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
      await boundedText(response);
      assertObservability(response.status >= 200 && response.status < 300, "OBS_OTLP_REJECTED", `OTLP collector rejected the batch with HTTP ${response.status}`);
      this.lastFailure = null;
      this.lastExportAt = this.clock().toISOString();
      return { accepted: spans.length, status: response.status };
    } catch (error) {
      const failure = error instanceof ObservabilityError ? error : new ObservabilityError("OBS_OTLP_UNAVAILABLE", "OTLP export failed", { cause: error });
      this.lastFailure = Object.freeze({ at: this.clock().toISOString(), code: failure.code ?? "OBS_OTLP_UNAVAILABLE" });
      throw failure;
    }
  }

  readiness() {
    const ageMs = this.lastExportAt ? Math.max(0, this.clock().getTime() - Date.parse(this.lastExportAt)) : null;
    const ready = !this.closed && this.lastFailure === null && ageMs !== null && ageMs <= this.readinessMaxAgeMs;
    return Object.freeze({ ready, status: ready ? "READY" : "NOT_READY", lastExportAt: this.lastExportAt, lastFailure: this.lastFailure, ageMs, maxAgeMs: this.readinessMaxAgeMs });
  }

  async initialize({ signal, force = false } = {}) {
    if (!force && this.readiness().ready) return this.readiness();
    if (this.probePromise) return this.probePromise;
    const now = BigInt(this.clock().getTime()) * 1_000_000n;
    this.probePromise = this.export([{
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      traceFlags: "01",
      tracestate: "",
      name: "molit.telemetry.readiness",
      kind: 1,
      startTimeUnixNano: now.toString(),
      endTimeUnixNano: (now + 1n).toString(),
      status: "OK",
      attributes: { "molit.probe": true },
    }], { signal }).then(() => this.readiness()).finally(() => { this.probePromise = null; });
    return this.probePromise;
  }

  async probeReadiness({ signal } = {}) {
    if (!this.readiness().ready) {
      try { await this.initialize({ signal, force: true }); } catch {}
    }
    return this.readiness();
  }

  async close() {
    this.closed = true;
  }
}

export function createLocalTestSpanSink({ environment } = {}) {
  assertObservability(environment === "test", "OBS_LOCAL_SINK_FORBIDDEN", "local telemetry sink is allowed only in an explicit test environment");
  const spans = [];
  return Object.freeze({
    mode: "local-test",
    spans,
    async export(batch) { spans.push(...structuredClone(batch)); return { accepted: batch.length, status: 200 }; },
  });
}
