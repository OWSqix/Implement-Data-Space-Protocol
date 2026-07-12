import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import jsonld from "jsonld";
import { Parser, Store } from "n3";
import rdfCanonize from "rdf-canonize";
import { RdfXmlParser } from "rdfxml-streaming-parser";
import { validateSupportedXsdLiteral } from "./xsd-lexical.mjs";

const OWL_IMPORTS = "http://www.w3.org/2002/07/owl#imports";
const SH_SHAPES_GRAPH = "http://www.w3.org/ns/shacl#shapesGraph";
const DCT_CONFORMS_TO = "http://purl.org/dc/terms/conformsTo";
const PRIVATE_PREDICATE_FRAGMENTS = [
  "approvalevidence",
  "credentialref",
  "evidenceid",
  "providerauthority",
  "sourcebindingref",
];
const PUBLIC_IRI_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /(?<![0-9A-Z])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/u,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  /\b(?:binding|secret|vault):\/\//iu,
  /\bjdbc:[a-z0-9]+:/iu,
];
const PII_PATTERNS = [
  /\b\d{6}[- ]?[1-8]\d{6}\b/u,
  /(?:\+82\s*(?:\(\s*0\s*\)\s*)?1[016789]|01[016789])[-. ]?\d{3,4}[-. ]?\d{4}\b/u,
  /(?:\+82[-. ]*(?:\(\s*0\s*\)[-. ]*)?(?:2|[3-6][1-5]|70))[-. ]?\d{3,4}[-. ]?\d{4}\b/u,
  /\b0(?:2|[3-6][1-5]|70)[-. ]?\d{3,4}[-. ]?\d{4}\b/u,
  /\b0\d{1,2}[-. ]\d{3,4}[-. ]\d{4}\b/u,
  /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:[.][A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/iu,
  /[^\s<>@]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:[.][A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/iu,
];
const SENSITIVE_QUERY_KEY = /^(?:access[-_]?token|api[-_]?key|credential|password|secret|sig(?:nature)?|token|x-amz-.+|x-goog-.+)$/iu;
const STABLE_PUBLIC_URL_PREDICATES = new Set([
  "http://www.w3.org/ns/dcat#accessURL",
  "http://www.w3.org/ns/dcat#downloadURL",
  "http://www.w3.org/ns/dcat#endpointDescription",
  "http://www.w3.org/ns/dcat#endpointURL",
  "http://www.w3.org/ns/dcat#landingPage",
  "http://xmlns.com/foaf/0.1/homepage",
]);
const PERSONAL_PREDICATES = new Set([
  "http://www.w3.org/2006/vcard/ns#bday",
  "http://xmlns.com/foaf/0.1/age",
  "http://xmlns.com/foaf/0.1/birthday",
  "http://xmlns.com/foaf/0.1/familyName",
  "http://xmlns.com/foaf/0.1/givenName",
]);
const DISALLOWED_PUBLIC_PREDICATES = new Set([
  "http://www.w3.org/2006/vcard/ns#hasTelephone",
]);
const PERSONAL_CLASSES = new Set([
  "http://www.w3.org/2006/vcard/ns#Individual",
  "http://www.w3.org/ns/prov#Person",
  "http://xmlns.com/foaf/0.1/Person",
  "http://schema.org/Person",
  "https://schema.org/Person",
]);
const PUBLIC_PREDICATE_NAMESPACES = [
  "http://data.europa.eu/930/",
  "http://data.europa.eu/r5r/",
  "http://purl.org/dc/terms/",
  "http://purl.org/linked-data/sdmx/2009/attribute#",
  "http://spdx.org/rdf/terms#",
  "http://www.opengis.net/ont/geosparql#",
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  "http://www.w3.org/2000/01/rdf-schema#",
  "http://www.w3.org/2002/07/owl#",
  "http://www.w3.org/2004/02/skos/core#",
  "http://www.w3.org/2006/time#",
  "http://www.w3.org/2006/vcard/ns#",
  "http://www.w3.org/2011/content#",
  "http://www.w3.org/ns/adms#",
  "http://www.w3.org/ns/dcat#",
  "http://www.w3.org/ns/dqv#",
  "http://www.w3.org/ns/locn#",
  "http://www.w3.org/ns/odrl/2/",
  "http://www.w3.org/ns/org#",
  "http://www.w3.org/ns/prov#",
  "http://www.w3.org/ns/sosa/",
  "http://www.w3.org/ns/ssn/",
  "http://xmlns.com/foaf/0.1/",
  "https://data.molit.go.kr/def/molit-dcat-ap#",
  "https://w3id.org/mobilitydcat-ap#",
];
const GEO_PROFILE_NAMESPACES = [
  "http://data.europa.eu/930/",
  "http://www.opengis.net/ont/geosparql#",
];
const GEO_PROFILE_EXACT_TERMS = new Set([
  "http://www.w3.org/ns/locn#geometry",
  "https://data.molit.go.kr/def/molit-dcat-ap#NetworkDataset",
  "https://data.molit.go.kr/def/molit-dcat-ap#SpatialDataset",
  "https://data.molit.go.kr/def/molit-dcat-ap#networkReference",
]);
const RDF_FORMATS = new Map([
  ["application/ld+json", "jsonld"],
  ["application/n-quads", "nquads"],
  ["application/n-triples", "ntriples"],
  ["application/rdf+xml", "rdfxml"],
  ["application/x-turtle", "turtle"],
  ["json-ld", "jsonld"],
  ["jsonld", "jsonld"],
  ["n-triples", "ntriples"],
  ["n-quads", "nquads"],
  ["nquads", "nquads"],
  ["ntriples", "ntriples"],
  ["rdf/xml", "rdfxml"],
  ["rdfxml", "rdfxml"],
  ["text/turtle", "turtle"],
  ["turtle", "turtle"],
]);
const RDF_EXTENSIONS = new Map([
  [".jsonld", "jsonld"],
  [".nq", "nquads"],
  [".nt", "ntriples"],
  [".owl", "rdfxml"],
  [".rdf", "rdfxml"],
  [".ttl", "turtle"],
  [".xml", "rdfxml"],
]);
const JSONLD_MAX_DEPTH = 64;
const CANONICALIZATION_TIMEOUT_MS = 5_000;
const XML_FORBIDDEN_DECLARATION = /<\s*!\s*(?:DOCTYPE|ENTITY)\b/iu;
const XML_FORBIDDEN_PROCESSING_INSTRUCTION = /<\?\s*xml-stylesheet\b/iu;
const XINCLUDE_NAMESPACE = "http://www.w3.org/2001/XInclude";

function readIanaNetworkPolicy() {
  const policyUrl = new URL("../../standards/generated/iana-network-policy.v1.json", import.meta.url);
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(policyUrl));
  } catch (cause) {
    const error = new Error("generated IANA network policy is not valid UTF-8", { cause });
    error.code = "INVALID_IANA_NETWORK_POLICY";
    throw error;
  }
  let policy;
  try {
    policy = JSON.parse(source);
  } catch (cause) {
    const error = new Error("generated IANA network policy is invalid JSON", { cause });
    error.code = "INVALID_IANA_NETWORK_POLICY";
    throw error;
  }
  if (
    policy?.schemaVersion !== "molit.iana-network-policy/1"
    || !Array.isArray(policy.ipv4Special)
    || !Array.isArray(policy.ipv6Special)
    || !Array.isArray(policy.ipv6GlobalAllocated)
    || !Array.isArray(policy.localPolicyAdditions?.ipv4NonGlobal)
    || !Array.isArray(policy.localPolicyAdditions?.ipv6NonGlobal)
  ) {
    const error = new Error("generated IANA network policy violates its runtime contract");
    error.code = "INVALID_IANA_NETWORK_POLICY";
    throw error;
  }
  const validSpecialRow = (row) => (
    row
    && typeof row.prefix === "string"
    && typeof row.globallyReachable === "boolean"
    && (row.embeddedIpv4Policy === undefined || typeof row.embeddedIpv4Policy === "boolean")
  );
  const validPrefixRow = (row) => row && typeof row.prefix === "string";
  if (
    !policy.ipv4Special.every(validSpecialRow)
    || !policy.ipv6Special.every(validSpecialRow)
    || !policy.ipv6GlobalAllocated.every(validPrefixRow)
    || !policy.localPolicyAdditions.ipv4NonGlobal.every(validPrefixRow)
    || !policy.localPolicyAdditions.ipv6NonGlobal.every(validPrefixRow)
  ) {
    const error = new Error("generated IANA network policy contains invalid rule records");
    error.code = "INVALID_IANA_NETWORK_POLICY";
    throw error;
  }
  return policy;
}

