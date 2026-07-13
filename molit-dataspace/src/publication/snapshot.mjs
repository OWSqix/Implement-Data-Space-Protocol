import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { selectContentNegotiationResponse } from "../profile/content-negotiation.mjs";

function publicationFailure(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeArtifactPath(value) {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value)
    && !value.includes("\\")
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function confinedFile(releaseRoot, relativePath) {
  if (!safeArtifactPath(relativePath)) {
    throw publicationFailure("UNSAFE_PUBLICATION_ARTIFACT", "publication artifact path is unsafe", { relativePath });
  }
  const root = await realpath(releaseRoot);
  const candidate = path.resolve(root, ...relativePath.split("/"));
  const resolved = await realpath(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw publicationFailure("PUBLICATION_ARTIFACT_ESCAPE", "publication artifact resolves outside release root", { relativePath });
  }
  const metadata = await stat(resolved);
  if (!metadata.isFile()) {
    throw publicationFailure("INVALID_PUBLICATION_ARTIFACT", "publication artifact is not a regular file", { relativePath });
  }
  return resolved;
}

async function readConfinedFile(releaseRoot, relativePath, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw publicationFailure("PUBLICATION_SNAPSHOT_TOO_LARGE", "publication snapshot has no remaining byte capacity", {
      relativePath,
    });
  }
  const file = await confinedFile(releaseRoot, relativePath);
  const beforeOpen = await stat(file);
  if (beforeOpen.size > maxBytes) {
    throw publicationFailure("PUBLICATION_ARTIFACT_TOO_LARGE", "publication artifact exceeds configured byte limit before read", {
      actual: beforeOpen.size,
      limit: maxBytes,
      relativePath,
    });
  }

  const handle = await open(file, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maxBytes) {
      throw publicationFailure("PUBLICATION_ARTIFACT_TOO_LARGE", "opened publication artifact exceeds configured byte limit", {
        actual: opened.size,
        limit: maxBytes,
        relativePath,
      });
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const remainingWithSentinel = maxBytes - total + 1;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remainingWithSentinel));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw publicationFailure("PUBLICATION_ARTIFACT_TOO_LARGE", "publication artifact grew beyond configured byte limit during read", {
          actual: total,
          limit: maxBytes,
          relativePath,
        });
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function validateContractOrigin(contract, publicOrigin) {
  if (!Array.isArray(contract.resources) || contract.resources.length === 0) {
    throw publicationFailure("INVALID_PUBLICATION_CONTRACT", "publication contract has no resources");
  }
  for (const resource of contract.resources) {
    for (const iri of resource.iris ?? []) {
      let parsed;
      try {
        parsed = new URL(iri);
      } catch {
        throw publicationFailure("INVALID_PUBLICATION_CONTRACT", "publication contract contains an invalid IRI", { iri });
      }
      if (parsed.origin !== publicOrigin) {
        throw publicationFailure("PUBLICATION_ORIGIN_MISMATCH", "contract IRI does not use configured publicOrigin", {
          actual: parsed.origin,
          expected: publicOrigin,
          iri,
        });
      }
    }
  }
}

