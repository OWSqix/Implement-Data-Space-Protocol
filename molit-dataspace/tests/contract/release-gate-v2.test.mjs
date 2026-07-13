import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  assertReleaseAcceptanceRegister,
  calculateReleaseEligibility,
  evaluateReleaseGateV2,
  releaseGateV2ExitCode,
  validateRcMatrixEvidence,
} from "../../tools/release/release-gate-v2.mjs";
import {
  loadProfileRelease,
  verifyArtifactLock,
} from "../../src/profile/registry.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const version = "1.0.0-rc.1";
const [schema, register, report] = await Promise.all([
  readFile(path.join(root, "contracts/release-gate-status.v2.schema.json"), "utf8")
    .then(JSON.parse),
  readFile(path.join(
    root,
    "profiles/molit-dcat-ap/releases/1.0.0-rc.1/release-acceptance.json",
  ), "utf8").then(JSON.parse),
  evaluateReleaseGateV2(version),
]);

test("RELEASE-GATE-V2-001: RC report satisfies the v2 machine contract", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(report), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(report.schemaVersion, "molit.release-gate-status/2");
  assert.equal(report.profileVersion, version);
  assert.equal(report.candidateDecision, report.candidateEligible ? "eligible" : "blocked");
  assert.equal(
    report.recommendationDecision,
    report.recommendationEligible ? "eligible" : "blocked",
  );
  assert.match(report.decisionDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(report.checks.acceptanceRegister.status, "passed");
});

test("RELEASE-GATE-V2-002: institutional and adapter scopes cannot block Core candidate", () => {
  for (const blocker of report.blockers.filter(({ scope }) => scope === "institutional")) {
    assert.equal(blocker.blocksCandidate, false, blocker.id);
    assert.equal(blocker.blocksRecommendation, true, blocker.id);
  }
  assert.equal(
    report.blockers.some(({ scope }) => scope === "interoperability-pack"),
    false,
  );
  if (report.checks.git.status === "failed") {
    assert.ok(report.blockers.some(({ id }) => id === "RA-GIT"));
  }
  if (report.checks.artifactLock.status === "failed") {
    assert.ok(report.blockers.some(({ id }) => id === "RA-LOCK"));
  }
  if (report.checks.requirementTraceability.status === "failed") {
    assert.ok(report.blockers.some(({ id }) => id === "RA-REQUIREMENTS"));
  }
});

test("RELEASE-GATE-V2-003: candidate and recommendation eligibility are independent", () => {
  const synthetic = {
    items: [
      {
        id: "RA-CORE",
        scope: "profile-core",
        severity: "P0",
        status: "fixed",
        blocksCandidate: false,
        blocksRecommendation: false,
      },
      {
        id: "RA-INSTITUTION",
        scope: "institutional",
        severity: "P0",
        status: "blocked-external-evidence",
        blocksCandidate: false,
        blocksRecommendation: true,
      },
      {
        id: "RA-ADAPTER",
        scope: "interoperability-pack",
        severity: "P2",
        status: "open",
        blocksCandidate: false,
        blocksRecommendation: false,
      },
    ],
  };
  const institutionalOnly = calculateReleaseEligibility(synthetic);
  assert.equal(institutionalOnly.candidateEligible, true);
  assert.equal(institutionalOnly.recommendationEligible, false);
  assert.equal(releaseGateV2ExitCode(institutionalOnly), 2);
  assert.deepEqual(institutionalOnly.blockers.map(({ id }) => id), ["RA-INSTITUTION"]);

  synthetic.items[0] = {
    ...synthetic.items[0],
    status: "open",
    blocksCandidate: true,
    blocksRecommendation: true,
  };
  const coreBlocked = calculateReleaseEligibility(synthetic);
  assert.equal(coreBlocked.candidateEligible, false);
  assert.equal(coreBlocked.recommendationEligible, false);

  const eligible = calculateReleaseEligibility({ items: [synthetic.items[2]] });
  assert.equal(eligible.candidateEligible, true);
  assert.equal(eligible.recommendationEligible, true);
  assert.equal(releaseGateV2ExitCode(eligible), 0);
});

test("RELEASE-GATE-V2-004: invalid scope flags and duplicate items fail closed", async () => {
  const duplicate = structuredClone(register);
  duplicate.items.push(structuredClone(duplicate.items[0]));
  await assert.rejects(
    assertReleaseAcceptanceRegister(duplicate, version),
    (error) => error.code === "INVALID_RELEASE_ACCEPTANCE_REGISTER",
  );

  const institutional = structuredClone(register);
  institutional.items.find(({ scope }) => scope === "institutional").blocksCandidate = true;
  await assert.rejects(
    assertReleaseAcceptanceRegister(institutional, version),
    (error) => error.code === "INVALID_RELEASE_ACCEPTANCE_REGISTER",
  );

  const adapter = structuredClone(register);
  const adapterItem = adapter.items.find(({ scope }) => scope === "interoperability-pack");
  adapterItem.blocksRecommendation = true;
  await assert.rejects(
    assertReleaseAcceptanceRegister(adapter, version),
    (error) => error.code === "INVALID_RELEASE_ACCEPTANCE_REGISTER",
  );

  const deferredCore = structuredClone(register);
  const coreItem = deferredCore.items.find(({ scope }) => scope === "profile-core");
  coreItem.status = "deferred-nonblocking";
  coreItem.blocksCandidate = false;
  coreItem.blocksRecommendation = false;
  await assert.rejects(
    assertReleaseAcceptanceRegister(deferredCore, version),
    (error) => error.code === "INVALID_RELEASE_ACCEPTANCE_REGISTER",
  );

  const missingInstitutionalGate = structuredClone(register);
  missingInstitutionalGate.items = missingInstitutionalGate.items.filter(({ id }) => (
    id !== "RA-NAMESPACE"
  ));
  await assert.rejects(
    assertReleaseAcceptanceRegister(missingInstitutionalGate, version),
    (error) => error.code === "INVALID_RELEASE_ACCEPTANCE_REGISTER"
      && error.details.missingRequiredItems.includes("RA-NAMESPACE"),
  );

  const selfApprovedInstitutionalGate = structuredClone(register);
  const namespace = selfApprovedInstitutionalGate.items.find(({ id }) => id === "RA-NAMESPACE");
  namespace.status = "fixed";
  namespace.blocksRecommendation = false;
  await assert.rejects(
    assertReleaseAcceptanceRegister(selfApprovedInstitutionalGate, version),
    (error) => error.code === "INVALID_RELEASE_ACCEPTANCE_REGISTER"
      && error.details.policyMismatches.includes("RA-NAMESPACE"),
  );
});

