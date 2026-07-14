import { authorizationHeaders } from "./telemetry.mjs";
import { RuntimeError, assertRuntime } from "./errors.mjs";
import { digest } from "../discovery/stable-json.mjs";

const MANAGEMENT_CONTEXT = ["https://w3id.org/edc/connector/management/v2"];
const EDC_NAMESPACE = "https://w3id.org/edc/v0.0.1/ns/";
const COLLECTIONS = Object.freeze({
  policy: "v4/policydefinitions",
  asset: "v4/assets",
  contractDefinition: "v4/contractdefinitions",
});
const FORBIDDEN_KEY = /(?:^|[-_.:])(auth(?:orization|code|key)?|cookie|credential|password|secret(?:name)?|token|api[-_.]?key)(?:$|[-_.:])/iu;
const FORBIDDEN_QUERY_KEY = /(?:auth|credential|password|secret|token|signature|(?:^|[-_.])sig(?:$|[-_.])|key$|^code$)/iu;
const FORBIDDEN_QUERY_VALUE = /(?:^|[?&;,\s])(?:(?:basic|bearer)\s+\S+|(?:authorization|auth(?:code|key)?|api[-_.]?key|credential|password|secret|token|signature|sig|service[-_.]?key|subscription[-_.]?key|code)\s*[:=]\s*\S+)/iu;
const ID_PATTERN = /^[^\u0000-\u001f\u007f\s](?:[^\u0000-\u001f\u007f]{0,510}[^\u0000-\u001f\u007f\s])?$/u;
const PROPERTY_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const ODRL_TARGET_KEY = /(?:^|[:/#])target$/u;
const DATA_AUTH_HEADERS = new Set(["api-key", "authorization", "ocp-apim-subscription-key", "x-api-key", "x-auth-token"]);
const VAULT_LOGICAL_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,15}$/u;

function object(value, label) {
  assertRuntime(value && typeof value === "object" && !Array.isArray(value), "EDC_PUBLICATION_INVALID", `${label} must be an object`);
  return value;
}

function identifier(value, label) {
  assertRuntime(typeof value === "string" && ID_PATTERN.test(value), "EDC_PUBLICATION_INVALID", `${label} is invalid`);
  return value;
}

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    throw new RuntimeError("EDC_PUBLICATION_INVALID", `${label} is not an absolute URL`);
  }
}

function scalar(value, label) {
  assertRuntime(["string", "number", "boolean"].includes(typeof value), "EDC_PUBLICATION_INVALID", `${label} must be a scalar value`);
  if (typeof value === "string") assertRuntime(value.length > 0 && value.length <= 2_048 && !/[\u0000-\u001f\u007f]/u.test(value), "EDC_PUBLICATION_INVALID", `${label} is invalid`);
  if (typeof value === "number") assertRuntime(Number.isFinite(value), "EDC_PUBLICATION_INVALID", `${label} is not finite`);
  return value;
}

function boundedProperties(value) {
  const properties = object(value, "asset.properties");
  const entries = Object.entries(properties);
  assertRuntime(entries.length >= 3 && entries.length <= 32, "EDC_PUBLICATION_INVALID", "asset.properties must contain between 3 and 32 entries");
  const result = {};
  for (const [key, item] of entries) {
    assertRuntime(PROPERTY_NAME.test(key) && !FORBIDDEN_KEY.test(key), "EDC_PUBLICATION_SECRET_FORBIDDEN", `asset property is not allowed: ${key}`);
    if (Array.isArray(item)) {
      assertRuntime(item.length > 0 && item.length <= 32, "EDC_PUBLICATION_INVALID", `asset.properties.${key} has an invalid array length`);
      result[key] = item.map((entry, index) => scalar(entry, `asset.properties.${key}[${index}]`));
    } else {
      result[key] = scalar(item, `asset.properties.${key}`);
    }
  }
  for (const required of ["name", "contenttype", "metadataIri"]) {
    assertRuntime(typeof result[required] === "string", "EDC_PUBLICATION_INVALID", `asset.properties.${required} is required`);
  }
  const metadataIri = parseUrl(result.metadataIri, "asset.properties.metadataIri");
  assertRuntime(metadataIri.protocol === "https:"
    && !metadataIri.username
    && !metadataIri.password
    && !metadataIri.search
    && !metadataIri.hash,
  "EDC_PUBLICATION_INVALID", "asset.properties.metadataIri must be an HTTPS IRI without credentials, a query or a fragment");
  return result;
}