const IANA_NETWORK_POLICY = readIanaNetworkPolicy();

function redacted(value) {
  const digest = createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
  return `[redacted:sha256:${digest}]`;
}

function bounded(value, maxLength) {
  if (value.length <= maxLength) return value;
  const digest = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
  return `[omitted:length:${value.length}:sha256:${digest}]`;
}

function validationFinding({ focusNode, message, path, value }) {
  return {
    focusNode,
    messages: [{ language: "ko", value: message }],
    path,
    requirementId: "MOLIT-SEC-PUBLIC-001",
    severity: "Violation",
    sourceConstraintComponent: "urn:kr:molit:profile:PublicProjectionSafetyConstraint",
    sourceShape: "urn:kr:molit:profile:PublicProjectionSafetyShape",
    value,
  };
}

function termValue(term) {
  return term?.value ?? "";
}

function ipv4Octets(host) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function ipv4Number(octets) {
  return octets.reduce((value, octet) => ((value * 256) + octet) >>> 0, 0);
}

function ipv4Rule(cidr, global) {
  const [host, bitsText] = cidr.split("/");
  const bits = Number(bitsText);
  const octets = ipv4Octets(host);
  if (!octets || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    const error = new Error(`invalid generated IANA IPv4 prefix: ${cidr}`);
    error.code = "INVALID_IANA_NETWORK_POLICY";
    throw error;
  }
  const prefix = ipv4Number(octets);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { bits, global, mask, prefix: prefix & mask };
}

function isNonGlobalIpv4(host) {
  const octets = ipv4Octets(host);
  if (!octets) return false;
  const address = ipv4Number(octets);
  const rule = IPV4_SPECIAL_REACHABILITY.find((candidate) => (
    (address & candidate.mask) === candidate.prefix
  ));
  return rule ? !rule.global : false;
}

function ipv6Words(normalized) {
  const [headText, tailText] = normalized.split("::");
  if (normalized.split("::").length > 2) return null;
  const head = headText ? headText.split(":").map((part) => Number.parseInt(part, 16)) : [];
  const tail = tailText ? tailText.split(":").map((part) => Number.parseInt(part, 16)) : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (!normalized.includes("::") && missing !== 0)) return null;
  const words = [...head, ...Array(missing).fill(0), ...tail];
  return words.length === 8 && words.every((word) => Number.isInteger(word))
    ? words
    : null;
}

