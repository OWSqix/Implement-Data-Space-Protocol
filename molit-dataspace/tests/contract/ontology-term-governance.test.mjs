import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyOntologyTermGovernance } from "../../tools/profile/verify-ontology-term-governance.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(
  root,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "1.0.0-rc.1",
);
const checkedInPath = path.join(releaseRoot, "ontology", "term-governance.json");

async function withMutatedRegister(t, mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-term-governance-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const register = JSON.parse(await readFile(checkedInPath, "utf8"));
  mutate(register);
  const registerPath = path.join(directory, "term-governance.json");
  await writeFile(registerPath, `${JSON.stringify(register, null, 2)}\n`, "utf8");
  return verifyOntologyTermGovernance({ registerPath, releaseRoot });
}

test("ONTO-GOV-001: all 40 local terms have machine governance records", async () => {
  const report = await verifyOntologyTermGovernance({ releaseRoot });
  assert.equal(report.gatePassed, true, JSON.stringify(report.findings, null, 2));
  assert.deepEqual(report.summary, {
    blockedEvidence: 0,
    completeEvidence: 40,
    findings: 0,
    terms: 40,
  });
  assert.equal(report.registryStatus, "candidate");
});

test("ONTO-GOV-002: a missing per-term reuse reason fails closed", async (t) => {
  const report = await withMutatedRegister(t, (register) => {
    register.terms[0].reuseReason = "";
  });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some(({ code }) => code === "REGISTER_SCHEMA"));
});

test("ONTO-GOV-003: declared domain and range cannot drift from OWL", async (t) => {
  const report = await withMutatedRegister(t, (register) => {
    const term = register.terms.find(({ localName }) => localName === "observationUnit");
    term.range.values = ["http://www.w3.org/2001/XMLSchema#string"];
  });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some(({ code }) => code === "DOMAIN_RANGE_DRIFT"));
});

test("ONTO-GOV-004: unrelated fixtures cannot close a term blocker", async (t) => {
  const report = await withMutatedRegister(t, (register) => {
    const source = register.terms.find(({ localName }) => localName === "networkVersion");
    const target = register.terms.find(({ localName }) => localName === "networkValidUntil");
    target.positiveEvidence = structuredClone(source.positiveEvidence);
    target.negativeEvidence = structuredClone(source.negativeEvidence);
    target.evidenceStatus = "complete";
    target.blockers = [];
  });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some(({ code }) => (
    code === "POSITIVE_EVIDENCE_DOES_NOT_EXERCISE_TERM"
  )));
});

test("ONTO-GOV-005: deprecated terms retain their replacement IRIs", async (t) => {
  const report = await withMutatedRegister(t, (register) => {
    const term = register.terms.find(({ localName }) => localName === "TransferableDataset");
    term.deprecation.replacements = [];
  });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some(({ code }) => code === "DEPRECATION_DRIFT"));
});

test("ONTO-GOV-006: evidence cannot escape the release or resolve to a non-file", async (t) => {
  const report = await withMutatedRegister(t, (register) => {
    const term = register.terms.find(({ localName }) => localName === "networkValidUntil");
    term.positiveEvidence[0].dataPath = "../../../../package.json";
    const directoryTerm = register.terms.find(({ localName }) => localName === "qualityLossNote");
    directoryTerm.positiveEvidence[0].dataPath = "examples/unit/ontology-term-governance/valid";
  });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some(({ code }) => code === "REGISTER_SCHEMA"));
  const unreadable = report.findings.filter(({ code }) => code === "UNIT_EVIDENCE_UNREADABLE");
  assert.ok(unreadable.some(({ message }) => message.includes("release-relative path")));
  assert.ok(unreadable.some(({ message }) => message.includes("regular file")));
});

test("ONTO-GOV-007: every term must retain the full-inventory competency question", async (t) => {
  const report = await withMutatedRegister(t, (register) => {
    register.terms[0].competencyQuestionIds = ["CQ-GOV-01"];
  });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some(({ code }) => code === "TERM_COMPETENCY_COVERAGE"));
});

test("ONTO-GOV-008: semantic competency coverage cannot be empty or unrelated", async (t) => {
  const report = await withMutatedRegister(t, (register) => {
    const missing = register.terms.find(({ localName }) => localName === "networkElementType");
    missing.competencyQuestionIds = ["CQ-ONTO-TERM-01"];
    const unrelated = register.terms.find(({ localName }) => localName === "spatialDisclosureLevel");
    unrelated.competencyQuestionIds = ["CQ-ONTO-TERM-01", "CQ-OBS-01"];
  });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some(({ code }) => code === "TERM_SEMANTIC_COMPETENCY_MISSING"));
  assert.ok(report.findings.some(({ code }) => code === "TERM_SEMANTIC_QUERY_REFERENCE"));
});
