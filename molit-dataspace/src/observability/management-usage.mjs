import { assertObservability, ObservabilityError } from "./errors.mjs";
import { sha256 } from "./stable-json.mjs";

const TENANT_ID = /^[a-z][a-z0-9-]{2,62}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const TRACE_ID = /^[a-f0-9]{32}$/u;
const SPAN_ID = /^[a-f0-9]{16}$/u;
const FIXED_PURPOSE = "operational-non-billable";
const FIXED_METER = "management.api.request";
const FIXED_UNIT = "{request}";
const FIXED_DIMENSIONS = Object.freeze(["operation", "outcome"]);
const PLATFORM_ACCOUNTING_TENANT = "molit-platform";

function validateConfig(config) {
  assertObservability(config?.purpose === FIXED_PURPOSE && config.meterName === FIXED_METER && config.unit === FIXED_UNIT,
    "OBS_USAGE_CONFIG_INVALID", "management usage meter must remain non-billable and use the fixed meter identity");
  assertObservability(Array.isArray(config.dimensionKeys) && config.dimensionKeys.length === 2
    && config.dimensionKeys.every((value, index) => value === FIXED_DIMENSIONS[index]),
  "OBS_USAGE_CONFIG_INVALID", "management usage meter dimensions are fixed");
  assertObservability(Number.isSafeInteger(config.maxAttempts) && config.maxAttempts >= 1 && config.maxAttempts <= 5
    && Number.isSafeInteger(config.retryBaseMs) && config.retryBaseMs >= 10 && config.retryBaseMs <= 1_000,
  "OBS_USAGE_CONFIG_INVALID", "management usage retry policy is invalid");
  return Object.freeze(structuredClone(config));
}

function operationForCaas(method, path) {
  if (method === "POST" && path === "/v1/tenants") return "tenant.register";
  if (method === "POST" && path === "/v1/connectors/ensure") return "connector.ensure";
  const match = /^\/v1\/tenants\/[a-z][a-z0-9-]{2,62}(?:\/(desired-state|upgrade|rollback|reconcile|audit))?$/u.exec(path);
  if (!match) return null;
  const action = match[1];
  if (!action && method === "GET") return "tenant.read";
  if (action === "desired-state" && method === "PUT") return "tenant.desired-state.update";
  if (["upgrade", "rollback", "reconcile"].includes(action) && method === "POST") return `tenant.${action}`;
  if (action === "audit" && method === "GET") return "tenant.audit.read";
  return null;
}

function operationForDsaas(method, path) {
  if (method === "POST" && path === "/v1/dataspaces") return "dataspace.create";
  const base = "[a-z][a-z0-9-]{2,62}";
  if (method === "GET" && new RegExp(`^/v1/dataspaces/${base}$`, "u").test(path)) return "dataspace.read";
  if (method === "PUT" && new RegExp(`^/v1/dataspaces/${base}/desired-state$`, "u").test(path)) return "dataspace.desired-state.update";
  if (method === "POST" && new RegExp(`^/v1/dataspaces/${base}/reconcile$`, "u").test(path)) return "dataspace.reconcile";
  if (method === "POST" && new RegExp(`^/v1/dataspaces/${base}/participants$`, "u").test(path)) return "participant.submit";
  if (method === "GET" && new RegExp(`^/v1/dataspaces/${base}/participants/${base}$`, "u").test(path)) return "participant.read";
  if (method === "POST" && new RegExp(`^/v1/dataspaces/${base}/participants/${base}/approval$`, "u").test(path)) return "participant.approve";
  return null;
}

export function managementOperation(component, method, path) {
  if (typeof method !== "string" || typeof path !== "string") return null;
  if (component === "caas") return operationForCaas(method, path);
  if (component === "dsaas") return operationForDsaas(method, path);
  return null;
}

export function managementAccountingTenant({ authenticated, requestedTenantId, statusCode }) {
  if (authenticated !== true || !Number.isSafeInteger(statusCode) || statusCode < 100 || statusCode > 599) return null;
  return statusCode >= 200 && statusCode < 300 && TENANT_ID.test(requestedTenantId ?? "")
    ? requestedTenantId
    : PLATFORM_ACCOUNTING_TENANT;
}

export function managementUsageMeterOptions(config) {
  const resolved = validateConfig(config);
  return Object.freeze({
    maximumEventAgeDays: resolved.maximumEventAgeDays,
    maximumFutureSkewMs: resolved.maximumFutureSkewMs,
    meterDefinitions: Object.freeze({
      [FIXED_METER]: Object.freeze({ purpose: FIXED_PURPOSE, unit: FIXED_UNIT, dimensionKeys: [...FIXED_DIMENSIONS] }),
    }),
  });
}

