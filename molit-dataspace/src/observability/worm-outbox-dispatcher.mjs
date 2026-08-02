import { digest } from "../discovery/stable-json.mjs";
import { assertObservability, ObservabilityError } from "./errors.mjs";

const DIGEST = /^[0-9a-f]{64}$/u;
const TRACE_ID = /^[0-9a-f]{32}$/u;
const TENANT_ID = /^[a-z][a-z0-9-]{2,62}$/u;
export const WORM_OUTBOX_EVENT_TYPES = Object.freeze(["audit.appended", "tenant.security.access"]);

function abortError(signal) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error ? signal.reason : new ObservabilityError("OBS_DISPATCHER_ABORTED", "WORM outbox dispatcher was aborted");
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
  const value = typeof error?.code === "string" ? error.code.toUpperCase().replaceAll(/[^A-Z0-9_:-]/gu, "_") : "OBS_WORM_EXPORT_FAILED";
  return /^[A-Z][A-Z0-9_:-]{0,63}$/u.test(value) ? value : "OBS_WORM_EXPORT_FAILED";
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

export function auditOutboxEventToWormEvent(event) {
  assertObservability(event?.eventType === "audit.appended", "OBS_OUTBOX_EVENT_TYPE_INVALID", "dispatcher accepts only audit.appended events");
  assertObservability(event.payloadSha256 === digest(event.payload), "OBS_OUTBOX_PAYLOAD_TAMPERED", "outbox payload digest does not match its content");
  const payload = event.payload;
  assertObservability(payload?.schemaVersion === "molit.audit-outbox/1" && ["caas", "dsaas"].includes(payload.sourceComponent), "OBS_OUTBOX_PAYLOAD_INVALID", "audit outbox payload contract is invalid");
  assertObservability(payload.sourceComponent === event.component, "OBS_OUTBOX_COMPONENT_MISMATCH", "audit outbox source component does not match the claimed component");
  assertObservability(Number.isSafeInteger(payload.sourceSequence) && payload.sourceSequence >= 1 && payload.sourceSequence === payload.auditEvent?.sequence, "OBS_OUTBOX_SEQUENCE_MISMATCH", "audit outbox sequence does not match the source event");
  assertObservability(DIGEST.test(payload.sourceEventDigest) && DIGEST.test(payload.auditEventPayloadSha256), "OBS_OUTBOX_DIGEST_INVALID", "audit outbox digest is invalid");
  assertObservability(payload.auditEventPayloadSha256 === digest(payload.auditEvent), "OBS_OUTBOX_EVENT_TAMPERED", "full audit event digest does not match its outbox binding");
  const chainDigest = payload.sourceComponent === "caas" ? payload.auditEvent.eventDigest : payload.auditEvent.hash;
  assertObservability(payload.sourceEventDigest === chainDigest, "OBS_OUTBOX_CHAIN_BINDING_MISMATCH", "source audit chain digest does not match the full event");
  const occurredAt = payload.sourceComponent === "caas" ? payload.auditEvent.occurredAt : payload.auditEvent.at;
  assertObservability(Number.isFinite(Date.parse(occurredAt)), "OBS_OUTBOX_TIME_INVALID", "source audit occurrence time is invalid");
  const traceId = TRACE_ID.test(payload.auditEvent.traceId) ? payload.auditEvent.traceId : undefined;
  return Object.freeze({
    eventId: event.eventId,
    type: `${payload.sourceComponent}.audit`,
    occurredAt,
    ...(traceId ? { traceId } : {}),
    actor: compact({
      component: payload.sourceComponent,
      actor: payload.auditEvent.actor,
      role: payload.auditEvent.actorRole ?? payload.auditEvent.actorUsedRole,
      principalId: payload.auditEvent.actorPrincipalId,
      clientId: payload.auditEvent.actorClientId,
      keyId: payload.auditEvent.actorKeyId,
    }),
    subject: compact({
      aggregateId: event.aggregateId,
      aggregateKind: event.aggregateKind,
      sourceSequence: payload.sourceSequence,
      tenantId: event.tenantId,
    }),
    data: {
      auditEvent: payload.auditEvent,
      auditEventPayloadSha256: payload.auditEventPayloadSha256,
      sourceEventDigest: payload.sourceEventDigest,
    },
  });
}

