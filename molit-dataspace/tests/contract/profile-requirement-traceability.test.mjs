import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { DataFactory, Parser, Store } from "n3";
import {
  buildDraftRequirementArtifacts,
  buildDraftRequirementRegistry,
  includedRequirementRegistrySummaries,
  integratedRequirementCoverage,
  requirementResultEvidence,
  requirementCsvProjection,
  scanRequirementConstraints,
  verifyRequirementTraceability,
} from "../../tools/profile/verify-requirement-traceability.mjs";

const { namedNode } = DataFactory;

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const schema = JSON.parse(await readFile(
  path.join(root, "contracts/profile-requirements.v1.schema.json"),
  "utf8",
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv, { mode: "full" });
const validateRegistry = ajv.compile(schema);
const validateCaseRegistry = ajv.compile({
  $ref: `${schema.$id}#/$defs/fixtureCaseRegistryDocument`,
});

const version = "1.0.0-rc.1";
const shapeNamespace = `https://data.molit.go.kr/shape/molit-dcat-ap/${version}#`;
const shapeSource = `
@prefix dcat: <http://www.w3.org/ns/dcat#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix molit: <https://data.molit.go.kr/def/molit-dcat-ap#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

<${shapeNamespace}DatasetShape>
  a sh:NodeShape ;
  molit:requirementId "MOLIT-TEST-NODE-001" ;
  sh:targetClass dcat:Dataset ;
  sh:property <${shapeNamespace}TitlePropertyShape> ;
  sh:property [
    molit:requirementId "MOLIT-TEST-DESCRIPTION-001" ;
    sh:path dct:description ;
    sh:minCount 1 ;
    sh:node [ sh:property [ sh:path dct:identifier ; sh:minCount 1 ] ]
  ] .

<${shapeNamespace}TitlePropertyShape>
  a sh:PropertyShape ;
  molit:requirementId "MOLIT-TEST-TITLE-001" ;
  sh:path dct:title ;
  sh:minCount 1 ;
  sh:datatype rdf:langString .
`;

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function makeRelease(t) {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "molit-requirements-"));
  t.after(() => rm(releaseRoot, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(releaseRoot, "shacl"), { recursive: true }),
    mkdir(path.join(releaseRoot, "examples", "valid"), { recursive: true }),
    mkdir(path.join(releaseRoot, "examples", "invalid"), { recursive: true }),
    mkdir(path.join(releaseRoot, "requirements"), { recursive: true }),
  ]);
  await writeJson(path.join(releaseRoot, "manifest.json"), {
    schemaVersion: "molit.application-profile-manifest/2",
    profileId: "molit-dcat-ap",
    version,
    requirementsRegistry: "requirements/profile-requirements.json",
    conformanceCases: "requirements/conformance-cases.json",
    profiles: {
      core: {
        kind: "conformance",
        shapes: ["shacl/molit-test.ttl"],
      },
    },
  });
  await Promise.all([
    writeFile(path.join(releaseRoot, "shacl", "molit-test.ttl"), shapeSource, "utf8"),
    writeFile(
      path.join(releaseRoot, "examples", "valid", "dataset.ttl"),
      [
        "@prefix dcat: <http://www.w3.org/ns/dcat#> .",
        "@prefix dct: <http://purl.org/dc/terms/> .",
        '<urn:dataset> a dcat:Dataset ; dct:title "Title"@en ;',
        '  dct:description [ dct:identifier "description-1" ] .',
        "",
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      path.join(releaseRoot, "examples", "invalid", "missing-title.ttl"),
      [
        "@prefix dcat: <http://www.w3.org/ns/dcat#> .",
        "@prefix dct: <http://purl.org/dc/terms/> .",
        '<urn:broken> a dcat:Dataset ; dct:description [ dct:identifier "description-1" ] .',
        "",
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      path.join(releaseRoot, "examples", "invalid", "missing-description.ttl"),
      [
        "@prefix dcat: <http://www.w3.org/ns/dcat#> .",
        "@prefix dct: <http://purl.org/dc/terms/> .",
        '<urn:broken> a dcat:Dataset ; dct:title "Title"@en .',
        "",
      ].join("\n"),
      "utf8",
    ),
    writeJson(path.join(releaseRoot, "requirements", "source-overrides.json"), {
      schemaVersion: "molit.profile-requirement-source-overrides/1",
      profileVersion: version,
      overrides: [],
    }),
  ]);
  return releaseRoot;
}

async function approveDraft(releaseRoot) {
  const { caseRegistry, requirementsRegistry: registry } = await buildDraftRequirementArtifacts({
    releaseRoot,
  });
  const ids = registry.requirements.map((item) => item.requirementId).sort();
  registry.registryStatus = "approved";
  caseRegistry.registryStatus = "approved";
  for (const fixture of caseRegistry.fixtureCases) {
    fixture.description = fixture.expectedOutcome === "conforms"
      ? "Positive catalogue fixture for every synthetic requirement."
      : "Atomic negative catalogue fixture for one synthetic property condition.";
    if (fixture.expectedOutcome === "conforms") {
      fixture.coversRequirementIds = [...ids];
      fixture.expectedRequirementIds = [];
      fixture.atomicConditionFamilyIds = [];
    } else if (fixture.path.endsWith("missing-title.ttl")) {
      fixture.coversRequirementIds = ["MOLIT-TEST-TITLE-001"];
      fixture.expectedRequirementIds = [...fixture.coversRequirementIds];
      fixture.atomicConditionFamilyIds = ["MOLIT-TEST-TITLE-001"];
    } else {
      fixture.coversRequirementIds = ["MOLIT-TEST-DESCRIPTION-001"];
      fixture.expectedRequirementIds = [...fixture.coversRequirementIds];
      fixture.atomicConditionFamilyIds = ["MOLIT-TEST-DESCRIPTION-001"];
    }
  }
  const positive = caseRegistry.fixtureCases.find((item) => item.expectedOutcome === "conforms");
  const titleNegative = caseRegistry.fixtureCases.find((item) => item.path.endsWith("missing-title.ttl"));
  const descriptionNegative = caseRegistry.fixtureCases.find((item) => (
    item.path.endsWith("missing-description.ttl")
  ));
  for (const requirement of registry.requirements) {
    requirement.sourceStandard = "Synthetic traceability contract";
    requirement.sourceClause = requirement.requirementId;
    requirement.localRationale = "The fixture isolates the machine traceability contract.";
    requirement.positiveFixtureId = positive.fixtureId;
    requirement.negativeFixtureId = requirement.requirementId === "MOLIT-TEST-DESCRIPTION-001"
      ? descriptionNegative.fixtureId
      : titleNegative.fixtureId;
  }
  registry.integratedCoverage = integratedRequirementCoverage(
    registry.requirements,
    registry.includedRequirementRegistries,
  );
  assert.equal(validateRegistry(registry), true, JSON.stringify(validateRegistry.errors, null, 2));
  assert.equal(
    validateCaseRegistry(caseRegistry),
    true,
    JSON.stringify(validateCaseRegistry.errors, null, 2),
  );
  await Promise.all([
    writeJson(
      path.join(releaseRoot, "requirements", "profile-requirements.json"),
      registry,
    ),
    writeJson(
      path.join(releaseRoot, "requirements", "conformance-cases.json"),
      caseRegistry,
    ),
    writeJson(path.join(releaseRoot, "requirements", "local-normative-clauses.json"), {
      schemaVersion: "molit.local-normative-clauses/1",
      profileVersion: version,
      registryStatus: "approved",
      clauses: registry.requirements.map((requirement) => ({
        clauseId: requirement.requirementId,
        requirementId: requirement.requirementId,
        sourceStandard: requirement.sourceStandard,
        normativeStatement: [...requirement.messages]
          .sort((left, right) => left.language.localeCompare(right.language)
            || left.text.localeCompare(right.text))
          .map(({ language, text }) => `[${language}] ${text}`)
          .join("\n"),
        adoptionRationale: requirement.localRationale,
      })),
    }),
    writeFile(
      path.join(releaseRoot, "requirements", "profile-requirements.csv"),
      requirementCsvProjection(registry),
      "utf8",
    ),
  ]);
  return { caseRegistry, registry };
}

test("REQ-TRACE-SCHEMA-001: every normative traceability field is mandatory", async () => {
  const required = schema.$defs.requirement.required;
  for (const field of [
    "conformanceClass",
    "resourceClass",
    "property",
    "obligation",
    "cardinality",
    "range",
    "vocabulary",
    "severity",
    "messages",
    "remediation",
    "sourceStandard",
    "sourceClause",
    "localRationale",
    "shapeId",
    "positiveFixtureId",
    "negativeFixtureId",
  ]) {
    assert.ok(required.includes(field), field);
  }
});

test("REQ-TRACE-001: approved NodeShape, PropertyShape and direct property rows pass", async (t) => {
  const releaseRoot = await makeRelease(t);
  const { registry } = await approveDraft(releaseRoot);
  const scan = await scanRequirementConstraints({ releaseRoot });
  assert.deepEqual(
    scan.constraints.map((item) => item.constraintKind).sort(),
    ["direct-property-constraint", "property-shape"],
  );
  assert.equal(scan.containerShapes.length, 1);
  assert.equal(registry.requirements.length, 2);
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, true, JSON.stringify(report, null, 2));
  assert.deepEqual(report.coverage, {
    fullyCovered: 2,
    negativeCovered: 2,
    positiveCovered: 2,
    requirements: 2,
  });
  assert.deepEqual(report.coverageBlockers, []);
  assert.deepEqual(report.summary, {
    auxiliaryPropertyConstraints: 1,
    containerNodeShapes: 1,
    errors: 0,
    fixtureCases: 3,
    localShapeFiles: 1,
    registryRequirements: 2,
    trackedConstraints: 2,
  });
});