test("RELEASE-GATE-V2-005: an unsupported fixed claim becomes an evidence blocker", () => {
  const fixedCore = register.items.find((item) => (
    item.scope === "profile-core" && item.status === "fixed"
  ));
  const eligibility = calculateReleaseEligibility(register, {
    fixedEvidenceFailures: [fixedCore.id],
  });
  const blocker = eligibility.blockers.find(({ id }) => id === fixedCore.id);
  assert.equal(blocker.status, "evidence-invalid");
  assert.equal(blocker.blocksCandidate, true);
  assert.equal(blocker.blocksRecommendation, true);
});

test("RELEASE-GATE-V2-006: CLI exits 2 for a valid blocked RC decision", () => {
  const result = spawnSync(process.execPath, [
    "tools/release/release-gate.mjs",
    "--version",
    version,
  ], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    // The RC gate executes every allowlisted fixed-evidence command.  The
    // ontology, upstream-engine and serialization checks intentionally run in
    // separate processes, so their aggregate runtime can exceed two minutes
    // even when no individual command reaches its own timeout.
    timeout: 600_000,
    windowsHide: true,
  });
  assert.equal(result.status, 2, result.stderr);
  const cliReport = JSON.parse(result.stdout);
  assert.equal(cliReport.schemaVersion, "molit.release-gate-status/2");
  assert.equal(cliReport.recommendationEligible, false);
  assert.equal(cliReport.recommendationDecision, "blocked");
});

test("RELEASE-GATE-V2-007: malformed CLI input returns an indeterminate v2 report", () => {
  const result = spawnSync(process.execPath, [
    "tools/release/release-gate.mjs",
    "--version",
    "../escape",
  ], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(result.status, 1, result.stderr);
  const invalid = JSON.parse(result.stdout);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(invalid), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(invalid.schemaVersion, "molit.release-gate-status/2");
  assert.equal(invalid.candidateDecision, "indeterminate");
  assert.equal(invalid.recommendationDecision, "indeterminate");
  assert.equal(invalid.blockers[0].id, "RELEASE-GATE-INPUT");
});

test("RELEASE-GATE-V2-008: RC matrix evidence is bound to the current artifact lock", async () => {
  const [evidence, release] = await Promise.all([
    readFile(path.join(root, "evidence/validators/molit-rc-shacl-matrix.v1.json")),
    loadProfileRelease(version),
  ]);
  const verification = await verifyArtifactLock(release);
  const { createHash } = await import("node:crypto");
  const lockSha256 = createHash("sha256").update(verification.lockBytes).digest("hex");
  assert.equal(await validateRcMatrixEvidence(evidence, {
    artifactLockSha256: lockSha256,
  }), true);

  const tampered = JSON.parse(evidence.toString("utf8"));
  tampered.gatePassed = false;
  assert.equal(await validateRcMatrixEvidence(
    Buffer.from(JSON.stringify(tampered), "utf8"),
    { artifactLockSha256: lockSha256 },
  ), false);

  const truncated = JSON.parse(evidence.toString("utf8"));
  truncated.cases = truncated.cases.slice(0, 1);
  truncated.requirementCoverage.deduplicatedFixtures = 1;
  truncated.requirementCoverage.requirements = 1;
  assert.equal(await validateRcMatrixEvidence(
    Buffer.from(JSON.stringify(truncated), "utf8"),
    { artifactLockSha256: lockSha256 },
  ), false);

  const renamedEngines = JSON.parse(evidence.toString("utf8"));
  renamedEngines.cases[0].engines = {
    a: renamedEngines.cases[0].engines.jena,
    b: renamedEngines.cases[0].engines.node,
    c: renamedEngines.cases[0].engines.pyshacl,
  };
  assert.equal(await validateRcMatrixEvidence(
    Buffer.from(JSON.stringify(renamedEngines), "utf8"),
    { artifactLockSha256: lockSha256 },
  ), false);

  const falsifiedStaticCoverage = JSON.parse(evidence.toString("utf8"));
  falsifiedStaticCoverage.requirementCoverage.bundleCoverage.pairs[0].shapeFileSha256
    = "0".repeat(64);
  assert.equal(await validateRcMatrixEvidence(
    Buffer.from(JSON.stringify(falsifiedStaticCoverage), "utf8"),
    { artifactLockSha256: lockSha256 },
  ), false);
});
