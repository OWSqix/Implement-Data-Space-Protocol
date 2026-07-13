import assert from "node:assert/strict";
import test from "node:test";
import { DataFactory, Store } from "n3";
import { loadProfileRelease } from "../../src/profile/registry.mjs";
import {
  materializedRequirementProfileCoverage,
  runtimeRequirementCoverage,
} from "../../tools/profile/rc-requirement-profile-coverage.mjs";
import {
  buildRcShaclMatrixCandidate,
  deriveFullMatrixDefinitions,
} from "../../tools/profile/run-rc-shacl-matrix.mjs";
import {
  buildRcSerializationParityCandidate,
  deriveRequirementLinkedSerializationDefinitions,
} from "../../tools/profile/run-rc-serialization-parity.mjs";

test("CT-RC-SERIALIZATION-DEFINITION-001: full parity keeps fixtures from every non-diagnostic profile", async () => {
  const release = await loadProfileRelease("1.0.0-rc.1");
  const registry = {
    requirements: [
      {
        conformanceClass: ["core", "geo"],
        negativeFixtureId: "NEG-TEST-CORE",
        positiveFixtureId: "POS-TEST-CORE",
        requirementId: "MOLIT-TEST-CORE-001",
      },
      {
        conformanceClass: ["publication-policy"],
        negativeFixtureId: "NEG-TEST-POLICY",
        positiveFixtureId: "POS-TEST-POLICY",
        requirementId: "MOLIT-TEST-POLICY-001",
      },
    ],
  };
  const fixtureCases = [
    ["POS-TEST-CORE", "conforms", ["core", "geo"], "examples/valid/core-catalog.ttl"],
    ["NEG-TEST-CORE", "violates", ["core", "geo"], "examples/invalid/missing-korean-title.ttl"],
    ["POS-TEST-POLICY", "conforms", "publication-policy", "examples/valid/core-catalog.ttl"],
    ["NEG-TEST-POLICY", "violates", "publication-policy", "examples/invalid/deprecated-local-transfer-types.ttl"],
  ].map(([fixtureId, expectedOutcome, profile, input]) => ({
    conformanceClass: Array.isArray(profile) ? profile : [profile],
    expectedOutcome,
    fixtureId,
    path: input,
    sha256: "0".repeat(64),
  }));
  const definitions = deriveRequirementLinkedSerializationDefinitions(
    release,
    registry,
    { fixtureCases },
  );
  assert.deepEqual(definitions.map((item) => item.fixtureId), [
    "NEG-TEST-CORE",
    "NEG-TEST-CORE",
    "NEG-TEST-POLICY",
    "POS-TEST-CORE",
    "POS-TEST-CORE",
    "POS-TEST-POLICY",
  ]);
  assert.deepEqual(definitions.map((item) => item.profile), [
    "core",
    "geo",
    "publication-policy",
    "core",
    "geo",
    "publication-policy",
  ]);
  assert.equal(new Set(definitions.map((item) => item.id)).size, definitions.length);
});

test("CT-RC-MATRIX-001: full lane deduplicates fixture IDs and retains requirement links", async () => {
  const release = await loadProfileRelease("1.0.0-rc.1");
  const requirements = ["MOLIT-TEST-001", "MOLIT-TEST-002"].map((requirementId) => ({
    conformanceClass: ["core", "geo"],
    negativeFixtureId: "NEG-TEST-CORE",
    positiveFixtureId: "POS-TEST-CORE",
    requirementId,
  }));
  requirements.push({
    conformanceClass: ["core"],
    negativeFixtureId: "NEG-TEST-CORE",
    positiveFixtureId: "POS-TEST-CORE",
    requirementId: "MOLIT-TEST-CORE-ONLY-001",
  });
  const fixtures = [
    {
      conformanceClass: ["core", "geo"],
      expectedOutcome: "conforms",
      fixtureId: "POS-TEST-CORE",
      path: "examples/valid/core-catalog.ttl",
      sha256: "0".repeat(64),
    },
    {
      conformanceClass: ["core", "geo"],
      expectedOutcome: "violates",
      fixtureId: "NEG-TEST-CORE",
      path: "examples/invalid/catalog-record-dataset-mismatch.ttl",
      sha256: "1".repeat(64),
    },
  ];
  const definitions = deriveFullMatrixDefinitions(
    release,
    { registryStatus: "approved", requirements },
    { fixtureCases: fixtures, registryStatus: "approved" },
  );
  assert.equal(definitions.length, 4);
  assert.deepEqual(definitions.map((item) => item.fixtureId).sort(), [
    "NEG-TEST-CORE",
    "NEG-TEST-CORE",
    "POS-TEST-CORE",
    "POS-TEST-CORE",
  ]);
  for (const definition of definitions) {
    assert.deepEqual(
      definition.requirementIds,
      definition.profile === "core"
        ? ["MOLIT-TEST-001", "MOLIT-TEST-002", "MOLIT-TEST-CORE-ONLY-001"]
        : ["MOLIT-TEST-001", "MOLIT-TEST-002"],
    );
  }
  assert.deepEqual(
    definitions.map(({ fixtureId, profile }) => `${fixtureId}/${profile}`).sort(),
    [
      "NEG-TEST-CORE/core",
      "NEG-TEST-CORE/geo",
      "POS-TEST-CORE/core",
      "POS-TEST-CORE/geo",
    ],
  );
});