test("REQ-TRACE-002: a direct property without one requirementId fails closed", async (t) => {
  const releaseRoot = await makeRelease(t);
  await approveDraft(releaseRoot);
  await writeFile(
    path.join(releaseRoot, "shacl", "molit-test.ttl"),
    shapeSource.replace('    molit:requirementId "MOLIT-TEST-DESCRIPTION-001" ;\n', ""),
    "utf8",
  );
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some((item) => item.code === "SHAPE_REQUIREMENT_ID_CARDINALITY"));
});

test("REQ-TRACE-003: one requirementId cannot identify two SHACL constraints", async (t) => {
  const releaseRoot = await makeRelease(t);
  await approveDraft(releaseRoot);
  await writeFile(
    path.join(releaseRoot, "shacl", "molit-test.ttl"),
    shapeSource.replace("MOLIT-TEST-DESCRIPTION-001", "MOLIT-TEST-TITLE-001"),
    "utf8",
  );
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some((item) => item.code === "DUPLICATE_SHAPE_REQUIREMENT_ID"));
});

test("REQ-TRACE-003A: a logical helper inherits and cannot override its direct requirement", async (t) => {
  const releaseRoot = await makeRelease(t);
  await approveDraft(releaseRoot);
  await writeFile(
    path.join(releaseRoot, "shacl", "molit-test.ttl"),
    shapeSource.replace(
      "sh:property [ sh:path dct:identifier",
      'sh:property [ molit:requirementId "MOLIT-TEST-AUX-001" ; sh:path dct:identifier',
    ),
    "utf8",
  );
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some((item) => item.code === "AUXILIARY_REQUIREMENT_OVERRIDE"));
});