export async function loadPublicationSnapshot({
  contractFile,
  maxArtifactBytes = 32 * 1024 * 1024,
  maxSnapshotBytes = 128 * 1024 * 1024,
  publicOrigin,
  releaseRoot,
}) {
  const contractBytes = await readConfinedFile(
    releaseRoot,
    contractFile,
    Math.min(maxArtifactBytes, maxSnapshotBytes),
  );
  const artifactLockBytes = await readConfinedFile(
    releaseRoot,
    "artifact-lock.json",
    Math.min(maxArtifactBytes, maxSnapshotBytes - contractBytes.length),
  );
  let contract;
  let artifactLock;
  try {
    contract = JSON.parse(contractBytes.toString("utf8"));
  } catch (error) {
    throw publicationFailure("INVALID_PUBLICATION_CONTRACT", "publication contract is not valid JSON", {
      cause: error.message,
    });
  }
  try {
    artifactLock = JSON.parse(artifactLockBytes.toString("utf8"));
  } catch (error) {
    throw publicationFailure("INVALID_ARTIFACT_LOCK", "artifact lock is not valid JSON", {
      cause: error.message,
    });
  }
  validateContractOrigin(contract, publicOrigin);

  if (artifactLock.schemaVersion !== "molit.profile-artifact-lock/1"
    || artifactLock.profileVersion !== contract.profileVersion
    || !Array.isArray(artifactLock.artifacts)) {
    throw publicationFailure("INVALID_ARTIFACT_LOCK", "artifact lock version or artifact inventory is invalid");
  }
  const lockByPath = new Map();
  for (const entry of artifactLock.artifacts) {
    if (!entry || !safeArtifactPath(entry.path) || !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "")) {
      throw publicationFailure("INVALID_ARTIFACT_LOCK", "artifact lock contains an invalid path or digest", {
        path: entry?.path ?? null,
      });
    }
    if (lockByPath.has(entry.path)) {
      throw publicationFailure("INVALID_ARTIFACT_LOCK", "artifact lock contains a duplicate path", { path: entry.path });
    }
    lockByPath.set(entry.path, entry);
  }

  function verifyLockedBytes(relativePath, bytes) {
    const entry = lockByPath.get(relativePath);
    if (!entry) {
      throw publicationFailure("PUBLICATION_ARTIFACT_NOT_LOCKED", "publication artifact is absent from artifact lock", {
        relativePath,
      });
    }
    const digest = sha256(bytes);
    if (entry.sha256 !== digest) {
      throw publicationFailure("PUBLICATION_ARTIFACT_DIGEST_MISMATCH", "publication artifact does not match artifact lock", {
        actual: digest,
        expected: entry.sha256,
        relativePath,
      });
    }
    for (const sizeProperty of ["size", "bytes", "byteLength"]) {
      if (entry[sizeProperty] !== undefined && entry[sizeProperty] !== bytes.length) {
        throw publicationFailure("PUBLICATION_ARTIFACT_SIZE_MISMATCH", "publication artifact size does not match artifact lock", {
          actual: bytes.length,
          expected: entry[sizeProperty],
          relativePath,
          sizeProperty,
        });
      }
    }
    return digest;
  }

  const contractDigest = verifyLockedBytes(contractFile, contractBytes);

  const artifacts = new Map();
  let snapshotBytes = contractBytes.length + artifactLockBytes.length;
  if (snapshotBytes > maxSnapshotBytes) {
    throw publicationFailure("PUBLICATION_SNAPSHOT_TOO_LARGE", "contract and artifact lock exceed configured total byte limit", {
      actual: snapshotBytes,
      limit: maxSnapshotBytes,
    });
  }
  for (const resource of contract.resources) {
    for (const artifact of Object.values(resource.representations ?? {})) {
      if (artifacts.has(artifact)) continue;
      if (!safeArtifactPath(artifact)) {
        throw publicationFailure("UNSAFE_PUBLICATION_ARTIFACT", "publication artifact path is unsafe", {
          relativePath: artifact,
        });
      }
      const bytes = await readConfinedFile(
        releaseRoot,
        artifact,
        Math.min(maxArtifactBytes, maxSnapshotBytes - snapshotBytes),
      );
      const digest = verifyLockedBytes(artifact, bytes);
      snapshotBytes += bytes.length;
      if (snapshotBytes > maxSnapshotBytes) {
        throw publicationFailure("PUBLICATION_SNAPSHOT_TOO_LARGE", "publication snapshot exceeds configured total byte limit", {
          actual: snapshotBytes,
          limit: maxSnapshotBytes,
        });
      }
      artifacts.set(artifact, Object.freeze({
        bytes,
        digest,
        etag: `"sha256-${digest}"`,
        length: bytes.length,
        relativePath: artifact,
      }));
    }
  }

  // Exercise the shared contract parser before accepting traffic.
  for (const resource of contract.resources) {
    for (const iri of resource.iris) {
      for (const mediaType of Object.keys(resource.representations)) {
        const selected = selectContentNegotiationResponse({ accept: mediaType, contract, iri });
        if (selected.status !== 200 || !artifacts.has(selected.artifact)) {
          throw publicationFailure("INVALID_PUBLICATION_CONTRACT", "contract representation cannot be resolved", {
            iri,
            mediaType,
          });
        }
      }
    }
  }

  return Object.freeze({
    artifactLock: Object.freeze(artifactLock),
    artifactLockDigest: sha256(artifactLockBytes),
    artifacts,
    contract: Object.freeze(contract),
    contractDigest,
    loadedAt: new Date().toISOString(),
    profileVersion: contract.profileVersion,
    publicOrigin,
  });
}

export { sha256 };
