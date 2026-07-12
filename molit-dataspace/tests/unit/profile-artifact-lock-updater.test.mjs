import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  listReleaseMachineArtifacts,
  releaseMachineExtensions,
} from "../../src/profile/registry.mjs";
import { updateArtifactLock } from "../../tools/profile/update-artifact-lock.mjs";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("ST-SUPPLY-001: lock updater cannot auto-approve an injected artifact", async (t) => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "molit-profile-lock-"));
  t.after(() => rm(releaseRoot, { force: true, recursive: true }));
  await mkdir(path.join(releaseRoot, "ontology"), { recursive: true });
  await writeFile(path.join(releaseRoot, "manifest.json"), "{\"version\":\"test\"}\n", "utf8");
  await writeFile(path.join(releaseRoot, "ontology", "profile.ttl"), "<urn:s> <urn:p> <urn:o> .\n", "utf8");
  const artifacts = ["manifest.json", "ontology/profile.ttl"].map((relative) => ({
    license: "test-only",
    origin: "local",
    path: relative,
    sha256: "0".repeat(64),
    version: "test",
  }));
  const lockPath = path.join(releaseRoot, "artifact-lock.json");
  await writeFile(lockPath, `${JSON.stringify({
    artifacts,
    networkFetchAtRuntime: false,
    profileVersion: "test",
    schemaVersion: "molit.profile-artifact-lock/1",
  }, null, 2)}\n`, "utf8");

  const initialPaths = ["manifest.json", "ontology/profile.ttl"];
  const updated = await updateArtifactLock({
    releaseRoot,
    reviewedChangedPaths: initialPaths,
  });
  assert.equal(updated.artifactCount, 2);
  const locked = JSON.parse(await readFile(lockPath, "utf8"));
  for (const artifact of locked.artifacts) {
    assert.equal(
      artifact.sha256,
      digest(await readFile(path.join(releaseRoot, artifact.path))),
    );
    assert.equal(artifact.license, "test-only");
  }

  const lockBeforeInjection = await readFile(lockPath);
  await mkdir(path.join(releaseRoot, ".omc", "state"), { recursive: true });
  await writeFile(
    path.join(releaseRoot, ".omc", "state", "transient.json"),
    "{\"untrusted\":true}\n",
    "utf8",
  );
  await assert.rejects(
    updateArtifactLock({ releaseRoot }),
    (error) => error.code === "ARTIFACT_INVENTORY_CHANGE_REQUIRES_REVIEW"
      && error.details.added.includes(".omc/state/transient.json"),
  );
  assert.deepEqual(await readFile(lockPath), lockBeforeInjection);

  await rm(path.join(releaseRoot, ".omc"), { force: true, recursive: true });
  const beforeContentChange = await readFile(lockPath);
  await writeFile(path.join(releaseRoot, "ontology", "profile.ttl"), "<urn:x> <urn:p> <urn:o> .\n");
  await assert.rejects(
    updateArtifactLock({ releaseRoot }),
    (error) => error.code === "ARTIFACT_CONTENT_CHANGE_REQUIRES_REVIEW"
      && error.details.unreviewed.includes("ontology/profile.ttl"),
  );
  assert.deepEqual(await readFile(lockPath), beforeContentChange);
  await updateArtifactLock({
    releaseRoot,
    reviewedChangedPaths: ["ontology/profile.ttl"],
  });

  await assert.rejects(
    updateArtifactLock({ releaseRoot, lockName: "../outside.json" }),
    (error) => error.code === "INVALID_ARTIFACT_LOCK_PATH",
  );

  const upstreamLock = JSON.parse(await readFile(lockPath, "utf8"));
  const upstream = upstreamLock.artifacts.find((item) => item.path === "ontology/profile.ttl");
  upstream.origin = "https://standards.example.invalid/profile.ttl";
  upstream.version = "upstream-v1";
  await writeFile(lockPath, `${JSON.stringify(upstreamLock, null, 2)}\n`, "utf8");
  await writeFile(path.join(releaseRoot, "ontology", "profile.ttl"), "<urn:y> <urn:p> <urn:o> .\n");
  const lockBeforeUpstreamReview = await readFile(lockPath);
  await assert.rejects(
    updateArtifactLock({
      releaseRoot,
      reviewedChangedPaths: ["ontology/profile.ttl"],
    }),
    (error) => error.code === "UPSTREAM_ARTIFACT_PROVENANCE_REVIEW_REQUIRED",
  );
  for (const provenanceUpdate of [
    {},
    {
      license: upstream.license,
      origin: upstream.origin,
      version: upstream.version,
    },
  ]) {
    await assert.rejects(
      updateArtifactLock({
        provenanceUpdates: { "ontology/profile.ttl": provenanceUpdate },
        releaseRoot,
        reviewedChangedPaths: ["ontology/profile.ttl"],
      }),
      (error) => error.code === "UPSTREAM_ARTIFACT_PROVENANCE_REVIEW_REQUIRED"
        && error.details.path === "ontology/profile.ttl",
    );
  }
  for (const provenanceUpdate of [
    { reviewedBy: "test-reviewer" },
    { origin: "not-an-authority" },
    { version: "" },
    { version: " upstream-v2 " },
  ]) {
    await assert.rejects(
      updateArtifactLock({
        provenanceUpdates: { "ontology/profile.ttl": provenanceUpdate },
        releaseRoot,
        reviewedChangedPaths: ["ontology/profile.ttl"],
      }),
      (error) => error.code === "INVALID_ARTIFACT_REVIEW"
        && error.details.path === "ontology/profile.ttl",
    );
  }
  assert.deepEqual(await readFile(lockPath), lockBeforeUpstreamReview);
  await updateArtifactLock({
    provenanceUpdates: {
      "ontology/profile.ttl": {
        license: "test-only",
        origin: "https://standards.example.invalid/profile-v2.ttl",
        version: "upstream-v2",
      },
    },
    releaseRoot,
    reviewedChangedPaths: ["ontology/profile.ttl"],
  });
});

