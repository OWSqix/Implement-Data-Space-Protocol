import { createHash, randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname } from "node:os";

import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { digest } from "../discovery/stable-json.mjs";

const STATE_FIELDS = Object.freeze(["schemaVersion", "dataspaces", "idempotency", "audit", "integrity"]);

function snapshotPayload(state) {
  return {
    schemaVersion: state.schemaVersion,
    dataspaces: state.dataspaces,
    idempotency: state.idempotency,
  };
}

export function dsaasStateSnapshotDigest(state) {
  return digest(snapshotPayload(state));
}

export function emptyDsaasState() {
  const state = {
    schemaVersion: "molit.dsaas-state/1",
    dataspaces: {},
    idempotency: {},
    audit: { head: null, events: [] },
    integrity: null,
  };
  state.integrity = {
    algorithm: "sha-256",
    snapshotDigest: dsaasStateSnapshotDigest(state),
    auditHead: null,
    bindingDigest: digest({ auditHead: null, snapshotDigest: dsaasStateSnapshotDigest(state) }),
  };
  return state;
}

function auditPayload(event) {
  const { hash, ...payload } = event;
  return payload;
}

export function validateDsaasState(state) {
  assertRuntime(state?.schemaVersion === "molit.dsaas-state/1", "DSAAS_STATE_INVALID", "DSaaS state schemaVersion is invalid");
  assertRuntime(Object.keys(state).every((field) => STATE_FIELDS.includes(field)), "DSAAS_STATE_INVALID", "DSaaS state contains an unsupported root field");
  for (const field of ["dataspaces", "idempotency"]) {
    assertRuntime(state[field] && typeof state[field] === "object" && !Array.isArray(state[field]), "DSAAS_STATE_INVALID", `DSaaS state ${field} is invalid`);
  }
  assertRuntime(Array.isArray(state.audit?.events), "DSAAS_STATE_INVALID", "DSaaS audit log is invalid");
  let previous = null;
  let previousAt = -Infinity;
  for (let index = 0; index < state.audit.events.length; index += 1) {
    const event = state.audit.events[index];
    const eventAt = Date.parse(event.at);
    assertRuntime(Number.isFinite(eventAt), "DSAAS_AUDIT_TIME_INVALID", "DSaaS audit event timestamp is invalid", { sequence: event.sequence });
    assertRuntime(eventAt >= previousAt, "DSAAS_CLOCK_ROLLBACK", "DSaaS audit event clock cannot move backward", { sequence: event.sequence });
    previousAt = eventAt;
    const identifier = /^[^\s\u0000-\u001f\u007f]{3,256}$/u;
    assertRuntime(identifier.test(event.actor ?? "") && event.actorPrincipalId === event.actor
      && identifier.test(event.actorClientId ?? "") && identifier.test(event.actorKeyId ?? ""), "DSAAS_AUDIT_ACTOR_INVALID", "DSaaS audit actor attribution is invalid", { sequence: event.sequence });
    assertRuntime(Array.isArray(event.actorRoles) && event.actorRoles.length > 0
      && event.actorRoles.every((role) => identifier.test(role))
      && event.actorRoles.includes(event.actorUsedRole), "DSAAS_AUDIT_ACTOR_INVALID", "DSaaS audit actor roles are invalid", { sequence: event.sequence });
    if (event.action === "state.commit") {
      assertRuntime(event.actor === "system:dsaas-state-store"
        && event.actorClientId === "molit-dsaas-state-store"
        && event.actorKeyId === "molit-dsaas-state-integrity-v1"
        && event.actorUsedRole === "system" && event.actorRoles.length === 1 && event.actorRoles[0] === "system", "DSAAS_AUDIT_ACTOR_INVALID", "DSaaS state commit actor is invalid", { sequence: event.sequence });
    } else {
      assertRuntime(["dsaas.operator", "dsaas.dataspace-admin", "dsaas.auditor"].includes(event.actorUsedRole), "DSAAS_AUDIT_ACTOR_INVALID", "DSaaS audit used role is not recognized", { sequence: event.sequence });
    }
    assertRuntime(event.sequence === index + 1 && event.previousHash === previous, "DSAAS_AUDIT_CHAIN_INVALID", "DSaaS audit sequence or previous hash is invalid", { sequence: event.sequence });
    assertRuntime(event.hash === digest(auditPayload(event)), "DSAAS_AUDIT_CHAIN_INVALID", "DSaaS audit event digest does not match", { sequence: event.sequence });
    previous = event.hash;
  }
  assertRuntime(state.audit.head === previous, "DSAAS_AUDIT_CHAIN_INVALID", "DSaaS audit head does not match the event chain");
  assertRuntime(state.integrity?.algorithm === "sha-256", "DSAAS_STATE_SNAPSHOT_INVALID", "DSaaS state snapshot integrity metadata is missing");
  const actualSnapshotDigest = dsaasStateSnapshotDigest(state);
  assertRuntime(state.integrity.snapshotDigest === actualSnapshotDigest, "DSAAS_STATE_SNAPSHOT_INVALID", "DSaaS mutable state does not match its committed snapshot digest", {
    actualSnapshotDigest,
    expectedSnapshotDigest: state.integrity.snapshotDigest,
  });
  assertRuntime(state.integrity.auditHead === state.audit.head, "DSAAS_STATE_SNAPSHOT_INVALID", "DSaaS state snapshot is not bound to the current audit head");
  assertRuntime(state.integrity.bindingDigest === digest({ auditHead: state.audit.head, snapshotDigest: actualSnapshotDigest }), "DSAAS_STATE_SNAPSHOT_INVALID", "DSaaS state snapshot and audit head binding digest does not match");
  const mutableStateExists = Object.keys(state.dataspaces).length > 0 || Object.keys(state.idempotency).length > 0;
  assertRuntime(!mutableStateExists || state.audit.events.length > 0, "DSAAS_STATE_SNAPSHOT_INVALID", "non-empty DSaaS state has no committing audit event");
  if (state.audit.events.length > 0) {
    const commit = state.audit.events.at(-1);
    assertRuntime(commit.action === "state.commit" && commit.stateSnapshotDigest === actualSnapshotDigest, "DSAAS_STATE_SNAPSHOT_INVALID", "DSaaS audit head does not commit the current mutable state snapshot");
  }
  for (const [dataspaceId, record] of Object.entries(state.dataspaces)) {
    assertRuntime(record?.spec?.dataspaceId === dataspaceId, "DSAAS_STATE_INVALID", "dataspace key and specification ID differ", { dataspaceId });
    assertRuntime(Number.isSafeInteger(record.revision) && record.revision > 0, "DSAAS_STATE_INVALID", "dataspace revision is invalid", { dataspaceId });
    assertRuntime(Number.isSafeInteger(record.desiredGeneration) && record.desiredGeneration > 0, "DSAAS_STATE_INVALID", "dataspace desired generation is invalid", { dataspaceId });
    assertRuntime(Number.isSafeInteger(record.appliedGeneration) && record.appliedGeneration >= 0 && record.appliedGeneration <= record.desiredGeneration, "DSAAS_STATE_INVALID", "dataspace applied generation is invalid", { dataspaceId });
    assertRuntime(typeof record.reconcilePending === "boolean", "DSAAS_STATE_INVALID", "dataspace reconciliation marker is invalid", { dataspaceId });
    assertRuntime(record.nextCheckAt === undefined || record.nextCheckAt === null || Number.isFinite(Date.parse(record.nextCheckAt)), "DSAAS_STATE_INVALID", "dataspace nextCheckAt is invalid", { dataspaceId });
    assertRuntime(record.serviceRegistrySha256 === undefined || record.serviceRegistrySha256 === null || /^[a-f0-9]{64}$/u.test(record.serviceRegistrySha256), "DSAAS_STATE_INVALID", "dataspace service registry digest is invalid", { dataspaceId });
    assertRuntime(record.participants && typeof record.participants === "object" && !Array.isArray(record.participants), "DSAAS_STATE_INVALID", "dataspace participants are invalid", { dataspaceId });
    if (record.caasRetry !== undefined && record.caasRetry !== null) {
      const retry = record.caasRetry;
      const retryFields = ["desiredGeneration", "attempt", "errorFingerprint", "errorCodes", "firstFailureAt", "lastFailureAt", "nominalDelayMs", "jitterPermille", "delayMs", "nextRetryAt", "jitterPolicy"];
      assertRuntime(retry && typeof retry === "object" && !Array.isArray(retry)
        && Object.keys(retry).length === retryFields.length
        && Object.keys(retry).every((field) => retryFields.includes(field)), "DSAAS_STATE_INVALID", "dataspace CaaS retry metadata is invalid", { dataspaceId });
      assertRuntime(retry.desiredGeneration === record.desiredGeneration
        && Number.isSafeInteger(retry.attempt) && retry.attempt >= 1 && retry.attempt <= 64
        && /^[a-f0-9]{64}$/u.test(retry.errorFingerprint)
        && Array.isArray(retry.errorCodes) && retry.errorCodes.length > 0
        && retry.errorCodes.length <= Object.keys(record.participants).length
        && retry.errorCodes.every((code) => /^[A-Z][A-Z0-9_:-]{0,63}$/u.test(code))
        && new Set(retry.errorCodes).size === retry.errorCodes.length
        && [...retry.errorCodes].sort().every((code, index) => code === retry.errorCodes[index])
        && Number.isSafeInteger(retry.nominalDelayMs) && retry.nominalDelayMs >= 1000 && retry.nominalDelayMs <= 604_800_000
        && Number.isSafeInteger(retry.jitterPermille)
        && retry.jitterPermille === 750 + (Number.parseInt(digest({ attempt: retry.attempt, dataspaceId, errorFingerprint: retry.errorFingerprint }).slice(0, 8), 16) % 251)
        && Number.isSafeInteger(retry.delayMs) && retry.delayMs === Math.max(1000, Math.floor((retry.nominalDelayMs * retry.jitterPermille) / 1000))
        && retry.jitterPolicy === "stable-hash-75-100", "DSAAS_STATE_INVALID", "dataspace CaaS retry values are invalid", { dataspaceId });
      const firstFailureAt = Date.parse(retry.firstFailureAt);
      const lastFailureAt = Date.parse(retry.lastFailureAt);
      const nextRetryAt = Date.parse(retry.nextRetryAt);
      assertRuntime(Number.isFinite(firstFailureAt) && Number.isFinite(lastFailureAt) && Number.isFinite(nextRetryAt)
        && firstFailureAt <= lastFailureAt && nextRetryAt === lastFailureAt + retry.delayMs,
      "DSAAS_STATE_INVALID", "dataspace CaaS retry timestamps are invalid", { dataspaceId });
    }
  }
  return state;
}

