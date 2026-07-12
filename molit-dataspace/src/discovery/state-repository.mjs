import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { digest, stableStringify } from "./stable-json.mjs";
import { BridgeError, invariant } from "./errors.mjs";
import { validateOutboxDocument } from "./schema-validator.mjs";
import { computeOutboxEventId } from "./outbox-integrity.mjs";
import { encodeIdentifier, identifierTupleKey, isPlainObject } from "./validation.mjs";

export function createEmptyState() {
  return {
    schemaVersion: "molit.discovery-state/8",
    approvalRegistryDigest: null,
    lastEvaluationAt: null,
    lastReviewAt: null,
    nextOutboxSequence: 1,
    projectionConfigDigest: null,
    records: {},
    processedEvents: {},
    outbox: {},
  };
}

export function validateState(state) {
  invariant(
    state && state.schemaVersion === "molit.discovery-state/8",
    "INVALID_STATE",
    "unsupported discovery state schemaVersion",
  );
  for (const field of ["records", "processedEvents", "outbox"]) {
    invariant(
      state[field] && typeof state[field] === "object" && !Array.isArray(state[field]),
      "INVALID_STATE",
      `${field} must be an object`,
      { field },
    );
  }
  for (const field of ["approvalRegistryDigest", "projectionConfigDigest"]) {
    invariant(
      state[field] === null
        || (typeof state[field] === "string" && /^[a-f0-9]{64}$/u.test(state[field])),
      "INVALID_STATE",
      `${field} must be null or a SHA-256 digest`,
      { field },
    );
  }
  invariant(
    Number.isSafeInteger(state.nextOutboxSequence) && state.nextOutboxSequence > 0,
    "INVALID_STATE",
    "nextOutboxSequence must be a positive safe integer",
    { field: "nextOutboxSequence" },
  );
  for (const [key, entry] of Object.entries(state.records)) {
    invariant(
      typeof entry.sourceSystemId === "string"
        && typeof entry.sourceRecordId === "string"
        && identifierTupleKey(entry.sourceSystemId, entry.sourceRecordId) === key,
      "STATE_RECORD_KEY_MISMATCH",
      "stored record key does not match its source identifiers",
      { field: `records.${key}` },
    );
    invariant(
      entry.discoveryWasProjected === undefined
        || entry.discoveryWasProjected === true,
      "INVALID_STATE",
      "discoveryWasProjected may only record a true historical marker",
      { field: `records.${key}.discoveryWasProjected` },
    );
    if (entry.knownCandidateDatasetIds !== undefined) {
      const expectedDatasetSuffix = `:dataset:${encodeIdentifier(entry.sourceSystemId)}:${encodeIdentifier(entry.sourceRecordId)}`;
      invariant(
        Array.isArray(entry.knownCandidateDatasetIds)
          && entry.knownCandidateDatasetIds.length > 0
          && entry.knownCandidateDatasetIds.length <= 50
          && new Set(entry.knownCandidateDatasetIds).size
            === entry.knownCandidateDatasetIds.length
          && entry.knownCandidateDatasetIds.every((value) => (
            typeof value === "string"
              && value.startsWith("urn:")
              && value.endsWith(expectedDatasetSuffix)
          )),
        "INVALID_STATE",
        "known candidate Dataset IDs must be a bounded unique URN array",
        { field: `records.${key}.knownCandidateDatasetIds` },
      );
    }
    if (entry.offeringCandidate) {
      invariant(
        entry.knownCandidateDatasetIds?.includes(
          entry.offeringCandidate.registration?.datasetId,
        ),
        "INVALID_STATE",
        "current Offering candidate must be present in candidate Dataset ID history",
        { field: `records.${key}.knownCandidateDatasetIds` },
      );
    }
    if (!entry.canonical) {
      continue;
    }
    invariant(
      isPlainObject(entry.observedRecord)
        && typeof entry.observedRecordDigest === "string"
        && /^[a-f0-9]{64}$/u.test(entry.observedRecordDigest)
        && entry.observedRecordDigest === digest(entry.observedRecord),
      "STATE_SOURCE_RECORD_INTEGRITY_ERROR",
      "stored source record digest does not match its content",
      { field: `records.${key}.observedRecordDigest` },
    );
    invariant(
      typeof entry.canonicalRecordDigest === "string"
        && /^[a-f0-9]{64}$/u.test(entry.canonicalRecordDigest)
        && entry.canonicalRecordDigest === digest(entry.canonical),
      "STATE_RECORD_INTEGRITY_ERROR",
      "stored canonical record digest does not match its content",
      { field: `records.${key}.canonicalRecordDigest` },
    );
  }
  for (const field of ["lastEvaluationAt", "lastReviewAt"]) {
    invariant(
      state[field] === null
        || (typeof state[field] === "string"
          && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u
            .test(state[field])
          && Number.isFinite(Date.parse(state[field]))),
      "INVALID_STATE",
      `${field} must be null or an RFC 3339 timestamp`,
      { field },
    );
  }
  const outboxSequences = new Set();
  const pendingFamilies = new Set();
  let maximumOutboxSequence = 0;
  for (const [outboxKey, event] of Object.entries(state.outbox)) {
    validateOutboxDocument(event);
    invariant(
      outboxKey === event.id && event.id === computeOutboxEventId(event),
      "OUTBOX_INTEGRITY_ERROR",
      "outbox map key or event ID does not match the envelope content",
      { field: `outbox.${outboxKey}.id` },
    );
    invariant(
      !outboxSequences.has(event.sequence),
      "INVALID_STATE",
      "outbox sequence values must be unique",
      { field: "outbox.sequence" },
    );
    outboxSequences.add(event.sequence);
    if (event.status === "pending") {
      const pendingKey = `${event.aggregateKey}\u0000${event.family}`;
      invariant(
        !pendingFamilies.has(pendingKey),
        "INVALID_STATE",
        "only one pending outbox command is allowed per aggregate family",
        { field: "outbox.status" },
      );
      pendingFamilies.add(pendingKey);
    }
    maximumOutboxSequence = Math.max(maximumOutboxSequence, event.sequence);
  }
  for (const event of Object.values(state.outbox)) {
    if (event.status !== "superseded") {
      continue;
    }
    const successor = state.outbox[event.supersededBy];
    invariant(
      successor
        && successor.aggregateKey === event.aggregateKey
        && successor.family === event.family
        && successor.sequence > event.sequence,
      "OUTBOX_SUPERSEDE_CHAIN_INVALID",
      "superseded outbox command must reference a newer command in the same aggregate family",
      { field: "outbox.supersededBy" },
    );
  }
  invariant(
    state.nextOutboxSequence > maximumOutboxSequence,
    "INVALID_STATE",
    "nextOutboxSequence must be greater than persisted outbox sequences",
    { field: "nextOutboxSequence" },
  );
}

