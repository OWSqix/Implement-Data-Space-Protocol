import assert from "node:assert/strict";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sync as parseXml } from "slimdom-sax-parser";
import {
  MAX_ARTIFACT_BYTES,
  MAX_TOTAL_BYTES,
  assertManifest,
  decodeSecureXml,
  sha256,
} from "./lib.mjs";

const XSD_NS = "http://www.w3.org/2001/XMLSchema";
const allowedHosts = new Set(["schemas.isotc211.org", "schemas.opengis.net", "www.w3.org"]);
const moduleNames = [
  "cit", "gex", "lan", "mas", "mcc", "mco", "mda", "mdb", "mex",
  "mmi", "mpc", "mrc", "mrd", "mri", "mrl", "mrs", "msr", "srv",
];
const seeds = [
  ...moduleNames.map((moduleName) => ({
    role: moduleName === "mdb" ? "xsd-entrypoint" : "xsd-module",
    url: `https://schemas.isotc211.org/19115/-1/${moduleName}/1.3.0/${moduleName}.xsd`,
  })),
  {
    role: "schematron",
    url: "https://schemas.isotc211.org/19115/-1/mdb/1.3.0/metadata-minimal.sch",
  },
  {
    role: "valid-example",
    url: "https://schemas.isotc211.org/19115/-1/mdb/1.3.0/examples/D.1Minimal.xml",
  },
];

function usage() {
  return [
    "Usage:",
    "  node tools/iso19115-tech/capture.mjs --acknowledge-iso-copyright-restrictions",
    "  node tools/iso19115-tech/capture.mjs --acknowledge-iso-copyright-restrictions --approve-reviewed-manifest",
    "",
    "The command writes official bytes only to .local/ and writes a digest manifest to standards/.",
    "It does not grant redistribution rights.",
  ].join("\n");
}

function lockProjection(manifest) {
  return JSON.stringify({
    package: {
      standard: manifest.package.standard,
      version: manifest.package.version,
      status: manifest.package.status,
    },
    license: {
      repositoryLicenseDetected: manifest.license.repositoryLicenseDetected,
      redistributionPermission: manifest.license.redistributionPermission,
      committedOfficialBytes: manifest.license.committedOfficialBytes,
    },
    artifacts: manifest.artifacts.map((artifact) => ({
      role: artifact.role,
      url: artifact.url,
      responseUrl: artifact.responseUrl,
      mediaType: artifact.mediaType,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      cachePath: artifact.cachePath,
    })),
  });
}

function normalizeUrl(value, base) {
  const url = new URL(value, base);
  if (url.protocol === "http:" && allowedHosts.has(url.hostname)) url.protocol = "https:";
  assert.equal(url.protocol, "https:");
  assert.ok(allowedHosts.has(url.hostname), `host not allowed: ${url.hostname}`);
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.hash, "");
  return url;
}

async function fetchOnce(url) {
  let current = normalizeUrl(url).href;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        Accept: "application/xml,text/xml,application/octet-stream;q=0.9,*/*;q=0.1",
        "User-Agent": "molit-dataspace-iso19115-evidence-capture/1",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      assert.ok(location, `${current}: redirect without Location`);
      current = normalizeUrl(location, current).href;
      continue;
    }
    assert.equal(response.status, 200, `${current}: HTTP ${response.status}`);
    assert.equal(response.url, current, `${current}: unexpected response URL`);
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      assert.ok(Number(declaredLength) <= MAX_ARTIFACT_BYTES, `${current}: Content-Length too large`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 0 && bytes.length <= MAX_ARTIFACT_BYTES, `${current}: body size out of range`);
    decodeSecureXml(bytes, current);
    return {
      bytes,
      mediaType: response.headers.get("content-type") ?? "application/octet-stream",
      responseUrl: response.url,
      retrievedAt: new Date().toISOString(),
    };
  }
  throw new Error(`${url}: too many redirects`);
}

async function githubJson(url) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "api.github.com");
  const response = await fetch(parsed, {
    redirect: "error",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "molit-dataspace-iso19115-evidence-capture/1",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  assert.equal(response.status, 200, `${url}: HTTP ${response.status}`);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) assert.ok(Number(declaredLength) <= MAX_ARTIFACT_BYTES);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 0 && bytes.length <= MAX_ARTIFACT_BYTES);
  return JSON.parse(bytes.toString("utf8"));
}

function dependencyUrls(url, bytes) {
  if (!url.endsWith(".xsd")) return [];
  const document = parseXml(decodeSecureXml(bytes, url));
  const result = [];
  for (const localName of ["import", "include", "redefine"]) {
    for (const node of document.getElementsByTagNameNS(XSD_NS, localName)) {
      const location = node.getAttribute("schemaLocation");
      if (location) result.push(normalizeUrl(location, url).href);
    }
  }
  return result;
}

