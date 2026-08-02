import { randomUUID } from "node:crypto";
import { assertObservability, ObservabilityError } from "./errors.mjs";
import { redact } from "./redaction.mjs";
import { canonicalJson, sha256 } from "./stable-json.mjs";

const REQUIRED_CAPABILITIES = Object.freeze(["appendOnly", "conditionalAppend", "immutableUntilRetention", "readAfterWrite", "retentionEnforced"]);
const EVENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/u;

function withoutDigest(receipt) {
  const { receiptDigest: ignored, ...body } = receipt;
  return body;
}

function validateReceipt(receipt, record, expectedHead) {
  assertObservability(receipt?.schemaVersion === "molit.worm-receipt/1", "OBS_WORM_RECEIPT_INVALID", "WORM receipt schema is invalid");
  assertObservability(receipt.eventId === record.eventId && receipt.contentDigest === record.contentDigest, "OBS_WORM_RECEIPT_MISMATCH", "WORM receipt does not identify the appended event");
  assertObservability(receipt.retentionUntil === record.retentionUntil, "OBS_WORM_RETENTION_MISMATCH", "WORM backend changed the required retention boundary");
  assertObservability(receipt.sequence === expectedHead.sequence + 1 && receipt.previousReceiptDigest === expectedHead.receiptDigest, "OBS_WORM_CHAIN_BROKEN", "WORM receipt did not extend the current append-only head");
  assertObservability(receipt.receiptDigest === sha256(withoutDigest(receipt)), "OBS_WORM_RECEIPT_TAMPERED", "WORM receipt digest is invalid");
}

function validateStoredReceipt(receipt, record, backendId) {
  assertObservability(receipt?.schemaVersion === "molit.worm-receipt/1" && receipt.backendId === backendId, "OBS_WORM_RECEIPT_INVALID", "stored WORM receipt identity is invalid");
  assertObservability(receipt.eventId === record.eventId && receipt.contentDigest === record.contentDigest && receipt.retentionUntil === record.retentionUntil, "OBS_WORM_RECEIPT_MISMATCH", "stored WORM receipt does not identify the event");
  assertObservability(Number.isSafeInteger(receipt.sequence) && receipt.sequence >= 1 && /^[0-9a-f]{64}$/u.test(receipt.previousReceiptDigest), "OBS_WORM_CHAIN_BROKEN", "stored WORM receipt chain fields are invalid");
  assertObservability(receipt.receiptDigest === sha256(withoutDigest(receipt)), "OBS_WORM_RECEIPT_TAMPERED", "stored WORM receipt digest is invalid");
}

function validateRecord(record) {
  assertObservability(record?.schemaVersion === "molit.audit-record/1" && EVENT_ID.test(record.eventId), "OBS_AUDIT_RECORD_INVALID", "audit record identity is invalid");
  assertObservability(Number.isFinite(Date.parse(record.occurredAt)) && Number.isFinite(Date.parse(record.committedAt)) && Number.isFinite(Date.parse(record.retentionUntil)), "OBS_AUDIT_TIME_INVALID", "audit record timestamps are invalid");
  assertObservability(record.contentDigest === sha256({ ...record, contentDigest: undefined }), "OBS_AUDIT_CONTENT_TAMPERED", "audit record content digest is invalid");
}

export class WormAuditExporter {
  constructor({ backend, retentionDays = 365, clock = () => new Date(), minimumRetentionDays = 90, readinessMaxAgeMs = 60_000, environment = "production" }) {
    assertObservability(backend?.mode === "operational" || (backend?.mode === "local-test" && environment === "test"), "OBS_WORM_OPERATIONAL_REQUIRED", "production audit export requires an operational WORM backend");
    assertObservability(Number.isInteger(retentionDays) && retentionDays >= minimumRetentionDays, "OBS_WORM_RETENTION_TOO_SHORT", `audit retention must be at least ${minimumRetentionDays} days`);
    assertObservability(Number.isSafeInteger(readinessMaxAgeMs) && readinessMaxAgeMs >= 1_000 && readinessMaxAgeMs <= 300_000, "OBS_WORM_READINESS_INVALID", "WORM readiness age is invalid");
    this.backend = backend;
    this.retentionDays = retentionDays;
    this.clock = clock;
    this.readinessMaxAgeMs = readinessMaxAgeMs;
    this.initialized = false;
    this.lastFailure = null;
    this.lastSuccessAt = null;
    this.probePromise = null;
  }

