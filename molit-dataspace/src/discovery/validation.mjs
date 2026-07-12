import { BridgeError, invariant } from "./errors.mjs";

export const RECORD_TYPES = new Set([
  "dataset",
  "organization",
  "system",
  "use-case",
  "post",
]);

export const PLATFORM_ROLES = new Set([
  "hosted",
  "brokered",
  "index-only",
  "unknown",
]);

const EVENT_TYPES = new Set(["record.upsert", "record.deleted"]);
const BATCH_MODES = new Set(["baseline", "delta"]);
const FORBIDDEN_KEYS = new Set([
  "password",
  "passwd",
  "cookie",
  "cookies",
  "csrf",
  "csrftoken",
  "session",
  "sessionid",
  "authorization",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "secret",
  "secretvalue",
  "clientsecret",
]);
const FORBIDDEN_URL_PARAMETERS = new Set([
  "apikey",
  "accesstoken",
  "authorization",
  "clientsecret",
  "credential",
  "key",
  "password",
  "refreshtoken",
  "session",
  "signature",
  "token",
]);
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\bSECRET_DO_NOT_LEAK\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/u,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\b(?:password|client[_-]?secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S{4,}/iu,
];
const MAX_STRING_LENGTH = 8_192;
const MAX_BATCH_RECORDS = 10_000;
const MAX_COLLECTION_ITEMS = 200;
const MAX_SCAN_NODES = 100_000;
const MAX_SCAN_DEPTH = 32;

export function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function requiredString(value, field, details = {}) {
  invariant(
    typeof value === "string"
      && value.trim().length > 0
      && value.length <= MAX_STRING_LENGTH,
    "INVALID_FIELD",
    `${field} must be a non-empty string`,
    { field, ...details },
  );
  return value.trim();
}

export function validateIdentifier(value, field, details = {}) {
  const identifier = requiredString(value, field, details);
  invariant(
    value === identifier
      && identifier === identifier.normalize("NFKC")
      && identifier.length <= 256
      && /^[\p{L}\p{N}][\p{L}\p{N}._~:/-]*$/u.test(identifier),
    "INVALID_IDENTIFIER",
    `${field} must be an NFKC-normalized identifier without whitespace or query syntax`,
    { field, ...details },
  );
  for (const pattern of SECRET_VALUE_PATTERNS) {
    invariant(
      !pattern.test(identifier),
      "CREDENTIAL_LIKE_IDENTIFIER",
      `${field} contains a credential-like value`,
      { field, ...details },
    );
  }
  return identifier;
}

export function encodeIdentifier(value) {
  return encodeURIComponent(value.normalize("NFKC"));
}

export function identifierTupleKey(...values) {
  return values.map(encodeIdentifier).join("::");
}

export function optionalString(value, field, details = {}) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredString(value, field, details);
}

export function validateTimestamp(value, field, details = {}) {
  const timestamp = requiredString(value, field, details);
  const match = timestamp.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u,
  );
  invariant(
    match && Number.isFinite(Date.parse(timestamp)),
    "INVALID_TIMESTAMP",
    `${field} must be a strict RFC 3339 timestamp`,
    { field, ...details },
  );
  const [, year, month, day, hour, minute, second, offset] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const offsetParts = offset === "Z" ? ["00", "00"] : offset.slice(1).split(":");
  invariant(
    calendar.getUTCFullYear() === Number(year)
      && calendar.getUTCMonth() + 1 === Number(month)
      && calendar.getUTCDate() === Number(day)
      && Number(hour) <= 23
      && Number(minute) <= 59
      && Number(second) <= 59
      && Number(offsetParts[0]) <= 23
      && Number(offsetParts[1]) <= 59,
    "INVALID_TIMESTAMP",
    `${field} contains an invalid calendar date, time or offset`,
    { field, ...details },
  );
  return timestamp;
}

export function validateHttpsUrl(value, field, details = {}) {
  const raw = requiredString(value, field, details);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BridgeError("INVALID_URL", `${field} must be a valid URL`, {
      field,
      ...details,
    });
  }

  invariant(
    parsed.protocol === "https:" && !parsed.username && !parsed.password,
    "INSECURE_URL",
    `${field} must use HTTPS and must not contain user information`,
    { field, ...details },
  );
  for (const key of parsed.searchParams.keys()) {
    const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();
    invariant(
      !FORBIDDEN_URL_PARAMETERS.has(normalizedKey),
      "SECRET_URL_PARAMETER",
      `${field} must not contain credential-like URL parameters`,
      { field, parameter: key, ...details },
    );
  }
  invariant(
    parsed.search === "" && parsed.hash === "",
    "PUBLIC_URL_COMPONENT_FORBIDDEN",
    `${field} must not contain a query string or fragment`,
    { field, ...details },
  );
  return parsed.toString();
}

