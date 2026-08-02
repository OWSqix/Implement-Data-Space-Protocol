import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";

import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { digest } from "../discovery/stable-json.mjs";
import { componentStateRoot, scopedStateDigest } from "./scoped-cutover.mjs";

const COMPONENTS = new Set(["caas", "dsaas"]);
const TENANT_ID = /^[a-z][a-z0-9-]{2,62}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PLATFORM_TENANT_ID = "molit-platform";
const MIGRATION_COMPONENT = "postgres-scoped-control-store";
const MIGRATION_VERSION = 4;

const DEFAULT_CODES = Object.freeze({
  aborted: "SCOPED_STORE_ABORTED",
  capacity: "SCOPED_STORE_CAPACITY",
  closed: "SCOPED_STORE_CLOSED",
  commitUnknown: "SCOPED_STORE_COMMIT_UNKNOWN",
  conflict: "SCOPED_STORE_CONFLICT",
  fenceLost: "SCOPED_STORE_FENCE_LOST",
  invalid: "SCOPED_STORE_INVALID",
  migration: "SCOPED_STORE_MIGRATION_REQUIRED",
  missing: "SCOPED_STORE_SCOPE_MISSING",
  resourceLocked: "SCOPED_STORE_RESOURCE_LOCKED",
  timeout: "SCOPED_STORE_TIMEOUT",
  tooLarge: "SCOPED_STORE_TOO_LARGE",
  unavailable: "SCOPED_STORE_UNAVAILABLE",
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function throwIfAborted(signal, codes, preserveError) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof RuntimeError || preserveError(signal.reason)) throw signal.reason;
  throw new RuntimeError(codes.aborted, "scoped control-store operation was aborted", { causeCode: signal.reason?.code ?? signal.reason?.name ?? "ABORTED" });
}

function mapError(error, codes, { commitStarted = false, preserveError = () => false, stage } = {}) {
  if (error instanceof RuntimeError || preserveError(error)) return error;
  if (commitStarted) return new RuntimeError(codes.commitUnknown, "PostgreSQL scoped transaction outcome is unknown after COMMIT started", { causeCode: error?.code ?? "POSTGRES_ERROR" });
  if (error?.code === "55P03") return new RuntimeError(codes.resourceLocked, "PostgreSQL scoped resource lock is held by another instance");
  if (error?.code === "57014") return new RuntimeError(codes.timeout, "PostgreSQL scoped statement timeout elapsed");
  if (error?.code === "23505") return new RuntimeError(codes.conflict, "PostgreSQL scoped uniqueness constraint rejected the change", { constraint: error.constraint });
  return new RuntimeError(codes.unavailable, "PostgreSQL scoped control-store request failed", {
    causeCode: error?.code ?? "POSTGRES_ERROR",
    ...(stage ? { stage } : {}),
  });
}

function validatedIdentity(identity = {}) {
  const value = identity && typeof identity === "object" && !Array.isArray(identity) ? identity : {};
  for (const key of ["participantId", "connectorNamespace", "endpoint"]) {
    assertRuntime(value[key] === undefined || value[key] === null || (typeof value[key] === "string" && value[key].length >= 3 && value[key].length <= 1024),
      DEFAULT_CODES.invalid, `scope registry ${key} is invalid`);
  }
  return Object.freeze({
    participantId: value.participantId ?? null,
    connectorNamespace: value.connectorNamespace ?? null,
    endpoint: value.endpoint ?? null,
  });
}

function identityFromPayload(component, payload) {
  if (component !== "caas") return validatedIdentity();
  return validatedIdentity({ participantId: payload?.participantId, connectorNamespace: payload?.namespace, endpoint: payload?.endpoint });
}

function participantIndex(payload, dataspaceId, invalidCode = DEFAULT_CODES.invalid) {
  const participants = payload?.participants ?? {};
  assertRuntime(participants && typeof participants === "object" && !Array.isArray(participants), invalidCode, "dataspace participant registry is invalid");
  return Object.entries(participants).map(([participantId, participant]) => {
    const spec = participant?.spec;
    let connectorNamespace;
    try { connectorNamespace = new URL(spec?.connectorNamespace).href; }
    catch { assertRuntime(false, invalidCode, "participant connector namespace is invalid", { dataspaceId, participantId }); }
    assertRuntime(TENANT_ID.test(participantId) && TENANT_ID.test(spec?.caasTenantId ?? "")
      && typeof spec?.connectorParticipantId === "string" && spec.connectorParticipantId.length >= 3 && spec.connectorParticipantId.length <= 1024,
    invalidCode, "participant technical identity is invalid", { dataspaceId, participantId });
    return {
      caasTenantId: spec.caasTenantId,
      connectorNamespace,
      connectorParticipantId: spec.connectorParticipantId,
      dataspaceId,
      participantId,
      participantSha256: digest(participant),
    };
  }).sort((left, right) => left.participantId.localeCompare(right.participantId));
}

function eventFields(component, event) {
  return component === "caas"
    ? { digest: event?.eventDigest, occurredAt: event?.occurredAt, previous: event?.previousDigest }
    : { digest: event?.hash, occurredAt: event?.at, previous: event?.previousHash };
}

function auditTenant(component, event) {
  if (component === "caas") return event?.tenantId ?? PLATFORM_TENANT_ID;
  return /^dataspace:([^/]+)(?:\/|$)/u.exec(event?.resource ?? "")?.[1] ?? PLATFORM_TENANT_ID;
}

function sparseAudit(component, head) {
  const sequence = Number(head.sequence);
  assertRuntime(Number.isSafeInteger(sequence) && sequence >= 0 && sequence <= 10_000_000,
    DEFAULT_CODES.invalid, "component audit sequence is outside the bounded runtime range");
  const events = [];
  events.length = sequence;
  if (sequence > 0) {
    events[sequence - 1] = component === "caas"
      ? { sequence, occurredAt: new Date(head.occurred_at).toISOString(), eventDigest: head.event_digest }
      : { sequence, at: new Date(head.occurred_at).toISOString(), hash: head.event_digest };
  }
  return component === "caas" ? events : { events, head: head.event_digest === "0".repeat(64) ? null : head.event_digest };
}