export async function loadState(path) {
  let handle;
  try {
    handle = await open(path, "r");
    const metadata = await handle.stat();
    invariant(
      metadata.size <= 64 * 1024 * 1024,
      "STATE_TOO_LARGE",
      "state file exceeds the 64 MiB S1 limit",
      { path },
    );
    const raw = await handle.readFile();
    invariant(
      raw.byteLength <= 64 * 1024 * 1024,
      "STATE_TOO_LARGE",
      "state file grew beyond the 64 MiB S1 limit while reading",
      { path },
    );
    const state = JSON.parse(raw.toString("utf8"));
    validateState(state);
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return createEmptyState();
    }
    if (error instanceof SyntaxError) {
      throw new BridgeError("INVALID_STATE_JSON", "state file is not valid JSON", { path });
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function saveState(path, state, { maxBytes = 64 * 1024 * 1024 } = {}) {
  validateState(state);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const serialized = `${stableStringify(state, 2)}\n`;
  invariant(
    Number.isSafeInteger(maxBytes)
      && maxBytes > 0
      && maxBytes <= 64 * 1024 * 1024
      && Buffer.byteLength(serialized, "utf8") <= maxBytes,
    "STATE_TOO_LARGE",
    "state serialization exceeds the configured S1 byte limit",
    { path },
  );
  let committed = false;
  try {
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    committed = true;
  } finally {
    if (!committed) {
      await unlink(temporaryPath).catch(() => {});
    }
  }
}

export async function withStateLock(path, operation) {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({
      pid: process.pid,
      host: hostname(),
      acquiredAt: new Date().toISOString(),
    })}\n`);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
    }
    if (error?.code === "EEXIST") {
      throw new BridgeError(
        "STATE_LOCKED",
        "state lock exists; verify the owner before manual recovery",
        { lockPath },
      );
    }
    throw error;
  }

  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    });
  }
}