test("REQ-TRACE-004: fixture bytes and bidirectional case links are release evidence", async (t) => {
  const releaseRoot = await makeRelease(t);
  const { caseRegistry, registry } = await approveDraft(releaseRoot);
  const positive = caseRegistry.fixtureCases.find((item) => item.expectedOutcome === "conforms");
  positive.coversRequirementIds.pop();
  await writeJson(
    path.join(releaseRoot, "requirements", "conformance-cases.json"),
    caseRegistry,
  );
  let report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some((item) => item.code === "FIXTURE_COVERAGE_LINK_MISSING"));

  await approveDraft(releaseRoot);
  await writeFile(
    path.join(releaseRoot, "examples", "valid", "dataset.ttl"),
    "<urn:changed> <urn:predicate> <urn:value> .\n",
    "utf8",
  );
  report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some((item) => item.code === "FIXTURE_DIGEST_MISMATCH"));
});

test("REQ-TRACE-005: draft generation inventories missing IDs without approving them", async (t) => {
  const releaseRoot = await makeRelease(t);
  await writeFile(
    path.join(releaseRoot, "shacl", "molit-test.ttl"),
    shapeSource.replace('    molit:requirementId "MOLIT-TEST-DESCRIPTION-001" ;\n', ""),
    "utf8",
  );
  const draft = await buildDraftRequirementRegistry({ releaseRoot });
  assert.equal(validateRegistry(draft), true, JSON.stringify(validateRegistry.errors, null, 2));
  assert.equal(draft.registryStatus, "draft");
  assert.equal(draft.requirements.length, 2);
  assert.ok(draft.requirements.some((item) => item.requirementId.startsWith("MOLIT-DRAFT-")));
});