function matchesIpv6Prefix(words, prefix, bits) {
  const fullWords = Math.floor(bits / 16);
  const remainingBits = bits % 16;
  for (let index = 0; index < fullWords; index += 1) {
    if (words[index] !== prefix[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (words[fullWords] & mask) === (prefix[fullWords] & mask);
}

function ipv6Rule(cidr, global, nat64 = false) {
  const separator = cidr.lastIndexOf("/");
  const host = cidr.slice(0, separator);
  const bits = Number(cidr.slice(separator + 1));
  const prefix = ipv6Words(host.toLowerCase());
  if (isIP(host) !== 6 || !prefix || !Number.isInteger(bits) || bits < 0 || bits > 128) {
    const error = new Error(`invalid generated IANA IPv6 prefix: ${cidr}`);
    error.code = "INVALID_IANA_NETWORK_POLICY";
    throw error;
  }
  return { bits, global, nat64, prefix };
}

function assertUniquePolicyPrefixes(rows, label) {
  const prefixes = rows.map((row) => row.prefix);
  if (new Set(prefixes).size !== prefixes.length) {
    const error = new Error(`duplicate prefix in generated IANA ${label} policy`);
    error.code = "INVALID_IANA_NETWORK_POLICY";
    throw error;
  }
}

assertUniquePolicyPrefixes(IANA_NETWORK_POLICY.ipv4Special, "IPv4 special");
assertUniquePolicyPrefixes(IANA_NETWORK_POLICY.ipv6Special, "IPv6 special");
assertUniquePolicyPrefixes(IANA_NETWORK_POLICY.ipv6GlobalAllocated, "IPv6 allocation");

const IPV4_SPECIAL_REACHABILITY = [
  ...IANA_NETWORK_POLICY.ipv4Special.map((row) => (
    ipv4Rule(row.prefix, row.globallyReachable)
  )),
  ...IANA_NETWORK_POLICY.localPolicyAdditions.ipv4NonGlobal.map((row) => (
    ipv4Rule(row.prefix, false)
  )),
].sort((left, right) => right.bits - left.bits);

const IPV6_SPECIAL_REACHABILITY = [
  ...IANA_NETWORK_POLICY.ipv6Special.map((row) => (
    ipv6Rule(row.prefix, row.globallyReachable, row.embeddedIpv4Policy === true)
  )),
  ...IANA_NETWORK_POLICY.localPolicyAdditions.ipv6NonGlobal.map((row) => (
    ipv6Rule(row.prefix, false)
  )),
].sort((left, right) => right.bits - left.bits);

const IPV6_GLOBAL_UNICAST_ALLOCATIONS = IANA_NETWORK_POLICY.ipv6GlobalAllocated
  .map((row) => ipv6Rule(row.prefix, true))
  .sort((left, right) => right.bits - left.bits);

function isNonGlobalIpv6(host) {
  if (!host.includes(":")) return false;
  const normalized = host.replace(/^\[|\]$/gu, "").toLowerCase();
  if (isIP(normalized) !== 6) return true;
  const words = ipv6Words(normalized);
  if (!words) return true;
  const rule = IPV6_SPECIAL_REACHABILITY.find((candidate) => (
    matchesIpv6Prefix(words, candidate.prefix, candidate.bits)
  ));
  if (rule?.nat64) {
    const embedded = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
    return isNonGlobalIpv4(embedded);
  }
  if (rule) return !rule.global;
  return !IPV6_GLOBAL_UNICAST_ALLOCATIONS.some((allocation) => (
    matchesIpv6Prefix(words, allocation.prefix, allocation.bits)
  ));
}

function matchesSensitiveText(value) {
  const normalized = value.normalize("NFKC").replace(/\p{Cf}/gu, "");
  return SECRET_PATTERNS.some((pattern) => pattern.test(normalized))
    || PII_PATTERNS.some((pattern) => pattern.test(normalized));
}

function decodedUrlComponent(value) {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) return decoded;
    decoded = next;
  }
  return decoded;
}

function isNonCanonicalMolitProfileAlias(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/[.]$/u, "");
    const decodedPath = decodedUrlComponent(parsed.pathname);
    const belongsToProfileFamily = host === "data.molit.go.kr"
      && /^\/profile\/molit-dcat-ap(?:\/|$)/u.test(decodedPath);
    const canonicalLexicalIri = /^https:\/\/data[.]molit[.]go[.]kr\/profile\/molit-dcat-ap(?:\/[^?#]*)?$/u
      .test(value);
    return belongsToProfileFamily && !canonicalLexicalIri;
  } catch {
    return false;
  }
}

function isAllowedRoleMailboxBinding({
  policy,
  predicate,
  quad,
  store,
  term,
  allowedRoleMailboxes,
}) {
  if (!allowedRoleMailboxes.has(term.value)) return false;
  const isInstitutionalContact = (contact) => store.getQuads(
    null,
    policy.contactPointPredicate,
    contact,
    null,
  ).length > 0 && store.getQuads(
    contact,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    null,
    null,
  ).some((candidate) => candidate.object.value === policy.contactClass);
  if (term === quad.object && predicate === policy.mailboxPredicate) {
    return isInstitutionalContact(quad.subject);
  }
  return false;
}

export function blockedHttpIriReason(value) {
  if (!/^https?:/iu.test(value)) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/[.]$/u, "");
    const addressHost = host.replace(/^\[|\]$/gu, "");
    if (parsed.username || parsed.password) return "userinfo";
    if ([...parsed.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEY.test(key))) {
      return "sensitive-query";
    }
    for (const item of parsed.searchParams.values()) {
      try {
        if (matchesSensitiveText(item) || matchesSensitiveText(decodedUrlComponent(item))) {
          return "sensitive-query-value";
        }
      } catch {
        return "invalid-url-encoding";
      }
    }
    let decodedPath;
    let decodedFragment;
    try {
      decodedPath = decodedUrlComponent(parsed.pathname);
      decodedFragment = decodedUrlComponent(parsed.hash);
    } catch {
      return "invalid-url-encoding";
    }
    if ([parsed.pathname, parsed.hash, decodedPath, decodedFragment].some((item) => (
      matchesSensitiveText(item)
    ))) return "sensitive-url-component";
    if (
      host === "localhost"
      || (!addressHost.includes(".") && !addressHost.includes(":") && isIP(addressHost) === 0)
      || host.endsWith(".localhost")
      || host === "home.arpa"
      || host.endsWith(".home.arpa")
      || host === "test"
      || host.endsWith(".test")
      || host === "example"
      || host.endsWith(".example")
      || host === "corp"
      || host.endsWith(".corp")
      || host === "lan"
      || host.endsWith(".lan")
      || host === "home"
      || host.endsWith(".home")
      || host.endsWith(".internal")
      || host.endsWith(".invalid")
      || host.endsWith(".local")
      || host === "onion"
      || host.endsWith(".onion")
      || isNonGlobalIpv4(addressHost)
      || isNonGlobalIpv6(addressHost)
    ) return "non-global-host";
    return null;
  } catch {
    return "invalid-http-iri";
  }
}

function hasApprovedPublicHost(value, allowedPublicHosts) {
  if (!/^https?:/iu.test(value)) return true;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/[.]$/u, "");
    const unbracketed = host.replace(/^\[|\]$/gu, "");
    // The release registry contains DNS names only. A globally reachable IP
    // address is not, by itself, an approved publication endpoint.
    if (isIP(unbracketed) !== 0) return false;
    return allowedPublicHosts.has(host);
  } catch {
    return false;
  }
}

function unstablePublicUrlReason(predicate, value, allowedStablePublicHosts) {
  if (!STABLE_PUBLIC_URL_PREDICATES.has(predicate)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return "non-https-public-url";
    if (parsed.search || parsed.hash) return "query-or-fragment";
    const host = parsed.hostname.toLowerCase().replace(/[.]$/u, "");
    if (!allowedStablePublicHosts.has(host)) return "unapproved-public-host";
    return null;
  } catch {
    return "invalid-public-url";
  }
}

