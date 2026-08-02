import { digest } from "../discovery/stable-json.mjs";
import { assertObservability, ObservabilityError } from "./errors.mjs";

export const USAGE_OUTBOX_EVENT_TYPES = Object.freeze(["usage.meter.recorded", "usage.meter.reprocessed"]);

const DIGEST = /^[a-f0-9]{64}$/u;
const TRACE_ID = /^[a-f0-9]{32}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const PURPOSES = new Set(["operational-non-billable", "billing-candidate"]);

function abortError(signal) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error ? signal.reason : new ObservabilityError("OBS_USAGE_DISPATCHER_ABORTED", "usage outbox dispatcher was aborted");
}

function throwIfAborted(signal) {
  const error = abortError(signal);
  if (error) throw error;
}

function wait(ms, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(abortError(signal)); }, { once: true });
  });
}

function errorCode(error) {
  const value = typeof error?.code === "string" ? error.code.toUpperCase().replaceAll(/[^A-Z0-9_:-]/gu, "_") : "OBS_USAGE_EXPORT_FAILED";
  return /^[A-Z][A-Z0-9_:-]{0,63}$/u.test(value) ? value : "OBS_USAGE_EXPORT_FAILED";
}

function eventIdentity(event) {
  assertObservability(USAGE_OUTBOX_EVENT_TYPES.includes(event?.eventType), "OBS_USAGE_OUTBOX_EVENT_TYPE_INVALID", "usage dispatcher accepts only usage meter outbox events");
  assertObservability(typeof event.component === "string" && event.component.length >= 3 && typeof event.tenantId === "string" && event.tenantId.length >= 3,
    "OBS_USAGE_OUTBOX_IDENTITY_INVALID", "usage outbox component or tenant is invalid");
  assertObservability(IDENTIFIER.test(event.eventId ?? "") && DIGEST.test(event.payloadSha256 ?? "") && event.payloadSha256 === digest(event.payload),
    "OBS_USAGE_OUTBOX_PAYLOAD_TAMPERED", "usage outbox payload digest does not match its content");
}

export function usageOutboxEventToDelivery(event) {
  eventIdentity(event);
  const { payload } = event;
  if (event.eventType === "usage.meter.recorded") {
    const usage = payload?.usageEvent;
    assertObservability(payload?.schemaVersion === "molit.usage-meter-outbox/1" && usage?.schemaVersion === "molit.usage-meter-event/1",
      "OBS_USAGE_OUTBOX_PAYLOAD_INVALID", "usage meter recorded payload contract is invalid");
    assertObservability(DIGEST.test(payload.usageEventSha256 ?? "") && payload.usageEventSha256 === digest(usage),
      "OBS_USAGE_OUTBOX_EVENT_TAMPERED", "usage event digest does not match its outbox binding");
    assertObservability(usage.component === event.component && usage.tenantId === event.tenantId && usage.eventId === event.aggregateId,
      "OBS_USAGE_OUTBOX_BINDING_MISMATCH", "usage event identity does not match its outbox envelope");
    assertObservability(PURPOSES.has(usage.purpose) && TRACE_ID.test(usage.traceId ?? "") && IDENTIFIER.test(usage.correlationId ?? ""),
      "OBS_USAGE_OUTBOX_CORRELATION_INVALID", "usage event classification or correlation is invalid");
    return Object.freeze({
      correlationId: usage.correlationId,
      eventId: event.eventId,
      eventType: event.eventType,
      meterName: usage.meterName,
      payloadSha256: event.payloadSha256,
      purpose: usage.purpose,
      tenantId: event.tenantId,
      traceId: usage.traceId,
      unit: usage.unit,
    });
  }
  assertObservability(payload?.schemaVersion === "molit.usage-meter-reprocess-outbox/1" && DIGEST.test(payload.requestSha256 ?? "")
    && payload.requestSha256 === digest(payload.request), "OBS_USAGE_OUTBOX_PAYLOAD_INVALID", "usage meter reprocess payload contract is invalid");
  const request = payload.request;
  assertObservability(request?.tenantId === event.tenantId && request.operationId === event.aggregateId && PURPOSES.has(request.purpose)
    && TRACE_ID.test(request.traceId ?? "") && IDENTIFIER.test(request.correlationId ?? ""),
  "OBS_USAGE_OUTBOX_BINDING_MISMATCH", "usage reprocess identity or correlation does not match its outbox envelope");
  return Object.freeze({
    correlationId: request.correlationId,
    eventId: event.eventId,
    eventType: event.eventType,
    meterName: request.meterName,
    payloadSha256: event.payloadSha256,
    purpose: request.purpose,
    tenantId: event.tenantId,
    traceId: request.traceId,
    unit: request.unit,
  });
}

