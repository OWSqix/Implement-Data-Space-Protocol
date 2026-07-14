import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { evaluateCommercialReadiness } from "../../tools/commercial/readiness-status.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const [register, schema, resultSchema] = await Promise.all([
  readFile(path.join(root, "governance/commercial-readiness-register.v1.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "contracts/commercial-readiness-register.v1.schema.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "contracts/commercial-readiness-result.v1.schema.json"), "utf8").then(JSON.parse),
]);

const evaluationTime = new Date("2026-07-14T12:00:00.000Z");

function compile(candidateSchema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(candidateSchema);
}

function copyRegisterWithoutSupportingEvidence() {
  const copy = structuredClone(register);
  for (const gate of copy.gates) gate.evidencePaths = [];
  return copy;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function writeRepositoryFile(rootPath, relativePath, content) {
  const target = path.join(rootPath, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return sha256(content);
}

function gateResult(gateId, evidencePath, evidenceSha256) {
  return {
    schemaVersion: "molit.commercial-readiness-result/1",
    gateId,
    status: "pass",
    sourceCommit: "a".repeat(40),
    artifactDigests: [`sha256:${"b".repeat(64)}`],
    environmentDigest: `sha256:${"c".repeat(64)}`,
    startedAt: "2026-07-14T10:00:00.000Z",
    finishedAt: "2026-07-14T11:00:00.000Z",
    validUntil: "2026-08-14T11:00:00.000Z",
    testProfileId: "commercial-lifecycle-v1",
    evidencePath,
    evidenceSha256,
  };
}

test("COMMERCIAL-REGISTER-001: the product Gate register is strict and complete", () => {
  const validate = compile(schema);
  assert.equal(validate(register), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(register.gates.length, 14);
  assert.equal(new Set(register.gates.map(({ gateId }) => gateId)).size, 14);
  assert.ok(register.gates.some(({ gateId }) => gateId === "COM-CMP-001"));
});

test("COMMERCIAL-REGISTER-002: unresolved commercial claims fail closed", async () => {
  const status = await evaluateCommercialReadiness();
  assert.equal(status.commercialReady, false);
  assert.equal(status.decision, "blocked");
  assert.deepEqual(status.gateCounts, {
    total: 14,
    resolved: 0,
    unresolved: 14,
    open: 4,
    partial: 10,
    pass: 0,
    "not-applicable": 0,
  });
  assert.equal(status.blockers.length, 16);
  assert.ok(status.unresolvedGates.some(({ gateId }) => gateId === "COM-LCM-001"));
  assert.ok(status.unresolvedGates.some(({ gateId }) => gateId === "COM-CMP-001"));
  assert.ok(status.blockers.some(({ id }) => id === "COM-DSP-FINAL-IMAGE-TCK"));
});

test("COMMERCIAL-REGISTER-003: pass cannot be asserted without result evidence", () => {
  const candidate = structuredClone(register);
  const gate = candidate.gates.find(({ gateId }) => gateId === "COM-LCM-001");
  gate.status = "pass";
  gate.blockers = [];
  gate.resultEvidence = [];
  const validate = compile(schema);
  assert.equal(validate(candidate), false);
});

test("COMMERCIAL-REGISTER-004: not-applicable is restricted to the billing Gate", () => {
  const candidate = structuredClone(register);
  const gate = candidate.gates.find(({ gateId }) => gateId === "COM-TEN-001");
  gate.status = "not-applicable";
  gate.blockers = [];
  gate.notApplicableApproval = {
    decisionId: "decision-001",
    approvedBy: "commercial-governance",
    approvedAt: "2026-07-14T09:00:00.000Z",
    reason: "The test asserts that a mandatory Gate cannot be waived.",
    scope: "Tenant isolation remains mandatory for all commercial plans.",
    validUntil: "2026-08-14T09:00:00.000Z",
    evidencePath: "evidence/commercial-readiness/approvals/decision-001.json",
    evidenceSha256: "d".repeat(64),
  };
  const validate = compile(schema);
  assert.equal(validate(candidate), false);
});

test("COMMERCIAL-REGISTER-005: a result digest mismatch fails closed", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "molit-commercial-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  const candidate = copyRegisterWithoutSupportingEvidence();
  const gate = candidate.gates.find(({ gateId }) => gateId === "COM-LCM-001");
  const rawPath = "evidence/commercial-readiness/raw/lifecycle.json";
  const resultPath = "evidence/commercial-readiness/results/lifecycle.json";
  const rawContent = '{"created":30,"orphans":0}\n';
  const rawSha256 = await writeRepositoryFile(rootPath, rawPath, rawContent);
  const resultContent = `${JSON.stringify(gateResult(gate.gateId, rawPath, rawSha256), null, 2)}\n`;
  await writeRepositoryFile(rootPath, resultPath, resultContent);
  gate.status = "pass";
  gate.evidencePaths = [rawPath];
  gate.resultEvidence = [{ path: resultPath, sha256: "0".repeat(64) }];
  gate.blockers = [];

  await assert.rejects(
    evaluateCommercialReadiness({ now: evaluationTime, rootPath, register: candidate, registerSchema: schema, resultSchema }),
    (error) => error.code === "COMMERCIAL_EVIDENCE_DIGEST_MISMATCH",
  );
});

test("COMMERCIAL-REGISTER-006: an expired not-applicable approval fails closed", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "molit-commercial-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  const candidate = copyRegisterWithoutSupportingEvidence();
  const gate = candidate.gates.find(({ gateId }) => gateId === "COM-BIL-001");
  const approvalPath = "evidence/commercial-readiness/approvals/billing-scope.json";
  const approvalContent = '{"decision":"exclude-paid-transactions"}\n';
  const approvalSha256 = await writeRepositoryFile(rootPath, approvalPath, approvalContent);
  gate.status = "not-applicable";
  gate.blockers = [];
  gate.notApplicableApproval = {
    decisionId: "billing-scope-001",
    approvedBy: "commercial-governance",
    approvedAt: "2025-01-01T00:00:00.000Z",
    reason: "Paid transactions were excluded from the approved product scope.",
    scope: "The service supports governed data exchange without payment processing.",
    validUntil: "2026-01-01T00:00:00.000Z",
    evidencePath: approvalPath,
    evidenceSha256: approvalSha256,
  };

  await assert.rejects(
    evaluateCommercialReadiness({ now: evaluationTime, rootPath, register: candidate, registerSchema: schema, resultSchema }),
    (error) => error.code === "COMMERCIAL_NOT_APPLICABLE_EXPIRED",
  );
});

test("COMMERCIAL-REGISTER-007: a valid result resolves only its bound Gate", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "molit-commercial-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  const candidate = copyRegisterWithoutSupportingEvidence();
  const gate = candidate.gates.find(({ gateId }) => gateId === "COM-LCM-001");
  const rawPath = "evidence/commercial-readiness/raw/lifecycle.json";
  const resultPath = "evidence/commercial-readiness/results/lifecycle.json";
  const rawContent = '{"created":30,"orphans":0}\n';
  const rawSha256 = await writeRepositoryFile(rootPath, rawPath, rawContent);
  const resultContent = `${JSON.stringify(gateResult(gate.gateId, rawPath, rawSha256), null, 2)}\n`;
  const resultSha256 = await writeRepositoryFile(rootPath, resultPath, resultContent);
  gate.status = "pass";
  gate.evidencePaths = [rawPath];
  gate.resultEvidence = [{ path: resultPath, sha256: resultSha256 }];
  gate.blockers = [];

  const status = await evaluateCommercialReadiness({
    now: evaluationTime,
    rootPath,
    register: candidate,
    registerSchema: schema,
    resultSchema,
  });
  assert.equal(status.commercialReady, false);
  assert.equal(status.gateCounts.pass, 1);
  assert.equal(status.gateCounts.unresolved, 13);
  assert.equal(status.unresolvedGates.some(({ gateId }) => gateId === gate.gateId), false);
});