function isApprovedPublicPredicate(value) {
  return PUBLIC_PREDICATE_NAMESPACES.some((namespace) => value.startsWith(namespace));
}

function nestedTerms(term) {
  const terms = [term];
  if (term?.termType === "Literal") terms.push(term.datatype);
  if (term?.termType === "Quad") {
    terms.push(
      ...nestedTerms(term.subject),
      ...nestedTerms(term.predicate),
      ...nestedTerms(term.object),
      ...nestedTerms(term.graph),
    );
  }
  return terms;
}

function safeFocusNode(term) {
  const value = termValue(term);
  if (term?.termType !== "NamedNode") {
    return bounded(matchesSensitiveText(value) ? redacted(value) : value, 4096);
  }
  const scheme = value.match(/^[A-Za-z][A-Za-z0-9+.-]*:/u)?.[0]?.toLowerCase();
  const safe = (scheme && (!PUBLIC_IRI_SCHEMES.has(scheme) || scheme === "mailto:"))
    || blockedHttpIriReason(value)
    || matchesSensitiveText(value)
    ? redacted(value)
    : value;
  return bounded(safe, 4096);
}

export function sanitizeDiagnosticValue(value, maxLength = 20000) {
  if (typeof value !== "string") return value ?? null;
  const scheme = value.match(/^[A-Za-z][A-Za-z0-9+.-]*:/u)?.[0]?.toLowerCase();
  if ((scheme && (!PUBLIC_IRI_SCHEMES.has(scheme) || scheme === "mailto:"))
    || blockedHttpIriReason(value)
    || matchesSensitiveText(value)) {
    return redacted(value);
  }
  return bounded(value, maxLength);
}

function rdfInputError(message, code, diagnosticLabel, { cause, details } = {}) {
  const error = new Error(`${message}: ${diagnosticLabel}`, cause ? { cause } : undefined);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function formatFromSourceLabel(sourceLabel) {
  const extension = path.extname(String(sourceLabel)).toLowerCase();
  return RDF_EXTENSIONS.get(extension) ?? null;
}

function normalizeRdfFormat(format, sourceLabel, { requireKnownExtension = false } = {}) {
  if (format !== undefined && (typeof format !== "string" || format.trim() === "")) {
    const error = new TypeError("RDF format must be a non-empty string");
    error.code = "UNSUPPORTED_RDF_FORMAT";
    throw error;
  }
  if (format !== undefined) {
    const [mediaType, ...parameters] = format.toLowerCase().split(";").map((item) => item.trim());
    for (const parameter of parameters) {
      const charset = /^charset\s*=\s*["']?([^"']+)["']?$/u.exec(parameter)?.[1];
      if (charset && charset !== "utf-8" && charset !== "utf8") {
        const error = new Error("RDF input charset must be UTF-8");
        error.code = "UNSUPPORTED_RDF_CHARSET";
        throw error;
      }
    }
    const normalized = RDF_FORMATS.get(mediaType);
    if (normalized) return normalized;
    const error = new Error(`unsupported RDF format: ${mediaType}`);
    error.code = "UNSUPPORTED_RDF_FORMAT";
    throw error;
  }
  const inferred = formatFromSourceLabel(sourceLabel);
  if (inferred) return inferred;
  if (!requireKnownExtension) return "turtle";
  const error = new Error("RDF file extension does not identify an approved serialization");
  error.code = "UNSUPPORTED_RDF_FORMAT";
  throw error;
}

function strictJsonError(message, code = "INVALID_JSONLD") {
  const error = new SyntaxError(message);
  error.code = code;
  return error;
}

function parseStrictJson(source, maxNodes) {
  let index = 0;
  let nodes = 0;

  const skipWhitespace = () => {
    while (index < source.length && /[\t\n\r ]/u.test(source[index])) index += 1;
  };

  const parseString = () => {
    if (source[index] !== "\"") throw strictJsonError(`expected JSON string at offset ${index}`);
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === "\"") {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch (cause) {
          throw strictJsonError(`invalid JSON string at offset ${start}: ${cause.message}`);
        }
      }
      if (character === "\\") {
        index += 2;
        continue;
      }
      index += 1;
    }
    throw strictJsonError(`unterminated JSON string at offset ${start}`);
  };

  const parseValue = (depth) => {
    if (depth > JSONLD_MAX_DEPTH) {
      throw strictJsonError("JSON-LD nesting exceeds the allowed depth", "JSONLD_COMPLEXITY_LIMIT");
    }
    nodes += 1;
    if (nodes > maxNodes) {
      throw strictJsonError("JSON-LD value count exceeds the allowed limit", "JSONLD_COMPLEXITY_LIMIT");
    }
    skipWhitespace();
    const character = source[index];
    if (character === "\"") return parseString();
    if (character === "{") {
      index += 1;
      const value = {};
      const keys = new Set();
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return value;
      }
      while (index < source.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) {
          throw strictJsonError(`duplicate JSON key at offset ${index}`, "JSONLD_DUPLICATE_KEY");
        }
        if (["__proto__", "constructor", "prototype"].includes(key)) {
          throw strictJsonError("unsafe JSON object key is not allowed", "JSONLD_UNSAFE_KEY");
        }
        keys.add(key);
        skipWhitespace();
        if (source[index] !== ":") throw strictJsonError(`expected ':' at offset ${index}`);
        index += 1;
        const item = parseValue(depth + 1);
        Object.defineProperty(value, key, {
          configurable: true,
          enumerable: true,
          value: item,
          writable: true,
        });
        skipWhitespace();
        if (source[index] === "}") {
          index += 1;
          return value;
        }
        if (source[index] !== ",") throw strictJsonError(`expected ',' at offset ${index}`);
        index += 1;
      }
      throw strictJsonError("unterminated JSON object");
    }
    if (character === "[") {
      index += 1;
      const value = [];
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return value;
      }
      while (index < source.length) {
        value.push(parseValue(depth + 1));
        skipWhitespace();
        if (source[index] === "]") {
          index += 1;
          return value;
        }
        if (source[index] !== ",") throw strictJsonError(`expected ',' at offset ${index}`);
        index += 1;
      }
      throw strictJsonError("unterminated JSON array");
    }
    for (const [token, value] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(token, index)) {
        index += token.length;
        return value;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(source.slice(index))?.[0];
    if (number) {
      index += number.length;
      const value = Number(number);
      if (!Number.isFinite(value)) throw strictJsonError("JSON-LD number is outside the finite range");
      return value;
    }
    throw strictJsonError(`invalid JSON value at offset ${index}`);
  };

  const value = parseValue(0);
  skipWhitespace();
  if (index !== source.length) throw strictJsonError(`trailing JSON data at offset ${index}`);
  return value;
}