test("REQ-TRACE-006: CSV projection cannot drift from JSON rows or fields", async (t) => {
  const releaseRoot = await makeRelease(t);
  await approveDraft(releaseRoot);
  const csvPath = path.join(
    releaseRoot,
    "requirements",
    "profile-requirements.csv",
  );
  const source = await readFile(csvPath, "utf8");
  await writeFile(
    csvPath,
    source.replace("Synthetic traceability contract", "Changed only in CSV"),
    "utf8",
  );
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some((item) => item.code === "CSV_PROJECTION_MISMATCH"));
});

test("REQ-TRACE-007: reviewed source overrides cannot drift from JSON rationale", async (t) => {
  const releaseRoot = await makeRelease(t);
  const { registry } = await approveDraft(releaseRoot);
  await writeJson(path.join(releaseRoot, "requirements", "source-overrides.json"), {
    schemaVersion: "molit.profile-requirement-source-overrides/1",
    profileVersion: version,
    overrides: [{
      requirementId: registry.requirements[0].requirementId,
      sourceStandard: "Reviewed synthetic standard",
      sourceClause: "Reviewed clause 1",
      localRationale: "Reviewed rationale that intentionally differs from the JSON row.",
    }],
  });
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some((item) => item.code === "SOURCE_OVERRIDE_MISMATCH"));
});

test("REQ-TRACE-008: a matching digest cannot replace runtime SHACL evidence", async (t) => {
  const releaseRoot = await makeRelease(t);
  const { caseRegistry } = await approveDraft(releaseRoot);
  const negative = caseRegistry.fixtureCases.find((item) => (
    item.path.endsWith("missing-title.ttl")
  ));
  const source = await readFile(
    path.join(releaseRoot, "examples", "valid", "dataset.ttl"),
    "utf8",
  );
  await writeFile(path.join(releaseRoot, ...negative.path.split("/")), source, "utf8");
  negative.sha256 = sha256(source);
  await writeJson(
    path.join(releaseRoot, "requirements", "conformance-cases.json"),
    caseRegistry,
  );
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some((item) => (
    item.code === "FIXTURE_VALIDATION_OUTCOME_MISMATCH"
  )));
  assert.ok(report.findings.some((item) => (
    item.code === "FIXTURE_ATOMIC_FAMILY_MISMATCH"
  )));
});

