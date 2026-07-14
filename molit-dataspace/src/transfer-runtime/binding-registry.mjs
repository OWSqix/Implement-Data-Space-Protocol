import { readFile } from "node:fs/promises";
import { validateContract } from "./contracts.mjs";
import { RuntimeError } from "../bridge-runtime/errors.mjs";

export async function loadBindingRegistry(path) {
  const registry = validateContract("registry", JSON.parse(await readFile(path, "utf8")));
  const seen = new Set();
  for (const binding of registry.bindings) {
    assertSafeResourceRef(binding.resourceRef);
    const key = bindingKey(binding.datasetId, binding.format);
    if (seen.has(key)) throw new RuntimeError("DUPLICATE_TRANSFER_BINDING", "datasetId and format binding must be unique", { datasetId: binding.datasetId, format: binding.format });
    seen.add(key);
  }
  return registry;
}

const credentialKey = /(?:authorization|credential|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|cookie|private[-_]?key|signed[-_]?url|signature)/iu;
const credentialAssignment = /(?:^|[?&#;,\s])(?:authorization|proxy[-_]?authorization|credential|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|cookie|set[-_]?cookie|private[-_]?key|signature|sig|x[-_]?amz[-_]?credential|x[-_]?amz[-_]?signature)\s*[:=]\s*[^&#;,\s]+/iu;
const authorizationValue = /^(?:bearer|basic|digest|sharedaccesssignature)\s+\S+/iu;
const credentialQueryNames = new Set([
  "authorization", "proxyauthorization", "credential", "apikey", "accesstoken", "refreshtoken",
  "token", "secret", "password", "passwd", "cookie", "setcookie", "privatekey", "signature", "sig",
  "xamzcredential", "xamzsignature", "xamzsecuritytoken", "xgoogcredential", "xgoogsignature",
  "googleaccessid", "awsaccesskeyid", "clientsecret", "sharedaccesssignature", "subscriptionkey", "code", "key",
]);
const credentialQuerySuffix = /(?:authorization|credential|signature|accesskey|apikey|privatekey|subscriptionkey|token|secret|password|passwd|cookie)$/u;

function normalizedCredentialName(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[._-]/gu, "");
}

function isCredentialQueryName(value) {
  const normalized = normalizedCredentialName(value);
  return credentialQueryNames.has(normalized) || credentialQuerySuffix.test(normalized);
}

function rejectCredentialValue(field, value) {
  const text = value.trim();
  if (authorizationValue.test(text) || credentialAssignment.test(text)) {
    throw new RuntimeError("BINDING_SECRET_FORBIDDEN", "resourceRef must contain identifiers only, not credential values", { field });
  }

  let url;
  try {
    url = new URL(text, "https://resource-ref.invalid/");
  } catch {
    return;
  }
  if (url.username || url.password) {
    throw new RuntimeError("BINDING_SECRET_FORBIDDEN", "resourceRef URL must not contain userinfo", { field });
  }
  for (const [name, queryValue] of url.searchParams) {
    if (isCredentialQueryName(name) || authorizationValue.test(queryValue) || credentialAssignment.test(queryValue)) {
      throw new RuntimeError("BINDING_SECRET_FORBIDDEN", "resourceRef URL must not contain credential-like query parameters", { field, parameter: name });
    }
  }
  let fragment;
  try {
    fragment = decodeURIComponent(url.hash.slice(1));
  } catch {
    throw new RuntimeError("BINDING_RESOURCE_REF_INVALID", "resourceRef URL fragment is not valid percent-encoding", { field });
  }
  if (authorizationValue.test(fragment) || credentialAssignment.test(fragment)) {
    throw new RuntimeError("BINDING_SECRET_FORBIDDEN", "resourceRef URL fragment must not contain credential values", { field });
  }
}

export function assertSafeResourceRef(resourceRef) {
  if (!resourceRef || typeof resourceRef !== "object" || Array.isArray(resourceRef) || Object.getPrototypeOf(resourceRef) !== Object.prototype) {
    throw new RuntimeError("BINDING_RESOURCE_REF_INVALID", "resourceRef must be a plain object of typed identifiers");
  }
  for (const [key, value] of Object.entries(resourceRef)) {
    if (credentialKey.test(key)) throw new RuntimeError("BINDING_SECRET_FORBIDDEN", "resourceRef must contain identifiers only, not credential-like fields", { field: key });
    if (!["string", "number", "boolean"].includes(typeof value)) {
      throw new RuntimeError("BINDING_RESOURCE_REF_INVALID", "resourceRef values must be string, number, or boolean identifiers", { field: key });
    }
    if (typeof value === "string") rejectCredentialValue(key, value);
  }
  return resourceRef;
}

export function bindingKey(datasetId, format) {
  return `${datasetId}\u0000${format}`;
}

export function resolveBinding(registry, datasetId, format, { requireEnabled = true } = {}) {
  const binding = registry.bindings.find((candidate) => candidate.datasetId === datasetId && candidate.format === format);
  if (!binding || (requireEnabled && !binding.enabled)) throw new RuntimeError("TRANSFER_BINDING_NOT_FOUND", "no permitted private binding exists for datasetId and format", { datasetId, format });
  return structuredClone(binding);
}
