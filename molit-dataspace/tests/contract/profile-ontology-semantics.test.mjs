import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadOntologyCompetencyRegistry,
  runOwlConsistencyGate,
  verifyOntologySemantics,
  verifyQueryDocumentationSync,
} from "../../tools/profile/verify-ontology-semantics.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const RELEASE_ROOT = path.join(
  ROOT,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "1.0.0-rc.1",
);

test("RC ontology semantics are pinned to six modules, nineteen exact CQs and OWL-RL", {
  timeout: 180_000,
}, async () => {
  const report = await verifyOntologySemantics({ releaseRoot: RELEASE_ROOT });
  assert.equal(report.gatePassed, true, JSON.stringify(report.findings, null, 2));
  assert.equal(report.toolchain.verified, true);
  assert.equal(report.toolchain.jenaVersion, "6.1.0");
  assert.equal(report.toolchain.javaVersion, "21.0.11+10");
  assert.equal(report.documentation.passed, true);
  assert.equal(report.modules.length, 6);
  assert.ok(report.modules.every(({ passed }) => passed));
  assert.equal(report.queries.length, 19);
  assert.ok(report.queries.every(({ passed }) => passed));
  const resultCounts = new Map(report.queries.map(({ id, rowCount }) => [id, rowCount]));
  assert.equal(resultCounts.get("CQ-GEO-01"), 1, "spatial disclosure is exercised by a concrete dataset");
  assert.equal(resultCounts.get("CQ-GOV-02"), 3, "all three governance annotations retain their schema");
  assert.equal(resultCounts.get("CQ-NET-04"), 2, "node and link element kinds are both exercised");
  assert.equal(resultCounts.get("CQ-ONTO-TERM-01"), 40, "every local OWL term is queryable");
  assert.equal(resultCounts.get("CQ-QUAL-04"), 1, "quality status and result concept are joined");
  assert.equal(resultCounts.get("CQ-TRANSFER-01"), 4, "both deprecated transfer classes expose both replacements");
  assert.equal(resultCounts.get("CQ-NET-03"), 0, "fixture-specific empty supersession result");
  assert.equal(resultCounts.get("CQ-OFF-02"), 0, "candidate offering has no qualification evidence");
  assert.equal(resultCounts.get("CQ-QUAL-03"), 0, "quality target mismatch invariant");
  assert.equal(report.owlConsistency.gatePassed, true);
  assert.equal(report.owlConsistency.datasets.length, 6);
  assert.ok(report.owlConsistency.datasets.every(({ passed }) => passed));
});

test("machine query files cannot drift from their documented CQ fences", async () => {
  const { registry } = await loadOntologyCompetencyRegistry({ releaseRoot: RELEASE_ROOT });
  const markdown = await readFile(path.join(RELEASE_ROOT, ...registry.documentation.split("/")), "utf8");
  const queryTexts = new Map();
  for (const query of registry.queries) {
    queryTexts.set(
      query.queryFile,
      await readFile(path.join(RELEASE_ROOT, ...query.queryFile.split("/")), "utf8"),
    );
  }
  const target = registry.queries.find(({ id }) => id === "CQ-QUAL-03");
  queryTexts.set(target.queryFile, `${queryTexts.get(target.queryFile)}# drift\n`);
  const result = verifyQueryDocumentationSync(registry, markdown, queryTexts);
  assert.equal(result.passed, false);
  assert.deepEqual(result.findings, [{
    code: "CQ_DOCUMENTATION_QUERY_DRIFT",
    queryId: "CQ-QUAL-03",
  }]);
});

test("OWL gate fails closed on contradictions, deprecated terms and wrong domain/range use", {
  timeout: 60_000,
}, async (context) => {
  const releaseRoot = await mkdtemp(path.join(os.tmpdir(), "molit-owl-negative-"));
  context.after(async () => rm(releaseRoot, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(releaseRoot, "ontology"), { recursive: true }),
    mkdir(path.join(releaseRoot, "bundles"), { recursive: true }),
    mkdir(path.join(releaseRoot, "examples", "valid"), { recursive: true }),
  ]);
  await writeFile(path.join(releaseRoot, "ontology", "test.ttl"), `
@prefix ex: <https://data.molit.go.kr/def/molit-dcat-ap#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:A a owl:Class ; owl:disjointWith ex:B ; owl:equivalentClass ex:B .
ex:B a owl:Class .
ex:C a owl:Class .
ex:p a owl:ObjectProperty ; rdfs:domain ex:A ; rdfs:range ex:B .
ex:q a owl:DatatypeProperty ; rdfs:domain ex:A ; rdfs:range xsd:integer .
ex:old a owl:ObjectProperty ;
  rdfs:domain ex:A ;
  rdfs:range ex:B ;
  owl:deprecated true .
`, "utf8");
  await writeFile(path.join(releaseRoot, "bundles", "support.ttl"), `
@prefix owl: <http://www.w3.org/2002/07/owl#> .
<urn:test:support> a owl:Ontology .
`, "utf8");
  await writeFile(path.join(releaseRoot, "examples", "valid", "bad.ttl"), `
@prefix ex: <https://data.molit.go.kr/def/molit-dcat-ap#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:both a ex:A, ex:B .
ex:nothing a owl:Nothing .
ex:wrong a ex:C ;
  ex:p ex:wrongObject, "literal-object" ;
  ex:q "not-an-integer"^^xsd:integer ;
  ex:old ex:wrongObject .
ex:wrongObject a ex:C .
`, "utf8");
  const registryPath = path.join(releaseRoot, "ontology", "registry.json");
  await writeFile(registryPath, JSON.stringify({
    profileVersion: "synthetic-negative",
    baseGraphs: ["ontology/test.ttl", "bundles/support.ttl"],
    datasets: [{ id: "negative", module: "core", fixture: "examples/valid/bad.ttl" }],
    owlConsistency: {
      localNamespace: "https://data.molit.go.kr/def/molit-dcat-ap#",
      prohibitLocalEquivalence: true,
      requireDeprecatedReplacement: true,
      failOnDeprecatedFixtureUse: true,
      requireExplicitDomainRangeTypes: true,
    },
  }), "utf8");

  const report = runOwlConsistencyGate({ releaseRoot, registryPath });
  assert.equal(report.gatePassed, false);
  const codes = new Set(report.findings.map(({ code }) => code));
  for (const code of [
    "OWL_NOTHING_INSTANCE",
    "DISJOINT_CLASS_INSTANCE",
    "LOCAL_EQUIVALENCE_PROHIBITED",
    "EQUIVALENT_DISJOINT_CLASS",
    "DEPRECATED_REPLACEMENT_MISSING",
    "DEPRECATED_PROPERTY_IN_FIXTURE",
    "DOMAIN_TYPE_MISMATCH",
    "RANGE_TYPE_MISMATCH",
    "OBJECT_PROPERTY_LITERAL",
    "DATATYPE_RANGE_MISMATCH",
  ]) {
    assert.ok(codes.has(code), `missing fail-closed diagnostic ${code}`);
  }
});