test("REQ-TRACE-009: two independently failing leaves are not one atomic family", async (t) => {
  const releaseRoot = await makeRelease(t);
  const { caseRegistry } = await approveDraft(releaseRoot);
  const negative = caseRegistry.fixtureCases.find((item) => (
    item.path.endsWith("missing-title.ttl")
  ));
  const source = "@prefix dcat: <http://www.w3.org/ns/dcat#> . <urn:broken> a dcat:Dataset .\n";
  await writeFile(path.join(releaseRoot, ...negative.path.split("/")), source, "utf8");
  negative.sha256 = sha256(source);
  negative.coversRequirementIds = ["MOLIT-TEST-TITLE-001"];
  negative.expectedRequirementIds = ["MOLIT-TEST-TITLE-001"];
  negative.atomicConditionFamilyIds = ["MOLIT-TEST-TITLE-001"];
  await writeJson(
    path.join(releaseRoot, "requirements", "conformance-cases.json"),
    caseRegistry,
  );
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some((item) => (
    item.code === "REQUIREMENT_NEGATIVE_NOT_ATOMIC"
  )));
  assert.ok(report.findings.some((item) => (
    item.code === "FIXTURE_ATOMIC_FAMILY_MISMATCH"
  )));
});

test("REQ-TRACE-010: a requirement ID is not an approved clause without its register row", async (t) => {
  const releaseRoot = await makeRelease(t);
  await approveDraft(releaseRoot);
  const clausePath = path.join(
    releaseRoot,
    "requirements",
    "local-normative-clauses.json",
  );
  const clauses = JSON.parse(await readFile(clausePath, "utf8"));
  clauses.clauses.pop();
  await writeJson(clausePath, clauses);
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some((item) => (
    item.code === "LOCAL_CLAUSE_REGISTER_INVALID"
  )));
});

test("REQ-TRACE-011: a constraint-unit overlay isolates one leaf from the same graph", async (t) => {
  const releaseRoot = await makeRelease(t);
  const { caseRegistry } = await approveDraft(releaseRoot);
  const negative = caseRegistry.fixtureCases.find((item) => (
    item.path.endsWith("missing-title.ttl")
  ));
  const source = "@prefix dcat: <http://www.w3.org/ns/dcat#> . <urn:broken> a dcat:Dataset .\n";
  await writeFile(path.join(releaseRoot, ...negative.path.split("/")), source, "utf8");
  negative.sha256 = sha256(source);
  negative.coversRequirementIds = ["MOLIT-TEST-TITLE-001"];
  negative.expectedRequirementIds = ["MOLIT-TEST-TITLE-001"];
  negative.atomicConditionFamilyIds = ["MOLIT-TEST-TITLE-001"];
  negative.validationMode = "constraint-unit";
  negative.targetRequirementId = "MOLIT-TEST-TITLE-001";
  await writeJson(
    path.join(releaseRoot, "requirements", "conformance-cases.json"),
    caseRegistry,
  );
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, true, JSON.stringify(report.findings, null, 2));
});

test("REQ-TRACE-012: a sh:node wrapper is normalized to its detail child family", () => {
  const shapeStore = new Store(new Parser().parse(`
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix molit: <https://data.molit.go.kr/def/molit-dcat-ap#> .
    <urn:owner> a sh:NodeShape ; molit:requirementId "MOLIT-OWNER-001" ; sh:node <urn:child> .
    <urn:child> a sh:NodeShape ; molit:requirementId "MOLIT-CHILD-001" ; sh:class <urn:Expected> .
  `));
  const evidence = requirementResultEvidence({
    approvedIds: new Set(["MOLIT-OWNER-001", "MOLIT-CHILD-001"]),
    constraintById: new Map([
      ["MOLIT-OWNER-001", { constraintKind: "node-shape", shapeId: "urn:owner" }],
      ["MOLIT-CHILD-001", { constraintKind: "node-shape", shapeId: "urn:child" }],
    ]),
    report: {
      results: [{
        detail: [{
          detail: [],
          sourceConstraintComponent: namedNode("http://www.w3.org/ns/shacl#ClassConstraintComponent"),
          sourceShape: namedNode("urn:child"),
        }],
        sourceConstraintComponent: namedNode("http://www.w3.org/ns/shacl#NodeConstraintComponent"),
        sourceShape: namedNode("urn:owner"),
      }],
    },
    shapeStore,
  });
  assert.deepEqual(evidence.requirementIds, ["MOLIT-CHILD-001", "MOLIT-OWNER-001"]);
  assert.deepEqual(evidence.atomicConditionFamilyIds, ["MOLIT-CHILD-001"]);
  assert.deepEqual(evidence.unattributedResultFamilies, []);
});

