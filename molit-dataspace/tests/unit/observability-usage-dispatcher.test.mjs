import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../../src/discovery/stable-json.mjs";
import { createUsageOutboxDispatcher, ObservabilityError, usageOutboxEventToDelivery } from "../../src/observability/index.mjs";

function recordedEvent() {
  const usageEvent = {
    schemaVersion: "molit.usage-meter-event/1",
    component: "caas",
    tenantId: "tenant-seoul-01",
    eventId: "a".repeat(64),
    meterName: "management.api.request",
    purpose: "operational-non-billable",
    quantity: "1",
    unit: "{request}",
    occurredAt: "2026-07-14T12:00:00.000Z",
    traceId: "b".repeat(32),
    correlationId: "request-correlation-001",
    sourceEventId: "c".repeat(64),
    sourceEventDigest: "d".repeat(64),
    dimensions: { operation: "connector.ensure", outcome: "success" },
  };
  const payload = { schemaVersion: "molit.usage-meter-outbox/1", usageEvent, usageEventSha256: digest(usageEvent) };
  return {
    aggregateId: usageEvent.eventId,
    aggregateKind: "usage-meter-event",
    attempts: 1,
    component: "caas",
    createdAt: usageEvent.occurredAt,
    eventId: "e".repeat(64),
    eventType: "usage.meter.recorded",
    payload,
    payloadSha256: digest(payload),
    tenantId: usageEvent.tenantId,
  };
}

class FakeOutbox {
  constructor(events, { maxAttempts = 3, acknowledgeFailure = false } = {}) {
    this.events = events.map((event) => ({ ...structuredClone(event), claimed: false, done: false, dead: false }));
    this.maxAttempts = maxAttempts;
    this.acknowledgeFailure = acknowledgeFailure;
    this.acks = [];
    this.rejects = [];
  }
  async claim(options) {
    if (this.failNextClaim) {
      this.failNextClaim = false;
      throw new ObservabilityError("OUTBOX_STATE_UNAVAILABLE", "claim failed");
    }
    return this.events.filter((event) => !event.claimed && !event.done && !event.dead && options.eventTypes.includes(event.eventType)).slice(0, options.limit).map((event) => {
      event.claimed = true;
      return structuredClone(event);
    });
  }
  async acknowledge(eventId, receipt) {
    if (this.acknowledgeFailure) {
      this.acknowledgeFailure = false;
      throw new ObservabilityError("OUTBOX_STATE_UNAVAILABLE", "acknowledgement failed after export");
    }
    const event = this.events.find((value) => value.eventId === eventId);
    event.claimed = false;
    event.done = true;
    this.acks.push({ eventId, receipt });
    return { eventId };
  }
  async reject(eventId, code, options) {
    const event = this.events.find((value) => value.eventId === eventId);
    event.claimed = false;
    event.attempts += 1;
    event.dead = event.attempts >= this.maxAttempts;
    this.rejects.push({ code, eventId, options });
    return { deadLettered: event.dead, eventId };
  }
  async readiness(options) {
    const events = this.events.filter((event) => options.eventTypes.includes(event.eventType));
    return {
      deadLettered: events.filter((event) => event.dead).length,
      oldestPendingAt: events.some((event) => !event.done && !event.dead) ? "2026-07-14T11:59:00.000Z" : null,
      pending: events.filter((event) => !event.done && !event.dead).length,
      ready: !events.some((event) => event.dead),
    };
  }
}

test("usage infrastructure failure clears only after claim and health export recover", async () => {
  const outbox = new FakeOutbox([]);
  outbox.failNextClaim = true;
  const signal = telemetry();
  const dispatcher = createUsageOutboxDispatcher({ outbox, telemetry: signal, pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100, healthIntervalMs: 1_000, clock: () => new Date("2026-07-14T12:00:00.000Z") });
  await assert.rejects(dispatcher.runOnce(), { code: "OUTBOX_STATE_UNAVAILABLE" });
  dispatcher.running = true;
  assert.equal((await dispatcher.readiness()).ready, false);
  assert.deepEqual(await dispatcher.runOnce(), { acknowledged: 0, claimed: 0, deadLettered: 0, rejected: 0 });
  assert.equal(signal.health.length, 2);
  assert.equal((await dispatcher.readiness()).ready, true);
  dispatcher.running = false;
});