export function validateEvidenceIds(value, field, details = {}) {
  invariant(Array.isArray(value), "INVALID_FIELD", `${field} must be an array`, {
    field,
    ...details,
  });
  invariant(
    value.length <= MAX_COLLECTION_ITEMS,
    "COLLECTION_TOO_LARGE",
    `${field} has too many items`,
    { field, ...details },
  );
  return [...new Set(value.map((item, index) => validateIdentifier(
    item,
    `${field}[${index}]`,
    details,
  )))];
}

export function assertNoInlineSecrets(value, path = "record") {
  const stack = [{ depth: 0, path, value }];
  let visitedNodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    visitedNodes += 1;
    invariant(
      visitedNodes <= MAX_SCAN_NODES && current.depth <= MAX_SCAN_DEPTH,
      "INPUT_TOO_COMPLEX",
      "input object exceeds the supported size or nesting depth",
      { path: current.path },
    );

    if (typeof current.value === "string") {
      requiredString(current.value, current.path);
      for (const pattern of SECRET_VALUE_PATTERNS) {
        invariant(
          !pattern.test(current.value),
          "INLINE_SECRET_VALUE",
          `credential-like value is forbidden at ${current.path}`,
          { path: current.path },
        );
      }
      continue;
    }
    if (!current.value || typeof current.value !== "object") {
      continue;
    }

    const entries = Array.isArray(current.value)
      ? current.value.map((child, index) => [String(index), child])
      : Object.entries(current.value);
    invariant(
      entries.length <= MAX_BATCH_RECORDS,
      "COLLECTION_TOO_LARGE",
      `collection at ${current.path} has too many items`,
      { path: current.path },
    );
    for (const [key, child] of entries) {
      if (!Array.isArray(current.value)) {
        const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();
        invariant(
          !FORBIDDEN_KEYS.has(normalizedKey),
          "INLINE_SECRET_FIELD",
          `inline credential or browser-session field is forbidden at ${current.path}.${key}`,
          { path: `${current.path}.${key}` },
        );
      }
      stack.push({
        depth: current.depth + 1,
        path: Array.isArray(current.value)
          ? `${current.path}[${key}]`
          : `${current.path}.${key}`,
        value: child,
      });
    }
  }
}

export function validateBatch(batch) {
  invariant(isPlainObject(batch), "INVALID_BATCH", "batch must be an object");
  invariant(
    batch.schemaVersion === "molit.platform-metadata-batch/1",
    "UNSUPPORTED_SCHEMA",
    "unsupported metadata batch schemaVersion",
    { schemaVersion: batch.schemaVersion },
  );

  validateIdentifier(batch.batchId, "batchId");
  validateIdentifier(batch.sourceSystemId, "sourceSystemId");
  invariant(
    BATCH_MODES.has(batch.mode),
    "INVALID_BATCH_MODE",
    "mode must be baseline or delta",
    { mode: batch.mode },
  );
  validateTimestamp(batch.observedAt, "observedAt");
  invariant(Array.isArray(batch.records), "INVALID_BATCH", "records must be an array");
  invariant(
    batch.records.length <= MAX_BATCH_RECORDS,
    "BATCH_TOO_LARGE",
    "records exceeds the supported batch size",
  );

  const eventIds = new Set();
  for (const [index, event] of batch.records.entries()) {
    validateEvent(event, index);
    invariant(
      Date.parse(event.occurredAt) <= Date.parse(batch.observedAt) + 5 * 60 * 1000,
      "SOURCE_EVENT_TIME_AHEAD",
      "event occurredAt is later than the batch observation time beyond allowed skew",
      { index, field: "occurredAt" },
    );
    invariant(
      !eventIds.has(event.eventId),
      "DUPLICATE_EVENT_IN_BATCH",
      "eventId must be unique within a batch",
      { eventId: event.eventId, index },
    );
    eventIds.add(event.eventId);
  }
}

export function validateEvent(event, index) {
  const details = { index };
  invariant(isPlainObject(event), "INVALID_EVENT", "event must be an object", details);
  validateIdentifier(event.eventId, "eventId", details);
  invariant(
    EVENT_TYPES.has(event.eventType),
    "INVALID_EVENT_TYPE",
    "eventType must be record.upsert or record.deleted",
    { eventType: event.eventType, ...details },
  );
  validateIdentifier(event.recordId, "recordId", details);
  invariant(
    typeof event.resourceVersion === "string"
      && /^(0|[1-9]\d*)$/.test(event.resourceVersion)
      && event.resourceVersion.length <= 64,
    "INVALID_RESOURCE_VERSION",
    "resourceVersion must be a non-negative decimal string",
    { resourceVersion: event.resourceVersion, ...details },
  );
  validateTimestamp(event.occurredAt, "occurredAt", details);

  if (event.eventType === "record.upsert") {
    invariant(isPlainObject(event.record), "INVALID_EVENT", "upsert event requires record", details);
    assertNoInlineSecrets(event.record);
  } else {
    invariant(
      event.record === undefined,
      "INVALID_EVENT",
      "delete event must not contain record payload",
      details,
    );
  }
}
