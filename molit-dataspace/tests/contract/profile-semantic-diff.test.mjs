import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildSemanticDiff } from "../../tools/profile/build-semantic-diff.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(root, "profiles/molit-dcat-ap/releases/1.0.0-rc.1");
const semanticDiff = JSON.parse(await readFile(
  path.join(releaseRoot, "migration/semantic-diff.json"),
  "utf8",
));
const schema = JSON.parse(await readFile(
  path.join(root, "contracts/profile-semantic-diff.v1.schema.json"),
  "utf8",
));

test("PROFILE-DIFF-001: the checked-in 0.1.0 to RC semantic diff is schema-valid", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(semanticDiff), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(semanticDiff.from.version, "0.1.0");
  assert.equal(semanticDiff.to.version, "1.0.0-rc.1");
});

test("PROFILE-DIFF-002: module split and deprecated transfer terms are explicit", () => {
  for (const module of ["network", "observation", "quality", "dataspace-offering"]) {
    assert.ok(semanticDiff.profileModules.conformance.added.includes(module), module);
  }
  const deprecated = new Set(semanticDiff.ontology.deprecatedInTarget.map(({ iri }) => iri));
  assert.ok(deprecated.has("https://data.molit.go.kr/def/molit-dcat-ap#TransferableDataset"));
  assert.ok(deprecated.has("https://data.molit.go.kr/def/molit-dcat-ap#TransferDistribution"));
  assert.ok(semanticDiff.reviewedBreakingChanges.some(({ id }) => (
    id === "BREAK-TRANSFERABLE-DEPRECATION"
  )));
  assert.ok(semanticDiff.requirements.changed.some(({ requirementId }) => (
    requirementId === "MOLIT-GEO-ENCODING-001"
  )), "retained requirement IDs must still expose changed constraint graphs");
  assert.equal(
    semanticDiff.reviewedBreakingChanges.find(({ id }) => id === "BREAK-DOMESTIC-THEME")
      ?.migrationSection,
    "MIGRATION.md#9-core와-주제-이관",
  );
});

test("PROFILE-DIFF-003: the semantic diff is reproducible from the two releases", async () => {
  assert.deepEqual(await buildSemanticDiff("0.1.0", "1.0.0-rc.1"), semanticDiff);
});
