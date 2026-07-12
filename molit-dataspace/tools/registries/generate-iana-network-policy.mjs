#!/usr/bin/env node
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  atomicWriteChecked,
  isStrictRfc3339,
  readCheckedFile,
} from "./safe-local-file.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const snapshotRoot = path.join(root, "standards", "vendor", "iana", "2026-07-12");
const manifestPath = path.join(snapshotRoot, "manifest.json");
const outputPath = path.join(root, "standards", "generated", "iana-network-policy.v1.json");
const decoder = new TextDecoder("utf-8", { fatal: true });
const EXPECTED_ARTIFACT_IDS = new Set([
  "iana-ipv4-special-registry",
  "iana-ipv6-special-registry",
  "ipv6-unicast-address-assignments",
]);
const EXPECTED_ARTIFACTS = new Map([
  ["iana-ipv4-special-registry", {
    url: "https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv",
    path: "standards/vendor/iana/2026-07-12/iana-ipv4-special-registry-1.csv",
  }],
  ["iana-ipv6-special-registry", {
    url: "https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv",
    path: "standards/vendor/iana/2026-07-12/iana-ipv6-special-registry-1.csv",
  }],
  ["ipv6-unicast-address-assignments", {
    url: "https://www.iana.org/assignments/ipv6-unicast-address-assignments/ipv6-unicast-address-assignments.csv",
    path: "standards/vendor/iana/2026-07-12/ipv6-unicast-address-assignments.csv",
  }],
]);

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => (
      [key, canonicalValue(value[key])]
    )));
  }
  return value;
}

function encodedJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("unterminated quoted CSV field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length < 2) throw new Error("registry CSV has no data rows");
  const headers = rows[0];
  if (new Set(headers).size !== headers.length) throw new Error("duplicate CSV header");
  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${values.length} fields, expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, fieldIndex) => [header, values[fieldIndex]]));
  });
}

function cleanAddressBlock(value) {
  return value.replace(/\s*\[[0-9]+\]/gu, "").trim();
}

function cidrBits(prefix) {
  const bits = Number(prefix.split("/")[1]);
  if (!Number.isInteger(bits)) throw new Error(`invalid registry prefix: ${prefix}`);
  return bits;
}