test("REQ-TRACE-013: independent results and unattributed shapes remain separate families", () => {
  const shapeStore = new Store(new Parser().parse(`
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix molit: <https://data.molit.go.kr/def/molit-dcat-ap#> .
    <urn:owner> a sh:NodeShape ; molit:requirementId "MOLIT-OWNER-001" ; sh:class <urn:A> .
    <urn:child> a sh:NodeShape ; molit:requirementId "MOLIT-CHILD-001" ; sh:class <urn:B> .
  `));
  const component = namedNode("http://www.w3.org/ns/shacl#ClassConstraintComponent");
  const evidence = requirementResultEvidence({
    approvedIds: new Set(["MOLIT-OWNER-001", "MOLIT-CHILD-001"]),
    constraintById: new Map([
      ["MOLIT-OWNER-001", { constraintKind: "node-shape", shapeId: "urn:owner" }],
      ["MOLIT-CHILD-001", { constraintKind: "node-shape", shapeId: "urn:child" }],
    ]),
    report: {
      results: ["urn:owner", "urn:child", "urn:upstream"].map((sourceShape) => ({
        detail: [],
        sourceConstraintComponent: component,
        sourceShape: namedNode(sourceShape),
      })),
    },
    shapeStore,
  });
  assert.deepEqual(evidence.atomicConditionFamilyIds, [
    "MOLIT-CHILD-001",
    "MOLIT-OWNER-001",
  ]);
  assert.equal(evidence.unattributedResultFamilies.length, 1);
  assert.match(evidence.unattributedResultFamilies[0], /urn:upstream/u);
});

test("REQ-TRACE-014: the main ledger rejects forged upstream coverage and CSV projection bytes", async (t) => {
  const sourceRelease = path.join(
    root,
    "profiles",
    "molit-dcat-ap",
    "releases",
    version,
  );
  const manifest = JSON.parse(await readFile(
    path.join(sourceRelease, "manifest.json"),
    "utf8",
  ));
  assert.equal(typeof manifest.upstreamRequirementsRegistry, "string");
  assert.equal(typeof manifest.upstreamRequirementsCsv, "string");
  const [inventoryBytes, csvBytes] = await Promise.all([
    readFile(path.join(sourceRelease, ...manifest.upstreamRequirementsRegistry.split("/"))),
    readFile(path.join(sourceRelease, ...manifest.upstreamRequirementsCsv.split("/"))),
  ]);
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "molit-upstream-summary-"));
  t.after(() => rm(releaseRoot, { recursive: true, force: true }));
  await mkdir(path.join(releaseRoot, "requirements"), { recursive: true });
  const inventoryPath = path.join(
    releaseRoot,
    ...manifest.upstreamRequirementsRegistry.split("/"),
  );
  const csvPath = path.join(releaseRoot, ...manifest.upstreamRequirementsCsv.split("/"));
  await Promise.all([
    writeFile(inventoryPath, inventoryBytes),
    writeFile(csvPath, csvBytes),
  ]);
  const scan = { manifest, releaseRoot };
  const [summary] = await includedRequirementRegistrySummaries(scan);
  const inventory = JSON.parse(inventoryBytes);
  assert.equal(summary.requirements, inventory.requirements.length);
  assert.equal(summary.fullyCovered, summary.requirements);
  assert.equal(summary.blockers, 0);
  assert.equal(summary.csvSha256, sha256(csvBytes));

  inventory.coverage.isolatedNegative -= 1;
  await writeJson(inventoryPath, inventory);
  await assert.rejects(
    includedRequirementRegistrySummaries(scan),
    /invalid identity or coverage/u,
  );

  await writeFile(inventoryPath, inventoryBytes);
  await writeFile(csvPath, Buffer.concat([csvBytes, Buffer.from("\n")]));
  await assert.rejects(
    includedRequirementRegistrySummaries(scan),
    /invalid identity or coverage/u,
  );
});

