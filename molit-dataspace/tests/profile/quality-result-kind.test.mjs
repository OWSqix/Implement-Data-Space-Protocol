import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";

const { namedNode } = DataFactory;
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(
  root,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "1.0.0-rc.1",
);
const fixtureRoot = path.join(releaseRoot, "examples", "unit", "quality-result-kind");
const shapeIri = "https://data.molit.go.kr/shape/molit-dcat-ap/1.0.0-rc.1#QualityMeasurementShape";
const requirementPredicate = namedNode(
  "https://data.molit.go.kr/def/molit-dcat-ap#requirementId",
);
const shSparql = namedNode("http://www.w3.org/ns/shacl#sparql");
const shXone = namedNode("http://www.w3.org/ns/shacl#xone");

const shapes = new Store(new Parser().parse(await readFile(
  path.join(releaseRoot, "shacl", "molit-quality.ttl"),
  "utf8",
)));
const geoDcatShapes = new Store(new Parser().parse(await readFile(
  path.join(releaseRoot, "shacl", "upstream", "geodcat-ap-3.1.0", "geodcat-ap-SHACL.ttl"),
  "utf8",
)));

async function validateFixture(outcome, resultKind) {
  const source = await readFile(
    path.join(fixtureRoot, outcome, `${resultKind}.ttl`),
    "utf8",
  );
  return new SHACLValidator(shapes).validate(new Store(new Parser().parse(source)));
}

test("QUALITY-RESULT-CORE-001: result-kind branching uses SHACL Core", () => {
  assert.equal(shapes.countQuads(null, shSparql, null, null), 0);
  assert.equal(shapes.countQuads(namedNode(shapeIri), shXone, null, null), 1);
  assert.deepEqual(
    shapes.getObjects(namedNode(shapeIri), requirementPredicate, null).map((term) => term.value),
    ["MOLIT-QUAL-MEASURE-001"],
  );
});

test("QUALITY-RESULT-GEODCAT-001: categorical dqv:value remains a GeoDCAT-AP literal", async () => {
  const source = await readFile(path.join(fixtureRoot, "valid", "categorical.ttl"), "utf8");
  const report = await new SHACLValidator(geoDcatShapes)
    .validate(new Store(new Parser().parse(source)));
  assert.equal(report.conforms, true, JSON.stringify(report.results, null, 2));
});

for (const resultKind of ["quantitative", "boolean", "categorical", "descriptive"]) {
  test(`POS-QUALITY-RESULT-${resultKind.toUpperCase()}: matching value and unit semantics conform`, async () => {
    const report = await validateFixture("valid", resultKind);
    assert.equal(report.conforms, true, JSON.stringify(report.results, null, 2));
  });

  test(`NEG-QUALITY-RESULT-${resultKind.toUpperCase()}: mismatched value or unit semantics violate`, async () => {
    const report = await validateFixture("invalid", resultKind);
    assert.equal(report.conforms, false);
    assert.ok(report.results.some(({ sourceShape }) => sourceShape?.value === shapeIri));
  });
}
