import { createHash, randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { digest } from "../discovery/stable-json.mjs";
import { encodeIdempotencyRecordKey } from "../control-store/idempotency-record-key.mjs";
import { CaaSError, assertCaas } from "./errors.mjs";
import { validateDeploymentSecretReference } from "./secrets.mjs";

const phases = new Set([
  "NOT_PROVISIONED", "PROVISIONING", "PROVISIONED", "UPGRADING", "ROLLING_BACK",
  "SUSPENDING", "SUSPENDED", "DELETING", "DELETED", "DEPROVISIONING", "INTENT_READY", "ERROR",
]);
const desiredStates = new Set(["PROVISIONED", "SUSPENDED", "DELETED", "DEPROVISIONED"]);
const actorIdentifier = /^[^\s\u0000-\u001f\u007f]{3,256}$/u;
const persistedErrorCode = /^[A-Z0-9_:-]{1,64}$/u;
const tenantFields = new Set(["tenantId", "displayName", "participantId", "namespace", "endpoint", "adapterId", "connectorPlanId", "connectorPlanSnapshot", "connectorPlanDigest", "runtimeProfileRef", "deployedConnectorPlanId", "deployedConnectorPlanDigest", "connectorVersionHistory", "lifecycleOperation", "apiAccessSecretRef", "apiPrincipalId", "apiClientId", "apiKeyId", "deploymentSecretRefs", "desiredState", "observedState", "generation", "observedGeneration", "createdAt", "updatedAt", "adapterResourceId", "lastIntentDigest", "lastAppliedFencingToken", "lastError", "operationKey", "dataspaceId", "dsaasDesiredGeneration", "dsaasRequestDigest", "organizationId"]);
const versionFields = new Set(["connectorPlanId", "connectorPlanDigest", "connectorPlanSnapshot", "recordedAt"]);
const rootFields = new Set(["schemaVersion", "tenants", "requests", "audit", "integrity"]);

function snapshotPayload(state) {
  return {
    schemaVersion: state.schemaVersion,
    tenants: state.tenants,
    requests: state.requests,
  };
}

export function caasStateSnapshotDigest(state) {
  return digest(snapshotPayload(state));
}

export function emptyCaasState() {
  const state = { schemaVersion: "molit.caas-state/1", tenants: {}, requests: {}, audit: [], integrity: null };
  const snapshotDigest = caasStateSnapshotDigest(state);
  state.integrity = { algorithm: "sha-256", snapshotDigest, auditHead: null, bindingDigest: digest({ auditHead: null, snapshotDigest }) };
  return state;
}

export function validateCaasState(state) {
  assertCaas(state?.schemaVersion === "molit.caas-state/1", "CAAS_STATE_INVALID", "unsupported CaaS state");
  assertCaas(Object.keys(state).every((field) => rootFields.has(field)), "CAAS_STATE_INVALID", "CaaS state contains an unknown root field");
  for (const key of ["tenants", "requests"]) assertCaas(state[key] && typeof state[key] === "object" && !Array.isArray(state[key]), "CAAS_STATE_INVALID", `${key} must be an object`);
  assertCaas(Array.isArray(state.audit), "CAAS_STATE_INVALID", "audit must be an array");
  for (const [tenantId, tenant] of Object.entries(state.tenants)) {
    assertCaas(tenant && typeof tenant === "object" && !Array.isArray(tenant) && Object.keys(tenant).every((field) => tenantFields.has(field)), "CAAS_STATE_INVALID", "tenant state contains an unknown field", { tenantId });
    assertCaas(tenant.tenantId === tenantId && /^[a-z][a-z0-9-]{2,62}$/u.test(tenantId), "CAAS_STATE_INVALID", "tenant state key is invalid");
    assertCaas(desiredStates.has(tenant.desiredState) && phases.has(tenant.observedState), "CAAS_STATE_INVALID", "tenant lifecycle state is invalid", { tenantId });
    assertCaas(Number.isSafeInteger(tenant.generation) && tenant.generation >= 0, "CAAS_STATE_INVALID", "tenant generation is invalid", { tenantId });
    assertCaas(Number.isSafeInteger(tenant.observedGeneration) && tenant.observedGeneration >= 0 && tenant.observedGeneration <= tenant.generation, "CAAS_STATE_INVALID", "tenant observed generation is invalid", { tenantId });
    assertCaas(/^env:\/\/[A-Z_][A-Z0-9_]*$/u.test(tenant.apiAccessSecretRef), "CAAS_STATE_SECRET_VIOLATION", "tenant API credential must remain an env secret reference", { tenantId });
    assertCaas(tenant.deploymentSecretRefs && typeof tenant.deploymentSecretRefs === "object" && !Array.isArray(tenant.deploymentSecretRefs), "CAAS_STATE_INVALID", "deploymentSecretRefs must be an object", { tenantId });
    for (const reference of Object.values(tenant.deploymentSecretRefs ?? {})) {
      try { validateDeploymentSecretReference(reference); }
      catch { throw new CaaSError("CAAS_STATE_SECRET_VIOLATION", "deployment credential must remain a canonical secret reference", { tenantId }); }
    }
    for (const field of ["organizationId", "participantId", "namespace", "endpoint", "adapterId", "connectorPlanId", "runtimeProfileRef", "apiPrincipalId", "apiClientId", "apiKeyId"]) assertCaas(typeof tenant[field] === "string" && tenant[field].length > 0, "CAAS_STATE_INVALID", `tenant ${field} is missing`, { tenantId });
    for (const field of ["apiPrincipalId", "apiClientId", "apiKeyId"]) assertCaas(actorIdentifier.test(tenant[field]), "CAAS_STATE_INVALID", `tenant ${field} is invalid`, { tenantId });
    assertCaas(tenant.connectorPlanSnapshot && typeof tenant.connectorPlanSnapshot === "object" && !Array.isArray(tenant.connectorPlanSnapshot) && tenant.connectorPlanDigest === digest(tenant.connectorPlanSnapshot), "CAAS_STATE_INVALID", "tenant connector plan snapshot is missing or corrupted", { tenantId });
    assertCaas(tenant.connectorVersionHistory === undefined || (Array.isArray(tenant.connectorVersionHistory)
      && tenant.connectorVersionHistory.length <= 64), "CAAS_STATE_INVALID", "tenant connector version history is invalid", { tenantId });
    const historyDigests = new Set();
    for (const version of tenant.connectorVersionHistory ?? []) {
      assertCaas(version && typeof version === "object" && !Array.isArray(version)
        && Object.keys(version).every((field) => versionFields.has(field))
        && typeof version.connectorPlanId === "string" && version.connectorPlanId.length > 0
        && version.connectorPlanSnapshot && typeof version.connectorPlanSnapshot === "object" && !Array.isArray(version.connectorPlanSnapshot)
        && version.connectorPlanDigest === digest(version.connectorPlanSnapshot)
        && !historyDigests.has(version.connectorPlanDigest)
        && Number.isFinite(Date.parse(version.recordedAt)),
      "CAAS_STATE_INVALID", "tenant connector version history entry is invalid", { tenantId });
      historyDigests.add(version.connectorPlanDigest);
    }
    if (tenant.lifecycleOperation !== undefined) {
      assertCaas(["UPGRADE", "ROLLBACK"].includes(tenant.lifecycleOperation), "CAAS_STATE_INVALID", "tenant lifecycle operation is invalid", { tenantId });
    }
    if (tenant.deployedConnectorPlanDigest !== undefined || tenant.deployedConnectorPlanId !== undefined) {
      assertCaas(/^[a-f0-9]{64}$/u.test(tenant.deployedConnectorPlanDigest ?? "")
        && typeof tenant.deployedConnectorPlanId === "string" && tenant.deployedConnectorPlanId.length > 0,
      "CAAS_STATE_INVALID", "tenant deployed connector version is incomplete", { tenantId });
    }
    const hasDsaasGeneration = tenant.dsaasDesiredGeneration !== undefined;
    const hasDsaasRequestDigest = tenant.dsaasRequestDigest !== undefined;
    assertCaas(hasDsaasGeneration === hasDsaasRequestDigest, "CAAS_STATE_INVALID", "DSaaS generation fence is incomplete", { tenantId });
    if (hasDsaasGeneration) {
      assertCaas(Number.isSafeInteger(tenant.dsaasDesiredGeneration) && tenant.dsaasDesiredGeneration >= 1
        && /^[a-f0-9]{64}$/u.test(tenant.dsaasRequestDigest)
        && typeof tenant.dataspaceId === "string" && tenant.dataspaceId.length > 0,
      "CAAS_STATE_INVALID", "DSaaS generation fence is invalid", { tenantId });
    }
    if (tenant.lastError !== undefined) {
      assertCaas(tenant.lastError && typeof tenant.lastError === "object" && !Array.isArray(tenant.lastError) && Object.keys(tenant.lastError).every((field) => ["code", "message"].includes(field)), "CAAS_STATE_INVALID", "tenant lastError is invalid", { tenantId });
      assertCaas(persistedErrorCode.test(tenant.lastError.code ?? "") && typeof tenant.lastError.message === "string" && tenant.lastError.message.length <= 256, "CAAS_STATE_INVALID", "tenant lastError contains an invalid code or message", { tenantId });
    }
    if (tenant.lastAppliedFencingToken !== undefined) {
      assertCaas(/^[1-9][0-9]*$/u.test(tenant.lastAppliedFencingToken), "CAAS_STATE_INVALID", "tenant last-applied fencing token is invalid", { tenantId });
    }
    if (["PROVISIONING", "UPGRADING", "ROLLING_BACK", "SUSPENDING", "DELETING", "DEPROVISIONING"].includes(tenant.observedState)) assertCaas(/^[a-f0-9]{64}$/u.test(tenant.operationKey ?? ""), "CAAS_STATE_INVALID", "in-flight tenant state requires an operation key", { tenantId });
    if (tenant.observedState === "PROVISIONED") assertCaas(typeof tenant.adapterResourceId === "string" && tenant.adapterResourceId.length > 0, "CAAS_STATE_INVALID", "provisioned tenant lacks an adapter resource ID", { tenantId });
  }
  let previousDigest = null;
  state.audit.forEach((event, index) => {
    assertCaas(["admin", "controller", "tenant", "system"].includes(event.actorRole), "CAAS_AUDIT_ACTOR_INVALID", "audit event actor role is invalid", { sequence: index + 1 });
    for (const field of ["actorPrincipalId", "actorClientId", "actorKeyId"]) assertCaas(actorIdentifier.test(event[field] ?? ""), "CAAS_AUDIT_ACTOR_INVALID", `audit event ${field} is invalid`, { sequence: index + 1 });
    if (event.actorRole === "system") {
      assertCaas(event.action === "STATE_COMMITTED" && event.tenantId === undefined
        && event.actorPrincipalId === "urn:molit:principal:caas-state-store"
        && event.actorClientId === "molit-caas-state-store"
        && event.actorKeyId === "molit-caas-state-integrity-v1"
        && /^[a-f0-9]{64}$/u.test(event.stateSnapshotDigest ?? ""), "CAAS_AUDIT_ACTOR_INVALID", "system audit actor or state commit is invalid", { sequence: index + 1 });
    } else {
      assertCaas(event.action !== "STATE_COMMITTED", "CAAS_AUDIT_ACTOR_INVALID", "authenticated callers cannot emit state commit events", { sequence: index + 1 });
    }
    assertCaas(event.sequence === index + 1 && event.previousDigest === previousDigest, "CAAS_AUDIT_CHAIN_INVALID", "audit sequence or previous digest is invalid", { sequence: index + 1 });
    const { eventDigest, ...unsigned } = event;
    assertCaas(eventDigest === digest(unsigned), "CAAS_AUDIT_CHAIN_INVALID", "audit event digest is invalid", { sequence: index + 1 });
    previousDigest = eventDigest;
  });
  assertCaas(state.integrity?.algorithm === "sha-256" && Object.keys(state.integrity).length === 4
    && Object.hasOwn(state.integrity, "snapshotDigest") && Object.hasOwn(state.integrity, "auditHead") && Object.hasOwn(state.integrity, "bindingDigest"), "CAAS_STATE_SNAPSHOT_INVALID", "CaaS state snapshot integrity metadata is missing");
  const actualSnapshotDigest = caasStateSnapshotDigest(state);
  assertCaas(state.integrity.snapshotDigest === actualSnapshotDigest, "CAAS_STATE_SNAPSHOT_INVALID", "CaaS mutable state does not match its committed snapshot digest", {
    actualSnapshotDigest,
    expectedSnapshotDigest: state.integrity.snapshotDigest,
  });
  assertCaas(state.integrity.auditHead === previousDigest, "CAAS_STATE_SNAPSHOT_INVALID", "CaaS state snapshot is not bound to the current audit head");
  assertCaas(state.integrity.bindingDigest === digest({ auditHead: previousDigest, snapshotDigest: actualSnapshotDigest }), "CAAS_STATE_SNAPSHOT_INVALID", "CaaS state snapshot and audit head binding digest does not match");
  const mutableStateExists = Object.keys(state.tenants).length > 0 || Object.keys(state.requests).length > 0;
  assertCaas(!mutableStateExists || state.audit.length > 0, "CAAS_STATE_SNAPSHOT_INVALID", "non-empty CaaS state has no committing audit event");
  if (state.audit.length > 0) {
    const commit = state.audit.at(-1);
    assertCaas(commit.action === "STATE_COMMITTED" && commit.stateSnapshotDigest === actualSnapshotDigest, "CAAS_STATE_SNAPSHOT_INVALID", "CaaS audit head does not commit the current mutable state snapshot");
  }
  return state;
}

export async function loadCaasState(path, maxBytes = 128 * 1024 * 1024) {
  let handle;
  try {
    handle = await open(path, "r");
    const stats = await handle.stat();
    assertCaas(stats.size <= maxBytes, "CAAS_STATE_TOO_LARGE", "CaaS state exceeds its byte limit");
    return validateCaasState(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyCaasState();
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("CaaS state transaction was aborted");
  error.name = "AbortError";
  throw error;
}

async function save(path, state, maxBytes, { signal } = {}) {
  throwIfAborted(signal);
  validateCaasState(state);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  assertCaas(Buffer.byteLength(serialized) <= maxBytes, "CAAS_STATE_TOO_LARGE", "CaaS state exceeds its byte limit");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(serialized);
    await handle.sync();
    await handle.close();
    handle = undefined;
    // The synchronous replace is the transaction linearization point. Once
    // this abort gate passes, no signal callback can interleave before it.
    throwIfAborted(signal);
    renameSync(temporary, path);
    const directory = await open(dirname(path), "r").catch(() => null);
    await directory?.sync().catch((error) => {
      if (!["EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) throw error;
    });
    await directory?.close();
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

async function acquireLock(path) {
  const handle = await open(path, "wx", 0o600);
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() })}\n`);
  await handle.sync();
  return handle;
}

async function withLock(lockPath, conflictCode, operation, { signal } = {}) {
  throwIfAborted(signal);
  await mkdir(dirname(lockPath), { recursive: true });
  let lock;
  try { lock = await acquireLock(lockPath); } catch (error) {
    if (error?.code === "EEXIST") throw new CaaSError(conflictCode, "CaaS state operation is already in progress", { status: 409 });
    throw error;
  }
  try {
    throwIfAborted(signal);
    return await operation();
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export async function withCaasState(path, operation, { maxBytes = 128 * 1024 * 1024, maxAuditEvents = 1_000_000, now = () => new Date(), signal } = {}) {
  return withLock(`${path}.lock`, "CAAS_STATE_LOCKED", async () => {
    const state = await loadCaasState(path, maxBytes);
    const result = await operation(state);
    throwIfAborted(signal);
    sealCaasState(state, { maxAuditEvents, now: typeof now === "function" ? now() : now });
    await save(path, state, maxBytes, { signal });
    return result;
  }, { signal });
}

export async function withTenantOperationLock(statePath, tenantId, operation, { signal } = {}) {
  const token = createHash("sha256").update(tenantId).digest("hex");
  return withLock(`${statePath}.tenant-${token}.lock`, "CAAS_TENANT_BUSY", operation, { signal });
}

export function appendAudit(state, value, { maxAuditEvents, now = new Date() }) {
  assertCaas(state.audit.length < maxAuditEvents, "CAAS_AUDIT_CAPACITY_EXCEEDED", "audit capacity is exhausted; export and rotate under an approved procedure", { status: 507 });
  assertCaas(!state.audit.length || now.getTime() >= Date.parse(state.audit.at(-1).occurredAt), "CAAS_CLOCK_ROLLBACK", "audit clock cannot move backward");
  const unsigned = {
    sequence: state.audit.length + 1,
    previousDigest: state.audit.at(-1)?.eventDigest ?? null,
    occurredAt: now.toISOString(),
    ...value,
  };
  const event = { ...unsigned, eventDigest: digest(unsigned) };
  state.audit.push(event);
  return event;
}

export function sealCaasState(state, { maxAuditEvents, now }) {
  const stateSnapshotDigest = caasStateSnapshotDigest(state);
  const currentAuditHead = state.audit.at(-1)?.eventDigest ?? null;
  if (state.integrity?.snapshotDigest === stateSnapshotDigest && state.integrity?.auditHead === currentAuditHead) return state;
  const commit = appendAudit(state, {
    action: "STATE_COMMITTED",
    actorRole: "system",
    actorPrincipalId: "urn:molit:principal:caas-state-store",
    actorClientId: "molit-caas-state-store",
    actorKeyId: "molit-caas-state-integrity-v1",
    stateSnapshotDigest,
  }, { maxAuditEvents, now });
  state.integrity = {
    algorithm: "sha-256",
    snapshotDigest: stateSnapshotDigest,
    auditHead: commit.eventDigest,
    bindingDigest: digest({ auditHead: commit.eventDigest, snapshotDigest: stateSnapshotDigest }),
  };
  return state;
}

export class FileCaasStore {
  constructor({ path, maxBytes = 128 * 1024 * 1024, maxAuditEvents = 1_000_000, clock = () => new Date() }) {
    assertCaas(typeof path === "string" && path.length > 0, "CAAS_STATE_INVALID", "CaaS file store path is required");
    Object.assign(this, {
      kind: "file",
      supportsDistributedFencing: false,
      path,
      maxBytes,
      maxAuditEvents,
      clock,
      holderId: `file:${hostname()}:${process.pid}`,
      closed: false,
    });
  }

  #assertOpen() {
    assertCaas(!this.closed, "CAAS_STATE_CLOSED", "CaaS file store is closed");
  }

  async initialize({ signal } = {}) {
    this.#assertOpen();
    throwIfAborted(signal);
    await loadCaasState(this.path, this.maxBytes);
    throwIfAborted(signal);
  }

  async read(operation = (state) => state, { signal } = {}) {
    this.#assertOpen();
    throwIfAborted(signal);
    const state = await loadCaasState(this.path, this.maxBytes);
    const result = await operation(structuredClone(state));
    throwIfAborted(signal);
    return structuredClone(result);
  }

  async transact(operation, { signal } = {}) {
    this.#assertOpen();
    return structuredClone(await withCaasState(this.path, operation, {
      maxBytes: this.maxBytes,
      maxAuditEvents: this.maxAuditEvents,
      now: this.clock,
      signal,
    }));
  }

  async withResourceLock(resourceId, operation, { signal } = {}) {
    this.#assertOpen();
    assertCaas(typeof resourceId === "string" && resourceId.length >= 3 && resourceId.length <= 1024,
      "CAAS_STATE_INVALID", "CaaS resource identifier is invalid");
    assertCaas(typeof operation === "function", "CAAS_STATE_INVALID", "CaaS resource operation is invalid");
    return structuredClone(await withTenantOperationLock(this.path, resourceId, () => operation(Object.freeze({
      resourceId,
      holderId: this.holderId,
      fencingToken: null,
      acquiredAt: this.clock().toISOString(),
      signal,
    })), { signal }));
  }

  async readiness({ signal } = {}) {
    if (this.closed) return Object.freeze({ ready: false, status: "CLOSED", failureCode: "CAAS_STATE_CLOSED" });
    try {
      await this.read(() => null, { signal });
      return Object.freeze({ ready: true, status: "READY", failureCode: null });
    } catch (error) {
      return Object.freeze({ ready: false, status: "NOT_READY", failureCode: error?.code ?? "CAAS_STATE_UNAVAILABLE" });
    }
  }

  async close() {
    this.closed = true;
  }
}

export function idempotencyReplay(state, scope, key, payload) {
  assertCaas(typeof key === "string" && /^[^\u0000-\u001f\u007f]{1,256}$/u.test(key), "CAAS_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", { status: 400 });
  const scopeId = scope.slice(scope.indexOf(":") + 1);
  assertCaas(/^[a-z][a-z0-9-]{0,62}$/u.test(scopeId), "CAAS_IDEMPOTENCY_SCOPE_INVALID", "idempotency scope is invalid");
  const ledgerKey = encodeIdempotencyRecordKey(scope, key);
  const legacyLedgerKey = `${scope}\u0000${key}`;
  const payloadDigest = digest(payload);
  const existing = state.requests[ledgerKey] ?? state.requests[legacyLedgerKey];
  if (existing) {
    assertCaas(existing.payloadDigest === payloadDigest, "CAAS_IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different request", { status: 409 });
    assertCaas(existing.scopeId === undefined || existing.scopeId === scopeId, "CAAS_IDEMPOTENCY_SCOPE_INVALID", "idempotency record belongs to another tenant");
    return { ledgerKey: Object.hasOwn(state.requests, ledgerKey) ? ledgerKey : legacyLedgerKey, payloadDigest, result: structuredClone(existing.result), scopeId };
  }
  return { ledgerKey, payloadDigest, result: null, scopeId };
}

export function recordIdempotency(state, replay, result, now = new Date()) {
  state.requests[replay.ledgerKey] = {
    scopeId: replay.scopeId,
    payloadDigest: replay.payloadDigest,
    completedAt: now.toISOString(),
    result: structuredClone(result),
  };
}
