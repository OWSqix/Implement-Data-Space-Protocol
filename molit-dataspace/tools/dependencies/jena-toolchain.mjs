#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  opendir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isStrictRfc3339 } from "../registries/safe-local-file.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const manifestPath = path.join(
  root,
  "standards/toolchains/jena-parser-lane.win32-x64.json",
);
const localRoot = path.join(root, ".local", "toolchains");
const cacheRoot = path.join(localRoot, "cache");
const installRoot = path.join(localRoot, "install");
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_TREE_BYTES = 512 * 1024 * 1024;
const MAX_TREE_FILE_BYTES = 128 * 1024 * 1024;
const MAX_TREE_DIRECTORY_ENTRIES = 100_000;
const MAX_TREE_FILES = 50_000;
const EXPECTED_ARTIFACTS = new Map([
  ["java-runtime", {
    name: "OpenJDK21U-jre_x64_windows_hotspot_21.0.11_10.zip",
    version: "21.0.11+10",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.11%2B10/OpenJDK21U-jre_x64_windows_hotspot_21.0.11_10.zip",
    checksumSource: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.11%2B10/OpenJDK21U-jre_x64_windows_hotspot_21.0.11_10.zip.sha256.txt",
    checksumAlgorithm: "sha256",
    checksumSnapshotPath: "standards/vendor/toolchain-checksums/2026-07-12/OpenJDK21U-jre_x64_windows_hotspot_21.0.11_10.zip.sha256.txt",
    extractDirectory: "jdk-21.0.11+10-jre",
  }],
  ["jena-commands", {
    name: "apache-jena-6.1.0.zip",
    version: "6.1.0",
    url: "https://downloads.apache.org/jena/binaries/apache-jena-6.1.0.zip",
    checksumSource: "https://downloads.apache.org/jena/binaries/apache-jena-6.1.0.zip.sha512",
    checksumAlgorithm: "sha512",
    checksumSnapshotPath: "standards/vendor/toolchain-checksums/2026-07-12/apache-jena-6.1.0.zip.sha512",
    extractDirectory: "apache-jena-6.1.0",
  }],
]);
function sha(bytes, algorithm) {
  return createHash(algorithm).update(bytes).digest("hex");
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function treePathCompare(left, right) {
  const leftSegments = left.split("/");
  const rightSegments = right.split("/");
  const sharedLength = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = lexicalCompare(leftSegments[index], rightSegments[index]);
    if (comparison !== 0) return comparison;
  }
  return leftSegments.length - rightSegments.length;
}

function assertBelow(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`toolchain path escapes its parent: ${candidate}`);
  }
}

function samePath(left, right) {
  const normalize = (value) => {
    const normalized = path.normalize(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}

async function checkedPathBelow(parent, candidate, expectedType) {
  assertBelow(parent, candidate);
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  const segments = relative.split(path.sep);
  let current = path.resolve(parent);
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`toolchain reparse path rejected: ${current}`);
  }
  const stat = await lstat(current);
  if ((expectedType === "directory" && !stat.isDirectory())
    || (expectedType === "file" && !stat.isFile())) {
    throw new Error(`toolchain path is not a ${expectedType}: ${candidate}`);
  }
  const parentCanonical = await realpath(parent);
  const candidateCanonical = await realpath(current);
  if (!samePath(candidateCanonical, path.resolve(parentCanonical, ...segments))) {
    throw new Error(`toolchain path resolves through a reparse point: ${candidate}`);
  }
  return current;
}

