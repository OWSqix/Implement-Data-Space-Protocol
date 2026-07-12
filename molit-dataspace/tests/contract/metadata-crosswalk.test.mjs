import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const [schema, crosswalk, interoperabilityRegister] = await Promise.all([
  readFile(new URL("../../contracts/metadata-crosswalk.v1.schema.json", import.meta.url), "utf8")
    .then(JSON.parse),
  readFile(new URL(
    "../../standards/mappings/data-go-kr-dcat-dialect.v1.json",
    import.meta.url,
  ), "utf8").then(JSON.parse),
  readFile(new URL(
    "../../standards/korean-interoperability-register.json",
    import.meta.url,
  ), "utf8").then(JSON.parse),
]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateCrosswalk = ajv.compile(schema);

function humanReadableStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(humanReadableStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(humanReadableStrings);
  }
  return [];
}

test("MAP-COV-001: every observed source path has exactly one explicit mapping decision", () => {
  assert.equal(validateCrosswalk(crosswalk), true, JSON.stringify(validateCrosswalk.errors));
  const rowIds = crosswalk.rows.map((row) => row.id);
  assert.equal(new Set(rowIds).size, rowIds.length);
  const sourcePaths = crosswalk.rows.map((row) => row.sourcePointerOrXPath);
  assert.equal(new Set(sourcePaths).size, sourcePaths.length);
  assert.deepEqual(new Set(sourcePaths), new Set(crosswalk.sourceInventory));
});

test("MAP-LOSS-001: lossy or unresolved rows cannot bypass review", () => {
  for (const row of crosswalk.rows) {
    assert.ok(row.reverseRule.length > 0, row.id);
    if (["derived", "many-to-one", "unmapped"].includes(row.lossClass)) {
      assert.notEqual(row.publicationGate, "automatic", row.id);
    }
    if (row.lossClass === "not-published") {
      assert.ok(["private-only", "reject"].includes(row.publicationGate), row.id);
    }
  }
});

test("PDP-PROV-001: every mapping row points to a fixed registered fixture", () => {
  const fixtureIds = new Set(interoperabilityRegister.snapshots.map((item) => item.id));
  for (const row of crosswalk.rows) {
    assert.ok(row.fixtureIds.every((id) => fixtureIds.has(id)), row.id);
  }
  assert.equal(crosswalk.status, "working-draft");
});

test("PDP-LANG-001: BCP 47 kr is not silently rewritten as Korean", () => {
  const languageRows = crosswalk.rows.filter((row) => (
    row.sourcePointerOrXPath.includes("@xml:lang='kr'")
  ));
  assert.equal(languageRows.length, 3);
  for (const row of languageRows) {
    assert.notEqual(row.publicationGate, "automatic", row.id);
    assert.match(row.transform, /Kanuri/u, row.id);
    assert.match(row.authority, /confirmation required/u, row.id);
  }
});

test("CT-CROSSWALK-UTF8-001: mapping text has no replacement or encoding-loss markers", () => {
  const corrupted = humanReadableStrings(crosswalk).filter((value) => (
    value.includes("\uFFFD") || /[?]{2,}/u.test(value)
  ));
  assert.deepEqual(corrupted, []);
  for (const row of crosswalk.rows) {
    for (const field of ["authority", "reverseRule", "transform"]) {
      assert.equal(row[field].includes("?"), false, `${row.id}.${field}`);
    }
  }
});
