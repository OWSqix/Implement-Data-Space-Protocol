import { createHash } from "node:crypto";
import { assertObservability } from "./errors.mjs";

const SECRET_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|client[-_]?secret|credential)/iu;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+/-]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|secret|token|api[-_]?key)\s*[=:]\s*\S+)/giu;
const SAFE_ATTRIBUTE = /^(?:service\.(?:name|version)|deployment\.environment\.name|http\.(?:request\.method|response\.status_code)|url\.scheme|server\.(?:address|port)|network\.protocol\.version|rpc\.(?:system|service|method)|db\.system|error\.type|molit\.(?:component|operation|result|tenant_bucket))$/u;

export const REDACTED = "[REDACTED]";

function clean(value, key, seen) {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return value.replace(SECRET_VALUE, REDACTED).slice(0, 4096);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => clean(item, key, seen));
  if (typeof value !== "object") return String(value).slice(0, 4096);
  if (seen.has(value)) return "[CYCLE]";
  seen.add(value);
  const result = {};
  for (const [nestedKey, nestedValue] of Object.entries(value).slice(0, 100)) result[nestedKey] = clean(nestedValue, nestedKey, seen);
  seen.delete(value);
  return result;
}

export function redact(value) {
  return clean(value, "", new Set());
}

export function tenantBucket(tenantId, { bucketCount = 64, salt } = {}) {
  assertObservability(Number.isInteger(bucketCount) && bucketCount >= 2 && bucketCount <= 256, "OBS_TENANT_BUCKET_INVALID", "tenant bucket count must be between 2 and 256");
  assertObservability(typeof salt === "string" && Buffer.byteLength(salt) >= 16, "OBS_TENANT_SALT_REQUIRED", "tenant cardinality salt must have at least 16 bytes");
  assertObservability(typeof tenantId === "string" && tenantId.length > 0, "OBS_TENANT_ID_REQUIRED", "tenant identifier is required");
  const digest = createHash("sha256").update(salt).update("\0").update(tenantId).digest();
  return `b${digest.readUInt32BE(0) % bucketCount}`;
}

export function normalizeSpanAttributes(attributes = {}, { tenantId, tenantSalt, tenantBucketCount = 64 } = {}) {
  const result = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!SAFE_ATTRIBUTE.test(key) || SECRET_KEY.test(key) || /tenant(?:[._-]?id)?$/iu.test(key)) continue;
    result[key] = clean(value, key, new Set());
  }
  if (tenantId !== undefined) result["molit.tenant_bucket"] = tenantBucket(tenantId, { bucketCount: tenantBucketCount, salt: tenantSalt });
  return result;
}
