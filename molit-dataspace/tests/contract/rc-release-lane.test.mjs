import assert from "node:assert/strict";
import test from "node:test";
import { loadProfileRelease } from "../../src/profile/registry.mjs";
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
        conformanceClass: ["core"],
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
    ["POS-TEST-CORE", "conforms", "core", "examples/valid/core-catalog.ttl"],
    ["NEG-TEST-CORE", "violates", "core", "examples/invalid/missing-korean-title.ttl"],
    ["POS-TEST-POLICY", "conforms", "publication-policy", "examples/valid/core-catalog.ttl"],
    ["NEG-TEST-POLICY", "violates", "publication-policy", "examples/invalid/deprecated-local-transfer-types.ttl"],
  ].map(([fixtureId, expectedOutcome, profile, input]) => ({
    conformanceClass: [profile],
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
    "NEG-TEST-POLICY",
    "POS-TEST-CORE",
    "POS-TEST-POLICY",
  ]);
  assert.deepEqual(definitions.map((item) => item.profile), [
    "core",
    "publication-policy",
    "core",
    "publication-policy",
  ]);
});

test("CT-RC-MATRIX-001: full lane deduplicates fixture IDs and retains requirement links", async () => {
  const release = await loadProfileRelease("1.0.0-rc.1");
  const requirements = ["MOLIT-TEST-001", "MOLIT-TEST-002"].map((requirementId) => ({
    conformanceClass: ["core", "geo"],
    negativeFixtureId: "NEG-TEST-CORE",
    positiveFixtureId: "POS-TEST-CORE",
    requirementId,
  }));
  const fixtures = [
    {
      conformanceClass: ["core"],
      expectedOutcome: "conforms",
      fixtureId: "POS-TEST-CORE",
      path: "examples/valid/core-catalog.ttl",
      sha256: "0".repeat(64),
    },
    {
      conformanceClass: ["core"],
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
  assert.equal(definitions.length, 2);
  assert.deepEqual(definitions.map((item) => item.fixtureId).sort(), [
    "NEG-TEST-CORE",
    "POS-TEST-CORE",
  ]);
  for (const definition of definitions) {
    assert.equal(definition.profile, "core");
    assert.deepEqual(definition.requirementIds, ["MOLIT-TEST-001", "MOLIT-TEST-002"]);
  }
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
  }
  assert.equal(
    report.releaseEvidenceEligible,
    report.artifactLock.status === "verified"
      && report.requirementTraceability.gatePassed
      && report.fullCoverage.coverage.linkedRequirements
        === report.fullCoverage.coverage.executableRequirements,
  );
});
