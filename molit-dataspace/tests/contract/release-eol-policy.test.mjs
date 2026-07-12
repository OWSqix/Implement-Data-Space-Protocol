import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  assertPortableArtifactPath,
  assertPortableAttributes,
  assertPortableTextBytes,
  verifyReleaseEolPolicy,
} from "../../tools/release/verify-release-eol-policy.mjs";

test("RELEASE-EOL-001: every locked text artifact is normalized as LF", async () => {
  const report = await verifyReleaseEolPolicy();
  assert.equal(report.valid, true);
  assert.equal(report.lockFileChecked, true);
  assert.equal(report.artifactCount, report.textArtifacts + report.binaryArtifacts);
  assert.ok(report.textArtifacts > 0);
});

test("RELEASE-EOL-002: CR bytes and conversion attributes fail closed", () => {
  const valid = {
    eol: "lf",
    filter: "unset",
    ident: "unset",
    text: "set",
    "working-tree-encoding": "unset",
  };
  assert.doesNotThrow(() => assertPortableTextBytes(Buffer.from("a\nb\n"), "a.ttl"));
  assert.throws(
    () => assertPortableTextBytes(Buffer.from("a\r\nb\n"), "a.ttl"),
    { code: "RELEASE_EOL_POLICY_INVALID" },
  );
  assert.throws(
    () => assertPortableTextBytes(Buffer.from("{}\r\n"), "artifact-lock.json"),
    { code: "RELEASE_EOL_POLICY_INVALID" },
  );
  for (const [name, value] of [
    ["filter", "custom-clean"],
    ["ident", "set"],
    ["working-tree-encoding", "UTF-16"],
  ]) {
    assert.throws(
      () => assertPortableAttributes({ ...valid, [name]: value }, "a.ttl"),
      { code: "RELEASE_EOL_POLICY_INVALID" },
    );
  }
  assert.throws(
    () => assertPortableAttributes(valid, "archive.zip", { binary: true }),
    { code: "RELEASE_EOL_POLICY_INVALID" },
  );
});

test("RELEASE-EOL-003: traversal and duplicate lock paths fail closed", () => {
  const boundary = path.resolve("profiles/molit-dcat-ap/releases/1.0.0-rc.1");
  assert.throws(
    () => assertPortableArtifactPath("../manifest.json", new Set(), boundary),
    { code: "RELEASE_EOL_POLICY_INVALID" },
  );
  const seen = new Set();
  assert.doesNotThrow(() => assertPortableArtifactPath("manifest.json", seen, boundary));
  assert.throws(
    () => assertPortableArtifactPath("manifest.json", seen, boundary),
    { code: "RELEASE_EOL_POLICY_INVALID" },
  );
});