export function tenantSecurityOutboxEventToWormEvent(event) {
  assertObservability(event?.eventType === "tenant.security.access", "OBS_OUTBOX_EVENT_TYPE_INVALID", "security audit transformer accepts only tenant.security.access events");
  assertObservability(event.payloadSha256 === digest(event.payload), "OBS_OUTBOX_PAYLOAD_TAMPERED", "security audit outbox payload digest does not match its content");
  const payload = event.payload;
  const auditEvent = payload?.auditEvent;
  assertObservability(payload?.schemaVersion === "molit.tenant-access-outbox/1" && auditEvent?.schemaVersion === "molit.tenant-access-audit/1",
    "OBS_OUTBOX_PAYLOAD_INVALID", "tenant security audit outbox payload contract is invalid");
  assertObservability(DIGEST.test(payload.auditEventPayloadSha256) && payload.auditEventPayloadSha256 === digest(auditEvent),
    "OBS_OUTBOX_EVENT_TAMPERED", "tenant security audit event digest does not match its outbox binding");
  const { eventDigest, ...unsigned } = auditEvent;
  assertObservability(DIGEST.test(eventDigest) && eventDigest === digest(unsigned), "OBS_OUTBOX_CHAIN_BINDING_MISMATCH", "tenant security audit chain digest is invalid");
  assertObservability(event.eventId === digest({ component: event.component, eventDigest, type: "tenant.security.access" }),
    "OBS_OUTBOX_EVENT_ID_MISMATCH", "tenant security audit outbox identifier is not bound to its source event");
  assertObservability((auditEvent.previousDigest === null || DIGEST.test(auditEvent.previousDigest))
    && Number.isSafeInteger(auditEvent.sequence) && auditEvent.sequence >= 1,
  "OBS_OUTBOX_SEQUENCE_MISMATCH", "tenant security audit chain fields are invalid");
  assertObservability(event.aggregateKind === "tenant-security-audit" && event.aggregateId === eventDigest,
    "OBS_OUTBOX_AGGREGATE_MISMATCH", "tenant security audit aggregate does not match its source event");
  assertObservability(TENANT_ID.test(event.tenantId ?? "") && auditEvent.tenantId === event.tenantId && auditEvent.sessionTenantId === event.tenantId,
    "OBS_OUTBOX_TENANT_MISMATCH", "tenant security audit binding does not match the claimed tenant");
  assertObservability(TENANT_ID.test(auditEvent.requestedTenantId ?? "") && ["PERMIT", "DENY"].includes(auditEvent.decision)
    && ["tenant", "service", "break-glass"].includes(auditEvent.accessMode),
  "OBS_OUTBOX_SECURITY_DECISION_INVALID", "tenant security audit access decision is invalid");
  assertObservability(typeof auditEvent.actorId === "string" && auditEvent.actorId.length >= 3
    && ["user", "service", "workload", "operator"].includes(auditEvent.actorKind)
    && typeof auditEvent.resourceKind === "string" && auditEvent.resourceKind.length >= 2
    && typeof auditEvent.resourceId === "string" && auditEvent.resourceId.length >= 2,
  "OBS_OUTBOX_SECURITY_SUBJECT_INVALID", "tenant security audit actor or resource identity is invalid");
  assertObservability(Number.isFinite(Date.parse(auditEvent.occurredAt)) && TRACE_ID.test(auditEvent.traceId),
    "OBS_OUTBOX_TIME_INVALID", "tenant security audit occurrence time or trace is invalid");
  return Object.freeze({
    eventId: event.eventId,
    type: "tenant.security.access",
    occurredAt: auditEvent.occurredAt,
    traceId: auditEvent.traceId,
    actor: {
      component: event.component,
      actorId: auditEvent.actorId,
      actorKind: auditEvent.actorKind,
    },
    subject: {
      accessMode: auditEvent.accessMode,
      aggregateId: event.aggregateId,
      aggregateKind: event.aggregateKind,
      requestedTenantId: auditEvent.requestedTenantId,
      resourceId: auditEvent.resourceId,
      resourceKind: auditEvent.resourceKind,
      sequence: auditEvent.sequence,
      tenantId: event.tenantId,
    },
    data: {
      auditEvent,
      auditEventPayloadSha256: payload.auditEventPayloadSha256,
      sourceEventDigest: eventDigest,
    },
  });
}

function outboxEventToWormEvent(event) {
  if (event?.eventType === "audit.appended") return auditOutboxEventToWormEvent(event);
  if (event?.eventType === "tenant.security.access") return tenantSecurityOutboxEventToWormEvent(event);
  throw new ObservabilityError("OBS_OUTBOX_EVENT_TYPE_INVALID", "dispatcher received an event outside the WORM audit contract");
}

export class WormOutboxDispatcher {
  constructor({ outbox, exporter, batchSize = 50, leaseMs = 30_000, pollIntervalMs = 1_000, retryBaseMs = 1_000, retryMaxMs = 300_000 }) {
    assertObservability(outbox?.claim && outbox?.acknowledge && outbox?.reject && outbox?.readiness, "OBS_DISPATCHER_OUTBOX_INVALID", "dispatcher requires a PostgresOutbox-compatible instance");
    assertObservability(exporter?.initialize && exporter?.append, "OBS_DISPATCHER_EXPORTER_INVALID", "dispatcher requires a WormAuditExporter-compatible instance");
    assertObservability(Number.isSafeInteger(batchSize) && batchSize >= 1 && batchSize <= 500, "OBS_DISPATCHER_CONFIG_INVALID", "dispatcher batch size is invalid");
    assertObservability(Number.isSafeInteger(leaseMs) && leaseMs >= 1_000 && leaseMs <= 900_000, "OBS_DISPATCHER_CONFIG_INVALID", "dispatcher lease is invalid");
    assertObservability(Number.isSafeInteger(pollIntervalMs) && pollIntervalMs >= 10 && pollIntervalMs <= 60_000, "OBS_DISPATCHER_CONFIG_INVALID", "dispatcher poll interval is invalid");
    assertObservability(Number.isSafeInteger(retryBaseMs) && retryBaseMs >= 10 && retryBaseMs <= retryMaxMs && retryMaxMs <= 86_400_000, "OBS_DISPATCHER_CONFIG_INVALID", "dispatcher retry policy is invalid");
    Object.assign(this, { outbox, exporter, batchSize, leaseMs, pollIntervalMs, retryBaseMs, retryMaxMs });
    this.initialized = false;
    this.running = false;
    this.stopping = false;
    this.lastError = null;
    this.lastSuccessAt = null;
  }

