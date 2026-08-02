#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const REGISTER_FILE = "governance/commercial-readiness-register.v1.json";
const REGISTER_SCHEMA_FILE = "contracts/commercial-readiness-register.v1.schema.json";
const RESULT_SCHEMA_FILE = "contracts/commercial-readiness-result.v1.schema.json";
const COMMERCIAL_EVIDENCE_PREFIX = "evidence/commercial-readiness/";
const REQUIRED_GATES = Object.freeze([
  "COM-BIL-001", "COM-CAT-001", "COM-CMP-001", "COM-DSP-001", "COM-HA-001",
  "COM-ID-001", "COM-LCM-001", "COM-OBS-001", "COM-OPS-001", "COM-POL-001",
  "COM-SLA-001", "COM-SUP-001", "COM-TEN-001", "COM-TRUST-001",
]);

export class CommercialReadinessEvaluationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CommercialReadinessEvaluationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CommercialReadinessEvaluationError(code, message);
}

async function readJson(filePath, label) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    fail("COMMERCIAL_EVIDENCE_UNREADABLE", `${label} cannot be read: ${error.code ?? error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch {
    fail("COMMERCIAL_EVIDENCE_INVALID_JSON", `${label} is not valid JSON`);
  }
}

function assertExactGateSet(gates) {
  const actual = gates.map(({ gateId }) => gateId).sort();
  if (JSON.stringify(actual) !== JSON.stringify(REQUIRED_GATES)) {
    fail("COMMERCIAL_GATE_SET_INVALID", "commercial readiness register does not contain the exact required Gate set");
  }
}

function assertUniqueBlockers(gates) {
  const blockerIds = gates.flatMap(({ blockers }) => blockers.map(({ id }) => id));
  if (new Set(blockerIds).size !== blockerIds.length) {
    fail("COMMERCIAL_BLOCKER_DUPLICATE", "commercial readiness blocker IDs must be globally unique");
  }
}

function resolveRepositoryPath(rootPath, relativePath, label, requiredPrefix = null) {
  if (requiredPrefix !== null && !relativePath.startsWith(requiredPrefix)) {
    fail("COMMERCIAL_EVIDENCE_LOCATION_INVALID", `${label} must be stored below ${requiredPrefix}`);
  }
  const candidate = path.resolve(rootPath, ...relativePath.split("/"));
  const relative = path.relative(rootPath, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("COMMERCIAL_EVIDENCE_LOCATION_INVALID", `${label} leaves the repository: ${relativePath}`);
  }
  return candidate;
}

async function regularEvidenceFile(rootPath, relativePath, label, requiredPrefix = null) {
  const candidate = resolveRepositoryPath(rootPath, relativePath, label, requiredPrefix);
  let stats;
  try {
    stats = await lstat(candidate);
  } catch (error) {
    fail("COMMERCIAL_EVIDENCE_MISSING", `${label} is missing: ${relativePath} (${error.code ?? error.message})`);
  }
  if (!stats.isFile()) fail("COMMERCIAL_EVIDENCE_NOT_REGULAR", `${label} is not a regular file: ${relativePath}`);
  return candidate;
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function assertEvidencePaths(gates, rootPath) {
  for (const gate of gates) {
    for (const relativePath of gate.evidencePaths) {
      await regularEvidenceFile(rootPath, relativePath, `${gate.gateId} supporting evidence`);
    }
  }
}

function instant(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail("COMMERCIAL_TIME_INVALID", `${label} is not a valid instant`);
  return parsed;
}

async function assertDigestReference(rootPath, reference, label, requiredPrefix = COMMERCIAL_EVIDENCE_PREFIX) {
  const filePath = await regularEvidenceFile(rootPath, reference.path, label, requiredPrefix);
  const actual = await sha256(filePath);
  if (actual !== reference.sha256) {
    fail("COMMERCIAL_EVIDENCE_DIGEST_MISMATCH", `${label} digest does not match: ${reference.path}`);
  }
  return filePath;
}

async function assertPassEvidence(gate, rootPath, validateResult, nowMs) {
  const seen = new Set();
  for (const reference of gate.resultEvidence) {
    if (seen.has(reference.path)) fail("COMMERCIAL_EVIDENCE_DUPLICATE", `${gate.gateId} repeats a result evidence path`);
    seen.add(reference.path);
    const resultPath = await assertDigestReference(rootPath, reference, `${gate.gateId} result evidence`);
    const result = await readJson(resultPath, `${gate.gateId} result evidence`);
    if (!validateResult(result)) {
      fail("COMMERCIAL_RESULT_INVALID", `${gate.gateId} result evidence violates its schema: ${JSON.stringify(validateResult.errors)}`);
    }
    if (result.gateId !== gate.gateId) {
      fail("COMMERCIAL_RESULT_GATE_MISMATCH", `${gate.gateId} result evidence is bound to ${result.gateId}`);
    }
    const startedAt = instant(result.startedAt, `${gate.gateId} startedAt`);
    const finishedAt = instant(result.finishedAt, `${gate.gateId} finishedAt`);
    const validUntil = instant(result.validUntil, `${gate.gateId} validUntil`);
    if (startedAt > finishedAt || finishedAt > nowMs || validUntil < nowMs || finishedAt > validUntil) {
      fail("COMMERCIAL_RESULT_TIME_INVALID", `${gate.gateId} result is future-dated, expired, or has an invalid execution interval`);
    }
    const evidencePath = await regularEvidenceFile(
      rootPath,
      result.evidencePath,
      `${gate.gateId} raw evidence`,
      COMMERCIAL_EVIDENCE_PREFIX,
    );
    if (await sha256(evidencePath) !== result.evidenceSha256) {
      fail("COMMERCIAL_EVIDENCE_DIGEST_MISMATCH", `${gate.gateId} raw evidence digest does not match: ${result.evidencePath}`);
    }
  }
}

async function assertNotApplicableApproval(gate, rootPath, nowMs) {
  const approval = gate.notApplicableApproval;
  const approvedAt = instant(approval.approvedAt, `${gate.gateId} not-applicable approvedAt`);
  const validUntil = instant(approval.validUntil, `${gate.gateId} not-applicable validUntil`);
  if (approvedAt > nowMs || approvedAt > validUntil || validUntil < nowMs) {
    fail("COMMERCIAL_NOT_APPLICABLE_EXPIRED", `${gate.gateId} not-applicable approval is future-dated, expired, or has an invalid interval`);
  }
  await assertDigestReference(rootPath, {
    path: approval.evidencePath,
    sha256: approval.evidenceSha256,
  }, `${gate.gateId} not-applicable approval`);
}

function compileSchema(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

export async function evaluateCommercialReadiness({
  now = new Date(),
  rootPath = root,
  register: suppliedRegister,
  registerSchema: suppliedRegisterSchema,
  resultSchema: suppliedResultSchema,
} = {}) {
  const nowDate = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(nowDate.getTime())) throw new TypeError("commercial readiness evaluation time is invalid");
  const [register, registerSchema, resultSchema] = await Promise.all([
    suppliedRegister ?? readJson(path.join(rootPath, REGISTER_FILE), "commercial readiness register"),
    suppliedRegisterSchema ?? readJson(path.join(rootPath, REGISTER_SCHEMA_FILE), "commercial readiness register schema"),
    suppliedResultSchema ?? readJson(path.join(rootPath, RESULT_SCHEMA_FILE), "commercial readiness result schema"),
  ]);
  const validateRegister = compileSchema(registerSchema);
  const validateResult = compileSchema(resultSchema);
  if (!validateRegister(register)) {
    fail("COMMERCIAL_REGISTER_INVALID", `invalid commercial readiness register: ${JSON.stringify(validateRegister.errors)}`);
  }
  assertExactGateSet(register.gates);
  assertUniqueBlockers(register.gates);
  const today = nowDate.toISOString().slice(0, 10);
  if (register.asOf > today) fail("COMMERCIAL_REGISTER_FUTURE", "commercial readiness register asOf is in the future");
  await assertEvidencePaths(register.gates, rootPath);
  for (const gate of register.gates) {
    if (gate.status === "pass") await assertPassEvidence(gate, rootPath, validateResult, nowDate.getTime());
    if (gate.status === "not-applicable") await assertNotApplicableApproval(gate, rootPath, nowDate.getTime());
  }
  const blockers = register.gates.flatMap((gate) => gate.blockers.map((blocker) => ({
    gateId: gate.gateId,
    phase: gate.phase,
    status: gate.status,
    ...blocker,
  }))).sort((left, right) => left.id.localeCompare(right.id));
  const unresolvedGates = register.gates
    .filter(({ status }) => !["pass", "not-applicable"].includes(status))
    .map(({ gateId, phase, status }) => ({ gateId, phase, status }));
  const statusCounts = Object.fromEntries(["open", "partial", "pass", "not-applicable"]
    .map((status) => [status, register.gates.filter((gate) => gate.status === status).length]));
  return Object.freeze({
    schemaVersion: "molit.commercial-readiness-status/1",
    asOf: register.asOf,
    evaluatedAt: nowDate.toISOString(),
    target: register.target,
    commercialReady: unresolvedGates.length === 0,
    decision: unresolvedGates.length === 0 ? "eligible" : "blocked",
    gateCounts: Object.freeze({
      total: register.gates.length,
      resolved: register.gates.length - unresolvedGates.length,
      unresolved: unresolvedGates.length,
      ...statusCounts,
    }),
    unresolvedGates,
    blockers,
  });
}

export async function runCommercialReadinessCli({
  evaluate = evaluateCommercialReadiness,
  write = (value) => process.stdout.write(value),
} = {}) {
  try {
    const status = await evaluate();
    write(`${JSON.stringify(status, null, 2)}\n`);
    return status.commercialReady ? 0 : 2;
  } catch (error) {
    if (!(error instanceof CommercialReadinessEvaluationError)) throw error;
    write(`${JSON.stringify({
      schemaVersion: "molit.commercial-readiness-status/1",
      target: "commercial-production",
      commercialReady: false,
      decision: "blocked",
      evaluationErrors: [{ code: error.code, message: error.message }],
    }, null, 2)}\n`);
    return 1;
  }
}

async function main() {
  process.exitCode = await runCommercialReadinessCli();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ code: "COMMERCIAL_STATUS_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  });
}