function scopedView(component, tenantId, payload, ledgerRows, head) {
  const ledger = Object.fromEntries(ledgerRows.map((row) => [row.record_key, clone(row.payload)]));
  if (component === "caas") {
    return {
      tenants: payload === null ? {} : { [tenantId]: clone(payload) },
      requests: ledger,
      audit: sparseAudit(component, head),
    };
  }
  return {
    dataspaces: payload === null ? {} : { [tenantId]: clone(payload) },
    idempotency: ledger,
    audit: sparseAudit(component, head),
  };
}

function viewPayload(component, tenantId, state) {
  const collection = component === "caas" ? state?.tenants : state?.dataspaces;
  assertRuntime(collection && typeof collection === "object" && !Array.isArray(collection)
    && Object.keys(collection).every((key) => key === tenantId), DEFAULT_CODES.invalid, "scoped transaction accessed another tenant payload");
  return collection[tenantId] ?? null;
}

function viewLedger(component, state) {
  const ledger = component === "caas" ? state?.requests : state?.idempotency;
  assertRuntime(ledger && typeof ledger === "object" && !Array.isArray(ledger), DEFAULT_CODES.invalid, "scoped idempotency registry is invalid");
  return ledger;
}

function appendedAudit(component, state, initialSequence) {
  const events = component === "caas" ? state?.audit : state?.audit?.events;
  assertRuntime(Array.isArray(events) && events.length >= initialSequence, DEFAULT_CODES.invalid, "scoped audit accumulator is invalid");
  return events.slice(initialSequence);
}

function buildStateCommit(component, sequence, previousDigest, occurredAt, stateRootSha256) {
  if (component === "caas") {
    const unsigned = {
      sequence,
      previousDigest,
      occurredAt,
      action: "STATE_COMMITTED",
      actorRole: "system",
      actorPrincipalId: "urn:molit:principal:caas-scoped-store",
      actorClientId: "molit-caas-scoped-store",
      actorKeyId: "molit-caas-scoped-integrity-v1",
      stateSnapshotDigest: stateRootSha256,
    };
    return { ...unsigned, eventDigest: digest(unsigned) };
  }
  const event = {
    sequence,
    at: occurredAt,
    actor: "system:dsaas-scoped-store",
    actorPrincipalId: "system:dsaas-scoped-store",
    actorClientId: "molit-dsaas-scoped-store",
    actorKeyId: "molit-dsaas-scoped-integrity-v1",
    actorRoles: ["system"],
    actorUsedRole: "system",
    action: "state.commit",
    resource: "dsaas-scoped-state",
    outcome: "committed",
    detailsDigest: stateRootSha256,
    stateSnapshotDigest: stateRootSha256,
    previousHash: previousDigest,
  };
  return { ...event, hash: digest(event) };
}

function auditOutboxId(component, event, tenantId) {
  const fields = eventFields(component, event);
  return digest({
    component,
    kind: "audit",
    payloadSha256: fields.digest,
    resourceId: fields.digest,
    revision: String(event.sequence),
    tenantId,
    type: "audit.appended",
  });
}

function eventRow(component, event, tenantId) {
  const fields = eventFields(component, event);
  assertRuntime(Number.isSafeInteger(event?.sequence) && event.sequence >= 1 && SHA256.test(fields.digest ?? "")
    && Number.isFinite(Date.parse(fields.occurredAt)) && (fields.previous === null || SHA256.test(fields.previous ?? "")),
  DEFAULT_CODES.invalid, "scoped audit event fields are invalid");
  return { event, eventDigest: fields.digest, eventId: fields.digest, occurredAt: new Date(fields.occurredAt).toISOString(), previousDigest: fields.previous, sequence: event.sequence, tenantId };
}

function outboxPayload(component, row) {
  return {
    schemaVersion: "molit.audit-outbox/1",
    sourceComponent: component,
    sourceSequence: row.sequence,
    sourceEventDigest: row.eventDigest,
    auditEvent: row.event,
    auditEventPayloadSha256: digest(row.event),
  };
}

function linkAbort(controller, signals) {
  const listeners = [];
  for (const signal of new Set(signals.filter(Boolean))) {
    if (signal.aborted) controller.abort(signal.reason);
    else {
      const listener = () => controller.abort(signal.reason);
      signal.addEventListener("abort", listener, { once: true });
      listeners.push([signal, listener]);
    }
  }
  return () => listeners.forEach(([signal, listener]) => signal.removeEventListener("abort", listener));
}

export class PostgresScopedControlStore {
  constructor({
    pool,
    leasePool,
    component,
    holderId,
    maxBytes = 16 * 1024 * 1024,
    maxAuditEvents = 1_000_000,
    maxIdempotencyRecords = 1_000_000,
    maxScopes = 10_000,
    statementTimeoutMs = 30_000,
    lockTimeoutMs = 5_000,
    cleanupTimeoutMs = 5_000,
    clock = () => new Date(),
    codes = {},
    preserveError = () => false,
  }) {
    assertRuntime(pool?.connect && pool?.end && leasePool?.connect && leasePool?.end && pool !== leasePool,
      DEFAULT_CODES.invalid, "scoped store requires distinct state and lease pools");
    assertRuntime(COMPONENTS.has(component) && IDENTIFIER.test(holderId ?? ""), DEFAULT_CODES.invalid, "scoped store component or holder is invalid");
    for (const [name, value] of Object.entries({ maxBytes, maxAuditEvents, maxIdempotencyRecords, maxScopes, statementTimeoutMs, lockTimeoutMs, cleanupTimeoutMs })) {
      assertRuntime(Number.isSafeInteger(value) && value > 0, DEFAULT_CODES.invalid, `scoped store ${name} is invalid`);
    }
    assertRuntime(lockTimeoutMs <= statementTimeoutMs && cleanupTimeoutMs <= statementTimeoutMs, DEFAULT_CODES.invalid, "scoped store timeouts are inconsistent");
    Object.assign(this, { pool, leasePool, component, holderId, maxBytes, maxAuditEvents, maxIdempotencyRecords, maxScopes, statementTimeoutMs, lockTimeoutMs, cleanupTimeoutMs, clock, codes: Object.freeze({ ...DEFAULT_CODES, ...codes }), preserveError });
    this.kind = "postgres-scoped";
    this.supportsDistributedFencing = true;
    this.initialized = false;
    this.closed = false;
    this.closePromise = null;
    this.leaseContext = new AsyncLocalStorage();
    this.activeLeaseControllers = new Set();
  }