function globallyReachable(value, row) {
  if (value.trim() === "") {
    const terminated = /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(row["Termination Date"]);
    const inactiveFields = [
      "Source",
      "Destination",
      "Forwardable",
      "Reserved-by-Protocol",
    ].every((field) => row[field].trim() === "");
    if (terminated && inactiveFields) return false;
    throw new Error("blank IANA reachability is allowed only for a fully terminated row");
  }
  if (!/^(?:True|False|N\/A)(?:\s|\[|$)/u.test(value.trim())) {
    throw new Error(`invalid IANA globally-reachable value: ${value}`);
  }
  return /^True(?:\s|\[|$)/u.test(value.trim());
}

function ipv6Words(host) {
  if (host.split("::").length > 2) return null;
  const [headText, tailText] = host.split("::");
  const parse = (text) => text ? text.split(":").map((part) => (
    /^[0-9a-f]{1,4}$/iu.test(part) ? Number.parseInt(part, 16) : Number.NaN
  )) : [];
  const head = parse(headText);
  const tail = parse(tailText);
  if ([...head, ...tail].some(Number.isNaN)) return null;
  const missing = 8 - head.length - tail.length;
  if ((host.includes("::") && missing < 1) || (!host.includes("::") && missing !== 0)) return null;
  return [...head, ...Array(missing).fill(0), ...tail];
}

function assertNetworkPrefix(prefix, family) {
  const parts = prefix.split("/");
  if (parts.length !== 2) throw new Error(`invalid registry prefix: ${prefix}`);
  const [host, bitsText] = parts;
  const bits = Number(bitsText);
  const maximum = family === "ipv4" ? 32 : 128;
  if (isIP(host) !== (family === "ipv4" ? 4 : 6)
    || !Number.isInteger(bits) || bits < 0 || bits > maximum) {
    throw new Error(`invalid ${family} registry prefix: ${prefix}`);
  }
  if (family === "ipv4") {
    const octets = host.split(".").map(Number);
    if (octets.join(".") !== host) throw new Error(`non-canonical IPv4 prefix: ${prefix}`);
    const address = octets.reduce((value, octet) => ((value * 256) + octet) >>> 0, 0);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if (((address & mask) >>> 0) !== address) {
      throw new Error(`IPv4 prefix has host bits: ${prefix}`);
    }
  } else {
    const words = ipv6Words(host);
    if (!words) throw new Error(`invalid IPv6 prefix: ${prefix}`);
    for (let bit = bits; bit < 128; bit += 1) {
      if ((words[Math.floor(bit / 16)] & (1 << (15 - (bit % 16)))) !== 0) {
        throw new Error(`IPv6 prefix has host bits: ${prefix}`);
      }
    }
  }
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function specialRecords(rows, family) {
  const records = [];
  for (const row of rows) {
    const blocks = cleanAddressBlock(row["Address Block"]).split(/,\s*/u);
    for (const prefix of blocks) {
      const valid = family === "ipv4"
        ? /^(?:[0-9]{1,3}[.]){3}[0-9]{1,3}\/(?:[0-9]|[12][0-9]|3[0-2])$/u.test(prefix)
        : /^[0-9A-Fa-f:]+\/(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/u.test(prefix);
      if (!valid) throw new Error(`invalid ${family} special registry prefix: ${prefix}`);
      assertNetworkPrefix(prefix, family);
      records.push({
        prefix: prefix.toLowerCase(),
        name: row.Name.trim(),
        globallyReachable: globallyReachable(row["Globally Reachable"], row),
        ...(family === "ipv6" && prefix.toLowerCase() === "64:ff9b::/96"
          ? { embeddedIpv4Policy: true }
          : {}),
      });
    }
  }
  if (new Set(records.map(({ prefix }) => prefix)).size !== records.length) {
    throw new Error(`duplicate ${family} special registry prefix`);
  }
  return records.sort((left, right) => (
    cidrBits(right.prefix) - cidrBits(left.prefix) || lexicalCompare(left.prefix, right.prefix)
  ));
}

function allocatedIpv6(rows) {
  const records = rows
    .filter((row) => row.Status.trim() === "ALLOCATED")
    .map((row) => {
      const prefix = cleanAddressBlock(row.Prefix).toLowerCase();
      assertNetworkPrefix(prefix, "ipv6");
      return {
      prefix,
      designation: row.Designation.trim(),
    };})
    .sort((left, right) => (
      cidrBits(right.prefix) - cidrBits(left.prefix) || lexicalCompare(left.prefix, right.prefix)
    ));
  if (new Set(records.map(({ prefix }) => prefix)).size !== records.length) {
    throw new Error("duplicate allocated IPv6 registry prefix");
  }
  return records;
}

async function verifiedSnapshots() {
  const manifestBytes = await readCheckedFile(root, manifestPath, 1024 * 1024);
  const manifest = JSON.parse(decoder.decode(manifestBytes));
  if (manifest.schemaVersion !== "molit.registry-snapshot-manifest/1"
    || manifest.authority !== "Internet Assigned Numbers Authority"
    || !isStrictRfc3339(manifest.retrievedAt)
    || manifest.license !== "CC0-1.0"
    || manifest.licenseUrl !== "https://www.iana.org/help/licensing-terms"
    || !Array.isArray(manifest.artifacts)) {
    throw new Error("IANA snapshot manifest is incomplete");
  }
  const artifactIds = manifest.artifacts.map(({ id }) => id);
  if (artifactIds.length !== EXPECTED_ARTIFACT_IDS.size
    || new Set(artifactIds).size !== artifactIds.length
    || artifactIds.some((id) => !EXPECTED_ARTIFACT_IDS.has(id))) {
    throw new Error("IANA snapshot manifest artifact set is not approved");
  }
  const byId = new Map();
  for (const artifact of manifest.artifacts) {
    const expected = EXPECTED_ARTIFACTS.get(artifact.id);
    const expectedPrefix = "standards/vendor/iana/2026-07-12/";
    if (!expected || artifact.url !== expected.url || artifact.path !== expected.path
      || artifact.contentType !== "text/csv; charset=UTF-8; header=present"
      || !isStrictRfc3339(artifact.lastModified)
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0
      || !/^[a-f0-9]{64}$/u.test(artifact.sha256)
      || !artifact.path.startsWith(expectedPrefix)
      || artifact.path.includes("\\") || artifact.path.includes("..")) {
      throw new Error(`unsafe IANA artifact path: ${artifact.path}`);
    }
    const file = path.resolve(root, ...artifact.path.split("/"));
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`IANA artifact escapes project root: ${artifact.path}`);
    }
    const bytes = await readCheckedFile(root, file, 4 * 1024 * 1024);
    if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`IANA artifact digest mismatch: ${artifact.id}`);
    }
    byId.set(artifact.id, { artifact, bytes });
  }
  return { manifest, manifestSha256: sha256(manifestBytes), byId };
}

