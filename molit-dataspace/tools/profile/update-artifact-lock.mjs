#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseMachineExtensions } from "../../src/profile/registry.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const defaultReleaseRoot = path.join(
  projectRoot,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "0.1.0",
);
const machineExtensions = new Set(releaseMachineExtensions);
const provenanceFields = new Set([
  "license",
  "origin",
  "source",
  "sourceCommit",
  "upstream",
  "version",
]);

function failure(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function validateLockName(lockName) {
  if (typeof lockName !== "string"
    || lockName.length === 0
    || path.isAbsolute(lockName)
    || path.basename(lockName) !== lockName
    || lockName === "."
    || lockName === "..") {
    throw failure(
      "INVALID_ARTIFACT_LOCK_PATH",
      "artifact lock name must be a single relative file name",
      { lockName },
    );
  }
}

function validateArtifactMetadata(artifact) {
  const hasOrigin = typeof artifact?.origin === "string" && (
    ["generated-local", "local", "local-compatibility-closure", "upstream"]
      .includes(artifact.origin)
      || artifact.origin.startsWith("https://")
  );
  const hasUpstreamSource = typeof artifact?.source === "string"
    && artifact.source.startsWith("https://")
    && typeof artifact?.upstream === "string"
    && artifact.upstream.length > 0;
  return artifact
    && typeof artifact.license === "string"
    && artifact.license.length > 0
    && (hasOrigin || hasUpstreamSource)
    && typeof artifact.version === "string"
    && artifact.version.length > 0
    && typeof artifact.path === "string"
    && typeof artifact.sha256 === "string"
    && /^[0-9a-f]{64}$/u.test(artifact.sha256);
}

function isLocalArtifact(artifact) {
  return artifact.origin === "local" || artifact.origin === "generated-local";
}

function isMachineArtifactPath(relativePath) {
  return machineExtensions.has(path.extname(relativePath).toLowerCase());
}

function validateProvenanceUpdate(relativePath, previousArtifact, update, upstreamRequired) {
  const fields = update && typeof update === "object" && !Array.isArray(update)
    ? Object.keys(update)
    : [];
  const unknownFields = fields.filter((field) => !provenanceFields.has(field));
  const emptyFields = fields.filter((field) => (
    typeof update[field] !== "string"
      || update[field].trim().length === 0
      || update[field] !== update[field].trim()
  ));
  const changedFields = fields.filter((field) => (
    !unknownFields.includes(field)
      && !emptyFields.includes(field)
      && update[field] !== previousArtifact[field]
  ));

  if (!update
    || typeof update !== "object"
    || Array.isArray(update)
    || unknownFields.length > 0
    || emptyFields.length > 0) {
    throw failure(
      "INVALID_ARTIFACT_REVIEW",
      "provenance updates must contain only recognized non-empty trimmed fields",
      { emptyFields, path: relativePath, unknownFields },
    );
  }
  if (fields.length === 0 || changedFields.length === 0) {
    throw failure(
      upstreamRequired
        ? "UPSTREAM_ARTIFACT_PROVENANCE_REVIEW_REQUIRED"
        : "INVALID_ARTIFACT_REVIEW",
      "provenance review must change at least one recognized field",
      { changedFields, path: relativePath, reviewedFields: fields },
    );
  }
}

async function readStrictJson(filePath) {
  const bytes = await readFile(filePath);
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    const error = failure("INVALID_UTF8", "artifact lock must be valid UTF-8");
    error.cause = cause;
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch (cause) {
    const error = failure("INVALID_ARTIFACT_LOCK", "artifact lock must be valid JSON");
    error.cause = cause;
    throw error;
  }
}

async function listMachineArtifacts(releaseRoot, lockName) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(releaseRoot, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        throw failure(
          "PROFILE_RELEASE_SYMLINK_NOT_ALLOWED",
          "profile release inventory must not contain symbolic links",
          { path: relative },
        );
      }
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()
        && relative !== lockName
        && isMachineArtifactPath(relative)) {
        files.push(relative);
      }
    }
  }
  await walk(releaseRoot);
  return files.sort();
}