test("REQ-TRACE-RC-001: RC exposes every remaining non-atomic negative gap as a blocker", async () => {
  const releaseRoot = path.join(
    root,
    "profiles",
    "molit-dcat-ap",
    "releases",
    "1.0.0-rc.1",
  );
  const [registry, caseRegistry, coverage] = await Promise.all([
    readFile(path.join(releaseRoot, "requirements", "profile-requirements.json"), "utf8")
      .then(JSON.parse),
    readFile(path.join(releaseRoot, "requirements", "conformance-cases.json"), "utf8")
      .then(JSON.parse),
    readFile(path.join(releaseRoot, "requirements", "coverage-blockers.json"), "utf8")
      .then(JSON.parse),
  ]);
  assert.equal(validateRegistry(registry), true, JSON.stringify(validateRegistry.errors, null, 2));
  assert.equal(
    validateCaseRegistry(caseRegistry),
    true,
    JSON.stringify(validateCaseRegistry.errors, null, 2),
  );
  const fixtureById = new Map(caseRegistry.fixtureCases.map((item) => [item.fixtureId, item]));
  for (const requirement of registry.requirements) {
    assert.ok(requirement.messages.length > 0, requirement.requirementId);
    assert.ok(requirement.remediation.length >= 10, requirement.requirementId);
    assert.doesNotMatch(JSON.stringify(requirement), /\b(?:TBD|TODO)\b/iu);
    if (requirement.negativeFixtureId !== null) {
      const fixture = fixtureById.get(requirement.negativeFixtureId);
      assert.ok(fixture, requirement.requirementId);
      assert.deepEqual(
        fixture.atomicConditionFamilyIds.length,
        1,
        requirement.requirementId,
      );
    }
  }
  const expectedBlockers = registry.requirements.filter((item) => (
    item.positiveFixtureId === null || item.negativeFixtureId === null
  )).map((item) => item.requirementId).sort();
  assert.deepEqual(
    coverage.blockers.map((item) => item.requirementId).sort(),
    expectedBlockers,
  );
  assert.equal(coverage.counts.blockers, expectedBlockers.length);
  assert.equal(coverage.counts.fixtureCases, caseRegistry.fixtureCases.length);
  assert.equal(coverage.counts.normativeRequirements, registry.requirements.length);
  assert.equal(coverage.counts.positiveCovered, registry.requirements.length);
  assert.equal(
    coverage.counts.atomicNegativeFixtures,
    caseRegistry.fixtureCases.filter((item) => (
      item.expectedOutcome === "violates"
        && item.atomicConditionFamilyIds.length === 1
    )).length,
  );
  assert.equal(registry.registryStatus, expectedBlockers.length === 0 ? "approved" : "draft");
  assert.equal(caseRegistry.registryStatus, registry.registryStatus);
  const report = await verifyRequirementTraceability({ allowDraft: true, releaseRoot });
  assert.equal(report.gatePassed, expectedBlockers.length === 0);
  assert.equal(report.coverage.requirements, registry.requirements.length);
  assert.equal(report.coverage.positiveCovered, registry.requirements.length);
  assert.equal(report.coverage.negativeCovered, registry.requirements.length - expectedBlockers.length);
  if (expectedBlockers.length > 0) {
    assert.equal(report.findings.filter((item) => (
      item.code === "REQUIREMENT_NEGATIVE_FIXTURE_MISSING"
    )).length, expectedBlockers.length);
  }
});