  async initialize({ signal } = {}) {
    if (this.initialized) return;
    await this.exporter.initialize({ signal });
    this.initialized = true;
  }

  #retryDelay(attempts) {
    return Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.min(20, Math.max(0, attempts - 1)));
  }

  async #reject(event, error, signal) {
    return this.outbox.reject(event.eventId, errorCode(error), { delayMs: this.#retryDelay(event.attempts), signal });
  }

  async runOnce({ signal } = {}) {
    await this.initialize({ signal });
    throwIfAborted(signal);
    let events;
    try {
      events = await this.outbox.claim({ limit: this.batchSize, leaseMs: this.leaseMs, eventTypes: WORM_OUTBOX_EVENT_TYPES, signal });
      if (this.lastError?.scope === "infrastructure") this.lastError = null;
    } catch (error) {
      this.lastError = Object.freeze({ at: new Date().toISOString(), code: errorCode(error), scope: "infrastructure" });
      throw error;
    }
    let acknowledged = 0;
    let rejected = 0;
    for (const event of events) {
      throwIfAborted(signal);
      try {
        const wormEvent = outboxEventToWormEvent(event);
        const result = await this.exporter.append(wormEvent, { signal });
        const securityAudit = event.eventType === "tenant.security.access";
        await this.outbox.acknowledge(event.eventId, {
          schemaVersion: securityAudit ? "molit.security-audit-publish-receipt/1" : "molit.audit-publish-receipt/1",
          contentDigest: result.record.contentDigest,
          sourceEventDigest: securityAudit ? event.payload.auditEvent.eventDigest : event.payload.sourceEventDigest,
          sourceEventType: event.eventType,
          replayed: result.replayed,
          wormReceipt: result.receipt,
        }, { signal });
        acknowledged += 1;
        this.lastSuccessAt = new Date().toISOString();
        this.lastError = null;
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        await this.#reject(event, error, signal);
        rejected += 1;
        this.lastError = Object.freeze({ at: new Date().toISOString(), code: errorCode(error), scope: "delivery" });
      }
    }
    return Object.freeze({ acknowledged, claimed: events.length, rejected });
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
        this.lastError = Object.freeze({ at: new Date().toISOString(), code: errorCode(error), scope: "infrastructure" });
        this.pollController = new AbortController();
        await wait(this.pollIntervalMs, this.pollController.signal).catch(() => {});
        this.pollController = null;
      }
    }
  }

  async start() {
    if (this.running) return;
    assertObservability(!this.stopping, "OBS_DISPATCHER_STOPPING", "dispatcher cannot restart while stopping");
    await this.initialize();
    this.running = true;
    this.loopPromise = this.#loop().finally(() => { this.running = false; });
  }

  async readiness({ signal } = {}) {
    const outbox = await this.outbox.readiness({ eventTypes: WORM_OUTBOX_EVENT_TYPES, signal });
    return Object.freeze({
      ...outbox,
      initialized: this.initialized,
      running: this.running,
      stopping: this.stopping,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt,
      ready: this.initialized && this.running && !this.stopping && this.lastError === null && outbox.ready === true,
    });
  }

  async stop({ timeoutMs = 30_000 } = {}) {
    if (!this.running) return;
    if (this.stopping) return this.stopPromise;
    assertObservability(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 120_000, "OBS_DISPATCHER_CONFIG_INVALID", "dispatcher shutdown timeout is invalid");
    this.stopping = true;
    this.pollController?.abort(new ObservabilityError("OBS_DISPATCHER_STOPPING", "WORM outbox dispatcher is stopping"));
    this.stopPromise = (async () => {
      let timer;
      const result = await Promise.race([
        this.loopPromise.then(() => "stopped"),
        new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); }),
      ]);
      clearTimeout(timer);
      if (result === "timeout") {
        this.operationController?.abort(new ObservabilityError("OBS_DISPATCHER_SHUTDOWN_TIMEOUT", "WORM outbox dispatcher exceeded its shutdown deadline"));
        await this.loopPromise;
      }
      this.stopping = false;
      assertObservability(result === "stopped", "OBS_DISPATCHER_SHUTDOWN_TIMEOUT", "WORM outbox dispatcher did not stop before its deadline");
    })();
    return this.stopPromise;
  }
}

export function createWormOutboxDispatcher(options) {
  return new WormOutboxDispatcher(options);
}