function safeBaseName(url) {
  const candidate = path.posix.basename(new URL(url).pathname) || "artifact.xml";
  assert.match(candidate, /^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
  return candidate;
}

function samePath(left, right) {
  const normalize = (value) => {
    const normalized = path.normalize(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}

async function prepareCacheRoot(root, cacheRoot) {
  const localRoot = path.join(root, ".local");
  const artifactsRoot = path.join(cacheRoot, "artifacts");
  await mkdir(artifactsRoot, { recursive: true });
  for (const directory of [localRoot, cacheRoot, artifactsRoot]) {
    const info = await lstat(directory);
    assert.equal(info.isSymbolicLink(), false, `${directory}: symlink or junction rejected`);
    assert.ok(info.isDirectory(), `${directory}: directory required`);
    assert.ok(samePath(await realpath(directory), path.resolve(directory)), `${directory}: reparse point rejected`);
  }
  return artifactsRoot;
}

async function writeCacheArtifact(artifactsRoot, artifact, bytes) {
  const fileName = path.posix.basename(artifact.cachePath);
  const target = path.join(artifactsRoot, fileName);
  try {
    const info = await lstat(target);
    assert.equal(info.isSymbolicLink(), false, `${target}: symlink rejected`);
    assert.ok(info.isFile(), `${target}: regular file required`);
    const existing = await readFile(target);
    assert.equal(existing.length, bytes.length, `${target}: existing byte count differs`);
    assert.equal(sha256(existing), sha256(bytes), `${target}: existing digest differs`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(target, bytes, { flag: "wx" });
  }
}

async function main() {
  if (!process.argv.includes("--acknowledge-iso-copyright-restrictions")) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const cacheRoot = path.join(root, ".local", "iso19115-1-tech-gate");
  const manifestPath = path.join(root, "standards", "iso19115-1-tech-gate", "manifest.json");
  const [repository, repositoryHead] = await Promise.all([
    githubJson("https://api.github.com/repos/ISO-TC211/schemas"),
    githubJson("https://api.github.com/repos/ISO-TC211/schemas/commits/main"),
  ]);
  assert.equal(repository.default_branch, "main");
  assert.match(repositoryHead.sha, /^[a-f0-9]{40}$/u);
  const repositoryObservedAt = new Date().toISOString();
  const queue = seeds.map((item) => ({ ...item, url: normalizeUrl(item.url).href }));
  const roles = new Map(queue.map((item) => [item.url, item.role]));
  const captures = new Map();
  let totalBytes = 0;
  while (queue.length > 0) {
    const next = queue.shift();
    if (captures.has(next.url)) continue;
    assert.ok(captures.size < 256, "dependency count limit exceeded");
    const capture = await fetchOnce(next.url);
    totalBytes += capture.bytes.length;
    assert.ok(totalBytes <= MAX_TOTAL_BYTES, "total capture size exceeded");
    captures.set(next.url, capture);
    for (const dependencyUrl of dependencyUrls(next.url, capture.bytes)) {
      if (!roles.has(dependencyUrl)) roles.set(dependencyUrl, "xsd-dependency");
      if (!captures.has(dependencyUrl)) queue.push({ role: "xsd-dependency", url: dependencyUrl });
    }
  }

  const artifacts = [...captures.entries()].map(([url, capture]) => {
    const digest = sha256(capture.bytes);
    return {
      role: roles.get(url),
      url,
      responseUrl: capture.responseUrl,
      mediaType: capture.mediaType,
      bytes: capture.bytes.length,
      sha256: digest,
      retrievedAt: capture.retrievedAt,
      cachePath: `artifacts/${digest.slice(0, 16)}-${safeBaseName(url)}`,
    };
  }).sort((left, right) => left.url.localeCompare(right.url));
  assert.equal(new Set(artifacts.map((item) => item.cachePath)).size, artifacts.length);
  const manifest = {
    schemaVersion: "molit.iso19115-1-tech-gate/1",
    package: {
      standard: "ISO 19115-1",
      version: "1.3.0",
      status: "current",
      officialListing: "https://schemas.isotc211.org/19115/-1/",
      officialRepository: "https://github.com/ISO-TC211/schemas",
      repositoryCommitObserved: repositoryHead.sha,
      repositoryCommitObservedAt: repositoryObservedAt,
      endpointBytesBoundToRepositoryCommit: false,
    },
    license: {
      copyrightHolder: "ISO/TC 211",
      repositoryLicenseDetected: repository.license?.spdx_id ?? null,
      redistributionPermission: "not-established",
      committedOfficialBytes: false,
      privateCacheRequiresInstitutionAuthorization: true,
      officialRepositoryNotice: "https://github.com/ISO-TC211/schemas#copyright-and-license",
      isoCopyrightPolicy: "https://www.iso.org/copyright.html",
    },
    gateStatus: "blocked-pending-permission-or-approved-private-cache",
    capturePolicy: {
      networkAllowedOnlyDuringExplicitCapture: true,
      offlineVerificationRequired: true,
      dtdEntitiesXIncludeRejected: true,
      artifactMaxBytes: MAX_ARTIFACT_BYTES,
      totalMaxBytes: MAX_TOTAL_BYTES,
    },
    negativeMutations: {
      xsd: "rename the MD_Metadata root element while preserving well-formed XML",
      schematron: "change the metadata creation date type to publication while retaining XSD validity",
    },
    artifacts,
  };
  assertManifest(manifest);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const artifactsRoot = await prepareCacheRoot(root, cacheRoot);
  for (const artifact of artifacts) {
    await writeCacheArtifact(artifactsRoot, artifact, captures.get(artifact.url).bytes);
  }
  let manifestUpdated = false;
  let existingManifest;
  try {
    existingManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assertManifest(existingManifest);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existingManifest && lockProjection(existingManifest) !== lockProjection(manifest)) {
    const candidatePath = path.join(cacheRoot, "manifest.candidate.json");
    await writeFile(candidatePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (!process.argv.includes("--approve-reviewed-manifest")) {
      throw new Error(`upstream artifact drift requires review: ${candidatePath}`);
    }
  }
  if (!existingManifest || process.argv.includes("--approve-reviewed-manifest")) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    manifestUpdated = true;
  }
  process.stdout.write(`${JSON.stringify({
    manifestPath,
    cacheRoot,
    artifactCount: artifacts.length,
    manifestUpdated,
  }, null, 2)}\n`);
}

await main();