export function appendAudit(state, { actor, actorPrincipalId, actorClientId, actorKeyId, actorRoles, actorUsedRole, action, resource, outcome, detailsDigest = null, at = new Date().toISOString(), stateSnapshotDigest }) {
  const eventAt = Date.parse(at);
  assertRuntime(Number.isFinite(eventAt), "DSAAS_AUDIT_TIME_INVALID", "DSaaS audit event timestamp is invalid");
  const previousAt = state.audit.events.length === 0 ? -Infinity : Date.parse(state.audit.events.at(-1).at);
  assertRuntime(eventAt >= previousAt, "DSAAS_CLOCK_ROLLBACK", "DSaaS audit event clock cannot move backward");
  const event = {
    sequence: state.audit.events.length + 1,
    at,
    actor,
    actorPrincipalId,
    actorClientId,
    actorKeyId,
    actorRoles,
    actorUsedRole,
    action,
    resource,
    outcome,
    detailsDigest,
    previousHash: state.audit.head,
  };
  if (stateSnapshotDigest !== undefined) event.stateSnapshotDigest = stateSnapshotDigest;
  event.hash = digest(event);
  state.audit.events.push(event);
  state.audit.head = event.hash;
  return event;
}

export function sealDsaasState(state, at) {
  const stateSnapshotDigest = dsaasStateSnapshotDigest(state);
  const unchanged = state.integrity?.snapshotDigest === stateSnapshotDigest
    && state.integrity?.auditHead === state.audit.head;
  if (unchanged) return state;
  appendAudit(state, {
    actor: "system:dsaas-state-store",
    actorPrincipalId: "system:dsaas-state-store",
    actorClientId: "molit-dsaas-state-store",
    actorKeyId: "molit-dsaas-state-integrity-v1",
    actorRoles: ["system"],
    actorUsedRole: "system",
    action: "state.commit",
    resource: "dsaas-state",
    outcome: "committed",
    detailsDigest: stateSnapshotDigest,
    stateSnapshotDigest,
    at,
  });
  state.integrity = {
    algorithm: "sha-256",
    snapshotDigest: stateSnapshotDigest,
    auditHead: state.audit.head,
    bindingDigest: digest({ auditHead: state.audit.head, snapshotDigest: stateSnapshotDigest }),
  };
  return state;
}

