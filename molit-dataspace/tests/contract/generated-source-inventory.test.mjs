import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compareGeneratedInventory,
  DEFAULT_RDFXML_INVENTORY_LIMITS,
  inventoryRdfXmlBytes,
} from "../../tools/mappings/rdfxml-source-inventory.mjs";

const [fixture, crosswalk] = await Promise.all([
  readFile(new URL(
    "../../fixtures/interoperability/data-go-kr-100299070.rdf",
    import.meta.url,
  )),
  readFile(new URL(
    "../../standards/mappings/data-go-kr-dcat-dialect.v1.json",
    import.meta.url,
  ), "utf8").then(JSON.parse),
]);

test("MAP-COV-002: safe RDF/XML inventory exactly covers sourceInventory and mapping rows", () => {
  const generated = inventoryRdfXmlBytes(fixture);
  assert.equal(generated.length, 17);
  assert.deepEqual(compareGeneratedInventory(generated, crosswalk), []);
  assert.deepEqual(new Set(generated), new Set(crosswalk.sourceInventory));
  assert.deepEqual(
    new Set(generated),
    new Set(crosswalk.rows.map((row) => row.sourcePointerOrXPath)),
  );
});

test("MAP-COV-003: source and crosswalk cannot coordinate an omitted predicate", () => {
  const generated = inventoryRdfXmlBytes(fixture);
  const candidate = structuredClone(crosswalk);
  const omitted = candidate.sourceInventory.find((path) => path.endsWith("/dcat:theme"));
  candidate.sourceInventory = candidate.sourceInventory.filter((path) => path !== omitted);
  candidate.rows = candidate.rows.filter((row) => row.sourcePointerOrXPath !== omitted);
  assert.ok(compareGeneratedInventory(generated, candidate).some((problem) => (
    problem.includes("dcat:theme")
  )));

  const expandedFixture = Buffer.from(fixture.toString("utf8").replace(
    "<dcat:theme>교통물류</dcat:theme>",
    "<dcat:theme>교통물류</dcat:theme><dct:identifier>100299070</dct:identifier>",
  ));
  const expanded = inventoryRdfXmlBytes(expandedFixture);
  assert.ok(expanded.some((path) => path.endsWith("/dct:identifier")));
  assert.ok(compareGeneratedInventory(expanded, crosswalk).some((problem) => (
    problem.includes("dct:identifier")
  )));
});

test("MAP-COV-004: namespace aliases do not alter canonical paths", () => {
  const aliased = Buffer.from(fixture.toString("utf8")
    .replace('xmlns:dct="http://purl.org/dc/terms/"', 'xmlns:terms="http://purl.org/dc/terms/"')
    .replaceAll("<dct:", "<terms:")
    .replaceAll("</dct:", "</terms:"));
  assert.deepEqual(inventoryRdfXmlBytes(aliased), inventoryRdfXmlBytes(fixture));
});

test("RDFXML-SEC-001: inventory parser rejects active XML and resource exhaustion inputs", () => {
  const source = fixture.toString("utf8");
  const attacks = [
    Buffer.from(source.replace(
      "<rdf:RDF",
      '<!DOCTYPE rdf:RDF [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rdf:RDF',
    )),
    Buffer.from(source.replace(
      "<dcat:theme>교통물류</dcat:theme>",
      '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///etc/passwd"/>',
    )),
    Buffer.from(source.replace("<dcat:Catalog>", "<?fetch file:///etc/passwd?><dcat:Catalog>")),
    Buffer.from(source.replace("<dcat:Dataset>", '<dcat:Dataset dct:identifier="hidden">')),
    Buffer.from([0xff, 0xfe, 0xfd]),
  ];
  for (const attack of attacks) {
    assert.throws(() => inventoryRdfXmlBytes(attack));
  }
  assert.throws(
    () => inventoryRdfXmlBytes(Buffer.alloc(DEFAULT_RDFXML_INVENTORY_LIMITS.maxBytes + 1)),
    (error) => error.code === "RDFXML_SIZE_LIMIT",
  );
});