function telemetry() {
  return {
    deliveries: [],
    health: [],
    async recordUsageOutboxDelivery(value) {
      this.deliveries.push(value);
      return { deliveredAt: "2026-07-14T12:00:00.000Z", eventId: value.eventId, idempotencyKey: value.eventId, sink: "otlp-log" };
    },
    async recordOutboxHealth(value) { this.health.push(value); },
  };
}

test("usage dispatcher validates the transactional binding and acknowledges an OTLP delivery receipt", async () => {
  const event = recordedEvent();
  assert.equal(usageOutboxEventToDelivery(event).correlationId, "request-correlation-001");
  const outbox = new FakeOutbox([event]);
  const signal = telemetry();
  const dispatcher = createUsageOutboxDispatcher({ outbox, telemetry: signal, pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100, healthIntervalMs: 1_000, clock: () => new Date("2026-07-14T12:00:00.000Z") });
  assert.deepEqual(await dispatcher.runOnce(), { acknowledged: 1, claimed: 1, deadLettered: 0, rejected: 0 });
  assert.equal(signal.deliveries[0].eventId, event.eventId);
  assert.equal(outbox.acks[0].receipt.deliveryPurpose, "usage-integrity");
  assert.equal(outbox.acks[0].receipt.idempotencyKey, event.eventId);
  assert.equal(outbox.acks[0].receipt.sink, "otlp-log");
  assert.equal(signal.health.length, 2);
});

test("usage dispatcher retries the same sink deduplication key after export succeeds but acknowledgement fails", async () => {
  const event = recordedEvent();
  const outbox = new FakeOutbox([event], { acknowledgeFailure: true });
  const signal = telemetry();
  const dispatcher = createUsageOutboxDispatcher({ outbox, telemetry: signal, pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100, healthIntervalMs: 1_000, clock: () => new Date("2026-07-14T12:00:00.000Z") });
  assert.equal((await dispatcher.runOnce()).rejected, 1);
  assert.equal((await dispatcher.runOnce()).acknowledged, 1);
  assert.equal(signal.deliveries.length, 2);
  assert.equal(signal.deliveries[0].eventId, signal.deliveries[1].eventId);
  assert.equal(outbox.acks[0].receipt.idempotencyKey, event.eventId);
});

test("tampered usage payloads exhaust retry policy and make dispatcher readiness fail", async () => {
  const event = recordedEvent();
  event.payload.usageEvent.quantity = "2";
  event.payloadSha256 = digest(event.payload);
  const outbox = new FakeOutbox([event], { maxAttempts: 3 });
  const dispatcher = createUsageOutboxDispatcher({ outbox, telemetry: telemetry(), pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100, healthIntervalMs: 1_000, clock: () => new Date("2026-07-14T12:00:00.000Z") });
  await dispatcher.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const status = await dispatcher.readiness();
  assert.equal(status.deadLettered, 1);
  assert.equal(status.ready, false);
  await dispatcher.stop({ timeoutMs: 200 });
});

test("usage dispatcher aborts a timed-out delivery and waits for its loop to unwind", async () => {
  const outbox = new FakeOutbox([recordedEvent()]);
  let inFlight = false;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const signal = telemetry();
  signal.recordUsageOutboxDelivery = async ({ signal: abortSignal }) => {
    inFlight = true;
    markStarted();
    try {
      await new Promise((_, reject) => abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true }));
    } finally {
      inFlight = false;
    }
  };
  const dispatcher = createUsageOutboxDispatcher({ outbox, telemetry: signal, pollIntervalMs: 1_000, retryBaseMs: 10, retryMaxMs: 100 });
  await dispatcher.start();
  await started;
  await assert.rejects(dispatcher.stop({ timeoutMs: 10 }), { code: "OBS_USAGE_DISPATCHER_SHUTDOWN_TIMEOUT" });
  assert.equal(inFlight, false);
  assert.equal(dispatcher.running, false);
});