  readiness() {
    const ageMs = this.lastSuccessAt ? Math.max(0, this.clock().getTime() - Date.parse(this.lastSuccessAt)) : null;
    const ready = this.initialized && this.lastFailure === null && ageMs !== null && ageMs <= this.readinessMaxAgeMs;
    return Object.freeze({ ready, status: ready ? "READY" : "NOT_READY", backendId: this.backendId ?? null, lastSuccessAt: this.lastSuccessAt, lastFailure: this.lastFailure, ageMs, maxAgeMs: this.readinessMaxAgeMs });
  }

  async initialize({ signal, force = false } = {}) {
    if (!force && this.readiness().ready) return this.readiness();
    if (this.probePromise) return this.probePromise;
    this.probePromise = (async () => {
      try {
        const capabilities = await this.backend.capabilities({ signal });
        for (const name of REQUIRED_CAPABILITIES) assertObservability(capabilities?.[name] === true, "OBS_WORM_CAPABILITY_MISSING", `WORM backend does not attest ${name}`);
        assertObservability(typeof capabilities.backendId === "string" && capabilities.backendId.length > 0, "OBS_WORM_BACKEND_ID_REQUIRED", "WORM backend identity is required");
        assertObservability(!this.backendId || this.backendId === capabilities.backendId, "OBS_WORM_BACKEND_MISMATCH", "WORM backend identity changed during operation");
        this.backendId = capabilities.backendId;
        this.initialized = true;
        this.lastSuccessAt = this.clock().toISOString();
        this.lastFailure = null;
        return this.readiness();
      } catch (error) {
        this.lastFailure = Object.freeze({ at: this.clock().toISOString(), code: error?.code ?? "OBS_WORM_UNAVAILABLE" });
        throw error;
      } finally {
        this.probePromise = null;
      }
    })();
    return this.probePromise;
  }

  async probeReadiness({ signal } = {}) {
    if (!this.readiness().ready) {
      try { await this.initialize({ signal, force: true }); } catch {}
    }
    return this.readiness();
  }

