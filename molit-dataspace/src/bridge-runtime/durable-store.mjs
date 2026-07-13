import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { assertRuntime } from "./errors.mjs";

export function emptyRuntimeState() {
  return {
    schemaVersion: "molit.bridge-runtime/1",
    checkpoints: {},
    queue: {},
    completed: {},
    deadLetters: {},
    quarantine: {},
  };
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateRuntimeState(state) {
  assertRuntime(state?.schemaVersion === "molit.bridge-runtime/1", "INVALID_RUNTIME_STATE", "unsupported runtime state");
  for (const key of ["checkpoints", "queue", "completed", "deadLetters", "quarantine"]) {
    assertRuntime(state[key] && typeof state[key] === "object" && !Array.isArray(state[key]), "INVALID_RUNTIME_STATE", `${key} must be an object`);
  }
  for (const [id, item] of Object.entries(state.queue)) {
    assertRuntime(item.id === id && ["ready", "leased"].includes(item.status), "INVALID_QUEUE_ITEM", "queue key/status mismatch", { id });
    assertRuntime(Number.isSafeInteger(item.attempts) && item.attempts >= 0, "INVALID_QUEUE_ITEM", "invalid attempt count", { id });
    assertRuntime(validTimestamp(item.availableAt), "INVALID_QUEUE_ITEM", "invalid availableAt", { id });
    if (item.status === "leased") {
      assertRuntime(typeof item.leaseOwner === "string" && validTimestamp(item.leaseUntil), "INVALID_QUEUE_ITEM", "leased item lacks owner or expiry", { id });
    }
  }
  return state;
}

export async function loadRuntimeState(path, { maxBytes = 128 * 1024 * 1024 } = {}) {
  let handle;
  try {
    handle = await open(path, "r");
    const stats = await handle.stat();
    assertRuntime(stats.size <= maxBytes, "RUNTIME_STATE_TOO_LARGE", "runtime state exceeds byte limit");
    return validateRuntimeState(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyRuntimeState();
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function saveRuntimeState(path, state, { maxBytes = 128 * 1024 * 1024 } = {}) {
  validateRuntimeState(state);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  assertRuntime(Buffer.byteLength(serialized) <= maxBytes, "RUNTIME_STATE_TOO_LARGE", "runtime state exceeds byte limit");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    const directory = await open(dirname(path), "r").catch(() => null);
    await directory?.sync().catch((error) => {
      if (!(["EINVAL", "ENOTSUP", "EPERM"].includes(error?.code))) throw error;
    });
    await directory?.close();
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function withRuntimeLock(path, operation) {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let handle;
  async function acquire(recovered = false) {
    try {
      const acquired = await open(lockPath, "wx", 0o600);
      await acquired.writeFile(`${JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() })}\n`);
      await acquired.sync();
      return acquired;
    } catch (error) {
      if (error?.code !== "EEXIST" || recovered) throw error;
      let owner;
      try { owner = JSON.parse(await readFile(lockPath, "utf8")); } catch { throw error; }
      if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid)) throw error;
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (probe) { if (probe?.code === "ESRCH") alive = false; }
      if (alive) throw error;
      await unlink(lockPath);
      return acquire(true);
    }
  }
  try {
    handle = await acquire();
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") throw new Error(`runtime state is locked: ${lockPath}`);
    throw error;
  }
  try {
    const state = await loadRuntimeState(path);
    const result = await operation(state);
    await saveRuntimeState(path, state);
    return result;
  } finally {
    await handle.close();
    await unlink(lockPath);
  }
}

export function enqueue(state, { idempotencyKey, payload }, now = new Date()) {
  assertRuntime(typeof idempotencyKey === "string" && idempotencyKey.length <= 512, "INVALID_IDEMPOTENCY_KEY", "idempotency key is required");
  if (state.queue[idempotencyKey] || state.completed[idempotencyKey] || state.deadLetters[idempotencyKey]) return false;
  state.queue[idempotencyKey] = {
    id: idempotencyKey,
    status: "ready",
    attempts: 0,
    availableAt: now.toISOString(),
    enqueuedAt: now.toISOString(),
    payload,
  };
  return true;
}

export function recoverExpiredLeases(state, now = new Date()) {
  let recovered = 0;
  for (const item of Object.values(state.queue)) {
    if (item.status === "leased" && Date.parse(item.leaseUntil) <= now.getTime()) {
      item.status = "ready";
      item.availableAt = now.toISOString();
      delete item.leaseOwner;
      delete item.leaseUntil;
      recovered += 1;
    }
  }
  return recovered;
}

export function claim(state, { owner, limit = 10, leaseMs = 30_000, now = new Date() }) {
  recoverExpiredLeases(state, now);
  const due = Object.values(state.queue)
    .filter((item) => item.status === "ready" && Date.parse(item.availableAt) <= now.getTime())
    .sort((a, b) => Date.parse(a.enqueuedAt) - Date.parse(b.enqueuedAt) || a.id.localeCompare(b.id))
    .slice(0, limit);
  for (const item of due) {
    item.status = "leased";
    item.leaseOwner = owner;
    item.leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
  }
  return structuredClone(due);
}

function requireLease(state, id, owner) {
  const item = state.queue[id];
  assertRuntime(item?.status === "leased" && item.leaseOwner === owner, "LEASE_MISMATCH", "queue item is not leased by this worker", { id });
  return item;
}

export function ack(state, id, owner, result, now = new Date()) {
  const item = requireLease(state, id, owner);
  state.completed[id] = { completedAt: now.toISOString(), attempts: item.attempts + 1, result };
  delete state.queue[id];
}

export function nack(state, id, owner, error, { maxAttempts = 8, delayMs = 1_000, now = new Date() } = {}) {
  const item = requireLease(state, id, owner);
  item.attempts += 1;
  const safeError = { code: error?.code ?? "DELIVERY_FAILED", message: String(error?.message ?? "delivery failed").slice(0, 500) };
  if (item.attempts >= maxAttempts) {
    state.deadLetters[id] = { ...item, status: "dead", failedAt: now.toISOString(), lastError: safeError };
    delete state.queue[id];
    return "dead";
  }
  item.status = "ready";
  item.availableAt = new Date(now.getTime() + delayMs).toISOString();
  item.lastError = safeError;
  delete item.leaseOwner;
  delete item.leaseUntil;
  return "ready";
}

export function renewLease(state, id, owner, leaseMs, now = new Date()) {
  const item = requireLease(state, id, owner);
  item.leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
}