function decodeXmlCharacterReferences(source) {
  return source.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/giu, (match, hexadecimal, decimal) => {
    const value = Number.parseInt(hexadecimal ?? decimal, hexadecimal ? 16 : 10);
    try {
      return String.fromCodePoint(value);
    } catch {
      return match;
    }
  });
}

function assertSafeRdfXml(source, diagnosticLabel) {
  const expanded = decodeXmlCharacterReferences(source);
  if (XML_FORBIDDEN_DECLARATION.test(expanded)) {
    throw rdfInputError(
      "RDF/XML DTD and entity declarations are forbidden",
      "RDFXML_DTD_FORBIDDEN",
      diagnosticLabel,
    );
  }
  if (XML_FORBIDDEN_PROCESSING_INSTRUCTION.test(expanded)) {
    throw rdfInputError(
      "RDF/XML stylesheet processing instructions are forbidden",
      "RDFXML_PROCESSING_INSTRUCTION_FORBIDDEN",
      diagnosticLabel,
    );
  }
  if (expanded.includes(XINCLUDE_NAMESPACE)) {
    throw rdfInputError(
      "RDF/XML XInclude is forbidden",
      "RDFXML_XINCLUDE_FORBIDDEN",
      diagnosticLabel,
    );
  }
  const declaration = /^\uFEFF?<\?xml\s+([^?]*)\?>/iu.exec(expanded)?.[1];
  const encoding = declaration
    ? /\bencoding\s*=\s*(["'])([^"']+)\1/iu.exec(declaration)?.[2]
    : null;
  if (encoding && !/^utf-?8$/iu.test(encoding)) {
    throw rdfInputError(
      "RDF/XML declaration must identify UTF-8",
      "RDFXML_ENCODING_FORBIDDEN",
      diagnosticLabel,
    );
  }
}

function parseRdfXml(source, { baseIRI, diagnosticLabel, maxQuads }) {
  assertSafeRdfXml(source, diagnosticLabel);
  return new Promise((resolve, reject) => {
    const parser = new RdfXmlParser({
      allowDuplicateRdfIds: false,
      baseIRI,
      parseUnsupportedVersions: false,
      strict: true,
      trackPosition: false,
      validateUri: true,
    });
    const quads = [];
    let settled = false;
    const fail = (cause) => {
      if (settled) return;
      settled = true;
      if (cause?.code === "RDF_QUAD_LIMIT") reject(cause);
      else reject(rdfInputError("invalid RDF/XML", "INVALID_RDFXML", diagnosticLabel, { cause }));
    };
    parser.on("data", (quad) => {
      quads.push(quad);
      if (quads.length > maxQuads) {
        const error = rdfInputError(
          "RDF input exceeds the quad limit",
          "RDF_QUAD_LIMIT",
          diagnosticLabel,
          { details: { maxQuads, quads: quads.length } },
        );
        parser.destroy(error);
      }
    });
    parser.once("error", fail);
    parser.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(quads);
    });
    parser.end(source);
  });
}

async function parseJsonLd(source, { baseIRI, diagnosticLabel, maxNodes }) {
  let document;
  try {
    document = parseStrictJson(source, maxNodes);
  } catch (cause) {
    if (cause?.code?.startsWith("JSONLD_")) {
      throw rdfInputError(cause.message, cause.code, diagnosticLabel, { cause });
    }
    throw rdfInputError("invalid JSON-LD", "INVALID_JSONLD", diagnosticLabel, { cause });
  }
  let remoteDocument;
  const documentLoader = async (url) => {
    remoteDocument = String(url);
    const error = new Error("remote JSON-LD documents are disabled");
    error.code = "JSONLD_REMOTE_DOCUMENT_FORBIDDEN";
    throw error;
  };
  let nquads;
  try {
    nquads = await jsonld.toRDF(document, {
      base: baseIRI,
      documentLoader,
      format: "application/n-quads",
      produceGeneralizedRdf: false,
      safe: true,
    });
  } catch (cause) {
    if (remoteDocument !== undefined) {
      throw rdfInputError(
        "remote JSON-LD context or document is forbidden",
        "JSONLD_REMOTE_DOCUMENT_FORBIDDEN",
        diagnosticLabel,
        { details: { remoteDocument: redacted(remoteDocument) } },
      );
    }
    throw rdfInputError("invalid JSON-LD", "INVALID_JSONLD", diagnosticLabel, { cause });
  }
  try {
    return new Parser({ baseIRI, format: "N-Quads" }).parse(nquads);
  } catch (cause) {
    throw rdfInputError("invalid JSON-LD RDF output", "INVALID_JSONLD", diagnosticLabel, { cause });
  }
}