  async append(event, { signal } = {}) {
    assertObservability(this.initialized, "OBS_WORM_NOT_INITIALIZED", "WORM exporter must verify backend capabilities before use");
    const now = this.clock();
    assertObservability(now instanceof Date && Number.isFinite(now.valueOf()), "OBS_CLOCK_INVALID", "audit clock is invalid");
    const eventId = event?.eventId ?? randomUUID();
    assertObservability(EVENT_ID.test(eventId), "OBS_AUDIT_EVENT_ID_INVALID", "audit event identifier is invalid");
    assertObservability(typeof event?.type === "string" && /^[a-z][a-z0-9._-]{2,127}$/u.test(event.type), "OBS_AUDIT_TYPE_INVALID", "audit event type is invalid");
    assertObservability(event?.occurredAt === undefined || Number.isFinite(Date.parse(event.occurredAt)), "OBS_AUDIT_TIME_INVALID", "audit occurrence time is invalid");
    const stableBody = {
      schemaVersion: "molit.audit-record/1",
      eventId,
      occurredAt: event.occurredAt ?? now.toISOString(),
      type: event.type,
      traceId: event.traceId,
      actor: redact(event.actor ?? {}),
      subject: redact(event.subject ?? {}),
      data: redact(event.data ?? {}),
    };
    const existing = await this.backend.get(eventId, { signal });
    if (existing !== undefined) {
      validateRecord(existing);
      const existingStable = Object.fromEntries(Object.keys(stableBody).map((key) => [key, existing[key]]));
      assertObservability(canonicalJson(existingStable) === canonicalJson(stableBody), "OBS_WORM_DUPLICATE_CONFLICT", "audit event identifier is already bound to different content", { status: 409 });
      assertObservability(Date.parse(existing.retentionUntil) === Date.parse(existing.committedAt) + this.retentionDays * 86_400_000, "OBS_WORM_RETENTION_MISMATCH", "existing WORM record does not preserve the required retention interval");
      const receipt = await this.backend.receipt(eventId, { signal });
      assertObservability(receipt !== undefined, "OBS_WORM_RECEIPT_MISSING", "existing WORM record has no receipt");
      validateStoredReceipt(receipt, existing, this.backendId);
      return Object.freeze({ record: Object.freeze(existing), receipt: Object.freeze(receipt), replayed: true });
    }
    const committedAt = now.toISOString();
    const retentionUntil = new Date(now.valueOf() + this.retentionDays * 86_400_000).toISOString();
    const body = { ...stableBody, committedAt, retentionUntil };
    const record = Object.freeze({ ...body, contentDigest: sha256(body) });
    const expectedHead = await this.backend.head({ signal });
    assertObservability(Number.isSafeInteger(expectedHead?.sequence) && expectedHead.sequence >= 0 && typeof expectedHead.receiptDigest === "string", "OBS_WORM_HEAD_INVALID", "WORM backend head is invalid");
    const receipt = await this.backend.append(record, { expectedHead, signal });
    validateReceipt(receipt, record, expectedHead);
    assertObservability(receipt.backendId === this.backendId, "OBS_WORM_BACKEND_MISMATCH", "WORM receipt came from a different backend");
    const persisted = await this.backend.get(eventId, { signal });
    assertObservability(persisted !== undefined, "OBS_WORM_READ_AFTER_WRITE_FAILED", "WORM event was not readable after append");
    validateRecord(persisted);
    assertObservability(canonicalJson(persisted) === canonicalJson(record), "OBS_WORM_READBACK_MISMATCH", "WORM read-back does not match appended content");
    return Object.freeze({ record, receipt: Object.freeze(receipt), replayed: false });
  }

  async verifyReceipt(receipt, { signal } = {}) {
    assertObservability(this.initialized, "OBS_WORM_NOT_INITIALIZED", "WORM exporter must verify backend capabilities before use");
    assertObservability(receipt?.backendId === this.backendId && receipt.receiptDigest === sha256(withoutDigest(receipt)), "OBS_WORM_RECEIPT_TAMPERED", "WORM receipt is invalid");
    const record = await this.backend.get(receipt.eventId, { signal });
    assertObservability(record !== undefined, "OBS_WORM_RECORD_DELETED", "retained WORM record is missing");
    validateRecord(record);
    assertObservability(record.contentDigest === receipt.contentDigest && record.retentionUntil === receipt.retentionUntil, "OBS_WORM_RECORD_TAMPERED", "retained WORM record does not match its receipt");
    return true;
  }
}

