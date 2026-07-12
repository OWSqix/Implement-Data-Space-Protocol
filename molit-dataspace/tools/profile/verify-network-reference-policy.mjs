#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  NETWORK_RUNTIME_CONTROL_BY_ERROR_CODE,
  networkReferenceKey,
  validateNetworkReferenceSet,
  validateStandardNodeLinkExtract,
} from "../../src/profile/network-reference-integrity.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(root, "profiles/molit-dcat-ap/releases/1.0.0-rc.1");
const schemaPath = path.join(root, "contracts/network-reference-policy.v1.schema.json");
const policyPath = path.join(releaseRoot, "policy/network-reference-policy.json");
const evidencePath = path.join(
  releaseRoot,
  "examples/source-evidence/standard-node-link-2026-07-01.json",
);
const lifecycleCasesPath = path.join(
  releaseRoot,
  "examples/source-evidence/network-edition-lifecycle-cases.json",
);
const lifecycleCasesSchemaPath = path.join(
  root,
  "contracts/network-edition-lifecycle-cases.v1.schema.json",
);
const runtimeControlsPath = path.join(
  releaseRoot,
  "requirements/network-runtime-controls.json",
);
const runtimeControlsSchemaPath = path.join(
  root,
  "contracts/network-runtime-controls.v1.schema.json",
);