export function assertApprovedManifest(manifest) {
  if (manifest.schemaVersion !== "molit.validator-toolchain/1"
    || manifest.platform !== "win32"
    || manifest.architecture !== "x64"
    || manifest.signatureVerification !== "not-performed"
    || !isStrictRfc3339(manifest.reviewedAt)
    || !Array.isArray(manifest.artifacts)
    || manifest.artifacts.length !== 2
    || new Set(manifest.artifacts.map(({ role }) => role)).size !== 2) {
    throw new Error("Jena toolchain manifest is not approved");
  }
  for (const artifact of manifest.artifacts) {
    const expected = EXPECTED_ARTIFACTS.get(artifact.role);
    if (!expected
      || Object.entries(expected).some(([key, value]) => artifact[key] !== value)
      || !/^[A-Za-z0-9+_.-]+[.]zip$/u.test(artifact.name)
      || !/^[A-Za-z0-9+_.-]+$/u.test(artifact.extractDirectory)
      || !/^https:\/\//u.test(artifact.url)
      || !/^[a-f0-9]{64}$/u.test(artifact.sha256)
      || !/^[a-f0-9]{128}$/u.test(artifact.sha512)
      || !["sha256", "sha512"].includes(artifact.checksumAlgorithm)
      || !artifact.checksumSnapshotPath?.startsWith(
        "standards/vendor/toolchain-checksums/2026-07-12/",
      )
      || artifact.checksumSnapshotPath.includes("\\")
      || artifact.checksumSnapshotPath.includes(":")
      || artifact.checksumSnapshotPath.split("/").some((segment) => (
        !segment || segment === "." || segment === ".."
      ))
      || !/^[a-f0-9]{64}$/u.test(artifact.checksumSnapshotSha256)
      || !Number.isSafeInteger(artifact.bytes)
      || artifact.bytes <= 0
      || artifact.bytes > MAX_ARCHIVE_BYTES) {
      throw new Error(`invalid Jena toolchain artifact: ${artifact.role}`);
    }
  }
}

async function readManifest() {
  await checkedPathBelow(root, manifestPath, "file");
  const bytes = await readBoundedFile(manifestPath, 1024 * 1024);
  const manifest = JSON.parse(decoder.decode(bytes));
  assertApprovedManifest(manifest);
  return { bytes, manifest };
}

async function hashBoundedFile(
  file,
  maximumBytes,
  algorithms = ["sha256"],
  { includeBytes = false } = {},
) {
  const pathStat = await lstat(file);
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.size > maximumBytes) {
    throw new Error(`bounded toolchain file required: ${file}`);
  }
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximumBytes
      || before.dev !== pathStat.dev || before.ino !== pathStat.ino) {
      throw new Error(`toolchain file changed before hashing: ${file}`);
    }
    const hashes = new Map(algorithms.map((algorithm) => [algorithm, createHash(algorithm)]));
    const chunks = includeBytes ? [] : null;
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < before.size) {
      const length = Math.min(buffer.length, before.size - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead <= 0) throw new Error(`unexpected EOF in toolchain file: ${file}`);
      const chunk = buffer.subarray(0, bytesRead);
      for (const hash of hashes.values()) hash.update(chunk);
      if (chunks) chunks.push(Buffer.from(chunk));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (position !== before.size || after.size !== before.size
      || after.dev !== before.dev || after.ino !== before.ino) {
      throw new Error(`toolchain file changed while hashing: ${file}`);
    }
    return {
      bytes: position,
      ...(chunks ? { content: Buffer.concat(chunks, position) } : {}),
      digests: Object.fromEntries([...hashes].map(([algorithm, hash]) => (
        [algorithm, hash.digest("hex")]
      ))),
    };
  } finally {
    await handle.close();
  }
}

async function readBoundedFile(file, maximumBytes) {
  const record = await hashBoundedFile(
    file,
    maximumBytes,
    ["sha256"],
    { includeBytes: true },
  );
  return record.content;
}

