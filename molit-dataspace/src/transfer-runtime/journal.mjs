import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { digest } from "../discovery/stable-json.mjs";
import canonicalize from "canonicalize";

const JOURNAL_INTEGRITY_DOMAIN = "molit.provider-transfer-journal.integrity";
const JOURNAL_INTEGRITY_VERSION = 1;
const JOURNAL_INTEGRITY_ALGORITHM = "hmac-sha256";
const JOURNAL_INTEGRITY_FIELDS = ["algorithm", "domain", "keyId", "mac", "version"];

export function emptyTransferJournal() {
  return { schemaVersion: "molit.provider-transfer-journal/1", revision: 0, records: {}, integrity: null };
}

function validateIntegrityOptions({ integrityKey, integrityKeyId } = {}) {
  assertRuntime(typeof integrityKey === "string" && Buffer.byteLength(integrityKey, "utf8") >= 32 && !/[\u0000-\u001f\u007f]/u.test(integrityKey), "TRANSFER_JOURNAL_INTEGRITY_KEY_INVALID", "provider transfer journal HMAC key must be at least 32 bytes and free of control characters");
  assertRuntime(typeof integrityKeyId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(integrityKeyId), "TRANSFER_JOURNAL_INTEGRITY_KEY_INVALID", "provider transfer journal HMAC key identifier is invalid");
  return { integrityKey, integrityKeyId };
}