async function generatedPolicy() {
  const snapshots = await verifiedSnapshots();
  const text = (id) => decoder.decode(snapshots.byId.get(id).bytes);
  const ipv4Rows = parseCsv(text("iana-ipv4-special-registry"));
  const ipv6Rows = parseCsv(text("iana-ipv6-special-registry"));
  const unicastRows = parseCsv(text("ipv6-unicast-address-assignments"));
  return {
    schemaVersion: "molit.iana-network-policy/1",
    generatedFrom: {
      manifestPath: "standards/vendor/iana/2026-07-12/manifest.json",
      manifestSha256: snapshots.manifestSha256,
      retrievedAt: snapshots.manifest.retrievedAt,
      license: snapshots.manifest.license,
    },
    ipv4Special: specialRecords(ipv4Rows, "ipv4"),
    ipv6Special: specialRecords(ipv6Rows, "ipv6"),
    ipv6GlobalAllocated: allocatedIpv6(unicastRows),
    localPolicyAdditions: {
      ipv4NonGlobal: [
        {
          prefix: "224.0.0.0/4",
          reason: "multicast URL hosts are prohibited",
        }
      ],
      ipv6NonGlobal: [
        {
          prefix: "fec0::/10",
          reason: "deprecated site-local URL hosts are prohibited"
        }
      ]
    }
  };
}

const arguments_ = process.argv.slice(2);
if (arguments_.some((argument) => (
  argument !== "--write" && !argument.startsWith("--review-manifest=")
)) || arguments_.filter((argument) => argument === "--write").length > 1) {
  throw new Error("usage: generate-iana-network-policy.mjs [--write --review-manifest=SHA256]");
}
const write = arguments_.includes("--write");
try {
  const policy = await generatedPolicy();
  const encoded = encodedJson(policy);
  if (write) {
    const reviewed = arguments_.find((argument) => argument.startsWith("--review-manifest="))
      ?.slice("--review-manifest=".length);
    if (reviewed !== policy.generatedFrom.manifestSha256) {
      throw new Error(`write requires --review-manifest=${policy.generatedFrom.manifestSha256}`);
    }
    await atomicWriteChecked(root, outputPath, encoded);
  } else {
    const approved = decoder.decode(await readCheckedFile(root, outputPath, 4 * 1024 * 1024));
    if (approved !== encoded) throw new Error("generated IANA policy differs from approved output");
  }
  process.stdout.write(`${JSON.stringify({
    valid: true,
    write,
    output: path.relative(root, outputPath).replaceAll("\\", "/"),
    sha256: sha256(encoded),
    ipv4Special: policy.ipv4Special.length,
    ipv6Special: policy.ipv6Special.length,
    ipv6GlobalAllocated: policy.ipv6GlobalAllocated.length,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