export async function treeRecord(directory, {
  maximumDirectoryEntries = MAX_TREE_DIRECTORY_ENTRIES,
  maximumFiles = MAX_TREE_FILES,
} = {}) {
  if (!Number.isSafeInteger(maximumDirectoryEntries) || maximumDirectoryEntries <= 0
    || !Number.isSafeInteger(maximumFiles) || maximumFiles <= 0) {
    throw new Error("positive safe-integer toolchain tree limits are required");
  }
  const files = [];
  let totalBytes = 0;
  let directoryEntryCount = 0;
  let fileCount = 0;
  const pending = [{ current: directory, relative: "" }];
  while (pending.length > 0) {
    const { current, relative } = pending.pop();
    const handle = await opendir(current);
    for await (const entry of handle) {
      directoryEntryCount += 1;
      if (directoryEntryCount > maximumDirectoryEntries) {
        throw new Error("toolchain tree directory-entry limit exceeded");
      }
      const item = path.join(current, entry.name);
      const itemRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await lstat(item);
      if (stat.isSymbolicLink()) throw new Error(`toolchain reparse item rejected: ${itemRelative}`);
      if (stat.isDirectory()) {
        pending.push({ current: item, relative: itemRelative });
        continue;
      }
      if (!stat.isFile()) throw new Error(`non-regular toolchain item: ${itemRelative}`);
      fileCount += 1;
      if (fileCount > maximumFiles) throw new Error("toolchain tree file-count limit exceeded");
      if (stat.size > MAX_TREE_BYTES - totalBytes) {
        throw new Error("toolchain tree byte limit exceeded");
      }
      const record = await hashBoundedFile(item, MAX_TREE_FILE_BYTES);
      if (record.bytes > MAX_TREE_BYTES - totalBytes) {
        throw new Error("toolchain tree byte limit exceeded");
      }
      totalBytes += record.bytes;
      files.push({ path: itemRelative, bytes: record.bytes, sha256: record.digests.sha256 });
    }
  }
  files.sort((left, right) => treePathCompare(left.path, right.path));
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path, "utf8");
    digest.update("\0");
    digest.update(file.sha256, "ascii");
    digest.update("\0");
    digest.update(String(file.bytes), "ascii");
    digest.update("\0");
  }
  return {
    bytes: totalBytes,
    contentSha256: digest.digest("hex"),
    fileCount,
  };
}

async function verifyArchive(artifact) {
  const archive = path.join(cacheRoot, artifact.name);
  await checkedPathBelow(cacheRoot, archive, "file");
  const record = await hashBoundedFile(archive, artifact.bytes, ["sha256", "sha512"]);
  if (record.bytes !== artifact.bytes
    || record.digests.sha256 !== artifact.sha256
    || record.digests.sha512 !== artifact.sha512) {
    throw new Error(`toolchain archive digest mismatch: ${artifact.role}`);
  }
  return archive;
}

async function verifyPublisherChecksum(artifact) {
  const snapshot = path.resolve(root, ...artifact.checksumSnapshotPath.split("/"));
  await checkedPathBelow(root, snapshot, "file");
  const bytes = await readBoundedFile(snapshot, 4096);
  if (sha(bytes, "sha256") !== artifact.checksumSnapshotSha256) {
    throw new Error(`publisher checksum snapshot mismatch: ${artifact.role}`);
  }
  const expectedDigest = artifact[artifact.checksumAlgorithm];
  const expectedLine = `${expectedDigest}  ${artifact.name}`;
  if (decoder.decode(bytes).trim() !== expectedLine) {
    throw new Error(`publisher checksum does not bind the archive: ${artifact.role}`);
  }
}

async function verifyInstall(artifact, base = installRoot) {
  const directory = path.join(base, artifact.extractDirectory);
  await checkedPathBelow(base, directory, "directory");
  const record = await treeRecord(directory);
  if (record.fileCount !== artifact.installedFileCount
    || record.bytes !== artifact.installedBytes
    || record.contentSha256 !== artifact.installedContentSha256) {
    throw new Error(`installed toolchain bytes differ: ${artifact.role}`);
  }
  return { directory, ...record };
}

async function verifyToolchain() {
  const { bytes: manifestBytes, manifest } = await readManifest();
  if (process.platform !== manifest.platform || process.arch !== manifest.architecture) {
    throw new Error(`toolchain requires ${manifest.platform}-${manifest.architecture}`);
  }
  await checkedPathBelow(root, cacheRoot, "directory");
  await checkedPathBelow(root, installRoot, "directory");
  const artifacts = [];
  for (const artifact of manifest.artifacts) {
    await verifyPublisherChecksum(artifact);
    const archive = await verifyArchive(artifact);
    const installed = await verifyInstall(artifact);
    artifacts.push({
      role: artifact.role,
      archive: path.relative(root, archive).replaceAll("\\", "/"),
      archiveSha256: artifact.sha256,
      installedContentSha256: installed.contentSha256,
    });
  }
  return {
    valid: true,
    toolchainId: manifest.toolchainId,
    manifestSha256: sha(manifestBytes, "sha256"),
    artifacts,
  };
}

if (process.argv[1]
  && samePath(fileURLToPath(import.meta.url), path.resolve(process.argv[1]))) {
  const [command = "verify"] = process.argv.slice(2);
  try {
    const result = command === "verify"
      ? await verifyToolchain()
      : (() => { throw new Error(`unknown command: ${command}`); })();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
