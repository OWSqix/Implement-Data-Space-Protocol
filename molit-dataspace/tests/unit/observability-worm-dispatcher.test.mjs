import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../../src/discovery/stable-json.mjs";
import { createLocalTestWormBackend, createWormOutboxDispatcher, ObservabilityError, tenantSecurityOutboxEventToWormEvent, WormAuditExporter } from "../../src/observability/index.mjs";

function caasEvent(sequence = 1) {
  const unsigned = {
    sequence,
    previousDigest: null,
    occurredAt: "2026-07-14T00:00:00.000Z",
    action: "TENANT_REGISTERED",
    actorRole: "admin",
    actorPrincipalId: "urn:molit:operator:test",
    actorClientId: "test-client",
    actorKeyId: "test-key",
    tenantId: "road-data-provider",
  };
  return { ...unsigned, eventDigest: digest(unsigned) };
}

function outboxEvent(auditEvent = caasEvent()) {
  const payload = {
    schemaVersion: "molit.audit-outbox/1",
    sourceComponent: "caas",
    sourceSequence: auditEvent.sequence,
    sourceEventDigest: auditEvent.eventDigest,
    auditEventPayloadSha256: digest(auditEvent),
    auditEvent,
  };
  return {
    aggregateId: auditEvent.eventDigest,
    aggregateKind: "audit",
    attempts: 1,
    component: "caas",
    createdAt: auditEvent.occurredAt,
    eventId: digest({ type: "audit.appended", sequence: auditEvent.sequence }),
    eventType: "audit.appended",
    payload,
    payloadSha256: digest(payload),
    tenantId: auditEvent.tenantId ?? null,
  };
}

function tenantSecurityEvent(sequence = 1) {
  const unsigned = {
    accessMode: "tenant",
    actorId: "urn:molit:user:road-operator",
    actorKind: "user",
    correlationId: "security-correlation-0001",
    decision: "DENY",
    occurredAt: "2026-07-14T00:30:00.000Z",
    previousDigest: null,
    reasonCode: "TENANT_BINDING_MISMATCH",
    requestedTenantId: "tenant-busan-01",
    resourceId: "tenant-busan-01",
    resourceKind: "tenant",
    schemaVersion: "molit.tenant-access-audit/1",
    sequence,
    sessionTenantId: "tenant-seoul-01",
    tenantId: "tenant-seoul-01",
    traceId: "c".repeat(32),
  };
  const auditEvent = { ...unsigned, eventDigest: digest(unsigned) };
  const payload = {
    auditEvent,
    auditEventPayloadSha256: digest(auditEvent),
    schemaVersion: "molit.tenant-access-outbox/1",
  };
  return {
    aggregateId: auditEvent.eventDigest,
    aggregateKind: "tenant-security-audit",
    attempts: 1,
    component: "caas",
    createdAt: auditEvent.occurredAt,
    eventId: digest({ component: "caas", eventDigest: auditEvent.eventDigest, type: "tenant.security.access" }),
    eventType: "tenant.security.access",
    payload,
    payloadSha256: digest(payload),
    tenantId: auditEvent.tenantId,
  };
}

class FakeOutbox {
  constructor(events, { maxAttempts = 3, failFirstAcknowledge = false } = {}) {
    this.events = events.map((event) => ({ ...structuredClone(event), claimed: false, done: false, dead: false }));
    this.maxAttempts = maxAttempts;
    this.failFirstAcknowledge = failFirstAcknowledge;
    this.claimOptions = [];
    this.acks = [];
    this.rejects = [];
  }

  async claim(options) {
    if (this.failNextClaim) {
      this.failNextClaim = false;
      throw new ObservabilityError("OUTBOX_STATE_UNAVAILABLE", "claim failed");
    }
    this.claimOptions.push(options);
    return this.events.filter((event) => !event.claimed && !event.done && !event.dead && options.eventTypes.includes(event.eventType)).slice(0, options.limit).map((event) => {
      event.claimed = true;
      return structuredClone(event);
    });
  }

  async acknowledge(eventId, receipt) {
    if (this.failFirstAcknowledge) {
      this.failFirstAcknowledge = false;
      throw new ObservabilityError("OUTBOX_STATE_UNAVAILABLE", "simulated acknowledgement failure");
    }
    const event = this.events.find((item) => item.eventId === eventId);
    event.done = true;
    event.claimed = false;
    this.acks.push({ eventId, receipt });
    return { eventId };
  }

  async reject(eventId, code, options) {
    const event = this.events.find((item) => item.eventId === eventId);
    event.claimed = false;
    event.attempts += 1;
    event.dead = event.attempts >= this.maxAttempts;
    this.rejects.push({ code, eventId, options });
    return { deadLettered: event.dead, eventId };
  }

  async readiness(options) {
    const relevant = this.events.filter((event) => options.eventTypes.includes(event.eventType));
    return { deadLettered: relevant.filter((event) => event.dead).length, pending: relevant.filter((event) => !event.done && !event.dead).length, ready: !relevant.some((event) => event.dead) };
  }
}

test("an infrastructure claim error clears after a successful empty recovery cycle", async () => {
  const outbox = new FakeOutbox([]);
  outbox.failNextClaim = true;
  const dispatcher = createWormOutboxDispatcher({ outbox, exporter: exporter(), pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100 });
  await assert.rejects(dispatcher.runOnce(), { code: "OUTBOX_STATE_UNAVAILABLE" });
  dispatcher.running = true;
  assert.equal((await dispatcher.readiness()).ready, false);
  assert.deepEqual(await dispatcher.runOnce(), { acknowledged: 0, claimed: 0, rejected: 0 });
  assert.equal((await dispatcher.readiness()).ready, true);
  dispatcher.running = false;
});