test("CT-RC-COVERAGE-FAIL-CLOSED-001: runtime and materialized profile gaps are rejected", async () => {
  const release = await loadProfileRelease("1.0.0-rc.1");
  const requirement = {
    conformanceClass: ["core"],
    requirementId: "MOLIT-TEST-COVERAGE-001",
    shapeFile: "shacl/test-shape.ttl",
    shapeId: "https://data.molit.go.kr/shape/test#Shape",
  };
  assert.throws(() => runtimeRequirementCoverage(release, { requirements: [requirement] }, [{
    expectedConforms: true,
    fixtureId: "POS-TEST",
    profile: "core",
    requirementIds: [requirement.requirementId],
  }]), (error) => error.code === "RC_REQUIREMENT_PROFILE_COVERAGE_GAP");

  const syntheticRelease = structuredClone(release);
  syntheticRelease.manifest.profiles.core.shapes = [requirement.shapeFile];
  const { blankNode, literal, namedNode, quad } = DataFactory;
  const shape = namedNode(requirement.shapeId);
  const propertyShape = blankNode("property-shape");
  const shapeStore = new Store([
    DataFactory.quad(
      shape,
      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      namedNode("http://www.w3.org/ns/shacl#NodeShape"),
    ),
    quad(shape, namedNode("http://www.w3.org/ns/shacl#property"), propertyShape),
    quad(
      propertyShape,
      namedNode("https://data.molit.go.kr/def/molit-dcat-ap#requirementId"),
      literal(requirement.requirementId),
    ),
  ]);
  const coverageInput = {
    materializedProfiles: new Map([["core", {
      bundleBytes: Buffer.from(`# Source: ${requirement.shapeFile}\n`, "utf8"),
      bundleRelative: "bundles/core.ttl",
      shapeStore,
    }]]),
    registry: { requirements: [requirement] },
    release: syntheticRelease,
    sourceShapeDigests: new Map([[requirement.shapeFile, "0".repeat(64)]]),
  };
  const covered = materializedRequirementProfileCoverage(coverageInput);
  assert.equal(covered.applicableRequirementProfilePairs, 1);
  shapeStore.removeQuad(quad(
    propertyShape,
    namedNode("https://data.molit.go.kr/def/molit-dcat-ap#requirementId"),
    literal(requirement.requirementId),
  ));
  assert.throws(() => materializedRequirementProfileCoverage({
    ...coverageInput,
  }), (error) => error.code === "RC_REQUIREMENT_PROFILE_COVERAGE_GAP");
});

test("CT-RC-MATRIX-002: six RC modules agree across Node, pySHACL and Jena", {
  timeout: 300_000,
}, async () => {
  const report = await buildRcShaclMatrixCandidate({ mode: "representative" });
  assert.equal(report.schemaVersion, "molit.rc-shacl-engine-matrix/1");
  assert.equal(report.gatePassed, true);
  assert.equal(report.mode, "representative");
  assert.equal(report.releaseEvidenceEligible, false);
  assert.equal(report.cases.length, 13);
  const modules = new Set(report.cases.map((item) => item.profile));
  assert.deepEqual([...modules].sort(), [
    "core",
    "dataspace-offering",
    "geo",
    "network",
    "observation",
    "quality",
  ]);
  for (const module of modules) {
    const cases = report.cases.filter((item) => item.profile === module);
    assert.equal(cases.length, module === "core" ? 3 : 2);
    assert.deepEqual(
      cases.map((item) => item.decision).sort(),
      module === "core" ? ["conforms", "conforms", "violates"] : ["conforms", "violates"],
    );
    for (const item of cases) {
      const decisions = Object.values(item.engines).map((engine) => engine.conforms);
      assert.deepEqual(decisions, [item.decision === "conforms", item.decision === "conforms", item.decision === "conforms"]);
    }
  }
  assert.deepEqual(report.nodeOnlyPreflightControls.map((item) => item.controlId).sort(), [
    "MOLIT-GEO-LEXICAL-PREFLIGHT-001",
    "MOLIT-PROFILE-SELECTION-001",
    "MOLIT-SEC-PUBLIC-001",
  ]);
  assert.match(report.normativeBoundary.shaclMatrix, /pySHACL and Jena/u);
  assert.match(report.normativeBoundary.nodePublicationPreflight, /before SHACL/u);
  const sectorService = report.cases.find((item) => (
    item.input === "examples/valid/sector-and-service-catalog.ttl"
  ));
  assert.equal(sectorService?.profile, "core");
  assert.equal(sectorService?.decision, "conforms");
});

