import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";

const ENCODED = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u;

function encoded(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decoded(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function encodeIdempotencyRecordKey(scope, key) {
  assertRuntime(typeof scope === "string" && scope.length >= 3 && scope.length <= 256
    && typeof key === "string" && key.length >= 1 && key.length <= 256,
  "IDEMPOTENCY_RECORD_KEY_INVALID", "idempotency scope or key is invalid");
  return `v1.${encoded(scope)}.${encoded(key)}`;
}

export function decodeIdempotencyRecordKey(recordKey) {
  assertRuntime(typeof recordKey === "string" && recordKey.length <= 2_048,
    "IDEMPOTENCY_RECORD_KEY_INVALID", "idempotency record key is invalid");
  const match = ENCODED.exec(recordKey);
  assertRuntime(match, "IDEMPOTENCY_RECORD_KEY_INVALID", "idempotency record key version is unsupported");
  const scope = decoded(match[1]);
  const key = decoded(match[2]);
  assertRuntime(encodeIdempotencyRecordKey(scope, key) === recordKey,
    "IDEMPOTENCY_RECORD_KEY_INVALID", "idempotency record key encoding is not canonical");
  return Object.freeze({ key, scope });
}

export function normalizeCaasIdempotencyRecordKey(recordKey) {
  try {
    const decodedKey = decodeIdempotencyRecordKey(recordKey);
    return Object.freeze({ ...decodedKey, legacyConverted: false, recordKey, sourceRecordKey: recordKey });
  } catch (error) {
    if (!(error instanceof RuntimeError) || typeof recordKey !== "string") throw error;
  }
  const separator = recordKey.indexOf("\u0000");
  if (separator === -1 && /^[^\u0000-\u001f\u007f]{1,2048}$/u.test(recordKey)) {
    return Object.freeze({ key: null, legacyConverted: false, recordKey, scope: null, sourceRecordKey: recordKey });
  }
  assertRuntime(separator >= 3 && separator === recordKey.lastIndexOf("\u0000"),
    "IDEMPOTENCY_RECORD_KEY_INVALID", "legacy CaaS idempotency record key is invalid");
  const scope = recordKey.slice(0, separator);
  const key = recordKey.slice(separator + 1);
  return Object.freeze({
    key,
    legacyConverted: true,
    recordKey: encodeIdempotencyRecordKey(scope, key),
    scope,
    sourceRecordKey: recordKey,
  });
}