function exporter() {
  const backend = createLocalTestWormBackend({ environment: "test" });
  return new WormAuditExporter({ backend, environment: "test", clock: () => new Date("2026-07-14T01:00:00.000Z") });
}

test("dispatcher claims state and tenant security audits and acknowledges typed WORM receipts", async () => {
  const securityEvent = tenantSecurityEvent();
  const outbox = new FakeOutbox([outboxEvent(), securityEvent]);
  const dispatcher = createWormOutboxDispatcher({ outbox, exporter: exporter(), pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100 });
  assert.deepEqual(await dispatcher.runOnce(), { acknowledged: 2, claimed: 2, rejected: 0 });
  assert.deepEqual(outbox.claimOptions[0].eventTypes, ["audit.appended", "tenant.security.access"]);
  assert.equal(outbox.acks[0].receipt.schemaVersion, "molit.audit-publish-receipt/1");
  assert.equal(outbox.acks[0].receipt.wormReceipt.sequence, 1);
  assert.equal(outbox.acks[0].receipt.replayed, false);
  assert.equal(outbox.acks[1].receipt.schemaVersion, "molit.security-audit-publish-receipt/1");
  assert.equal(outbox.acks[1].receipt.sourceEventDigest, securityEvent.payload.auditEvent.eventDigest);
  assert.equal(outbox.acks[1].receipt.wormReceipt.sequence, 2);
  const wormEvent = tenantSecurityOutboxEventToWormEvent(securityEvent);
  assert.equal(wormEvent.type, "tenant.security.access");
  assert.equal(wormEvent.subject.requestedTenantId, "tenant-busan-01");
  assert.equal(wormEvent.data.auditEvent.decision, "DENY");
});

test("append completed before acknowledgement is recovered without a second WORM record", async () => {
  const outbox = new FakeOutbox([outboxEvent()], { failFirstAcknowledge: true });
  const dispatcher = createWormOutboxDispatcher({ outbox, exporter: exporter(), pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100 });
  assert.deepEqual(await dispatcher.runOnce(), { acknowledged: 0, claimed: 1, rejected: 1 });
  assert.deepEqual(await dispatcher.runOnce(), { acknowledged: 1, claimed: 1, rejected: 0 });
  assert.equal(outbox.acks[0].receipt.replayed, true);
  assert.equal(outbox.acks[0].receipt.wormReceipt.sequence, 1);
});

test("temporary errors retry and invalid payload eventually dead-letters", async () => {
  const temporaryOutbox = new FakeOutbox([outboxEvent()]);
  const operationalExporter = exporter();
  await operationalExporter.initialize();
  let calls = 0;
  const flaky = { async initialize() {}, async append(...args) { calls += 1; if (calls === 1) throw new ObservabilityError("OBS_WORM_UNAVAILABLE", "temporary"); return operationalExporter.append(...args); } };
  const retrying = createWormOutboxDispatcher({ outbox: temporaryOutbox, exporter: flaky, pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100 });
  assert.equal((await retrying.runOnce()).rejected, 1);
  retrying.running = true;
  const unavailable = await retrying.readiness();
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.lastError.code, "OBS_WORM_UNAVAILABLE");
  assert.equal((await retrying.runOnce()).acknowledged, 1);
  assert.equal((await retrying.readiness()).ready, true);
  retrying.running = false;
  assert.equal(temporaryOutbox.rejects[0].code, "OBS_WORM_UNAVAILABLE");

  const invalid = outboxEvent();
  invalid.payload.auditEventPayloadSha256 = "0".repeat(64);
  invalid.payloadSha256 = digest(invalid.payload);
  const deadLetterOutbox = new FakeOutbox([invalid], { maxAttempts: 2 });
  const dispatcher = createWormOutboxDispatcher({ outbox: deadLetterOutbox, exporter: exporter(), pollIntervalMs: 10, retryBaseMs: 10, retryMaxMs: 100 });
  await dispatcher.runOnce();
  await dispatcher.runOnce();
  assert.equal((await dispatcher.readiness()).deadLettered, 1);
  assert.equal((await dispatcher.readiness()).ready, false);
});

test("stop wakes an idle poll and drains an in-flight append before the deadline", async () => {
  const outbox = new FakeOutbox([outboxEvent()]);
  const operationalExporter = exporter();
  await operationalExporter.initialize();
  let appendStarted;
  const started = new Promise((resolve) => { appendStarted = resolve; });
  const slow = { async initialize() {}, async append(event, options) { appendStarted(); await new Promise((resolve) => setTimeout(resolve, 30)); return operationalExporter.append(event, options); } };
  const dispatcher = createWormOutboxDispatcher({ outbox, exporter: slow, pollIntervalMs: 1_000, retryBaseMs: 10, retryMaxMs: 100 });
  await dispatcher.start();
  await started;
  await dispatcher.stop({ timeoutMs: 200 });
  assert.equal(outbox.acks.length, 1);
  assert.equal(dispatcher.running, false);
});

test("WORM dispatcher aborts a timed-out append and waits for its loop to unwind", async () => {
  const outbox = new FakeOutbox([outboxEvent()]);
  let inFlight = false;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const exporter = {
    async initialize() {},
    async append(_event, { signal }) {
      inFlight = true;
      markStarted();
      try {
        await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      } finally {
        inFlight = false;
      }
    },
  };
  const dispatcher = createWormOutboxDispatcher({ outbox, exporter, pollIntervalMs: 1_000, retryBaseMs: 10, retryMaxMs: 100 });
  await dispatcher.start();
  await started;
  await assert.rejects(dispatcher.stop({ timeoutMs: 10 }), { code: "OBS_DISPATCHER_SHUTDOWN_TIMEOUT" });
  assert.equal(inFlight, false);
  assert.equal(dispatcher.running, false);
});
