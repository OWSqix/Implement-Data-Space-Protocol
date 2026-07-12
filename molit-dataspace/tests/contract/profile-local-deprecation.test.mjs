import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { loadProfileRelease, resolveReleaseArtifact } from "../../src/profile/registry.mjs";

const release = await loadProfileRelease("1.0.0-rc.1");
const shapePath = "shacl/molit-recommended.ttl";
const negativePath = "examples/invalid/deprecated-local-transfer-types.ttl";
const positivePath = release.manifest.profiles["publication-policy"].example;
const sourceShape =
  "https://data.molit.go.kr/shape/molit-dcat-ap/1.0.0-rc.1#LocalDeprecatedTransferTypeShape";

async function store(relative) {
  return new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(release, relative),
    "utf8",
  )));
}

test("PROFILE-DEPRECATED-001: publication policy rejects both local legacy transfer classes", async () => {
  assert.ok(release.manifest.profiles["publication-policy"].shapes.includes(shapePath));
  const validator = new SHACLValidator(await store(shapePath));
  const report = await validator.validate(await store(negativePath));
  assert.equal(report.conforms, false);
  assert.equal(report.results.length, 2);
  assert.ok(report.results.every((result) => result.sourceShape.value === sourceShape));
  assert.deepEqual(
    report.results.map((result) => result.focusNode.value).sort(),
    [
      "https://data.molit.go.kr/id/example/legacy-transfer-dataset",
      "https://data.molit.go.kr/id/example/legacy-transfer-distribution",
    ],
  );
});

test("PROFILE-DEPRECATED-002: absence of legacy transfer classes remains conformant", async () => {
  const validator = new SHACLValidator(await store(shapePath));
  const report = await validator.validate(await store(positivePath));
  assert.equal(report.conforms, true);
  assert.equal(report.results.length, 0);
});