function journalMac(journal, key, metadata) {
  const payload = canonicalize({
    domain: metadata.domain,
    version: metadata.version,
    algorithm: metadata.algorithm,
    keyId: metadata.keyId,
    journal: {
      schemaVersion: journal.schemaVersion,
      revision: journal.revision,
      records: journal.records,
    },
  });
  assertRuntime(typeof payload === "string", "TRANSFER_JOURNAL_INVALID", "provider transfer journal cannot be canonicalized");
  return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

function validateJournalRecords(journal) {
  assertRuntime(journal?.schemaVersion === "molit.provider-transfer-journal/1" && Number.isSafeInteger(journal.revision) && journal.revision >= 0 && journal.records && typeof journal.records === "object" && !Array.isArray(journal.records), "TRANSFER_JOURNAL_INVALID", "invalid provider transfer journal");
  for (const [providerPid, record] of Object.entries(journal.records)) {
    assertRuntime(record.providerPid === providerPid, "TRANSFER_JOURNAL_INVALID", "journal key and providerPid differ");
    assertRuntime(["authorized", "provisioned", "active", "terminating", "revoked", "terminated"].includes(record.phase), "TRANSFER_JOURNAL_INVALID", "journal phase is invalid", { providerPid });
    for (const field of ["consumerPid", "agreementId", "datasetId", "format", "provisionerId"]) assertRuntime(typeof record[field] === "string" && record[field].length > 0, "TRANSFER_JOURNAL_INVALID", `journal ${field} is missing`, { providerPid });
    assertRuntime(typeof record.bindingDigest === "string" && record.bindingDigest.length === 64 && record.bindingSnapshot?.datasetId === record.datasetId && record.bindingSnapshot?.format === record.format && record.bindingSnapshot?.provisionerId === record.provisionerId && digest(record.bindingSnapshot) === record.bindingDigest, "TRANSFER_JOURNAL_INVALID", "immutable binding snapshot or digest is missing or corrupted", { providerPid });
    assertRuntime(record.dataAddress === undefined, "TRANSFER_JOURNAL_SECRET_FORBIDDEN", "DataAddress material must never be persisted in the transfer journal", { providerPid });
    if (["provisioned", "active"].includes(record.phase)) {
      for (const field of ["provisioningId", "provisionIdempotencyKey", "dataAddressDigest", "provisionedAt"]) assertRuntime(typeof record[field] === "string" && record[field].length > 0, "TRANSFER_JOURNAL_INVALID", `journal ${field} is missing`, { providerPid });
    }
    if (["terminating", "revoked", "terminated"].includes(record.phase)) {
      assertRuntime(record.provisioningId === null || (typeof record.provisioningId === "string" && record.provisioningId.length > 0 && record.provisioningId.length <= 512), "TRANSFER_JOURNAL_INVALID", "revocation provisioningId correlation is missing", { providerPid });
    }
    if (["revoked", "terminated"].includes(record.phase)) assertRuntime(typeof record.revokedAt === "string" && typeof record.revokeIdempotencyKey === "string" && /^[a-f0-9]{64}$/u.test(record.revokeReceiptDigest ?? ""), "TRANSFER_JOURNAL_INVALID", "revocation evidence is missing", { providerPid });
  }
  return journal;
}

export function validateTransferJournal(journal, options) {
  const { integrityKey, integrityKeyId } = validateIntegrityOptions(options);
  validateJournalRecords(journal);
  const metadataFields = journal.integrity && typeof journal.integrity === "object" && !Array.isArray(journal.integrity)
    ? Object.keys(journal.integrity).sort()
    : [];
  assertRuntime(
    metadataFields.length === JOURNAL_INTEGRITY_FIELDS.length
      && metadataFields.every((field, index) => field === JOURNAL_INTEGRITY_FIELDS[index])
      && journal.integrity.domain === JOURNAL_INTEGRITY_DOMAIN
      && journal.integrity.version === JOURNAL_INTEGRITY_VERSION
      && journal.integrity.algorithm === JOURNAL_INTEGRITY_ALGORITHM
      && journal.integrity.keyId === integrityKeyId
      && /^[a-f0-9]{64}$/u.test(journal.integrity.mac ?? ""),
    "TRANSFER_JOURNAL_INTEGRITY_INVALID",
    "provider transfer journal integrity metadata is missing or invalid",
  );
  const expected = Buffer.from(journalMac(journal, integrityKey, journal.integrity), "hex");
  const actual = Buffer.from(journal.integrity.mac, "hex");
  assertRuntime(actual.length === expected.length && timingSafeEqual(actual, expected), "TRANSFER_JOURNAL_INTEGRITY_INVALID", "provider transfer journal HMAC verification failed");
  return journal;
}

async function acquireProcessLock(lockPath) {
  const handle = await open(lockPath, "wx", 0o600);
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString(), recovery: "operator-only" })}\n`);
  await handle.sync();
  return handle;
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

export async function loadTransferJournal(path, { maxBytes = 64 * 1024 * 1024, ...integrity } = {}) {
  validateIntegrityOptions(integrity);
  let handle;
  try {
    handle = await open(path, "r");
    const stats = await handle.stat();
    assertRuntime(stats.size <= maxBytes, "TRANSFER_JOURNAL_TOO_LARGE", "provider transfer journal exceeds the byte limit");
    return validateTransferJournal(JSON.parse(await handle.readFile("utf8")), integrity);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyTransferJournal();
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function save(path, journal, maxBytes, integrity) {
  const { integrityKey, integrityKeyId } = validateIntegrityOptions(integrity);
  validateJournalRecords(journal);
  journal.revision += 1;
  const metadata = {
    domain: JOURNAL_INTEGRITY_DOMAIN,
    version: JOURNAL_INTEGRITY_VERSION,
    algorithm: JOURNAL_INTEGRITY_ALGORITHM,
    keyId: integrityKeyId,
  };
  journal.integrity = { ...metadata, mac: journalMac(journal, integrityKey, metadata) };
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

export async function withTransferJournal(path, operation, { maxBytes = 64 * 1024 * 1024, ...integrity } = {}) {
  validateIntegrityOptions(integrity);
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let lock;
  try { lock = await acquireProcessLock(lockPath); } catch (error) {
    if (error?.code === "EEXIST") throw new RuntimeError("TRANSFER_JOURNAL_LOCKED", "provider transfer journal is locked");
    throw error;
  }
  try {
    const journal = await loadTransferJournal(path, { maxBytes, ...integrity });
    const result = await operation(journal);
    await save(path, journal, maxBytes, integrity);
    return result;
  } finally {
    await lock?.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}