test("CT-RC-SERIALIZATION-001: Jena conversions preserve graph and core decision", {
  timeout: 300_000,
}, async () => {
  const report = await buildRcSerializationParityCandidate();
  assert.equal(report.schemaVersion, "molit.rc-serialization-parity/1");
  assert.equal(report.gatePassed, true);
  assert.deepEqual(report.conversions.map((item) => item.format), [
    "turtle",
    "rdfxml",
    "jsonld",
    "ntriples",
    "nquads",
  ]);
  for (const conversion of report.conversions) {
    assert.equal(conversion.canonicalGraphSha256, report.baseline.canonicalGraphSha256);
    assert.equal(conversion.defaultGraphPreserved, true);
    assert.equal(conversion.validation.node.conforms, true);
    assert.equal(conversion.validation.jena.conforms, true);
  }
  assert.deepEqual(report.fullCoverage.coverage.formats, [
    "turtle",
    "rdfxml",
    "jsonld",
    "ntriples",
    "nquads",
  ]);
  assert.deepEqual(report.fullCoverage.coverage.profiles, [
    "core",
    "dataspace-offering",
    "geo",
    "network",
    "observation",
    "publication-policy",
    "quality",
  ]);
  assert.equal(
    report.fullCoverage.coverage.fixtureCount,
    report.fullCoverage.cases.length,
  );
  assert.equal(
    report.fullCoverage.coverage.fixtureProfileExecutions,
    report.fullCoverage.cases.length,
  );
  assert.equal(
    report.fullCoverage.coverage.uniqueFixtures,
    new Set(report.fullCoverage.cases.map((item) => item.fixtureId)).size,
  );
  assert.equal(
    report.fullCoverage.coverage.positiveRequirements,
    report.fullCoverage.coverage.executableRequirements,
  );
  assert.equal(
    report.fullCoverage.coverage.negativeRequirements,
    report.fullCoverage.coverage.executableRequirements,
  );
  assert.ok(
    report.fullCoverage.coverage.applicableRequirementProfilePairs
      > report.fullCoverage.coverage.requirementProfileExecutions,
  );
  assert.equal(
    report.fullCoverage.coverage.bundleCoverage.pairs.length,
    report.fullCoverage.coverage.applicableRequirementProfilePairs,
  );
  assert.equal(
    report.fullCoverage.coverage.positiveFixtures
      + report.fullCoverage.coverage.negativeFixtures,
    report.fullCoverage.cases.length,
  );
  for (const item of report.fullCoverage.cases) {
    assert.equal(item.conversions.length, 5, item.fixtureId);
    assert.ok(item.conversions.every((conversion) => (
      conversion.canonicalGraphSha256 === item.baseline.canonicalGraphSha256
        && conversion.defaultGraphPreserved
        && conversion.node.conforms === item.baseline.node.conforms
        && conversion.output.digestScope === "RDFC-1.0-canonical-n-quads"
        && conversion.output.sha256 === conversion.canonicalGraphSha256
        && conversion.output.bytes > 0
    )), item.fixtureId);
  }
  for (const profile of report.fullCoverage.coverage.profiles) {
    const profileCoverage = report.fullCoverage.coverage.perProfile[profile];
    assert.ok(profileCoverage.fixtureCount > 0, profile);
    assert.ok(profileCoverage.positiveFixtures > 0, profile);
    assert.ok(profileCoverage.negativeFixtures > 0, profile);
    assert.equal(
      profileCoverage.formatConversionCount,
      profileCoverage.fixtureCount * report.fullCoverage.coverage.formats.length,
      profile,
    );
    assert.ok(profileCoverage.requirementCount > 0, profile);
    assert.ok(
      profileCoverage.applicableRequirementCount >= profileCoverage.requirementCount,
      profile,
    );
    assert.equal(
      report.fullCoverage.coverage.bundleCoverage.perProfile[profile]
        .applicableRequirements,
      profileCoverage.applicableRequirementCount,
      profile,
    );
  }
  assert.equal(
    report.releaseEvidenceEligible,
    report.artifactLock.status === "verified"
      && report.requirementTraceability.gatePassed
      && report.fullCoverage.coverage.linkedRequirements
        === report.fullCoverage.coverage.executableRequirements,
  );
});