function wait(ms, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class ManagementUsageRecorder {
  constructor({ meter, telemetry, component, config, clock = () => new Date(), sleeper = wait }) {
    assertObservability(meter?.record && meter?.readiness, "OBS_USAGE_CONFIG_INVALID", "initialized usage meter is required");
    assertObservability(telemetry?.recordMeterCommit, "OBS_USAGE_CONFIG_INVALID", "operational telemetry is required for usage correlation");
    assertObservability(["caas", "dsaas"].includes(component), "OBS_USAGE_CONFIG_INVALID", "management usage component is invalid");
    assertObservability(typeof clock === "function" && typeof sleeper === "function", "OBS_USAGE_CONFIG_INVALID", "management usage runtime dependencies are invalid");
    Object.assign(this, { meter, telemetry, component, config: validateConfig(config), clock, sleeper });
    this.closed = false;
    this.inFlight = new Set();
    this.lastFailure = null;
  }

  record(input) {
    assertObservability(!this.closed, "OBS_USAGE_CLOSED", "management usage recorder is closed");
    const operation = input?.operation;
    assertObservability(TENANT_ID.test(input?.tenantId ?? "") && typeof operation === "string" && operation.length > 0,
      "OBS_USAGE_COMPLETION_INVALID", "management usage completion tenant or operation is invalid");
    assertObservability(Number.isSafeInteger(input.statusCode) && input.statusCode >= 100 && input.statusCode <= 599
      && REQUEST_ID.test(input.requestId ?? "") && TRACE_ID.test(input.traceId ?? "")
      && (input.spanId === undefined || SPAN_ID.test(input.spanId)),
    "OBS_USAGE_COMPLETION_INVALID", "management usage completion correlation is invalid");
    const promise = this.#record(input);
    this.inFlight.add(promise);
    promise.finally(() => this.inFlight.delete(promise)).catch(() => {});
    return promise;
  }

  async #record(input) {
    input.signal?.throwIfAborted();
    const completed = this.clock();
    assertObservability(completed instanceof Date && Number.isFinite(completed.valueOf()), "OBS_CLOCK_INVALID", "management usage clock is invalid");
    const outcome = input.statusCode < 400 ? "success" : "failure";
    const completionFact = Object.freeze({
      schemaVersion: "molit.management-api-completion/1",
      purpose: FIXED_PURPOSE,
      component: this.component,
      tenantId: input.tenantId,
      requestId: input.requestId,
      operation: input.operation,
      outcome,
      statusCode: input.statusCode,
      completedAt: completed.toISOString(),
      traceId: input.traceId,
      ...(input.spanId ? { spanId: input.spanId } : {}),
      correlationId: input.requestId,
    });
    const sourceEventId = sha256({ component: this.component, tenantId: input.tenantId, requestId: input.requestId, traceId: input.traceId, spanId: input.spanId ?? null, operation: input.operation });
    const context = {
      accessMode: "service",
      actorId: `service:${this.component}-usage-meter`,
      correlationId: input.requestId,
      tenantId: input.tenantId,
      traceId: input.traceId,
    };
    let result;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      try {
        input.signal?.throwIfAborted();
        result = await this.meter.record(context, {
          meterName: FIXED_METER,
          quantity: "1",
          occurredAt: completionFact.completedAt,
          sourceEventId,
          sourceEventDigest: sha256(completionFact),
          dimensions: { operation: input.operation, outcome },
        });
        this.lastFailure = null;
        break;
      } catch (error) {
        this.lastFailure = Object.freeze({ at: this.clock().toISOString(), code: error?.code ?? "OBS_USAGE_RECORD_FAILED" });
        if (input.signal?.aborted) throw input.signal.reason;
        const retryable = error?.code === "OBS_USAGE_RECORD_FAILED";
        if (!retryable || attempt === this.config.maxAttempts) throw error;
        await this.sleeper(this.config.retryBaseMs * (2 ** (attempt - 1)), { signal: input.signal });
      }
    }
    await this.telemetry.recordMeterCommit({
      tenantId: input.tenantId,
      meterName: FIXED_METER,
      unit: FIXED_UNIT,
      purpose: FIXED_PURPOSE,
      eventId: result.eventId,
      result: result.replayed ? "replayed" : "committed",
      correlationId: input.requestId,
      traceId: input.traceId,
      ...(input.spanId ? { spanId: input.spanId } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return Object.freeze({ completionFact, meter: result });
  }

  async readiness() {
    if (this.closed) return Object.freeze({ ready: false, status: "NOT_READY", failureCode: "OBS_USAGE_CLOSED" });
    const traceId = sha256({ component: this.component, purpose: "usage-readiness" }).slice(0, 32);
    const meter = await this.meter.readiness({
      accessMode: "service",
      actorId: `service:${this.component}-usage-meter`,
      correlationId: `${this.component}:usage-readiness`,
      tenantId: "molit-platform",
      traceId,
    });
    const ready = meter.ready === true && this.lastFailure === null;
    return Object.freeze({
      ready,
      status: ready ? "READY" : "NOT_READY",
      failureCode: this.lastFailure?.code ?? meter.failureCode ?? null,
      meter,
    });
  }

  async close({ timeoutMs = 30_000 } = {}) {
    if (this.closed) return;
    assertObservability(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 120_000, "OBS_USAGE_CLOSE_INVALID", "management usage close timeout is invalid");
    this.closed = true;
    if (this.inFlight.size === 0) return;
    const drain = Promise.allSettled([...this.inFlight]);
    if (timeoutMs === 0) throw new ObservabilityError("OBS_USAGE_CLOSE_TIMEOUT", "management usage records did not drain before shutdown");
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ObservabilityError("OBS_USAGE_CLOSE_TIMEOUT", "management usage records did not drain before shutdown")), timeoutMs);
    });
    try { await Promise.race([drain, timeout]); } finally { clearTimeout(timer); }
  }
}

export const MANAGEMENT_USAGE_POLICY = Object.freeze({
  purpose: FIXED_PURPOSE,
  meterName: FIXED_METER,
  unit: FIXED_UNIT,
  dimensionKeys: FIXED_DIMENSIONS,
  platformAccountingTenant: PLATFORM_ACCOUNTING_TENANT,
  targetAttribution: "successful-management-operation-only",
});