export class UsageOutboxDispatcher {
  constructor({ outbox, telemetry, batchSize = 50, leaseMs = 30_000, pollIntervalMs = 1_000, retryBaseMs = 1_000, retryMaxMs = 300_000, healthIntervalMs = 30_000, clock = () => new Date() }) {
    assertObservability(outbox?.claim && outbox?.acknowledge && outbox?.reject && outbox?.readiness, "OBS_USAGE_DISPATCHER_OUTBOX_INVALID", "usage dispatcher requires a PostgresOutbox-compatible instance");
    assertObservability(telemetry?.recordUsageOutboxDelivery && telemetry?.recordOutboxHealth, "OBS_USAGE_DISPATCHER_TELEMETRY_INVALID", "usage dispatcher requires operational telemetry");
    assertObservability(Number.isSafeInteger(batchSize) && batchSize >= 1 && batchSize <= 500 && Number.isSafeInteger(leaseMs) && leaseMs >= 1_000 && leaseMs <= 900_000,
      "OBS_USAGE_DISPATCHER_CONFIG_INVALID", "usage dispatcher batch or lease is invalid");
    assertObservability(Number.isSafeInteger(pollIntervalMs) && pollIntervalMs >= 10 && pollIntervalMs <= 60_000
      && Number.isSafeInteger(retryBaseMs) && retryBaseMs >= 10 && retryBaseMs <= retryMaxMs && retryMaxMs <= 86_400_000,
    "OBS_USAGE_DISPATCHER_CONFIG_INVALID", "usage dispatcher polling or retry policy is invalid");
    assertObservability(Number.isSafeInteger(healthIntervalMs) && healthIntervalMs >= 1_000 && healthIntervalMs <= 300_000 && typeof clock === "function",
      "OBS_USAGE_DISPATCHER_CONFIG_INVALID", "usage dispatcher health interval is invalid");
    Object.assign(this, { outbox, telemetry, batchSize, leaseMs, pollIntervalMs, retryBaseMs, retryMaxMs, healthIntervalMs, clock });
    this.initialized = false;
    this.running = false;
    this.stopping = false;
    this.lastError = null;
    this.lastSuccessAt = null;
    this.lastHealthAt = null;
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
  }

