import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  buildDraftRequirementArtifacts,
  buildDraftRequirementRegistry,
  requirementCsvProjection,
  scanRequirementConstraints,
  verifyRequirementTraceability,
} from "../../tools/profile/verify-requirement-traceability.mjs";

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
      "@prefix dcat: <http://www.w3.org/ns/dcat#> . <urn:dataset> a dcat:Dataset .\n",
      "utf8",
    ),
    writeFile(
      path.join(releaseRoot, "examples", "invalid", "dataset.ttl"),
      "@prefix dcat: <http://www.w3.org/ns/dcat#> . <urn:broken> a dcat:Dataset .\n",
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
      : "Single negative catalogue fixture for every synthetic requirement.";
    fixture.coversRequirementIds = [...ids];
    fixture.expectedRequirementIds = fixture.expectedOutcome === "violates" ? [...ids] : [];
  }
  const positive = caseRegistry.fixtureCases.find((item) => item.expectedOutcome === "conforms");
  const negative = caseRegistry.fixtureCases.find((item) => item.expectedOutcome === "violates");
  for (const requirement of registry.requirements) {
    requirement.sourceStandard = "Synthetic traceability contract";
    requirement.sourceClause = `clause-${requirement.requirementId}`;
    requirement.localRationale = "The fixture isolates the machine traceability contract.";
    requirement.positiveFixtureId = positive.fixtureId;
    requirement.negativeFixtureId = negative.fixtureId;
  }
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
    ["direct-property-constraint", "node-shape", "property-shape"],
  );
  assert.equal(registry.requirements.length, 3);
  const report = await verifyRequirementTraceability({ releaseRoot });
  assert.equal(report.gatePassed, true, JSON.stringify(report, null, 2));
  assert.deepEqual(report.coverage, {
    fullyCovered: 3,
    negativeCovered: 3,
    positiveCovered: 3,
    requirements: 3,
  });
  assert.deepEqual(report.coverageBlockers, []);
  assert.deepEqual(report.summary, {
    auxiliaryPropertyConstraints: 1,
    errors: 0,
    fixtureCases: 2,
    localShapeFiles: 1,
    registryRequirements: 3,
    trackedConstraints: 3,
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
    shapeSource.replace("MOLIT-TEST-DESCRIPTION-001", "MOLIT-TEST-NODE-001"),
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
  assert.equal(draft.requirements.length, 3);
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

test("REQ-TRACE-RC-001: RC has complete positive and negative evidence", async () => {
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
  for (const requirement of registry.requirements) {
    assert.ok(requirement.messages.length > 0, requirement.requirementId);
    assert.ok(requirement.remediation.length >= 10, requirement.requirementId);
    assert.doesNotMatch(JSON.stringify(requirement), /\b(?:TBD|TODO)\b/iu);
    assert.match(requirement.negativeFixtureId, /^NEG-MUT-/u, requirement.requirementId);
  }
  assert.equal(registry.requirements.filter((requirement) => (
    requirement.negativeFixtureId
      === `NEG-MUT-${requirement.requirementId.slice("MOLIT-".length)}`
  )).length, 110);
  assert.deepEqual(coverage.counts, {
    blockers: 0,
    fixtureCases: 138,
    fullyCovered: 156,
    generatedMutations: 110,
    negativeCovered: 156,
    normativeRequirements: 156,
    positiveCovered: 156,
  });
  const expectedBlockers = registry.requirements.filter((item) => (
    item.positiveFixtureId === null || item.negativeFixtureId === null
  )).map((item) => item.requirementId).sort();
  assert.deepEqual(
    coverage.blockers.map((item) => item.requirementId).sort(),
    expectedBlockers,
  );
  const report = await verifyRequirementTraceability({ allowDraft: true, releaseRoot });
  assert.equal(report.gatePassed, true);
  assert.deepEqual(report.coverage, {
    fullyCovered: 156,
    negativeCovered: 156,
    positiveCovered: 156,
    requirements: 156,
  });
  assert.deepEqual(report.findings, []);
});