function decodedQueryValue(value, label) {
  let decoded = value.normalize("NFKC");
  for (let pass = 0; pass < 3 && decoded.includes("%"); pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next.normalize("NFKC");
    } catch {
      throw new RuntimeError("EDC_PUBLICATION_INVALID", `${label} contains invalid percent encoding`);
    }
  }
  assertRuntime(!/[\u0000-\u001f\u007f]/u.test(decoded), "EDC_PUBLICATION_INVALID", `${label} contains a control character`);
  return decoded;
}

function forbiddenQueryKey(key) {
  const canonical = key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/gu, "");
  return FORBIDDEN_QUERY_KEY.test(key)
    || /(?:auth|credential|password|secret|token|signature)/u.test(canonical)
    || canonical.endsWith("key")
    || ["code", "sig"].includes(canonical);
}

function validateStaticQuery(value, label, allowedNames = []) {
  assertRuntime(typeof value === "string" && value.length <= 2_048 && !/[\u0000-\u001f\u007f#]/u.test(value) && !/%(?![0-9A-Fa-f]{2})/u.test(value), "EDC_PUBLICATION_INVALID", `${label} is invalid`);
  assertRuntime(Array.isArray(allowedNames) && allowedNames.length <= 64 && allowedNames.every((name) => typeof name === "string" && /^[a-z][a-z0-9._-]{0,63}$/u.test(name)), "EDC_MANAGEMENT_CONFIG_INVALID", "allowedDataQueryParameters is invalid");
  const allowed = new Set(allowedNames);
  const query = new URLSearchParams(value.startsWith("?") ? value.slice(1) : value);
  const entries = [...query];
  for (const [key, item] of entries) {
    assertRuntime(!forbiddenQueryKey(key), "EDC_PUBLICATION_SECRET_FORBIDDEN", `${label} contains a credential-like parameter name`);
    const decoded = decodedQueryValue(item, label);
    assertRuntime(!FORBIDDEN_QUERY_VALUE.test(decoded), "EDC_PUBLICATION_SECRET_FORBIDDEN", `${label} contains a credential-like parameter value`);
    try {
      const embedded = new URL(decoded);
      if (["http:", "https:"].includes(embedded.protocol)) {
        assertRuntime(!embedded.username && !embedded.password, "EDC_PUBLICATION_SECRET_FORBIDDEN", `${label} contains URL credentials`);
        for (const embeddedKey of embedded.searchParams.keys()) {
          assertRuntime(!forbiddenQueryKey(embeddedKey), "EDC_PUBLICATION_SECRET_FORBIDDEN", `${label} contains an embedded credential-like query parameter`);
        }
      }
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
    }
  }
  for (const [key] of entries) {
    const canonicalKey = key.normalize("NFKC").toLowerCase();
    assertRuntime(/^[a-z][a-z0-9._-]{0,63}$/u.test(canonicalKey) && allowed.has(canonicalKey), "EDC_PUBLICATION_INVALID", `${label} contains a query parameter that is not explicitly allowlisted`, { parameter: key });
  }
  return value;
}

function validateDataPath(value, baseUrl) {
  assertRuntime(typeof value === "string" && value.length > 0 && value.length <= 2_048 && !/%(?![0-9A-Fa-f]{2})/u.test(value), "EDC_PUBLICATION_INVALID", "asset.dataAddress.path is invalid");
  let decoded = value.normalize("NFKC");
  for (let pass = 0; pass < 3 && decoded.includes("%"); pass += 1) {
    assertRuntime(!/%(?:2e|2f|5c)/iu.test(decoded), "EDC_PUBLICATION_INVALID", "asset.dataAddress.path contains an encoded separator or traversal segment");
    try {
      const next = decodeURIComponent(decoded).normalize("NFKC");
      if (next === decoded) break;
      decoded = next;
    } catch {
      throw new RuntimeError("EDC_PUBLICATION_INVALID", "asset.dataAddress.path contains invalid percent encoding");
    }
  }
  assertRuntime(!/[\u0000-\u0020\u007f\\?#]/u.test(decoded)
    && !decoded.startsWith("//")
    && !/(?:^|\/)\.{1,2}(?:\/|$)/u.test(decoded)
    && /^\/?[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/u.test(decoded),
  "EDC_PUBLICATION_INVALID", "asset.dataAddress.path is not a canonical relative path");
  let resolved;
  try { resolved = new URL(decoded, baseUrl); } catch { throw new RuntimeError("EDC_PUBLICATION_INVALID", "asset.dataAddress.path cannot be resolved against baseUrl"); }
  assertRuntime(resolved.origin === baseUrl.origin && !resolved.username && !resolved.password, "EDC_DATA_ORIGIN_NOT_ALLOWED", "asset.dataAddress.path changes the allowlisted data origin");
  return decoded;
}

function dataAddress(value, config) {
  const source = object(value, "asset.dataAddress");
  const allowed = new Set(["type", "baseUrl", "name", "path", "queryParams", "method", "contentType", "nonChunkedTransfer", "authKey", "secretName"]);
  assertRuntime(Object.keys(source).every((key) => allowed.has(key)), "EDC_PUBLICATION_INVALID", "asset.dataAddress contains an unsupported field");
  assertRuntime(source.type === "HttpData", "EDC_PUBLICATION_INVALID", "only the EDC HttpData source type is supported");
  const url = parseUrl(source.baseUrl, "asset.dataAddress.baseUrl");
  assertRuntime(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash, "EDC_PUBLICATION_INVALID", "asset.dataAddress.baseUrl is invalid");
  assertRuntime(url.protocol === "https:" || config.allowHttpData === true, "EDC_PUBLICATION_INVALID", "HTTP data sources require allowHttpData=true");
  assertRuntime(config.allowedDataOrigins.includes(url.origin), "EDC_DATA_ORIGIN_NOT_ALLOWED", "asset.dataAddress.baseUrl origin is not allowlisted", { origin: url.origin });
  validateStaticQuery(url.search, "asset.dataAddress.baseUrl query", config.allowedDataQueryParameters);
  const result = { "@type": "DataAddress", type: "HttpData", baseUrl: url.toString() };
  for (const field of ["name", "contentType"]) {
    if (source[field] !== undefined) result[field] = scalar(source[field], `asset.dataAddress.${field}`);
  }
  if (source.path !== undefined) {
    result.path = validateDataPath(source.path, url);
  }
  if (source.queryParams !== undefined) result.queryParams = validateStaticQuery(source.queryParams, "asset.dataAddress.queryParams", config.allowedDataQueryParameters);
  if (source.method !== undefined) {
    assertRuntime(["GET", "POST"].includes(source.method), "EDC_PUBLICATION_INVALID", "asset.dataAddress.method must be GET or POST");
    result.method = source.method;
  }
  if (source.nonChunkedTransfer !== undefined) {
    assertRuntime(typeof source.nonChunkedTransfer === "boolean", "EDC_PUBLICATION_INVALID", "asset.dataAddress.nonChunkedTransfer must be boolean");
    result.nonChunkedTransfer = String(source.nonChunkedTransfer);
  }
  const hasAuthKey = source.authKey !== undefined;
  const hasSecretName = source.secretName !== undefined;
  assertRuntime(hasAuthKey === hasSecretName, "EDC_PUBLICATION_INVALID", "authKey and secretName must be supplied together");
  if (hasAuthKey) {
    const authKey = typeof source.authKey === "string" ? source.authKey.toLowerCase() : "";
    assertRuntime(source.authKey === authKey && DATA_AUTH_HEADERS.has(authKey), "EDC_PUBLICATION_INVALID", "asset.dataAddress.authKey is not an approved credential header");
    assertRuntime(typeof source.secretName === "string" && source.secretName.length <= 240 && VAULT_LOGICAL_PATH.test(source.secretName), "EDC_PUBLICATION_INVALID", "asset.dataAddress.secretName is not a canonical Vault logical path");
    result.authKey = authKey;
    result.secretName = source.secretName;
  }
  return result;
}

function inspectPolicy(value, path = "policy", depth = 0, budget = { nodes: 0 }) {
  assertRuntime(depth <= 10 && ++budget.nodes <= 1_000, "EDC_PUBLICATION_INVALID", `${path} exceeds the structural limit`);
  if (Array.isArray(value)) {
    assertRuntime(value.length <= 64, "EDC_PUBLICATION_INVALID", `${path} has too many items`);
    value.forEach((entry, index) => inspectPolicy(entry, `${path}[${index}]`, depth + 1, budget));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") assertRuntime(value.length <= 2_048 && !/[\u0000-\u001f\u007f]/u.test(value), "EDC_PUBLICATION_INVALID", `${path} contains an invalid string`);
    else assertRuntime(["number", "boolean"].includes(typeof value) && (typeof value !== "number" || Number.isFinite(value)), "EDC_PUBLICATION_INVALID", `${path} contains an invalid value`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assertRuntime(key !== "@context" && !ODRL_TARGET_KEY.test(key), "EDC_PUBLICATION_INVALID", `${path} must be an untargeted ODRL policy without a local JSON-LD context`);
    assertRuntime(!FORBIDDEN_KEY.test(key), "EDC_PUBLICATION_SECRET_FORBIDDEN", `${path}.${key} is not allowed`);
    inspectPolicy(entry, `${path}.${key}`, depth + 1, budget);
  }
}

function policyDefinition(value, label) {
  const definition = object(value, label);
  const id = identifier(definition.id, `${label}.id`);
  const policy = object(definition.policy, `${label}.policy`);
  assertRuntime(policy["@type"] === "Set" && policy["@id"] === undefined, "EDC_PUBLICATION_INVALID", `${label}.policy must be an untargeted ODRL Set`);
  inspectPolicy(policy, `${label}.policy`);
  assertRuntime(Buffer.byteLength(JSON.stringify(policy)) <= 64 * 1024, "EDC_PUBLICATION_INVALID", `${label}.policy exceeds 64 KiB`);
  return { id, policy: structuredClone(policy) };
}

function publicationModel(offering, metadata, config, rootKey) {
  object(offering, "offering");
  assertRuntime(offering.schemaVersion === "molit.edc-v4-publication/1", "EDC_PUBLICATION_INVALID", "offering.schemaVersion is invalid");
  const allowedTop = new Set(["schemaVersion", "asset", "accessPolicy", "contractPolicy", "contractDefinition"]);
  assertRuntime(Object.keys(offering).every((key) => allowedTop.has(key)), "EDC_PUBLICATION_INVALID", "offering contains an unsupported field");
  object(metadata, "validated metadata evidence");
  assertRuntime(/^[a-f0-9]{64}$/u.test(metadata.sha256 ?? "") && typeof metadata.profileName === "string" && typeof metadata.profileVersion === "string" && typeof metadata.decisionDigest === "string", "EDC_PUBLICATION_INVALID", "validated metadata evidence is incomplete");
  const assetInput = object(offering.asset, "asset");
  assertRuntime(Object.keys(assetInput).every((key) => ["id", "properties", "dataAddress"].includes(key)), "EDC_PUBLICATION_INVALID", "asset contains an unsupported field");
  const assetId = identifier(assetInput.id, "asset.id");
  const access = policyDefinition(offering.accessPolicy, "accessPolicy");
  const contract = policyDefinition(offering.contractPolicy, "contractPolicy");
  const definitionInput = object(offering.contractDefinition, "contractDefinition");
  assertRuntime(Object.keys(definitionInput).every((key) => key === "id"), "EDC_PUBLICATION_INVALID", "contractDefinition only accepts its deterministic ID");
  const definitionId = identifier(definitionInput.id, "contractDefinition.id");
  if (access.id === contract.id) assertRuntime(digest(access.policy) === digest(contract.policy), "EDC_PUBLICATION_INVALID", "a shared policy ID requires identical access and contract policies");
  const publicationDigest = digest({ offering, metadata });
  const dispatchRootDigest = digest(String(rootKey));
  const properties = {
    ...boundedProperties(assetInput.properties),
    molitMetadataSha256: metadata.sha256,
    molitProfileName: metadata.profileName,
    molitProfileVersion: metadata.profileVersion,
    molitValidationDecisionDigest: metadata.decisionDigest,
  };
  const makePolicy = ({ id, policy }) => ({
    "@context": MANAGEMENT_CONTEXT,
    "@type": "PolicyDefinition",
    "@id": id,
    policy,
  });
  const policies = access.id === contract.id ? [makePolicy(access)] : [makePolicy(access), makePolicy(contract)];
  const asset = {
    "@context": MANAGEMENT_CONTEXT,
    "@type": "Asset",
    "@id": assetId,
    properties,
    dataAddress: dataAddress(assetInput.dataAddress, config),
  };
  const contractDefinition = {
    "@context": MANAGEMENT_CONTEXT,
    "@type": "ContractDefinition",
    "@id": definitionId,
    accessPolicyId: access.id,
    contractPolicyId: contract.id,
    assetsSelector: [{ "@type": "Criterion", operandLeft: "id", operator: "=", operandRight: assetId }],
  };
  const managed = (kind, payload) => {
    const resourceDigest = digest({ kind, payload });
    return {
      kind,
      id: payload["@id"],
      resourceDigest,
      payload: {
        ...payload,
        privateProperties: {
          molitManagedBy: "molit-platform-bridge/edc-v4",
          molitResourceDigest: resourceDigest,
        },
      },
    };
  };
  return {
    publicationDigest,
    dispatchRootDigest,
    assetId,
    definitionId,
    policyIds: policies.map((entry) => entry["@id"]),
    resources: [
      ...policies.map((payload) => managed("policy", payload)),
      managed("asset", asset),
      managed("contractDefinition", contractDefinition),
    ],
  };
}

function unwrap(value) {
  if (Array.isArray(value) && value.length === 1) return unwrap(value[0]);
  if (value && typeof value === "object" && "@value" in value) return value["@value"];
  return value;
}

function marker(existing, name) {
  const properties = managedField(existing, "privateProperties");
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return undefined;
  return managedField(properties, name);
}

function managedField(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const aliases = name.startsWith("@")
    ? [name]
    : [name, `edc:${name}`, `${EDC_NAMESPACE}${name}`];
  const matches = aliases
    .filter((alias) => Object.hasOwn(value, alias))
    .map((alias) => ({ alias, value: unwrap(value[alias]) }));
  if (matches.length === 0) return undefined;
  const expected = digest(matches[0].value);
  assertRuntime(matches.every(({ value: candidate }) => digest(candidate) === expected),
    "EDC_PUBLICATION_CONFLICT", `EDC v4 response contains conflicting canonical aliases for ${name}`,
    { aliases: matches.map(({ alias }) => alias) });
  return matches[0].value;
}

function managedType(value) {
  const type = managedField(value, "@type") ?? value?.["@type"];
  if (typeof type !== "string") return type;
  if (type.startsWith(EDC_NAMESPACE)) return type.slice(type.lastIndexOf("/") + 1);
  if (type.startsWith("edc:")) return type.slice(4);
  return type;
}

function semanticProjection(value, kind) {
  const existing = object(value, `EDC v4 ${kind} response`);
  const id = managedField(existing, "@id") ?? existing["@id"];
  if (kind === "policy") {
    return { "@type": managedType(existing), "@id": id, policy: managedField(existing, "policy") };
  }
  if (kind === "asset") {
    return {
      "@type": managedType(existing),
      "@id": id,
      properties: managedField(existing, "properties"),
      dataAddress: managedField(existing, "dataAddress"),
    };
  }
  return {
    "@type": managedType(existing),
    "@id": id,
    accessPolicyId: managedField(existing, "accessPolicyId"),
    contractPolicyId: managedField(existing, "contractPolicyId"),
    assetsSelector: managedField(existing, "assetsSelector"),
  };
}

function body(value) {
  return Buffer.from(JSON.stringify(value));
}

export class EdcManagementV4PublicationClient {
  constructor({ config, http, env = process.env }) {
    assertRuntime(config?.adapter === "edc-v4", "EDC_MANAGEMENT_CONFIG_INVALID", "EDC v4 management adapter is not selected");
    assertRuntime(Array.isArray(config.allowedDataOrigins) && config.allowedDataOrigins.length > 0, "EDC_MANAGEMENT_CONFIG_INVALID", "allowedDataOrigins is required");
    config.allowedDataOrigins.forEach((origin) => assertRuntime(parseUrl(origin, "allowedDataOrigins entry").origin === origin, "EDC_MANAGEMENT_CONFIG_INVALID", "allowedDataOrigins must contain exact origins"));
    this.config = config;
    this.http = http;
    if (config.auth?.type === "api-key") assertRuntime((config.auth.header ?? "x-api-key").toLowerCase() === "x-api-key", "EDC_MANAGEMENT_CONFIG_INVALID", "EDC token-based Management API authentication uses the x-api-key header");
    this.headers = authorizationHeaders(config.auth, env);
    const base = parseUrl(config.baseUrl, "management baseUrl");
    assertRuntime(!base.username && !base.password && !base.search && !base.hash, "EDC_MANAGEMENT_CONFIG_INVALID", "management baseUrl must not contain credentials, a query or a fragment");
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    this.baseUrl = base;
  }

  async publishOffering(offering, rootKey, { signal, metadata } = {}) {
    const model = publicationModel(offering, metadata, this.config, rootKey);
    let created = 0;
    let reconciled = 0;
    for (const resource of model.resources) {
      const outcome = await this.#ensure(resource, signal);
      if (outcome === "created") created += 1;
      else reconciled += 1;
    }
    return {
      assetId: model.assetId,
      policyDefinitionIds: model.policyIds,
      contractDefinitionId: model.definitionId,
      publicationDigest: model.publicationDigest,
      dispatchRootDigest: model.dispatchRootDigest,
      created,
      reconciled,
    };
  }

  async #ensure(resource, signal) {
    const existing = await this.#get(resource, signal);
    if (existing) {
      this.#assertOwned(existing, resource);
      return "reconciled";
    }
    const collection = new URL(COLLECTIONS[resource.kind], this.baseUrl);
    const response = await this.http.json(collection, {
      method: "POST",
      headers: { ...this.headers, "content-type": "application/json", accept: "application/json" },
      body: body(resource.payload),
      signal,
    });
    if (response.status === 409) {
      const raced = await this.#get(resource, signal);
      assertRuntime(raced, "EDC_PUBLICATION_CONFLICT", `${resource.kind} ${resource.id} conflicted but cannot be read back`);
      this.#assertOwned(raced, resource);
      return "reconciled";
    }
    assertRuntime(response.status === 200, "EDC_PUBLICATION_FAILED", `EDC v4 ${resource.kind} create returned ${response.status}`);
    const responseId = response.value?.["@id"];
    assertRuntime(responseId === resource.id, "EDC_PUBLICATION_RESPONSE_INVALID", `EDC v4 ${resource.kind} create returned a different ID`);
    return "created";
  }

  async #get(resource, signal) {
    const url = new URL(`${COLLECTIONS[resource.kind]}/${encodeURIComponent(resource.id)}`, this.baseUrl);
    const response = await this.http.json(url, { headers: { accept: "application/json", ...this.headers }, signal });
    if (response.status === 404) return null;
    assertRuntime(response.status === 200, "EDC_PUBLICATION_READ_FAILED", `EDC v4 ${resource.kind} read returned ${response.status}`);
    return object(response.value, `EDC v4 ${resource.kind} response`);
  }

  #assertOwned(existing, resource) {
    assertRuntime(existing["@id"] === resource.id, "EDC_PUBLICATION_CONFLICT", `EDC v4 ${resource.kind} read returned a different ID`);
    assertRuntime(marker(existing, "molitManagedBy") === "molit-platform-bridge/edc-v4" && marker(existing, "molitResourceDigest") === resource.resourceDigest, "EDC_PUBLICATION_CONFLICT", `EDC v4 ${resource.kind} ID is already owned by a different resource`);
    const expected = semanticProjection(resource.payload, resource.kind);
    const actual = semanticProjection(existing, resource.kind);
    assertRuntime(digest(actual) === digest(expected), "EDC_PUBLICATION_CONFLICT", `EDC v4 ${resource.kind} content differs from the managed resource`);
  }
}

export const edcManagementV4Internals = Object.freeze({ MANAGEMENT_CONTEXT, publicationModel, semanticProjection });