test("ST-SUPPLY-002: XML and RDF machine artifacts cannot bypass inventory review", async (t) => {
  const addedExtensions = [".rdf", ".xml", ".xsd", ".sch", ".nt", ".nq"];
  for (const extension of addedExtensions) {
    assert.ok(releaseMachineExtensions.includes(extension), extension);
  }
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "molit-profile-machine-ext-"));
  t.after(() => rm(releaseRoot, { force: true, recursive: true }));
  const manifestPath = path.join(releaseRoot, "manifest.json");
  const manifestBytes = Buffer.from("{\"version\":\"test\"}\n", "utf8");
  await writeFile(manifestPath, manifestBytes);
  const lockPath = path.join(releaseRoot, "artifact-lock.json");
  await writeFile(lockPath, `${JSON.stringify({
    artifacts: [{
      license: "test-only",
      origin: "local",
      path: "manifest.json",
      sha256: digest(manifestBytes),
      version: "test",
    }],
    networkFetchAtRuntime: false,
    profileVersion: "test",
    schemaVersion: "molit.profile-artifact-lock/1",
  }, null, 2)}\n`, "utf8");
  const lockBeforeInjection = await readFile(lockPath);

  for (const extension of addedExtensions) {
    for (const candidateExtension of [extension, extension.toUpperCase()]) {
      const relativePath = `injected${candidateExtension}`;
      const injectedPath = path.join(releaseRoot, relativePath);
      await writeFile(injectedPath, "unreviewed machine artifact\n", "utf8");
      assert.ok((await listReleaseMachineArtifacts({
        manifest: { lockFile: "artifact-lock.json" },
        releaseRoot,
      })).includes(relativePath), relativePath);
      await assert.rejects(
        updateArtifactLock({ releaseRoot }),
        (error) => error.code === "ARTIFACT_INVENTORY_CHANGE_REQUIRES_REVIEW"
          && error.details.added.includes(relativePath),
        relativePath,
      );
      assert.deepEqual(await readFile(lockPath), lockBeforeInjection, relativePath);
      await rm(injectedPath, { force: true });
    }
  }
});