  #assertUsable() {
    assertRuntime(!this.closed, this.codes.closed, "scoped control-store is closed");
    assertRuntime(this.initialized, this.codes.migration, "scoped control-store is not initialized");
  }

  #now() {
    const value = this.clock();
    assertRuntime(value instanceof Date && Number.isFinite(value.valueOf()), this.codes.invalid, "scoped control-store clock is invalid");
    return value.toISOString();
  }

  async #timeouts(client) {
    await client.query(
      "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)",
      [`${this.statementTimeoutMs}ms`, `${this.lockTimeoutMs}ms`],
    );
  }

  async #context(client, tenantId, correlationId = `${this.component}:${randomUUID()}`) {
    await client.query(
      `SELECT set_config('molit.tenant_id', $1, true),
              set_config('molit.actor_id', $2, true),
              set_config('molit.access_mode', 'service', true),
              set_config('molit.trace_id', $3, true),
              set_config('molit.correlation_id', $4, true),
              set_config('molit.break_glass_reason', '', true),
              set_config('molit.break_glass_expires_at', '', true)`,
      [tenantId, `service:${this.component}-scoped-store`, randomBytes(16).toString("hex"), correlationId],
    );
  }

  async #platform(client, correlationId) {
    return this.#context(client, PLATFORM_TENANT_ID, correlationId);
  }

  async #mode(client, { lock = false } = {}) {
    const result = await client.query(
      `SELECT mode, state_root_sha256 FROM molit_control_store.control_store_mode
       WHERE component = $1${lock ? " FOR UPDATE" : ""}`,
      [this.component],
    );
    assertRuntime(result.rowCount === 1 && result.rows[0].mode === "scoped-authoritative",
      this.codes.migration, "production scoped control-store cutover is incomplete");
    return result.rows[0];
  }

  async initialize({ signal } = {}) {
    assertRuntime(!this.closed, this.codes.closed, "scoped control-store is closed");
    if (this.initialized) return;
    throwIfAborted(signal, this.codes, this.preserveError);
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN READ ONLY");
      transaction = true;
      await this.#platform(client, `${this.component}:initialize`);
      await this.#timeouts(client);
      const migration = await client.query("SELECT version FROM molit_control_store.schema_migration WHERE component = $1", [MIGRATION_COMPONENT]);
      assertRuntime(Number(migration.rows[0]?.version) === MIGRATION_VERSION, this.codes.migration, "scoped control-store migration 4 is required");
      const componentBinding = await client.query("SELECT molit_control_store.component_principal_active($1) AS active", [this.component]);
      assertRuntime(componentBinding.rows[0]?.active === true, this.codes.migration, "database login is not bound to the scoped component");
      const snapshotGrant = await client.query(
        `SELECT has_table_privilege(session_user, 'molit_control_store.json_snapshot', 'SELECT') AS readable,
                has_table_privilege(session_user, 'molit_control_store.json_snapshot', 'INSERT') AS insertable,
                has_table_privilege(session_user, 'molit_control_store.json_snapshot', 'UPDATE') AS writable,
                has_table_privilege(session_user, 'molit_control_store.json_snapshot', 'DELETE') AS deletable`,
      );
      assertRuntime(snapshotGrant.rows[0]?.readable === false && snapshotGrant.rows[0]?.insertable === false
        && snapshotGrant.rows[0]?.writable === false && snapshotGrant.rows[0]?.deletable === false,
        this.codes.migration, "runtime access to json_snapshot must be revoked before authoritative cutover");
      const mode = await this.#mode(client);
      const registry = await client.query(
        "SELECT state_sha256 FROM molit_control_store.control_scope_registry WHERE component = $1 AND tenant_id = 'molit-platform'",
        [this.component],
      );
      const head = await client.query("SELECT state_root_sha256 FROM molit_control_store.component_audit_head WHERE component = $1", [this.component]);
      assertRuntime(registry.rowCount === 1 && head.rowCount === 1 && head.rows[0].state_root_sha256 === mode.state_root_sha256,
        this.codes.migration, "scoped registry, audit head, and cutover receipt are inconsistent");
      throwIfAborted(signal, this.codes, this.preserveError);
      await client.query("COMMIT");
      transaction = false;
      const lease = await this.leasePool.connect();
      try { await lease.query("SELECT 1 AS ready"); } finally { lease.release(); }
      this.initialized = true;
    } catch (error) {
      if (transaction) await client.query("ROLLBACK").catch(() => {});
      throw mapError(error, this.codes, { preserveError: this.preserveError });
    } finally {
      client.release(transaction);
    }
  }

  async #head(client, { lock = false } = {}) {
    const result = await client.query(
      `SELECT sequence::text, event_digest, occurred_at, state_root_sha256
       FROM molit_control_store.component_audit_head
       WHERE component = $1${lock ? " FOR UPDATE" : ""}`,
      [this.component],
    );
    assertRuntime(result.rowCount === 1, this.codes.migration, "component audit head is missing");
    return result.rows[0];
  }

  async #ledger(client, tenantId) {
    const result = await client.query(
      `SELECT record_key, payload, payload_sha256
       FROM molit_control_store.idempotency_record
       WHERE component = $1 AND tenant_id = $2
       ORDER BY record_key`,
      [this.component, tenantId],
    );
    assertRuntime(result.rows.length <= this.maxIdempotencyRecords, this.codes.capacity, "scoped idempotency capacity is exceeded");
    return result.rows;
  }

  async readScope(tenantId, operation = (state) => state, { signal } = {}) {
    this.#assertUsable();
    assertRuntime(TENANT_ID.test(tenantId ?? "") && typeof operation === "function", this.codes.invalid, "scoped read arguments are invalid");
    throwIfAborted(signal, this.codes, this.preserveError);
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN READ ONLY");
      transaction = true;
      await this.#platform(client);
      await this.#timeouts(client);
      await this.#mode(client);
      const registry = await client.query(
        "SELECT tenant_id FROM molit_control_store.control_scope_registry WHERE component = $1 AND tenant_id = $2",
        [this.component, tenantId],
      );
      assertRuntime(registry.rowCount === 1 && tenantId !== PLATFORM_TENANT_ID, this.codes.missing, "scoped control-store resource does not exist", { tenantId });
      const head = await this.#head(client);
      await this.#context(client, tenantId);
      const selected = await client.query(
        "SELECT payload FROM molit_control_store.scoped_control_state WHERE component = $1 AND tenant_id = $2",
        [this.component, tenantId],
      );
      assertRuntime(selected.rowCount === 1, this.codes.missing, "scoped state row is absent or inaccessible", { tenantId });
      const state = scopedView(this.component, tenantId, selected.rows[0].payload, await this.#ledger(client, tenantId), head);
      const result = await operation(state);
      throwIfAborted(signal, this.codes, this.preserveError);
      await client.query("COMMIT");
      transaction = false;
      return clone(result);
    } catch (error) {
      if (transaction) await client.query("ROLLBACK").catch(() => {});
      throw mapError(error, this.codes, { preserveError: this.preserveError });
    } finally {
      client.release(transaction);
    }
  }

  async createScope(tenantId, operation, { capacity = this.maxScopes, signal } = {}) {
    return this.#transactScope(tenantId, operation, { capacity, create: true, signal });
  }

  async transactScope(tenantId, operation, { signal } = {}) {
    return this.#transactScope(tenantId, operation, { create: false, signal });
  }

  async appendPlatformAudit(operation, { absentScopeId, signal } = {}) {
    this.#assertUsable();
    assertRuntime(typeof operation === "function"
      && (absentScopeId === undefined || (TENANT_ID.test(absentScopeId) && absentScopeId !== PLATFORM_TENANT_ID)),
    this.codes.invalid, "platform audit operation is invalid");
    const activeLease = this.leaseContext.getStore();
    const controller = new AbortController();
    const unlink = linkAbort(controller, [signal, activeLease?.signal]);
    const executionSignal = controller.signal;
    throwIfAborted(executionSignal, this.codes, this.preserveError);
    const client = await this.pool.connect();
    let transaction = false;
    let commitStarted = false;
    let stage = "begin";
    try {
      await client.query("BEGIN");
      transaction = true;
      stage = "platform-context";
      await this.#platform(client);
      await this.#timeouts(client);
      stage = "cutover-mode";
      const mode = await this.#mode(client, { lock: true });
      if (absentScopeId !== undefined) {
        stage = "scope-absence-check";
        const registered = await client.query(
          "SELECT 1 FROM molit_control_store.control_scope_registry WHERE component = $1 AND tenant_id = $2",
          [this.component, absentScopeId],
        );
        assertRuntime(registered.rowCount === 0, this.codes.fenceLost,
          "platform audit requires the target scope to remain absent", { absentScopeId });
      }
      stage = "audit-head-lock";
      const head = await this.#head(client, { lock: true });
      const initialSequence = Number(head.sequence);
      const state = scopedView(this.component, PLATFORM_TENANT_ID, null, [], head);
      stage = "operation";
      const result = await operation(state);
      throwIfAborted(executionSignal, this.codes, this.preserveError);
      assertRuntime(viewPayload(this.component, PLATFORM_TENANT_ID, state) === null
        && Object.keys(viewLedger(this.component, state)).length === 0,
      this.codes.invalid, "platform audit operation cannot mutate scoped state or idempotency records");
      const appended = appendedAudit(this.component, state, initialSequence);
      assertRuntime(appended.length > 0 && initialSequence + appended.length <= this.maxAuditEvents,
        this.codes.capacity, "platform audit operation must append events within component capacity");
      let previousDigest = head.event_digest === "0".repeat(64) ? null : head.event_digest;
      let previousAt = head.occurred_at ? Date.parse(head.occurred_at) : -Infinity;
      const rows = appended.map((event, index) => {
        assertRuntime(auditTenant(this.component, event) === PLATFORM_TENANT_ID,
          this.codes.invalid, "platform audit event must remain in the platform scope");
        const row = eventRow(this.component, event, PLATFORM_TENANT_ID);
        assertRuntime(row.sequence === initialSequence + index + 1 && row.previousDigest === previousDigest
          && Date.parse(row.occurredAt) >= previousAt,
        this.codes.invalid, "platform audit chain is not contiguous or monotonic");
        previousDigest = row.eventDigest;
        previousAt = Date.parse(row.occurredAt);
        return row;
      });
      if (activeLease) {
        stage = "fence-check";
        const fence = await client.query(
          `SELECT fencing_token::text, holder_id, released_at
           FROM molit_control_store.resource_fence
           WHERE component = $1 AND resource_id = $2 FOR SHARE`,
          [this.component, activeLease.resourceId],
        );
        assertRuntime(fence.rowCount === 1 && fence.rows[0].fencing_token === activeLease.fencingToken
          && fence.rows[0].holder_id === activeLease.holderId && fence.rows[0].released_at === null,
        this.codes.fenceLost, "platform audit fencing lease is no longer current");
      }
      stage = "audit-write";
      for (const row of rows) {
        await client.query(
          `INSERT INTO molit_control_store.audit_event
             (component, tenant_id, sequence, event_id, occurred_at, previous_digest, event_digest, event)
           VALUES ($1, 'molit-platform', $2::bigint, $3, $4::timestamptz, $5, $6, $7::jsonb)`,
          [this.component, String(row.sequence), row.eventId, row.occurredAt, row.previousDigest, row.eventDigest, JSON.stringify(row.event)],
        );
        const payloadValue = outboxPayload(this.component, row);
        await client.query(
          `INSERT INTO molit_control_store.outbox_event
             (component, event_id, aggregate_kind, aggregate_id, tenant_id, event_type,
              payload, payload_sha256, created_at, available_at)
           VALUES ($1, $2, 'audit', $3, 'molit-platform', 'audit.appended', $4::jsonb, $5, $6::timestamptz, $6::timestamptz)`,
          [this.component, auditOutboxId(this.component, row.event, PLATFORM_TENANT_ID), row.eventId,
            JSON.stringify(payloadValue), digest(payloadValue), row.occurredAt],
        );
      }
      stage = "audit-head-write";
      const last = rows.at(-1);
      const updatedAt = this.#now();
      const updated = await client.query(
        `UPDATE molit_control_store.component_audit_head
         SET sequence = $2::bigint, event_digest = $3, occurred_at = $4::timestamptz, updated_at = $5::timestamptz
         WHERE component = $1 AND sequence = $6::bigint AND event_digest = $7`,
        [this.component, String(last.sequence), last.eventDigest, last.occurredAt, updatedAt,
          String(initialSequence), head.event_digest],
      );
      assertRuntime(updated.rowCount === 1, this.codes.fenceLost, "component audit head fence was lost");
      assertRuntime(head.state_root_sha256 === mode.state_root_sha256,
        this.codes.fenceLost, "platform audit cannot advance a stale component state root");
      throwIfAborted(executionSignal, this.codes, this.preserveError);
      commitStarted = true;
      stage = "commit";
      await client.query("COMMIT");
      transaction = false;
      commitStarted = false;
      return clone(result);
    } catch (error) {
      if (transaction && !commitStarted) await client.query("ROLLBACK").catch(() => {});
      throw mapError(error, this.codes, { commitStarted, preserveError: this.preserveError, stage });
    } finally {
      client.release(commitStarted || transaction);
      unlink();
    }
  }

  async #transactScope(tenantId, operation, { capacity = this.maxScopes, create, signal }) {
    this.#assertUsable();
    assertRuntime(TENANT_ID.test(tenantId ?? "") && tenantId !== PLATFORM_TENANT_ID && typeof operation === "function",
      this.codes.invalid, "scoped transaction arguments are invalid");
    assertRuntime(Number.isSafeInteger(capacity) && capacity >= 1 && capacity <= this.maxScopes, this.codes.invalid, "scoped capacity is invalid");
    const activeLease = this.leaseContext.getStore();
    const controller = new AbortController();
    const unlink = linkAbort(controller, [signal, activeLease?.signal]);
    const executionSignal = controller.signal;
    throwIfAborted(executionSignal, this.codes, this.preserveError);
    const client = await this.pool.connect();
    let transaction = false;
    let commitStarted = false;
    let stage = "begin";
    try {
      await client.query("BEGIN");
      transaction = true;
      stage = "platform-context";
      await this.#platform(client);
      await this.#timeouts(client);
      stage = "cutover-mode";
      await this.#mode(client, { lock: true });
      stage = "registry-lock";
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`molit:scope-registry:${this.component}`]);
      const registry = await client.query(
        `SELECT tenant_id, state_revision::text, state_sha256, idempotency_count
         FROM molit_control_store.control_scope_registry
         WHERE component = $1 AND tenant_id = $2
         FOR UPDATE`,
        [this.component, tenantId],
      );
      const creating = create && registry.rowCount === 0;
      if (creating) {
        const count = await client.query(
          "SELECT count(*)::integer AS count FROM molit_control_store.control_scope_registry WHERE component = $1 AND tenant_id <> 'molit-platform'",
          [this.component],
        );
        assertRuntime(count.rows[0].count < capacity, this.codes.capacity, "scoped resource capacity is exhausted");
        stage = "scope-enrollment";
        await client.query("SELECT molit_control_store.enroll_scoped_service_principal($1, $2)", [tenantId, this.component]);
      } else if (!create) {
        assertRuntime(registry.rowCount === 1, this.codes.missing, "scoped resource does not exist", { tenantId });
      }
      stage = "audit-head-lock";
      const head = await this.#head(client, { lock: true });
      const initialSequence = Number(head.sequence);
      stage = "scope-read";
      await this.#context(client, tenantId);
      const selected = await client.query(
        "SELECT revision::text, payload, payload_sha256 FROM molit_control_store.scoped_control_state WHERE component = $1 AND tenant_id = $2 FOR UPDATE",
        [this.component, tenantId],
      );
      assertRuntime(creating ? selected.rowCount === 0 : selected.rowCount === 1, creating ? this.codes.conflict : this.codes.missing,
        creating ? "scoped state row already exists" : "scoped state row is absent or inaccessible", { tenantId });
      const initialPayload = selected.rows[0]?.payload ?? null;
      const initialLedgerRows = await this.#ledger(client, tenantId);
      const state = scopedView(this.component, tenantId, initialPayload, initialLedgerRows, head);
      stage = "operation";
      const result = await operation(state);
      throwIfAborted(executionSignal, this.codes, this.preserveError);

      const payload = viewPayload(this.component, tenantId, state);
      assertRuntime(payload && typeof payload === "object" && !Array.isArray(payload), this.codes.invalid, "scoped transaction must retain one object payload");
      const encodedPayload = JSON.stringify(payload);
      assertRuntime(Buffer.byteLength(encodedPayload) <= this.maxBytes, this.codes.tooLarge, "scoped state exceeds its byte limit");
      const ledger = viewLedger(this.component, state);
      const ledgerEntries = Object.entries(ledger).map(([recordKey, value]) => {
        assertRuntime(typeof recordKey === "string" && recordKey.length >= 1 && recordKey.length <= 2_048
          && value && typeof value === "object" && !Array.isArray(value), this.codes.invalid, "scoped idempotency entry is invalid");
        assertRuntime(value.scopeId === undefined || value.scopeId === tenantId,
          this.codes.invalid, "idempotency record escaped its transaction scope", { recordKey, tenantId });
        return { recordKey, payload: value };
      }).sort((left, right) => left.recordKey.localeCompare(right.recordKey));
      const appended = appendedAudit(this.component, state, initialSequence);
      const payloadChanged = digest(initialPayload) !== digest(payload);
      const initialLedgerDigest = digest(initialLedgerRows.map((row) => ({ recordKey: row.record_key, payload: row.payload })));
      const ledgerChanged = initialLedgerDigest !== digest(ledgerEntries);
      const changed = creating || payloadChanged || ledgerChanged || appended.length > 0;
      if (!changed) {
        await client.query("COMMIT");
        transaction = false;
        return clone(result);
      }
      assertRuntime(appended.length > 0, this.codes.invalid, "every authoritative scoped mutation must append a domain audit event");
      assertRuntime(initialSequence + appended.length + 1 <= this.maxAuditEvents, this.codes.capacity, "component audit capacity is exhausted");
      let previousDigest = head.event_digest === "0".repeat(64) ? null : head.event_digest;
      let previousAt = head.occurred_at ? Date.parse(head.occurred_at) : -Infinity;
      const domainRows = appended.map((event, index) => {
        const tenant = auditTenant(this.component, event);
        assertRuntime(tenant === tenantId, this.codes.invalid, "domain audit event escaped its transaction scope");
        const row = eventRow(this.component, event, tenant);
        assertRuntime(row.sequence === initialSequence + index + 1 && row.previousDigest === previousDigest
          && Date.parse(row.occurredAt) >= previousAt, this.codes.invalid, "domain audit chain is not contiguous or monotonic");
        previousDigest = row.eventDigest;
        previousAt = Date.parse(row.occurredAt);
        return row;
      });

      if (activeLease) {
        await this.#platform(client);
        const fence = await client.query(
          `SELECT fencing_token::text, holder_id, released_at
           FROM molit_control_store.resource_fence
           WHERE component = $1 AND resource_id = $2 FOR SHARE`,
          [this.component, activeLease.resourceId],
        );
        assertRuntime(fence.rowCount === 1 && fence.rows[0].fencing_token === activeLease.fencingToken
          && fence.rows[0].holder_id === activeLease.holderId && fence.rows[0].released_at === null,
        this.codes.fenceLost, "scoped transaction fencing lease is no longer current");
        await this.#context(client, tenantId);
      }

      const nextRevision = Number(selected.rows[0]?.revision ?? 0) + 1;
      const committedAt = this.#now();
      stage = "state-write";
      if (creating) {
        await client.query(
          `INSERT INTO molit_control_store.scoped_control_state
             (component, tenant_id, resource_kind, revision, payload, payload_sha256, updated_at)
           VALUES ($1, $2, $3, 1, $4::jsonb, $5, $6::timestamptz)`,
          [this.component, tenantId, this.component === "caas" ? "tenant" : "dataspace", encodedPayload, digest(payload), committedAt],
        );
      } else {
        const updated = await client.query(
          `UPDATE molit_control_store.scoped_control_state
           SET revision = revision + 1, payload = $3::jsonb, payload_sha256 = $4, updated_at = $5::timestamptz
           WHERE component = $1 AND tenant_id = $2 AND revision = $6::bigint`,
          [this.component, tenantId, encodedPayload, digest(payload), committedAt, selected.rows[0].revision],
        );
        assertRuntime(updated.rowCount === 1, this.codes.fenceLost, "scoped state revision fence was lost");
      }

      const initialKeys = new Set(initialLedgerRows.map((row) => row.record_key));
      const nextKeys = new Set(ledgerEntries.map(({ recordKey }) => recordKey));
      stage = "idempotency-write";
      for (const recordKey of initialKeys) {
        if (nextKeys.has(recordKey)) continue;
        await client.query(
          "DELETE FROM molit_control_store.idempotency_record WHERE component = $1 AND tenant_id = $2 AND record_key = $3",
          [this.component, tenantId, recordKey],
        );
      }
      for (const entry of ledgerEntries) {
        await client.query(
          `INSERT INTO molit_control_store.idempotency_record
             (component, tenant_id, record_key, payload, payload_sha256, snapshot_revision, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6::bigint, $7::timestamptz)
           ON CONFLICT (component, tenant_id, record_key) DO UPDATE
           SET payload = EXCLUDED.payload, payload_sha256 = EXCLUDED.payload_sha256,
               snapshot_revision = EXCLUDED.snapshot_revision, updated_at = EXCLUDED.updated_at`,
          [this.component, tenantId, entry.recordKey, JSON.stringify(entry.payload), digest(entry.payload), String(nextRevision), committedAt],
        );
      }

      const identity = identityFromPayload(this.component, payload);
      const participants = this.component === "dsaas" ? participantIndex(payload, tenantId, this.codes.invalid) : [];
      const stateSha256 = scopedStateDigest(payload, ledgerEntries);
      stage = "registry-write";
      await this.#platform(client);
      if (this.component === "dsaas") {
        await client.query(
          "DELETE FROM molit_control_store.control_participant_registry WHERE component = 'dsaas' AND dataspace_id = $1",
          [tenantId],
        );
        for (const participant of participants) {
          await client.query(
            `INSERT INTO molit_control_store.control_participant_registry
               (component, dataspace_id, participant_id, caas_tenant_id, connector_participant_id,
                connector_namespace, participant_sha256, updated_at)
             VALUES ('dsaas', $1, $2, $3, $4, $5, $6, $7::timestamptz)`,
            [tenantId, participant.participantId, participant.caasTenantId, participant.connectorParticipantId,
              participant.connectorNamespace, participant.participantSha256, committedAt],
          );
        }
      }
      if (creating) {
        await client.query(
          `INSERT INTO molit_control_store.control_scope_registry
             (component, tenant_id, resource_kind, participant_id, connector_namespace, endpoint,
              state_revision, state_sha256, idempotency_count, first_seen_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9::timestamptz, $9::timestamptz)`,
          [this.component, tenantId, this.component === "caas" ? "tenant" : "dataspace", identity.participantId,
            identity.connectorNamespace, identity.endpoint, stateSha256, ledgerEntries.length, committedAt],
        );
      } else {
        const updatedRegistry = await client.query(
          `UPDATE molit_control_store.control_scope_registry
           SET participant_id = $3, connector_namespace = $4, endpoint = $5,
               state_revision = $6::bigint, state_sha256 = $7,
               idempotency_count = $8, last_seen_at = $9::timestamptz
           WHERE component = $1 AND tenant_id = $2 AND state_revision = $10::bigint`,
          [this.component, tenantId, identity.participantId, identity.connectorNamespace, identity.endpoint,
            String(nextRevision), stateSha256, ledgerEntries.length, committedAt, registry.rows[0].state_revision],
        );
        assertRuntime(updatedRegistry.rowCount === 1, this.codes.fenceLost, "scope registry revision fence was lost");
      }
      const idempotencyTotal = await client.query(
        "SELECT sum(idempotency_count)::bigint AS total FROM molit_control_store.control_scope_registry WHERE component = $1",
        [this.component],
      );
      assertRuntime(BigInt(idempotencyTotal.rows[0].total ?? 0) <= BigInt(this.maxIdempotencyRecords), this.codes.capacity, "component idempotency capacity is exhausted");
      const registryRootRows = await client.query(
        `SELECT tenant_id, state_revision::text, state_sha256, idempotency_count
         FROM molit_control_store.control_scope_registry WHERE component = $1 ORDER BY tenant_id`,
        [this.component],
      );
      const stateRootSha256 = componentStateRoot(registryRootRows.rows.map((row) => ({
        idempotencyCount: Number(row.idempotency_count), stateRevision: Number(row.state_revision), stateSha256: row.state_sha256, tenantId: row.tenant_id,
      })));
      const stateCommitAt = new Date(Math.max(Date.parse(committedAt), previousAt)).toISOString();
      const stateCommit = buildStateCommit(this.component, initialSequence + domainRows.length + 1, previousDigest, stateCommitAt, stateRootSha256);
      const allRows = [...domainRows, eventRow(this.component, stateCommit, PLATFORM_TENANT_ID)];
      stage = "audit-write";
      for (const row of allRows) {
        await this.#context(client, row.tenantId);
        await client.query(
          `INSERT INTO molit_control_store.audit_event
             (component, tenant_id, sequence, event_id, occurred_at, previous_digest, event_digest, event)
           VALUES ($1, $2, $3::bigint, $4, $5::timestamptz, $6, $7, $8::jsonb)`,
          [this.component, row.tenantId, String(row.sequence), row.eventId, row.occurredAt, row.previousDigest, row.eventDigest, JSON.stringify(row.event)],
        );
        const payloadValue = outboxPayload(this.component, row);
        await client.query(
          `INSERT INTO molit_control_store.outbox_event
             (component, event_id, aggregate_kind, aggregate_id, tenant_id, event_type,
              payload, payload_sha256, created_at, available_at)
           VALUES ($1, $2, 'audit', $3, $4, 'audit.appended', $5::jsonb, $6, $7::timestamptz, $7::timestamptz)`,
          [this.component, auditOutboxId(this.component, row.event, row.tenantId), row.eventId, row.tenantId,
            JSON.stringify(payloadValue), digest(payloadValue), row.occurredAt],
        );
      }
      const last = allRows.at(-1);
      stage = "audit-head-write";
      await this.#platform(client);
      await client.query(
        `UPDATE molit_control_store.component_audit_head
         SET sequence = $2::bigint, event_digest = $3, occurred_at = $4::timestamptz,
             state_root_sha256 = $5, updated_at = $6::timestamptz
         WHERE component = $1 AND sequence = $7::bigint AND event_digest = $8`,
        [this.component, String(last.sequence), last.eventDigest, last.occurredAt, stateRootSha256, committedAt,
          String(initialSequence), head.event_digest],
      ).then((updated) => assertRuntime(updated.rowCount === 1, this.codes.fenceLost, "component audit head fence was lost"));
      await client.query(
        `UPDATE molit_control_store.control_store_mode SET state_root_sha256 = $2, updated_at = $3::timestamptz
         WHERE component = $1 AND mode = 'scoped-authoritative'`,
        [this.component, stateRootSha256, committedAt],
      );
      throwIfAborted(executionSignal, this.codes, this.preserveError);
      commitStarted = true;
      stage = "commit";
      await client.query("COMMIT");
      transaction = false;
      commitStarted = false;
      return clone(result);
    } catch (error) {
      if (transaction && !commitStarted) await client.query("ROLLBACK").catch(() => {});
      throw mapError(error, this.codes, { commitStarted, preserveError: this.preserveError, stage });
    } finally {
      client.release(commitStarted || transaction);
      unlink();
    }
  }

  async listScopeIds({ after = "", limit = 1_000, signal } = {}) {
    this.#assertUsable();
    assertRuntime((after === "" || TENANT_ID.test(after)) && Number.isSafeInteger(limit) && limit >= 1 && limit <= 1_000,
      this.codes.invalid, "scope registry page is invalid");
    throwIfAborted(signal, this.codes, this.preserveError);
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN READ ONLY");
      transaction = true;
      await this.#platform(client);
      await this.#timeouts(client);
      await this.#mode(client);
      const result = await client.query(
        `SELECT tenant_id FROM molit_control_store.control_scope_registry
         WHERE component = $1 AND tenant_id <> 'molit-platform' AND tenant_id > $2
         ORDER BY tenant_id LIMIT $3`,
        [this.component, after, limit],
      );
      await client.query("COMMIT");
      transaction = false;
      return result.rows.map((row) => row.tenant_id);
    } catch (error) {
      if (transaction) await client.query("ROLLBACK").catch(() => {});
      throw mapError(error, this.codes, { preserveError: this.preserveError });
    } finally { client.release(transaction); }
  }

  async scopeExists(tenantId, { signal } = {}) {
    this.#assertUsable();
    assertRuntime(TENANT_ID.test(tenantId ?? "") && tenantId !== PLATFORM_TENANT_ID, this.codes.invalid, "scope identifier is invalid");
    throwIfAborted(signal, this.codes, this.preserveError);
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN READ ONLY");
      transaction = true;
      await this.#platform(client);
      await this.#timeouts(client);
      await this.#mode(client);
      const result = await client.query(
        "SELECT 1 AS present FROM molit_control_store.control_scope_registry WHERE component = $1 AND tenant_id = $2",
        [this.component, tenantId],
      );
      await client.query("COMMIT");
      transaction = false;
      return result.rowCount === 1;
    } catch (error) {
      if (transaction) await client.query("ROLLBACK").catch(() => {});
      throw mapError(error, this.codes, { preserveError: this.preserveError });
    } finally { client.release(transaction); }
  }

  async readAudit(tenantId, { beforeSequence = Number.MAX_SAFE_INTEGER, limit = 1_000, signal } = {}) {
    this.#assertUsable();
    assertRuntime((tenantId === null || tenantId === undefined || TENANT_ID.test(tenantId))
      && Number.isSafeInteger(beforeSequence) && beforeSequence >= 1
      && Number.isSafeInteger(limit) && limit >= 1 && limit <= 10_000,
    this.codes.invalid, "audit page is invalid");
    if (tenantId) assertRuntime(await this.scopeExists(tenantId, { signal }), this.codes.missing, "scoped control-store resource does not exist", { tenantId });
    const tenantIds = tenantId ? [tenantId] : [PLATFORM_TENANT_ID, ...await this.#allScopeIds({ signal })];
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN READ ONLY");
      transaction = true;
      await this.#timeouts(client);
      const events = [];
      let total = 0;
      for (const scopedTenantId of tenantIds) {
        await this.#context(client, scopedTenantId);
        const result = await client.query(
          `WITH selected AS (
             SELECT sequence, event FROM molit_control_store.audit_event
             WHERE component = $1 AND tenant_id = $2 AND sequence < $3::bigint
           )
           SELECT sequence::text, event, count(*) OVER ()::text AS total
           FROM selected ORDER BY sequence DESC LIMIT $4`,
          [this.component, scopedTenantId, String(beforeSequence), limit],
        );
        total += Number(result.rows[0]?.total ?? 0);
        events.push(...result.rows.map((row) => ({ sequence: Number(row.sequence), event: row.event })));
      }
      await client.query("COMMIT");
      transaction = false;
      assertRuntime(Number.isSafeInteger(total) && total <= this.maxAuditEvents, this.codes.capacity, "component audit count exceeds its configured bound");
      const selected = events.sort((left, right) => left.sequence - right.sequence).slice(-limit).map(({ event }) => clone(event));
      return Object.freeze({ events: Object.freeze(selected), total, truncated: total > selected.length });
    } catch (error) {
      if (transaction) await client.query("ROLLBACK").catch(() => {});
      throw mapError(error, this.codes, { preserveError: this.preserveError });
    } finally { client.release(transaction); }
  }

  async #allScopeIds({ signal } = {}) {
    const ids = [];
    let after = "";
    while (true) {
      throwIfAborted(signal, this.codes, this.preserveError);
      const page = await this.listScopeIds({ after, limit: Math.min(1_000, this.maxScopes), signal });
      ids.push(...page);
      assertRuntime(ids.length <= this.maxScopes, this.codes.capacity, "scope registry exceeds its configured bound");
      if (page.length < Math.min(1_000, this.maxScopes)) return ids;
      after = page.at(-1);
    }
  }

  async withResourceLock(resourceId, operation, { signal } = {}) {
    this.#assertUsable();
    assertRuntime(typeof resourceId === "string" && resourceId.length >= 3 && resourceId.length <= 1024 && typeof operation === "function",
      this.codes.invalid, "scoped resource lock arguments are invalid");
    throwIfAborted(signal, this.codes, this.preserveError);
    const controller = new AbortController();
    const unlink = linkAbort(controller, [signal]);
    this.activeLeaseControllers.add(controller);
    const client = await this.leasePool.connect();
    const lockName = JSON.stringify([this.component, resourceId]);
    let acquired = false;
    let fencingToken = null;
    let failure;
    let result;
    const onError = (error) => controller.abort(error);
    client.on?.("error", onError);
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [lockName]);
      acquired = lock.rows[0]?.acquired === true;
      assertRuntime(acquired, this.codes.resourceLocked, "scoped resource lock is held by another instance", { resourceId });
      await client.query("BEGIN");
      await this.#platform(client);
      await this.#timeouts(client);
      const fence = await client.query(
        `INSERT INTO molit_control_store.resource_fence
           (component, resource_id, fencing_token, holder_id, acquired_at, released_at)
         VALUES ($1, $2, 1, $3, clock_timestamp(), NULL)
         ON CONFLICT (component, resource_id) DO UPDATE
           SET fencing_token = molit_control_store.resource_fence.fencing_token + 1,
               holder_id = EXCLUDED.holder_id, acquired_at = EXCLUDED.acquired_at, released_at = NULL
         RETURNING fencing_token::text, acquired_at`,
        [this.component, resourceId, this.holderId],
      );
      fencingToken = fence.rows[0].fencing_token;
      await client.query("COMMIT");
      const lease = Object.freeze({ resourceId, holderId: this.holderId, fencingToken, acquiredAt: new Date(fence.rows[0].acquired_at).toISOString(), signal: controller.signal });
      result = await this.leaseContext.run(lease, () => operation(lease));
      throwIfAborted(controller.signal, this.codes, this.preserveError);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      failure = mapError(error, this.codes, { preserveError: this.preserveError });
    }
    if (acquired) {
      try {
        await client.query("BEGIN");
        await this.#platform(client);
        await client.query("SELECT set_config('statement_timeout', $1, true)", [`${this.cleanupTimeoutMs}ms`]);
        const released = await client.query(
          `UPDATE molit_control_store.resource_fence SET released_at = clock_timestamp()
           WHERE component = $1 AND resource_id = $2 AND holder_id = $3
             AND fencing_token = $4::bigint AND released_at IS NULL`,
          [this.component, resourceId, this.holderId, fencingToken],
        );
        assertRuntime(released.rowCount === 1, this.codes.fenceLost, "scoped fencing row changed before release");
        await client.query("COMMIT");
        const unlocked = await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked", [lockName]);
        assertRuntime(unlocked.rows[0]?.unlocked === true, this.codes.fenceLost, "scoped advisory lock was lost before release");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        failure ??= mapError(error, this.codes, { preserveError: this.preserveError });
      }
    }
    client.off?.("error", onError);
    client.release(Boolean(failure && controller.signal.aborted));
    this.activeLeaseControllers.delete(controller);
    unlink();
    if (failure) throw failure;
    return clone(result);
  }

  async readiness({ signal } = {}) {
    if (this.closed) return Object.freeze({ ready: false, status: "CLOSED", failureCode: this.codes.closed });
    if (!this.initialized) return Object.freeze({ ready: false, status: "NOT_INITIALIZED", failureCode: this.codes.migration });
    try {
      throwIfAborted(signal, this.codes, this.preserveError);
      const client = await this.pool.connect();
      let transaction = false;
      try {
        await client.query("BEGIN READ ONLY");
        transaction = true;
        await this.#platform(client);
        const mode = await this.#mode(client);
        const head = await this.#head(client);
        assertRuntime(mode.state_root_sha256 === head.state_root_sha256, this.codes.migration, "cutover receipt and audit head root differ");
        await client.query("COMMIT");
        transaction = false;
      } catch (error) {
        if (transaction) await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { client.release(transaction); }
      const lease = await this.leasePool.connect();
      try { await lease.query("SELECT 1 AS ready"); } finally { lease.release(); }
      return Object.freeze({ ready: true, status: "READY", failureCode: null });
    } catch (error) {
      const mapped = mapError(error, this.codes, { preserveError: this.preserveError });
      return Object.freeze({ ready: false, status: "NOT_READY", failureCode: mapped.code ?? this.codes.unavailable });
    }
  }

  async close({ deadline, timeoutMs = this.cleanupTimeoutMs } = {}) {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.leaseContext.disable();
    const closing = new RuntimeError(this.codes.closed, "scoped control-store is closing");
    for (const controller of this.activeLeaseControllers) controller.abort(closing);
    const end = Number.isFinite(deadline) ? deadline : Date.now() + Math.max(0, timeoutMs);
    this.closePromise = (async () => {
      const pools = Promise.allSettled([this.pool.end(), this.leasePool.end()]);
      const remaining = Math.max(0, end - Date.now());
      if (remaining === 0) return;
      let timer;
      const outcome = await Promise.race([
        pools.then((results) => ({ results })),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), remaining); }),
      ]);
      clearTimeout(timer);
      if (outcome.timeout) return;
      const failure = outcome.results.find((entry) => entry.status === "rejected");
      if (failure) throw mapError(failure.reason, this.codes);
    })();
    return this.closePromise;
  }
}

export const POSTGRES_SCOPED_CONTROL_STORE_MIGRATION = Object.freeze({ component: MIGRATION_COMPONENT, version: MIGRATION_VERSION });