export function createLocalTestWormBackend({ environment, backendId = "local-test-worm" } = {}) {
  assertObservability(environment === "test", "OBS_LOCAL_SINK_FORBIDDEN", "local WORM backend is allowed only in an explicit test environment");
  const records = new Map();
  const receipts = [];
  const backend = {
    mode: "local-test",
    storageClass: "local-test",
    async capabilities() {
      return { backendId, appendOnly: true, conditionalAppend: true, immutableUntilRetention: true, readAfterWrite: true, retentionEnforced: true };
    },
    async head() {
      const last = receipts.at(-1);
      return { sequence: last?.sequence ?? 0, receiptDigest: last?.receiptDigest ?? "0".repeat(64) };
    },
    async append(record, { expectedHead }) {
      validateRecord(record);
      assertObservability(!records.has(record.eventId), "OBS_WORM_DUPLICATE", "audit event identifier already exists", { status: 409 });
      const current = await backend.head();
      assertObservability(canonicalJson(current) === canonicalJson(expectedHead), "OBS_WORM_CONFLICT", "WORM head changed before append", { status: 409 });
      const body = { schemaVersion: "molit.worm-receipt/1", backendId, eventId: record.eventId, contentDigest: record.contentDigest, sequence: current.sequence + 1, previousReceiptDigest: current.receiptDigest, retentionUntil: record.retentionUntil, storedAt: new Date().toISOString() };
      const receipt = Object.freeze({ ...body, receiptDigest: sha256(body) });
      records.set(record.eventId, structuredClone(record));
      receipts.push(receipt);
      return structuredClone(receipt);
    },
    async get(eventId) { return records.has(eventId) ? structuredClone(records.get(eventId)) : undefined; },
    async receipt(eventId) { const value = receipts.find((item) => item.eventId === eventId); return value ? structuredClone(value) : undefined; },
    testOnlyTamper(eventId, mutate) { records.set(eventId, mutate(structuredClone(records.get(eventId)))); },
    testOnlyDelete(eventId) { records.delete(eventId); },
  };
  return Object.freeze(backend);
}

async function readJsonResponse(response, maxBytes = 256 * 1024) {
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ObservabilityError("OBS_WORM_RESPONSE_TOO_LARGE", "WORM response exceeded its byte limit");
      }
      chunks.push(Buffer.from(value));
    }
  }
  const bytes = Buffer.concat(chunks);
  try { return JSON.parse(bytes.toString("utf8")); } catch (error) { throw new ObservabilityError("OBS_WORM_RESPONSE_INVALID", "WORM response was not valid JSON", { cause: error }); }
}

export class HttpWormBackend {
  constructor({ baseUrl, authorization, dispatcher, timeoutMs = 5_000, fetchImpl = fetch }) {
    const url = new URL(baseUrl);
    assertObservability(url.protocol === "https:" && url.pathname.endsWith("/") && !url.username && !url.password && !url.search && !url.hash, "OBS_WORM_URL_INVALID", "operational WORM URL must be an uncredentialed HTTPS base URL");
    this.mode = "operational";
    this.storageClass = "remote-worm";
    this.baseUrl = url;
    this.authorization = authorization;
    this.dispatcher = dispatcher;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async #request(path, { method = "GET", body, signal } = {}) {
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    const token = await this.authorization?.({ signal: combined });
    assertObservability(!token || (typeof token === "string" && !/[\r\n]/u.test(token)), "OBS_WORM_AUTH_INVALID", "WORM authorization value is invalid");
    let response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), { method, headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: combined, ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}) });
    } catch (error) {
      throw new ObservabilityError("OBS_WORM_UNAVAILABLE", "WORM backend request failed", { cause: error });
    }
    assertObservability(response.status >= 200 && response.status < 300, response.status === 409 ? "OBS_WORM_CONFLICT" : "OBS_WORM_REJECTED", `WORM backend returned HTTP ${response.status}`);
    assertObservability(/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""), "OBS_WORM_RESPONSE_INVALID", "WORM backend response must be application/json");
    return readJsonResponse(response);
  }

  capabilities(options) { return this.#request("v1/capabilities", options); }
  head(options) { return this.#request("v1/head", options); }
  append(record, { expectedHead, signal } = {}) { return this.#request("v1/records", { method: "POST", body: { record, expectedHead }, signal }); }
  receipt(eventId, options) {
    assertObservability(EVENT_ID.test(eventId), "OBS_AUDIT_EVENT_ID_INVALID", "audit event identifier is invalid");
    return this.#request(`v1/receipts/${encodeURIComponent(eventId)}`, options);
  }
  async get(eventId, options) {
    assertObservability(EVENT_ID.test(eventId), "OBS_AUDIT_EVENT_ID_INVALID", "audit event identifier is invalid");
    try { return await this.#request(`v1/records/${encodeURIComponent(eventId)}`, options); } catch (error) {
      if (error.code === "OBS_WORM_REJECTED" && /HTTP 404/u.test(error.message)) return undefined;
      throw error;
    }
  }
}