  #retryDelay(attempts) {
    return Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.min(20, Math.max(0, attempts - 1)));
  }

  async #publishHealth({ force = false, signal } = {}) {
    const now = this.clock();
    assertObservability(now instanceof Date && Number.isFinite(now.valueOf()), "OBS_CLOCK_INVALID", "usage dispatcher clock is invalid");
    if (!force && this.lastHealthAt && now.valueOf() - Date.parse(this.lastHealthAt) < this.healthIntervalMs) return;
    for (const eventType of USAGE_OUTBOX_EVENT_TYPES) {
      const status = await this.outbox.readiness({ eventTypes: [eventType], signal });
      const oldestPendingAgeSeconds = status.oldestPendingAt ? Math.max(0, (now.valueOf() - Date.parse(status.oldestPendingAt)) / 1_000) : 0;
      await this.telemetry.recordOutboxHealth({ tenantId: "molit-platform", eventType, pending: status.pending, deadLettered: status.deadLettered, oldestPendingAgeSeconds, signal });
    }
    this.lastHealthAt = now.toISOString();
  }

  async runOnce({ signal } = {}) {
    await this.initialize();
    throwIfAborted(signal);
    let events;
    try {
      events = await this.outbox.claim({ limit: this.batchSize, leaseMs: this.leaseMs, eventTypes: USAGE_OUTBOX_EVENT_TYPES, signal });
    } catch (error) {
      this.lastError = Object.freeze({ at: this.clock().toISOString(), code: errorCode(error), scope: "infrastructure" });
      throw error;
    }
    let acknowledged = 0;
    let rejected = 0;
    let deadLettered = 0;
    for (const event of events) {
      throwIfAborted(signal);
      try {
        const delivery = usageOutboxEventToDelivery(event);
        const result = await this.telemetry.recordUsageOutboxDelivery({ ...delivery, signal });
        await this.outbox.acknowledge(event.eventId, {
          schemaVersion: "molit.usage-delivery-receipt/1",
          deliveryPurpose: "usage-integrity",
          eventType: event.eventType,
          idempotencyKey: event.eventId,
          payloadSha256: event.payloadSha256,
          sink: result.sink,
          deliveredAt: result.deliveredAt,
        }, { signal });
        acknowledged += 1;
        this.lastSuccessAt = result.deliveredAt;
        this.lastError = null;
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        const rejection = await this.outbox.reject(event.eventId, errorCode(error), { delayMs: this.#retryDelay(event.attempts), signal });
        rejected += 1;
        if (rejection.deadLettered) deadLettered += 1;
        this.lastError = Object.freeze({ at: this.clock().toISOString(), code: errorCode(error), scope: "delivery" });
      }
    }
    try {
      await this.#publishHealth({ force: deadLettered > 0 || this.lastError?.scope === "infrastructure", signal });
      if (this.lastError?.scope === "infrastructure") this.lastError = null;
    } catch (error) {
      this.lastError = Object.freeze({ at: this.clock().toISOString(), code: errorCode(error), scope: "infrastructure" });
      throw error;
    }
    return Object.freeze({ acknowledged, claimed: events.length, deadLettered, rejected });
  }

  async #loop() {
    while (!this.stopping) {
      this.operationController = new AbortController();
      try {
        const result = await this.runOnce({ signal: this.operationController.signal });
        this.operationController = null;
        if (result.claimed === 0 && !this.stopping) {
          this.pollController = new AbortController();
          await wait(this.pollIntervalMs, this.pollController.signal);
          this.pollController = null;
        }
      } catch (error) {
        this.operationController = null;
        this.pollController = null;
        if (this.stopping) break;
        this.lastError = Object.freeze({ at: this.clock().toISOString(), code: errorCode(error), scope: "infrastructure" });
        this.pollController = new AbortController();
        await wait(this.pollIntervalMs, this.pollController.signal).catch(() => {});
        this.pollController = null;
      }
    }
  }

  async start() {
    if (this.running) return;
    assertObservability(!this.stopping, "OBS_USAGE_DISPATCHER_STOPPING", "usage dispatcher cannot restart while stopping");
    await this.initialize();
    this.running = true;
    this.loopPromise = this.#loop().finally(() => { this.running = false; });
  }

  async readiness({ signal } = {}) {
    const outbox = await this.outbox.readiness({ eventTypes: USAGE_OUTBOX_EVENT_TYPES, signal });
    const ready = this.initialized && this.running && !this.stopping && this.lastError === null && outbox.ready === true;
    return Object.freeze({ ...outbox, initialized: this.initialized, running: this.running, stopping: this.stopping, lastError: this.lastError, lastHealthAt: this.lastHealthAt, lastSuccessAt: this.lastSuccessAt, ready });
  }

  async stop({ timeoutMs = 30_000 } = {}) {
    if (!this.running) return;
    if (this.stopping) return this.stopPromise;
    assertObservability(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 120_000, "OBS_USAGE_DISPATCHER_CONFIG_INVALID", "usage dispatcher shutdown timeout is invalid");
    this.stopping = true;
    this.pollController?.abort(new ObservabilityError("OBS_USAGE_DISPATCHER_STOPPING", "usage dispatcher is stopping"));
    this.stopPromise = (async () => {
      let timer;
      const result = await Promise.race([
        this.loopPromise.then(() => "stopped"),
        new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); }),
      ]);
      clearTimeout(timer);
      if (result === "timeout") {
        this.operationController?.abort(new ObservabilityError("OBS_USAGE_DISPATCHER_SHUTDOWN_TIMEOUT", "usage dispatcher exceeded its shutdown deadline"));
        await this.loopPromise;
      }
      this.stopping = false;
      assertObservability(result === "stopped", "OBS_USAGE_DISPATCHER_SHUTDOWN_TIMEOUT", "usage dispatcher did not stop before its deadline");
    })();
    return this.stopPromise;
  }
}

export function createUsageOutboxDispatcher(options) {
  return new UsageOutboxDispatcher(options);
}