export async function updateArtifactLock({
  releaseRoot = defaultReleaseRoot,
  lockName = "artifact-lock.json",
  provenanceUpdates = {},
  reviewedChangedPaths = [],
} = {}) {
  validateLockName(lockName);
  const absoluteReleaseRoot = path.resolve(releaseRoot);
  const lockPath = path.resolve(absoluteReleaseRoot, lockName);
  if (path.dirname(lockPath) !== absoluteReleaseRoot) {
    throw failure(
      "INVALID_ARTIFACT_LOCK_PATH",
      "artifact lock path escaped the release root",
      { lockName },
    );
  }
  const previous = await readStrictJson(lockPath);
  if (previous?.schemaVersion !== "molit.profile-artifact-lock/1"
    || !Array.isArray(previous.artifacts)) {
    throw failure("INVALID_ARTIFACT_LOCK", "artifact lock identity is invalid");
  }

  const lockedPaths = previous.artifacts.map((artifact) => artifact?.path);
  const invalidPaths = lockedPaths.filter((relative) => (
    typeof relative !== "string"
      || relative.length === 0
      || path.isAbsolute(relative)
      || relative.split(/[\\/]/u).includes("..")
      || relative === lockName
      || !isMachineArtifactPath(relative)
  ));
  const duplicates = lockedPaths.filter((item, index) => lockedPaths.indexOf(item) !== index);
  if (invalidPaths.length > 0 || duplicates.length > 0) {
    throw failure(
      "INVALID_ARTIFACT_LOCK",
      "artifact lock contains invalid or duplicate inventory paths",
      { duplicates, invalidPaths },
    );
  }
  const invalidMetadata = previous.artifacts
    .filter((artifact) => !validateArtifactMetadata(artifact))
    .map((artifact) => artifact?.path ?? null);
  if (invalidMetadata.length > 0) {
    throw failure(
      "INVALID_ARTIFACT_LOCK",
      "artifact lock contains incomplete provenance or invalid digests",
      { invalidMetadata },
    );
  }

  if (!Array.isArray(reviewedChangedPaths)
    || reviewedChangedPaths.some((item) => typeof item !== "string")
    || new Set(reviewedChangedPaths).size !== reviewedChangedPaths.length
    || provenanceUpdates === null
    || typeof provenanceUpdates !== "object"
    || Array.isArray(provenanceUpdates)) {
    throw failure(
      "INVALID_ARTIFACT_REVIEW",
      "reviewed paths and provenance updates must be explicit and unique",
    );
  }

  const discoveredPaths = await listMachineArtifacts(absoluteReleaseRoot, lockName);
  const locked = new Set(lockedPaths);
  const discovered = new Set(discoveredPaths);
  const added = discoveredPaths.filter((relative) => !locked.has(relative));
  const removed = lockedPaths.filter((relative) => !discovered.has(relative));
  if (added.length > 0 || removed.length > 0) {
    throw failure(
      "ARTIFACT_INVENTORY_CHANGE_REQUIRES_REVIEW",
      "artifact paths changed; edit the lock inventory and provenance explicitly before updating digests",
      { added, removed },
    );
  }

  const previousByPath = new Map(
    previous.artifacts.map((artifact) => [artifact.path, artifact]),
  );
  const digestByPath = new Map();
  for (const relativePath of discoveredPaths) {
    const bytes = await readFile(path.join(absoluteReleaseRoot, relativePath));
    digestByPath.set(relativePath, createHash("sha256").update(bytes).digest("hex"));
  }
  const changedPaths = discoveredPaths.filter((relativePath) => (
    digestByPath.get(relativePath) !== previousByPath.get(relativePath).sha256
  ));
  const reviewed = new Set(reviewedChangedPaths);
  const changed = new Set(changedPaths);
  const unreviewed = changedPaths.filter((relativePath) => !reviewed.has(relativePath));
  const staleReviews = reviewedChangedPaths.filter((relativePath) => !changed.has(relativePath));
  if (unreviewed.length > 0 || staleReviews.length > 0) {
    throw failure(
      "ARTIFACT_CONTENT_CHANGE_REQUIRES_REVIEW",
      "artifact byte changes must match the explicit reviewed path set",
      { changedPaths, staleReviews, unreviewed },
    );
  }

  const unknownProvenanceUpdates = Object.keys(provenanceUpdates)
    .filter((relativePath) => !changed.has(relativePath));
  if (unknownProvenanceUpdates.length > 0) {
    throw failure(
      "INVALID_ARTIFACT_REVIEW",
      "provenance updates are allowed only for reviewed changed artifacts",
      { unknownProvenanceUpdates },
    );
  }

  const artifacts = [];
  for (const relativePath of discoveredPaths) {
    const previousArtifact = previousByPath.get(relativePath);
    const provenanceUpdate = provenanceUpdates[relativePath];
    if (changed.has(relativePath)) {
      const upstreamRequired = !isLocalArtifact(previousArtifact);
      if (upstreamRequired && provenanceUpdate === undefined) {
        throw failure(
          "UPSTREAM_ARTIFACT_PROVENANCE_REVIEW_REQUIRED",
          "changed upstream artifacts require an explicit provenance update",
          { path: relativePath },
        );
      }
      if (provenanceUpdate !== undefined) {
        validateProvenanceUpdate(
          relativePath,
          previousArtifact,
          provenanceUpdate,
          upstreamRequired,
        );
      }
    }
    const artifact = {
      ...previousArtifact,
      ...(provenanceUpdate ?? {}),
      path: relativePath,
      sha256: digestByPath.get(relativePath),
    };
    if (!validateArtifactMetadata(artifact)) {
      throw failure(
        "INVALID_ARTIFACT_REVIEW",
        "updated artifact provenance is incomplete or invalid",
        { path: relativePath },
      );
    }
    artifacts.push(artifact);
  }

  const output = `${JSON.stringify({
    ...previous,
    generatedAt: new Date().toISOString().slice(0, 10),
    artifacts,
  }, null, 2)}\n`;
  const temporaryPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, output, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, lockPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return { artifactCount: artifacts.length, lockPath };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const reviewedChangedPaths = [];
    for (let index = 2; index < process.argv.length; index += 1) {
      const argument = process.argv[index];
      if (argument !== "--reviewed" || !process.argv[index + 1]) {
        throw failure(
          "INVALID_ARTIFACT_REVIEW",
          "CLI accepts repeated --reviewed <release-relative-path> pairs only",
        );
      }
      reviewedChangedPaths.push(process.argv[index + 1]);
      index += 1;
    }
    await updateArtifactLock({ reviewedChangedPaths });
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error.code ?? "ARTIFACT_LOCK_UPDATE_FAILED",
      details: error.details ?? {},
      message: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