export async function canonicalGraphDigest(storeOrQuads, {
  timeoutMs = CANONICALIZATION_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    const error = new RangeError("canonicalization timeout must be between 1 and 60000 ms");
    error.code = "INVALID_CANONICALIZATION_LIMIT";
    throw error;
  }
  const quads = typeof storeOrQuads?.getQuads === "function"
    ? storeOrQuads.getQuads(null, null, null, null)
    : new Store(storeOrQuads).getQuads(null, null, null, null);
  let canonicalNQuads;
  try {
    canonicalNQuads = await rdfCanonize.canonize(quads, {
      algorithm: "RDFC-1.0",
      maxWorkFactor: 1,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const error = new Error("RDF dataset canonicalization exceeded its security limit", { cause });
    error.code = "RDF_CANONICALIZATION_LIMIT";
    throw error;
  }
  return {
    algorithm: "RDFC-1.0",
    canonicalBytes: Buffer.byteLength(canonicalNQuads, "utf8"),
    quadCount: quads.length,
    sha256: createHash("sha256").update(canonicalNQuads, "utf8").digest("hex"),
  };
}

export async function loadRdfBytes(bytes, sourceLabel, limits, {
  baseIRI,
  canonicalize = false,
  format,
  trusted = false,
} = {}) {
  const source = Buffer.from(bytes);
  const diagnosticLabel = matchesSensitiveText(String(sourceLabel))
    ? redacted(sourceLabel)
    : bounded(String(sourceLabel), 4096);
  const maxBytes = trusted
    ? Math.max(limits.maxInputBytes, 20 * 1024 * 1024)
    : limits.maxInputBytes;
  if (source.length > maxBytes) {
    throw rdfInputError(
      "RDF input exceeds the allowed size",
      "RDF_INPUT_SIZE_LIMIT",
      diagnosticLabel,
      { details: { bytes: source.length, maxBytes } },
    );
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch (cause) {
    throw rdfInputError("RDF input is not valid UTF-8", "INVALID_UTF8", diagnosticLabel, { cause });
  }
  const rdfFormat = normalizeRdfFormat(format, sourceLabel);
  const maxQuads = trusted
    ? Math.max(limits.maxInputQuads, 500_000)
    : limits.maxInputQuads;
  let quads;
  if (rdfFormat === "rdfxml") {
    quads = await parseRdfXml(text, { baseIRI, diagnosticLabel, maxQuads });
  } else if (rdfFormat === "jsonld") {
    quads = await parseJsonLd(text, {
      baseIRI,
      diagnosticLabel,
      maxNodes: Math.min(250_000, Math.max(10_000, maxQuads * 4)),
    });
  } else {
    const n3Format = rdfFormat === "ntriples"
      ? "N-Triples"
      : rdfFormat === "nquads" ? "N-Quads" : "text/turtle";
    try {
      quads = new Parser({
        ...(baseIRI === undefined ? {} : { baseIRI }),
        format: n3Format,
      }).parse(text);
    } catch (cause) {
      const name = rdfFormat === "ntriples"
        ? "N-Triples"
        : rdfFormat === "nquads" ? "N-Quads" : "Turtle";
      throw rdfInputError(`invalid ${name} RDF`, `INVALID_${rdfFormat.toUpperCase()}`, diagnosticLabel, { cause });
    }
  }
  if (quads.length > maxQuads) {
    throw rdfInputError(
      "RDF input exceeds the quad limit",
      "RDF_QUAD_LIMIT",
      diagnosticLabel,
      { details: { maxQuads, quads: quads.length } },
    );
  }
  const store = new Store(quads);
  const canonicalGraph = canonicalize
    ? await canonicalGraphDigest(store)
    : null;
  return {
    bytes: source.length,
    byteSha256: createHash("sha256").update(source).digest("hex"),
    canonicalGraph,
    quads,
    rdfFormat,
    store,
  };
}

export async function loadRdfFile(filePath, limits, {
  baseIRI,
  canonicalize = false,
  format,
  trusted = false,
} = {}) {
  const diagnosticPath = matchesSensitiveText(String(filePath))
    ? redacted(filePath)
    : bounded(String(filePath), 4096);
  const rdfFormat = normalizeRdfFormat(format, filePath, { requireKnownExtension: true });
  const metadata = await stat(filePath);
  const maxBytes = trusted
    ? Math.max(limits.maxInputBytes, 20 * 1024 * 1024)
    : limits.maxInputBytes;
  if (!metadata.isFile() || metadata.size > maxBytes) {
    const error = new Error(`RDF input exceeds the allowed size: ${diagnosticPath}`);
    error.code = "RDF_INPUT_SIZE_LIMIT";
    error.details = { bytes: metadata.size, maxBytes };
    throw error;
  }
  const bytes = await readFile(filePath);
  if (bytes.length > maxBytes) {
    const error = new Error(`RDF input grew beyond the allowed size: ${diagnosticPath}`);
    error.code = "RDF_INPUT_SIZE_LIMIT";
    error.details = { bytes: bytes.length, maxBytes };
    throw error;
  }
  return loadRdfBytes(bytes, filePath, limits, {
    baseIRI,
    canonicalize,
    format: rdfFormat,
    trusted,
  });
}

export async function assertCanonicalGraphEquivalence(documents, limits) {
  if (!Array.isArray(documents) || documents.length < 2) {
    const error = new TypeError("canonical graph equivalence requires at least two RDF documents");
    error.code = "INVALID_RDF_EQUIVALENCE_INPUT";
    throw error;
  }
  const evidence = [];
  for (const document of documents) {
    if (!document || document.bytes === undefined || typeof document.sourceLabel !== "string") {
      const error = new TypeError("each RDF document requires bytes and a sourceLabel");
      error.code = "INVALID_RDF_EQUIVALENCE_INPUT";
      throw error;
    }
    const loaded = await loadRdfBytes(document.bytes, document.sourceLabel, limits, {
      ...(document.baseIRI === undefined ? {} : { baseIRI: document.baseIRI }),
      canonicalize: true,
      ...(document.format === undefined ? {} : { format: document.format }),
    });
    evidence.push({
      byteSha256: loaded.byteSha256,
      bytes: loaded.bytes,
      canonicalGraphSha256: loaded.canonicalGraph.sha256,
      quads: loaded.canonicalGraph.quadCount,
      rdfFormat: loaded.rdfFormat,
      sourceLabel: matchesSensitiveText(document.sourceLabel)
        ? redacted(document.sourceLabel)
        : bounded(document.sourceLabel, 4096),
    });
  }
  const digests = new Set(evidence.map((item) => item.canonicalGraphSha256));
  if (digests.size !== 1) {
    const error = new Error("RDF serializations do not produce the same canonical graph");
    error.code = "RDF_SERIALIZATION_GRAPH_MISMATCH";
    error.details = { documents: evidence };
    throw error;
  }
  return {
    algorithm: "RDFC-1.0",
    documents: evidence,
    sha256: evidence[0].canonicalGraphSha256,
  };
}

export function scanPublicGraph(
  store,
  limits,
  maxFindings = limits.maxValidationResults,
  publicValuePolicy = {},
) {
  const findings = [];
  const seen = new Set();
  const valueCounts = new Map();
  let limitReached = false;
  const allowedRoleMailboxes = new Set(publicValuePolicy.allowedRoleMailboxes ?? []);
  const allowedStablePublicHosts = new Set(publicValuePolicy.allowedStablePublicHosts ?? []);
  const allowedPublicHosts = new Set(
    publicValuePolicy.allowedPublicHosts ?? [],
  );
  const add = (finding) => {
    const key = JSON.stringify(finding);
    if (seen.has(key)) return;
    seen.add(key);
    if (findings.length >= maxFindings) {
      limitReached = true;
      return;
    }
    findings.push(finding);
  };

  for (const quad of store) {
    if (limitReached) break;
    const subject = safeFocusNode(quad.subject);
    const predicate = termValue(quad.predicate);
    const diagnosticPath = sanitizeDiagnosticValue(predicate, 4096);
    const valueKey = `${quad.subject.termType}:${quad.subject.value}|${predicate}`;
    const valueCount = (valueCounts.get(valueKey) ?? 0) + 1;
    valueCounts.set(valueKey, valueCount);
    const valueLimit = predicate === "http://purl.org/dc/terms/title"
      || predicate === "http://purl.org/dc/terms/description"
      ? Math.min(100, limits.maxValuesPerSubjectPredicate)
      : limits.maxValuesPerSubjectPredicate;
    if (valueCount === valueLimit + 1) {
      add({
        ...validationFinding({
          focusNode: subject,
          message: "단일 subject·predicate의 값 수가 검증 복잡도 한도를 넘었다.",
          path: diagnosticPath,
          value: `[value count exceeds ${valueLimit}]`,
        }),
        requirementId: "MOLIT-SEC-COMPLEXITY-001",
        sourceConstraintComponent: "urn:kr:molit:profile:ValueCardinalityLimitConstraint",
        sourceShape: "urn:kr:molit:profile:ValueCardinalityLimitShape",
      });
    }
    if (PERSONAL_PREDICATES.has(predicate)
      || (predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
        && PERSONAL_CLASSES.has(termValue(quad.object)))) {
      add({
        ...validationFinding({
          focusNode: subject,
          message: "공개 카탈로그 graph에 개인 유형 또는 개인 연락처 predicate를 넣을 수 없다.",
          path: diagnosticPath,
          value: redacted(termValue(quad.object)),
        }),
        requirementId: "MOLIT-SEC-PUBLIC-005",
        sourceConstraintComponent: "urn:kr:molit:profile:PublicPiiConstraint",
        sourceShape: "urn:kr:molit:profile:PublicPiiShape",
      });
    }
    if (DISALLOWED_PUBLIC_PREDICATES.has(predicate)) {
      add({
        ...validationFinding({
          focusNode: subject,
          message: "0.1.0 공개 카탈로그에는 전화번호를 게시하지 않는다. 승인된 기관 role mailbox를 사용해야 한다.",
          path: diagnosticPath,
          value: redacted(termValue(quad.object)),
        }),
        requirementId: "MOLIT-SEC-PUBLIC-007",
        sourceConstraintComponent: "urn:kr:molit:profile:PublicTelephonePolicyConstraint",
        sourceShape: "urn:kr:molit:profile:PublicTelephonePolicyShape",
      });
    }
    if (predicate === DCT_CONFORMS_TO
      && quad.object.termType === "NamedNode"
      && isNonCanonicalMolitProfileAlias(quad.object.value)) {
      add({
        ...validationFinding({
          focusNode: subject,
          message: "국토교통 profile marker는 release에 고정된 canonical HTTPS IRI와 철자까지 일치해야 한다.",
          path: diagnosticPath,
          value: redacted(quad.object.value),
        }),
        requirementId: "MOLIT-PROFILE-MARKER-003",
        sourceConstraintComponent: "urn:kr:molit:profile:CanonicalProfileMarkerConstraint",
        sourceShape: "urn:kr:molit:profile:CanonicalProfileMarkerShape",
      });
    }
    if (quad.object.termType === "NamedNode") {
      const reason = unstablePublicUrlReason(
        predicate,
        quad.object.value,
        allowedStablePublicHosts,
      );
      if (reason) {
        add({
          ...validationFinding({
            focusNode: subject,
            message: "공개 접근·서비스 URL은 query와 fragment가 없는 안정적인 HTTPS IRI여야 한다.",
            path: diagnosticPath,
            value: redacted(quad.object.value),
          }),
          requirementId: "MOLIT-SEC-PUBLIC-006",
          sourceConstraintComponent: "urn:kr:molit:profile:StablePublicUrlConstraint",
          sourceShape: "urn:kr:molit:profile:StablePublicUrlShape",
        });
      }
    }
    if (predicate === OWL_IMPORTS || predicate === SH_SHAPES_GRAPH) {
      add(validationFinding({
        focusNode: subject,
        message: "공개 데이터 그래프에서 동적 import 또는 shapesGraph 지시자를 사용할 수 없다.",
        path: diagnosticPath,
        value: redacted(termValue(quad.object)),
      }));
    }
    if (!isApprovedPublicPredicate(predicate)) {
      add({
        ...validationFinding({
          focusNode: subject,
          message: "공개 그래프 predicate는 승인된 공공 메타데이터 namespace에 속해야 한다.",
          path: diagnosticPath,
          value: null,
        }),
        requirementId: "MOLIT-SEC-PUBLIC-002",
        sourceConstraintComponent: "urn:kr:molit:profile:PublicPredicateAllowlistConstraint",
        sourceShape: "urn:kr:molit:profile:PublicPredicateAllowlistShape",
      });
    }
    if (PRIVATE_PREDICATE_FRAGMENTS.some((fragment) => predicate.toLowerCase().includes(fragment))) {
      add(validationFinding({
        focusNode: subject,
        message: "공개 그래프에 내부 증빙, 자격 또는 원천 바인딩 predicate를 넣을 수 없다.",
        path: diagnosticPath,
        value: redacted(termValue(quad.object)),
      }));
    }
    const topLevelTerms = [quad.subject, quad.predicate, quad.object, quad.graph];
    if (topLevelTerms.some((term) => nestedTerms(term).some((item) => item?.termType === "Quad"))) {
      add({
        ...validationFinding({
          focusNode: subject,
          message: "0.1.0 공개 메타데이터 그래프에서는 RDF-star quoted triple을 사용할 수 없다.",
          path: diagnosticPath,
          value: "[quoted-triple]",
        }),
        requirementId: "MOLIT-SEC-PUBLIC-003",
        sourceConstraintComponent: "urn:kr:molit:profile:RdfStarNotAllowedConstraint",
        sourceShape: "urn:kr:molit:profile:RdfStarNotAllowedShape",
      });
    }
    for (const term of topLevelTerms.flatMap(nestedTerms)) {
      if (term.termType === "NamedNode") {
        const value = term.value;
        const scheme = value.match(/^[A-Za-z][A-Za-z0-9+.-]*:/u)?.[0]?.toLowerCase();
        const allowedRoleMailbox = isAllowedRoleMailboxBinding({
          allowedRoleMailboxes,
          policy: publicValuePolicy,
          predicate,
          quad,
          store,
          term,
        });
        if (!scheme) {
          add({
            ...validationFinding({
              focusNode: subject,
              message: "공개 그래프의 NamedNode는 절대 IRI여야 한다.",
              path: diagnosticPath,
              value: sanitizeDiagnosticValue(value),
            }),
            requirementId: "MOLIT-SEC-PUBLIC-004",
            sourceConstraintComponent: "urn:kr:molit:profile:AbsoluteIriConstraint",
            sourceShape: "urn:kr:molit:profile:AbsoluteIriShape",
          });
        }
        if ((scheme && !PUBLIC_IRI_SCHEMES.has(scheme))
          || (scheme === "mailto:" && !allowedRoleMailbox)
          || !hasApprovedPublicHost(value, allowedPublicHosts)
          || blockedHttpIriReason(value)) {
          add(validationFinding({
            focusNode: subject,
            message: "공개 그래프에 승인되지 않은 주소 체계·공개 host 또는 내부 네트워크 주소가 포함되어 있다.",
            path: diagnosticPath,
            value: redacted(value),
          }));
        }
        if (matchesSensitiveText(value) && !allowedRoleMailbox) {
          add({
            ...validationFinding({
              focusNode: subject,
              message: "공개 IRI에서 비밀정보 또는 개인정보 형식을 발견했다.",
              path: diagnosticPath,
              value: redacted(value),
            }),
            requirementId: "MOLIT-SEC-PUBLIC-005",
            sourceConstraintComponent: "urn:kr:molit:profile:PublicPiiConstraint",
            sourceShape: "urn:kr:molit:profile:PublicPiiShape",
          });
        }
      }
      if (term.termType === "Literal") {
        const lexical = validateSupportedXsdLiteral(term);
        if (lexical && !lexical.valid) {
          const message = lexical.reason === "unsupported-xsd-datatype"
            ? "공개 그래프의 XML Schema datatype은 승인된 registry에 있어야 한다."
            : "승인된 XML Schema datatype의 lexical space와 값 범위를 충족해야 한다.";
          add({
            ...validationFinding({
              focusNode: subject,
              message,
              path: diagnosticPath,
              value: sanitizeDiagnosticValue(term.value),
            }),
            requirementId: "MOLIT-SEM-DATATYPE-001",
            sourceConstraintComponent: "urn:kr:molit:profile:XsdLexicalValueConstraint",
            sourceShape: "urn:kr:molit:profile:XsdLexicalValueShape",
          });
        }
        if (term.value.length > limits.maxLiteralLength) {
          add(validationFinding({
            focusNode: subject,
            message: "공개 메타데이터 literal이 허용 길이를 넘었다.",
            path: diagnosticPath,
            value: `[literal length ${term.value.length}]`,
          }));
        }
        if (matchesSensitiveText(term.value)) {
          add({
            ...validationFinding({
              focusNode: subject,
              message: "공개 메타데이터 literal에서 비밀정보 또는 개인정보 형식을 발견했다.",
              path: diagnosticPath,
              value: redacted(term.value),
            }),
            requirementId: "MOLIT-SEC-PUBLIC-005",
            sourceConstraintComponent: "urn:kr:molit:profile:PublicPiiConstraint",
            sourceShape: "urn:kr:molit:profile:PublicPiiShape",
          });
        }
      }
    }
  }
  return { findings, limitReached };
}

export function scanCoreProfileRouting(
  store,
  profileName,
  maxFindings,
) {
  if (profileName !== "core" && profileName !== "core-publication") {
    return { findings: [], limitReached: false };
  }
  const findings = [];
  const subjects = new Set();
  let limitReached = false;
  for (const quad of store) {
    const coreCoverageLiteral = quad.object.termType === "Literal"
      && (quad.predicate.value === "http://www.w3.org/ns/dcat#bbox"
        || quad.predicate.value === "http://www.w3.org/ns/dcat#centroid")
      && (quad.object.datatype.value === "http://www.opengis.net/ont/geosparql#wktLiteral"
        || quad.object.datatype.value === "http://www.opengis.net/ont/geosparql#gmlLiteral");
    const routingTerms = [quad.subject, quad.predicate, quad.graph]
      .flatMap(nestedTerms)
      .concat(coreCoverageLiteral ? [quad.object] : nestedTerms(quad.object));
    const usesGeoProfileTerm = routingTerms
      .some((term) => (
        term?.termType === "NamedNode"
          && (GEO_PROFILE_EXACT_TERMS.has(term.value)
            || GEO_PROFILE_NAMESPACES.some((namespace) => term.value.startsWith(namespace)))
      ));
    if (!usesGeoProfileTerm) continue;
    const subjectKey = `${quad.subject.termType}:${quad.subject.value}`;
    if (subjects.has(subjectKey)) continue;
    subjects.add(subjectKey);
    if (findings.length >= maxFindings) {
      limitReached = true;
      break;
    }
    findings.push({
      ...validationFinding({
        focusNode: safeFocusNode(quad.subject),
        message: "GeoDCAT-AP, GeoSPARQL, LOCN geometry 또는 국토교통 공간 term을 사용한 graph는 Geo subprofile로 검증해야 한다.",
        path: sanitizeDiagnosticValue(quad.predicate.value, 4096),
        value: null,
      }),
      requirementId: "MOLIT-PROFILE-SELECTION-001",
      sourceConstraintComponent: "urn:kr:molit:profile:ProfileRoutingConstraint",
      sourceShape: "urn:kr:molit:profile:CoreRejectsGeoProfileTermsShape",
    });
  }
  return { findings, limitReached };
}

export function mergeStores(target, sources) {
  for (const source of sources) {
    target.addQuads(source.getQuads(null, null, null, null));
  }
  return target;
}
