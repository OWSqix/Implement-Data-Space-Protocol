import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertApprovedManifest,
  treeRecord,
} from "../../tools/dependencies/jena-toolchain.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const manifest = JSON.parse(await readFile(
  path.join(root, "standards/toolchains/jena-parser-lane.win32-x64.json"),
  "utf8",
));
const differential = JSON.parse(await readFile(
  path.join(root, "evidence/validators/jena-shacl-differential.v1.json"),
  "utf8",
));

test("SHACL-TOOLCHAIN-001: publisher checksum snapshots bind the pinned archives", async () => {
  assert.equal(manifest.schemaVersion, "molit.validator-toolchain/1");
  assert.equal(manifest.platform, "win32");
  assert.equal(manifest.architecture, "x64");
  assert.equal(manifest.signatureVerification, "not-performed");
  assert.deepEqual(
    new Set(manifest.artifacts.map(({ role }) => role)),
    new Set(["java-runtime", "jena-commands"]),
  );
  for (const artifact of manifest.artifacts) {
    assert.match(artifact.url, /^https:\/\//u);
    assert.match(artifact.checksumSource, /^https:\/\//u);
    assert.match(artifact.checksumSnapshotPath, /^standards\/vendor\/toolchain-checksums\//u);
    assert.match(artifact.checksumSnapshotSha256, /^[a-f0-9]{64}$/u);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/u);
    assert.match(artifact.sha512, /^[a-f0-9]{128}$/u);
    assert.match(artifact.installedContentSha256, /^[a-f0-9]{64}$/u);
    assert.ok(artifact.installedFileCount > 0);
    assert.ok(artifact.installedBytes > artifact.bytes);
    assert.ok(["sha256", "sha512"].includes(artifact.checksumAlgorithm));
    const snapshotPath = path.resolve(root, ...artifact.checksumSnapshotPath.split("/"));
    assert.equal(
      path.relative(root, snapshotPath).startsWith(".."),
      false,
      artifact.checksumSnapshotPath,
    );
    const snapshot = await readFile(snapshotPath);
    assert.equal(
      createHash("sha256").update(snapshot).digest("hex"),
      artifact.checksumSnapshotSha256,
      artifact.role,
    );
    assert.equal(
      snapshot.toString("utf8").trim(),
      `${artifact[artifact.checksumAlgorithm]}  ${artifact.name}`,
      artifact.role,
    );
  }
});

test("SHACL-TOOLCHAIN-002: approved Jena evidence covers the SHACL example corpus", () => {
  assert.equal(differential.schemaVersion, "molit.jena-shacl-differential/1");
  assert.equal(differential.gatePassed, true);
  assert.equal(differential.toolchain.toolchainId, manifest.toolchainId);
  assert.equal(differential.toolchain.jenaVersion, "6.1.0");
  assert.equal(differential.toolchain.javaVersion, "21.0.11");
  assert.equal(differential.cases.length, 13);
  assert.deepEqual(
    differential.cases.slice(0, 3).map(({ id, conforms }) => [id, conforms]),
    [
      ["JENA-SHACL-CORE-VALID", true],
      ["JENA-SHACL-GEO-VALID", true],
      ["JENA-SHACL-CORE-INVALID", false],
    ],
  );
  assert.ok(differential.cases.slice(2).every(({ conforms, resultCount }) => (
    conforms === false && resultCount > 0
  )));
  assert.ok(differential.cases.every(({ normalizedResultsSha256 }) => (
    /^[a-f0-9]{64}$/u.test(normalizedResultsSha256)
  )));
});

test("SHACL-TOOLCHAIN-003: reviewedAt is a real RFC 3339 calendar instant", () => {
  assert.doesNotThrow(() => assertApprovedManifest(structuredClone(manifest)));
  for (const reviewedAt of [
    "2026-02-29T12:00:00Z",
    "2026-04-31T12:00:00Z",
    "2026-13-01T12:00:00Z",
    "2026-07-12T24:00:00Z",
  ]) {
    const candidate = structuredClone(manifest);
    candidate.reviewedAt = reviewedAt;
    assert.throws(
      () => assertApprovedManifest(candidate),
      /Jena toolchain manifest is not approved/u,
      reviewedAt,
    );
  }
  const leapDay = structuredClone(manifest);
  leapDay.reviewedAt = "2024-02-29T12:00:00Z";
  assert.doesNotThrow(() => assertApprovedManifest(leapDay));
});

test("SHACL-TOOLCHAIN-004: tree limits apply across nested directories", async (context) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "molit-jena-tree-"));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(path.join(fixture, "nested"));
  await writeFile(path.join(fixture, "root.txt"), "a");
  await writeFile(path.join(fixture, "nested", "child.txt"), "bc");

  const record = await treeRecord(fixture, {
    maximumDirectoryEntries: 3,
    maximumFiles: 2,
  });
  assert.equal(record.fileCount, 2);
  assert.equal(record.bytes, 3);
  assert.match(record.contentSha256, /^[a-f0-9]{64}$/u);

  await assert.rejects(
    treeRecord(fixture, { maximumDirectoryEntries: 2, maximumFiles: 2 }),
    /directory-entry limit exceeded/u,
  );
  await assert.rejects(
    treeRecord(fixture, { maximumDirectoryEntries: 3, maximumFiles: 1 }),
    /file-count limit exceeded/u,
  );
});