async function acquireLock(lockPath, now) {
  const handle = await open(lockPath, "wx", 0o600);
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, host: hostname(), at: now() })}\n`);
  await handle.sync();
  return handle;
}

async function load(path, maxBytes) {
  let handle;
  try {
    handle = await open(path, "r");
    const stats = await handle.stat();
    assertRuntime(stats.size <= maxBytes, "DSAAS_STATE_TOO_LARGE", "DSaaS state exceeds the configured byte limit");
    return validateDsaasState(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyDsaasState();
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("DSaaS state transaction was aborted");
  error.name = "AbortError";
  throw error;
}

async function save(path, state, maxBytes, { signal } = {}) {
  throwIfAborted(signal);
  validateDsaasState(state);
  const body = `${JSON.stringify(state, null, 2)}\n`;
  assertRuntime(Buffer.byteLength(body) <= maxBytes, "DSAAS_STATE_TOO_LARGE", "DSaaS state exceeds the configured byte limit");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(body);
    await handle.sync();
    await handle.close();
    handle = undefined;
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

export class FileDsaasStore {
  constructor({ path, maxBytes = 64 * 1024 * 1024, clock = () => new Date() }) {
    this.path = path;
    this.maxBytes = maxBytes;
    this.clock = clock;
  }

  now() { return this.clock().toISOString(); }

  async read(operation = (state) => state) {
    const state = await load(this.path, this.maxBytes);
    return structuredClone(await operation(state));
  }

  async transact(operation, { signal } = {}) {
    throwIfAborted(signal);
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    let lock;
    try {
      lock = await acquireLock(lockPath, () => this.now());
    } catch (error) {
      if (error?.code === "EEXIST") throw new RuntimeError("DSAAS_STATE_LOCKED", "DSaaS state lock exists; automatic stale-lock removal is forbidden and manual recovery is required", { lockPath });
      throw error;
    }
    try {
      const state = await load(this.path, this.maxBytes);
      const result = await operation(state);
      throwIfAborted(signal);
      sealDsaasState(state, this.now());
      await save(this.path, state, this.maxBytes, { signal });
      return structuredClone(result);
    } finally {
      await lock?.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
    }
  }

  async withResourceLock(resourceId, operation) {
    await mkdir(dirname(this.path), { recursive: true });
    const token = createHash("sha256").update(resourceId).digest("hex");
    const lockPath = `${this.path}.resource-${token}.lock`;
    let lock;
    try {
      lock = await acquireLock(lockPath, () => this.now());
    } catch (error) {
      if (error?.code === "EEXIST") throw new RuntimeError("DSAAS_RECONCILE_IN_PROGRESS", "DSaaS resource lock exists; automatic stale-lock removal is forbidden and manual recovery is required", { lockPath, resourceId });
      throw error;
    }
    try {
      return await operation();
    } finally {
      await lock?.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
    }
  }

  async close() {}
}
