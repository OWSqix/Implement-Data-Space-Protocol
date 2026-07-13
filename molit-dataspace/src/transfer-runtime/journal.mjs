import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { digest } from "../discovery/stable-json.mjs";

export function emptyTransferJournal() {
  return { schemaVersion: "molit.provider-transfer-journal/1", records: {} };
}

export function validateTransferJournal(journal) {
  assertRuntime(journal?.schemaVersion === "molit.provider-transfer-journal/1" && journal.records && typeof journal.records === "object" && !Array.isArray(journal.records), "TRANSFER_JOURNAL_INVALID", "invalid provider transfer journal");
  for (const [providerPid, record] of Object.entries(journal.records)) {
    assertRuntime(record.providerPid === providerPid, "TRANSFER_JOURNAL_INVALID", "journal key and providerPid differ");
    assertRuntime(["authorized", "provisioned", "active", "terminating", "revoked", "terminated"].includes(record.phase), "TRANSFER_JOURNAL_INVALID", "journal phase is invalid", { providerPid });
    for (const field of ["consumerPid", "agreementId", "datasetId", "format", "provisionerId"]) assertRuntime(typeof record[field] === "string" && record[field].length > 0, "TRANSFER_JOURNAL_INVALID", `journal ${field} is missing`, { providerPid });
    assertRuntime(typeof record.bindingDigest === "string" && record.bindingDigest.length === 64 && record.bindingSnapshot?.datasetId === record.datasetId && record.bindingSnapshot?.format === record.format && record.bindingSnapshot?.provisionerId === record.provisionerId && digest(record.bindingSnapshot) === record.bindingDigest, "TRANSFER_JOURNAL_INVALID", "immutable binding snapshot or digest is missing or corrupted", { providerPid });
    assertRuntime(record.dataAddress === undefined, "TRANSFER_JOURNAL_SECRET_FORBIDDEN", "DataAddress material must never be persisted in the transfer journal", { providerPid });
    if (["provisioned", "active"].includes(record.phase)) {
      for (const field of ["provisioningId", "provisionIdempotencyKey", "dataAddressDigest", "provisionedAt"]) assertRuntime(typeof record[field] === "string" && record[field].length > 0, "TRANSFER_JOURNAL_INVALID", `journal ${field} is missing`, { providerPid });
    }
    if (["revoked", "terminated"].includes(record.phase)) assertRuntime(typeof record.revokedAt === "string" && typeof record.revokeIdempotencyKey === "string", "TRANSFER_JOURNAL_INVALID", "revocation evidence is missing", { providerPid });
  }
  return journal;
}

async function acquireProcessLock(lockPath) {
  async function acquire(recovered = false) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() })}\n`);
      await handle.sync();
      return handle;
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
  return acquire();
}

/** Serializes all external side effects for one provider PID across CLI processes. */
export async function withProviderOperationLock(journalPath, providerPid, operation) {
  await mkdir(dirname(journalPath), { recursive: true });
  const token = createHash("sha256").update(providerPid).digest("hex");
  const lockPath = `${journalPath}.provider-${token}.lock`;
  let lock;
  try { lock = await acquireProcessLock(lockPath); } catch (error) {
    if (error?.code === "EEXIST") throw new RuntimeError("TRANSFER_OPERATION_IN_PROGRESS", "another lifecycle operation holds the provider lock", { providerPid });
    throw error;
  }
  try { return await operation(); } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export async function loadTransferJournal(path, maxBytes = 64 * 1024 * 1024) {
  let handle;
  try {
    handle = await open(path, "r");
    const stats = await handle.stat();
    assertRuntime(stats.size <= maxBytes, "TRANSFER_JOURNAL_TOO_LARGE", "provider transfer journal exceeds the byte limit");
    return validateTransferJournal(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyTransferJournal();
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function save(path, journal, maxBytes) {
  validateTransferJournal(journal);
  const body = `${JSON.stringify(journal, null, 2)}\n`;
  assertRuntime(Buffer.byteLength(body) <= maxBytes, "TRANSFER_JOURNAL_TOO_LARGE", "provider transfer journal exceeds the byte limit");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(body);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
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

export async function withTransferJournal(path, operation, { maxBytes = 64 * 1024 * 1024 } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let lock;
  try { lock = await acquireProcessLock(lockPath); } catch (error) {
    if (error?.code === "EEXIST") throw new RuntimeError("TRANSFER_JOURNAL_LOCKED", "provider transfer journal is locked");
    throw error;
  }
  try {
    const journal = await loadTransferJournal(path, maxBytes);
    const result = await operation(journal);
    await save(path, journal, maxBytes);
    return result;
  } finally {
    await lock?.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}