const REQUIRED_RUNTIME_CONTROL_IDS = new Set([
  "MOLIT-NET-IDENTITY-001",
  "MOLIT-NET-LIFECYCLE-GLOBAL-001",
  "MOLIT-NET-TERMINAL-VALIDITY-GLOBAL-001",
  "MOLIT-NET-VALIDITY-GLOBAL-001",
]);
const REQUIRED_LIFECYCLE_CASE_IDS = new Set([
  "NETWORK-EDITION-HISTORY-VALID",
  "NETWORK-EDITION-CANDIDATE-VALID",
  "NETWORK-EDITION-SAME-KEY-CHECKSUM-CONFLICT",
  "NETWORK-EDITION-VALIDITY-OVERLAP",
  "NETWORK-EDITION-SAME-KEY-DUPLICATE",
  "NETWORK-EDITION-SUPERSEDED-WITHOUT-SUCCESSOR",
  "NETWORK-EDITION-EQUAL-BOUNDARY-OVERLAP",
  "NETWORK-EDITION-THREE-VERSION-HISTORY-VALID",
  "NETWORK-EDITION-ACTIVE-WITH-SUCCESSOR",
  "NETWORK-EDITION-CANDIDATE-WITH-SUCCESSOR",
  "NETWORK-EDITION-WITHDRAWN-WITH-SUCCESSOR",
  "NETWORK-EDITION-SUCCESSOR-NOT-FOUND",
  "NETWORK-EDITION-SUCCESSOR-IDENTITY-MISMATCH",
  "NETWORK-EDITION-SUCCESSOR-IDENTIFIER-MISMATCH",
  "NETWORK-EDITION-SELF-SUCCESSOR",
  "NETWORK-EDITION-SUCCESSOR-STATUS-INVALID",
  "NETWORK-EDITION-WITHDRAWN-WITHOUT-END",
  "NETWORK-EDITION-WITHDRAWN-VALID",
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function loadJson(file) {
  const bytes = await readFile(file);
  return { bytes, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
}

function edition(overrides = {}) {
  return {
    networkAuthority: "https://data.molit.go.kr/id/organization/molit",
    networkIdentifier: "MOLIT-STANDARD-NODE-LINK",
    networkVersion: "2026-07-01",
    networkSnapshotChecksum: "219020fac55f2faab1029ec9306563a00968f9b27f3910b80c534583b750b9ab",
    networkLifecycleStatus: "current",
    networkValidFrom: "2026-07-01",
    networkValidUntil: null,
    replacementKey: null,
    ...overrides,
  };
}

export function assertRequiredLifecycleCaseIds(caseIds) {
  const actual = new Set(caseIds);
  if (actual.size !== caseIds.length || actual.size !== REQUIRED_LIFECYCLE_CASE_IDS.size
    || [...REQUIRED_LIFECYCLE_CASE_IDS].some((id) => !actual.has(id))) {
    const error = new Error("network lifecycle case IDs do not match the required closed set");
    error.code = "NETWORK_LIFECYCLE_CASE_SET_INVALID";
    throw error;
  }
}

export async function verifyNetworkReferencePolicy() {
  const [
    schema,
    policy,
    evidence,
    lifecycleCases,
    lifecycleCasesSchema,
    runtimeControls,
    runtimeControlsSchema,
  ] = await Promise.all([
    loadJson(schemaPath),
    loadJson(policyPath),
    loadJson(evidencePath),
    loadJson(lifecycleCasesPath),
    loadJson(lifecycleCasesSchemaPath),
    loadJson(runtimeControlsPath),
    loadJson(runtimeControlsSchemaPath),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema.value);
  if (!validate(policy.value)) {
    const error = new Error(`network reference policy schema error: ${JSON.stringify(validate.errors)}`);
    error.code = "NETWORK_POLICY_SCHEMA_INVALID";
    throw error;
  }
  const validateCases = ajv.compile(lifecycleCasesSchema.value);
  if (!validateCases(lifecycleCases.value)) {
    const error = new Error(`network lifecycle cases schema error: ${JSON.stringify(validateCases.errors)}`);
    error.code = "NETWORK_LIFECYCLE_CASES_SCHEMA_INVALID";
    throw error;
  }
  const validateRuntimeControls = ajv.compile(runtimeControlsSchema.value);
  if (!validateRuntimeControls(runtimeControls.value)) {
    const error = new Error(
      `network runtime controls schema error: ${JSON.stringify(validateRuntimeControls.errors)}`,
    );
    error.code = "NETWORK_RUNTIME_CONTROLS_SCHEMA_INVALID";
    throw error;
  }
  const caseIds = lifecycleCases.value.cases.map(({ id }) => id);
  assertRequiredLifecycleCaseIds(caseIds);
  const casesById = new Map(lifecycleCases.value.cases.map((item) => [item.id, item]));
  const controlIds = runtimeControls.value.controls.map(({ controlId }) => controlId);
  if (new Set(controlIds).size !== controlIds.length
    || controlIds.length !== REQUIRED_RUNTIME_CONTROL_IDS.size
    || controlIds.some((id) => !REQUIRED_RUNTIME_CONTROL_IDS.has(id))) {
    const error = new Error("network runtime control IDs do not match the required closed set");
    error.code = "NETWORK_RUNTIME_CONTROL_SET_INVALID";
    throw error;
  }
  const coveredNegativeCases = new Set();
  const coveredPositiveCases = new Set();
  for (const control of runtimeControls.value.controls) {
    if (control.sourceClause !== control.controlId) {
      const error = new Error(`network runtime source clause mismatch: ${control.controlId}`);
      error.code = "NETWORK_RUNTIME_CONTROL_CLAUSE_MISMATCH";
      throw error;
    }
    for (const caseId of control.positiveCaseIds) {
      const positive = casesById.get(caseId);
      if (!positive || positive.expected !== "valid") {
        const error = new Error(`network runtime positive case is not valid: ${control.controlId}`);
        error.code = "NETWORK_RUNTIME_CONTROL_POSITIVE_CASE_INVALID";
        throw error;
      }
      coveredPositiveCases.add(caseId);
    }
    for (const caseId of control.negativeCaseIds) {
      const negative = casesById.get(caseId);
      if (!negative || negative.expected === "valid"
        || NETWORK_RUNTIME_CONTROL_BY_ERROR_CODE[negative.expected] !== control.controlId) {
        const error = new Error(
          `network runtime negative case is not bound to its diagnostic: ${control.controlId}/${caseId}`,
        );
        error.code = "NETWORK_RUNTIME_CONTROL_NEGATIVE_CASE_INVALID";
        throw error;
      }
      if (coveredNegativeCases.has(caseId)) {
        const error = new Error(`network runtime negative case has multiple controls: ${caseId}`);
        error.code = "NETWORK_RUNTIME_CONTROL_CASE_DUPLICATE";
        throw error;
      }
      coveredNegativeCases.add(caseId);
    }
  }
  const expectedNegativeCases = lifecycleCases.value.cases
    .filter(({ expected }) => expected !== "valid")
    .map(({ id }) => id);
  if (expectedNegativeCases.length !== coveredNegativeCases.size
    || expectedNegativeCases.some((id) => !coveredNegativeCases.has(id))) {
    const error = new Error("network runtime controls do not cover every invalid lifecycle case");
    error.code = "NETWORK_RUNTIME_CONTROL_COVERAGE_INCOMPLETE";
    throw error;
  }
  const expectedPositiveCases = lifecycleCases.value.cases
    .filter(({ expected }) => expected === "valid")
    .map(({ id }) => id);
  if (expectedPositiveCases.length !== coveredPositiveCases.size
    || expectedPositiveCases.some((id) => !coveredPositiveCases.has(id))) {
    const error = new Error("network runtime controls do not cover every valid lifecycle case");
    error.code = "NETWORK_RUNTIME_CONTROL_POSITIVE_COVERAGE_INCOMPLETE";
    throw error;
  }
  const fixtureErrorCodes = new Set(lifecycleCases.value.cases
    .filter(({ expected }) => expected !== "valid")
    .map(({ expected }) => expected));
  const productionMappedErrorCodes = Object.keys(NETWORK_RUNTIME_CONTROL_BY_ERROR_CODE);
  if (fixtureErrorCodes.size !== productionMappedErrorCodes.length
    || productionMappedErrorCodes.some((code) => !fixtureErrorCodes.has(code))) {
    const error = new Error(
      "network lifecycle fixtures do not cover the production diagnostic mapping",
    );
    error.code = "NETWORK_RUNTIME_DIAGNOSTIC_COVERAGE_INCOMPLETE";
    throw error;
  }
  const sourceSample = validateStandardNodeLinkExtract(evidence.value, policy.value);
  const successor = edition();
  const predecessorBase = edition({
    networkVersion: "2026-06-01",
    networkSnapshotChecksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    networkLifecycleStatus: "superseded",
    networkValidFrom: "2026-06-01",
    networkValidUntil: "2026-06-30",
  });
  const lifecycle = validateNetworkReferenceSet([{
    ...predecessorBase,
    replacementKey: networkReferenceKey(successor, policy.value),
  }, successor], policy.value);
  for (const item of lifecycleCases.value.cases) {
    if (item.expected === "valid") {
      validateNetworkReferenceSet(item.records, policy.value);
    } else {
      let observed = null;
      try {
        validateNetworkReferenceSet(item.records, policy.value);
      } catch (error) {
        observed = error.code;
      }
      if (observed !== item.expected) {
        const error = new Error(`network lifecycle case did not produce ${item.expected}: ${item.id}`);
        error.code = "NETWORK_LIFECYCLE_CASE_MISMATCH";
        throw error;
      }
    }
  }
  return {
    evidenceSha256: sha256(evidence.bytes),
    lifecycle,
    lifecycleCaseCount: lifecycleCases.value.cases.length,
    lifecycleCasesSha256: sha256(lifecycleCases.bytes),
    lifecycleCasesSchemaSha256: sha256(lifecycleCasesSchema.bytes),
    policySha256: sha256(policy.bytes),
    profileVersion: policy.value.profileVersion,
    runtimeControlCount: runtimeControls.value.controls.length,
    runtimeControlsSha256: sha256(runtimeControls.bytes),
    runtimeControlsSchemaSha256: sha256(runtimeControlsSchema.bytes),
    schemaSha256: sha256(schema.bytes),
    schemaVersion: "molit.network-reference-policy-verification/1",
    sourceSample,
    valid: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyNetworkReferencePolicy().then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
