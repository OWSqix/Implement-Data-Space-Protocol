import { readFile } from "node:fs/promises";

import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { digest } from "../discovery/stable-json.mjs";
import { assertCleanUri, rejectSecretMaterial, validateContract } from "./contracts.mjs";

async function readRegistryDocument(path) {
  try {
    const registry = JSON.parse(await readFile(path, "utf8"));
    await validateContract("approvalDecisionRegistry", registry);
    return registry;
  } catch (error) {
    const causeCode = typeof error?.code === "string" ? error.code : error instanceof SyntaxError ? "JSON_INVALID" : "READ_FAILED";
    throw new RuntimeError("DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED", "trusted approval decision registry could not be read, parsed, or validated", { causeCode });
  }
}

function milliseconds(value, field) {
  const result = Date.parse(value);
  assertRuntime(Number.isFinite(result), "DSAAS_APPROVAL_REGISTRY_STALE", `${field} is not a valid date-time`);
  return result;
}

function assertFresh(registry, now, maxAgeSeconds) {
  const nowMs = now instanceof Date ? now.getTime() : milliseconds(now, "current time");
  const issuedAt = milliseconds(registry.issuedAt, "approval registry issuedAt");
  const validUntil = milliseconds(registry.validUntil, "approval registry validUntil");
  assertRuntime(issuedAt <= nowMs && nowMs <= validUntil && nowMs - issuedAt <= maxAgeSeconds * 1000, "DSAAS_APPROVAL_REGISTRY_STALE", "trusted approval decision registry is expired, not yet valid, or older than the configured maximum age", {
    issuedAt: registry.issuedAt,
    maxAgeSeconds,
    validUntil: registry.validUntil,
  });
  return nowMs;
}

export async function loadApprovalDecisionRegistry(path, expectedSha256, { clock = () => new Date(), maxAgeSeconds = 86_400 } = {}) {
  const registry = await readRegistryDocument(path);
  rejectSecretMaterial(registry);
  assertCleanUri(registry.registryId, "$.registryId");
  const actualSha256 = digest(registry);
  assertRuntime(actualSha256 === expectedSha256, "DSAAS_APPROVAL_REGISTRY_DIGEST_MISMATCH", "trusted approval decision registry digest does not match configuration", {
    actualSha256,
    expectedSha256,
  });
  assertFresh(registry, clock(), maxAgeSeconds);
  const byId = new Map();
  for (const decision of registry.decisions) {
    if (byId.has(decision.decisionId)) throw new RuntimeError("DSAAS_APPROVAL_REGISTRY_DUPLICATE", "trusted approval registry contains a duplicate decisionId", { decisionId: decision.decisionId });
    byId.set(decision.decisionId, structuredClone(decision));
  }
  return Object.freeze({
    actualSha256,
    byId,
    issuedAt: registry.issuedAt,
    maxAgeSeconds,
    registry: structuredClone(registry),
    status: registry.status,
    validUntil: registry.validUntil,
  });
}

export function verifyApprovalDecision(approvalRegistry, { approval, dataspaceId, participant }, now = new Date()) {
  assertRuntime(approvalRegistry?.status === "READY", "DSAAS_EXTERNAL_APPROVAL_GATE_BLOCKED", "external institutional approval is not connected; participant approval remains release-gated");
  const registry = approvalRegistry.registry ?? approvalRegistry;
  const maxAgeSeconds = approvalRegistry.maxAgeSeconds ?? 86_400;
  const nowMs = assertFresh(registry, now, maxAgeSeconds);
  const decision = approvalRegistry.byId.get(approval.decisionId);
  assertRuntime(decision, "DSAAS_APPROVAL_DECISION_NOT_TRUSTED", "approval decision is absent from the trusted decision registry", { decisionId: approval.decisionId });
  assertRuntime(decision.status === "APPROVED", "DSAAS_APPROVAL_DECISION_NOT_APPROVED", "trusted approval decision is not approved", { decisionId: approval.decisionId, status: decision.status });
  assertRuntime(decision.dataspaceId === dataspaceId
    && decision.participantId === participant.spec.participantId
    && decision.organizationId === participant.spec.organizationId
    && decision.evidenceSha256 === approval.evidenceSha256,
  "DSAAS_APPROVAL_DECISION_MISMATCH", "trusted approval decision does not bind the submitted membership and evidence", { decisionId: approval.decisionId });
  assertRuntime(milliseconds(decision.decidedAt, "approval decision decidedAt") <= nowMs
    && nowMs <= milliseconds(decision.validUntil, "approval decision validUntil"),
  "DSAAS_APPROVAL_DECISION_EXPIRED", "trusted approval decision is not currently valid", { decisionId: approval.decisionId });
  return structuredClone({
    authority: decision.authority,
    decidedAt: decision.decidedAt,
    decisionId: decision.decisionId,
    provenanceSha256: decision.provenanceSha256,
    registrySha256: approvalRegistry.actualSha256,
    validUntil: decision.validUntil,
  });
}
