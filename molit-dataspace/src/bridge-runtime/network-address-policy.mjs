import { readFileSync } from "node:fs";
import { isIP } from "node:net";

function fail(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "INVALID_IANA_NETWORK_POLICY";
  throw error;
}

function loadPolicy() {
  const url = new URL("../../standards/generated/iana-network-policy.v1.json", import.meta.url);
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(url));
  } catch (cause) {
    fail("generated IANA network policy is not valid UTF-8", cause);
  }
  let policy;
  try {
    policy = JSON.parse(source);
  } catch (cause) {
    fail("generated IANA network policy is invalid JSON", cause);
  }
  if (policy?.schemaVersion !== "molit.iana-network-policy/1"
    || !Array.isArray(policy.ipv4Special)
    || !Array.isArray(policy.ipv6Special)
    || !Array.isArray(policy.ipv6GlobalAllocated)
    || !Array.isArray(policy.localPolicyAdditions?.ipv4NonGlobal)
    || !Array.isArray(policy.localPolicyAdditions?.ipv6NonGlobal)) {
    fail("generated IANA network policy violates its runtime contract");
  }
  return policy;
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

function classification(row) {
  if (row.globallyReachable === true) return "public";
  return row.name === "Private-Use" || row.name === "Unique-Local" ? "private" : "forbidden";
}

function ipv4Rule(row) {
  const [host, bitsText] = row.prefix.split("/");
  const bits = Number(bitsText);
  const octets = ipv4Octets(host);
  if (!octets || !Number.isInteger(bits) || bits < 0 || bits > 32) fail(`invalid generated IANA IPv4 prefix: ${row.prefix}`);
  const prefix = ipv4Number(octets);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { bits, class: classification(row), mask, prefix: prefix & mask };
}

function expandEmbeddedIpv4(normalized) {
  if (!normalized.includes(".")) return normalized;
  const separator = normalized.lastIndexOf(":");
  const octets = ipv4Octets(normalized.slice(separator + 1));
  if (separator < 0 || !octets) return normalized;
  const high = ((octets[0] << 8) | octets[1]).toString(16);
  const low = ((octets[2] << 8) | octets[3]).toString(16);
  return `${normalized.slice(0, separator)}:${high}:${low}`;
}

function ipv6Words(value) {
  const normalized = expandEmbeddedIpv4(value);
  const sections = normalized.split("::");
  if (sections.length > 2) return null;
  const parse = (text) => text
    ? text.split(":").map((part) => (/^[0-9a-f]{1,4}$/u.test(part) ? Number.parseInt(part, 16) : Number.NaN))
    : [];
  const head = parse(sections[0]);
  const tail = parse(sections[1]);
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (sections.length === 1 && missing !== 0)) return null;
  const words = [...head, ...Array(missing).fill(0), ...tail];
  return words.length === 8 && words.every((word) => Number.isInteger(word)) ? words : null;
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

function ipv6Rule(row) {
  const separator = row.prefix.lastIndexOf("/");
  const host = row.prefix.slice(0, separator).toLowerCase();
  const bits = Number(row.prefix.slice(separator + 1));
  const prefix = ipv6Words(host);
  if (isIP(host) !== 6 || !prefix || !Number.isInteger(bits) || bits < 0 || bits > 128) fail(`invalid generated IANA IPv6 prefix: ${row.prefix}`);
  return {
    bits,
    class: classification(row),
    embeddedIpv4Policy: row.embeddedIpv4Policy === true,
    prefix,
  };
}

const POLICY = loadPolicy();
const IPV4_RULES = [
  ...POLICY.ipv4Special.map(ipv4Rule),
  ...POLICY.localPolicyAdditions.ipv4NonGlobal.map((row) => ipv4Rule({ ...row, globallyReachable: false })),
].sort((left, right) => right.bits - left.bits);
const IPV6_RULES = [
  ...POLICY.ipv6Special.map(ipv6Rule),
  ...POLICY.localPolicyAdditions.ipv6NonGlobal.map((row) => ipv6Rule({ ...row, globallyReachable: false })),
].sort((left, right) => right.bits - left.bits);
const IPV6_ALLOCATIONS = POLICY.ipv6GlobalAllocated
  .map((row) => ipv6Rule({ ...row, globallyReachable: true }))
  .sort((left, right) => right.bits - left.bits);

function classifyIpv4(address) {
  const octets = ipv4Octets(address);
  if (!octets) return "forbidden";
  const numeric = ipv4Number(octets);
  const rule = IPV4_RULES.find((candidate) => (numeric & candidate.mask) === candidate.prefix);
  return rule?.class ?? "public";
}

function classifyIpv6(address) {
  const normalized = expandEmbeddedIpv4(address.toLowerCase());
  const words = ipv6Words(normalized);
  if (isIP(normalized) !== 6 || !words) return "forbidden";
  const rule = IPV6_RULES.find((candidate) => matchesIpv6Prefix(words, candidate.prefix, candidate.bits));
  if (rule?.embeddedIpv4Policy) {
    const embedded = `${words[6] >>> 8}.${words[6] & 255}.${words[7] >>> 8}.${words[7] & 255}`;
    return classifyIpv4(embedded);
  }
  if (rule) return rule.class;
  return IPV6_ALLOCATIONS.some((candidate) => matchesIpv6Prefix(words, candidate.prefix, candidate.bits))
    ? "public"
    : "forbidden";
}

export function classifyNetworkAddress(address) {
  const normalized = address.replace(/^\[|\]$/gu, "").toLowerCase();
  const family = isIP(normalized);
  if (family === 4) return classifyIpv4(normalized);
  if (family === 6) return classifyIpv6(normalized);
  return "forbidden";
}
