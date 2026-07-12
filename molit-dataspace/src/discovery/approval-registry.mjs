import { digest } from "./stable-json.mjs";
import { invariant } from "./errors.mjs";
import {
  identifierTupleKey,
  isPlainObject,
  validateEvidenceIds,
  validateIdentifier,
  validateTimestamp,
} from "./validation.mjs";
import { validateApprovalRegistryDocument } from "./schema-validator.mjs";

const CATALOG_VISIBILITIES = new Set(["public", "qualified", "internal", "hidden"]);
const OFFERING_DECISIONS = new Set(["approved", "pending", "denied"]);

export function validateApprovalRegistry(registry) {
  validateApprovalRegistryDocument(registry);
  invariant(
    isPlainObject(registry),
    "INVALID_APPROVAL_REGISTRY",
    "approval registry must be an object",
  );
  invariant(
    registry.schemaVersion === "molit.approval-registry/1",
    "INVALID_APPROVAL_REGISTRY",
    "unsupported approval registry schemaVersion",
  );
  invariant(
    registry.trustMode === "synthetic-test-only",
    "UNSUPPORTED_TRUST_MODE",
    "S1 accepts only a synthetic-test-only approval registry",
  );
  validateIdentifier(registry.registryId, "approvalRegistry.registryId");
  invariant(
    Array.isArray(registry.entries) && registry.entries.length <= 20_000,
    "INVALID_APPROVAL_REGISTRY",
    "approval registry entries must be a bounded array",
  );

  const keys = new Set();
  const approvalIds = new Set();
  for (const [index, entry] of registry.entries.entries()) {
    const field = `approvalRegistry.entries[${index}]`;
    invariant(isPlainObject(entry), "INVALID_APPROVAL_ENTRY", `${field} must be an object`);
    const sourceSystemId = validateIdentifier(entry.sourceSystemId, `${field}.sourceSystemId`);
    const recordId = validateIdentifier(entry.recordId, `${field}.recordId`);
    invariant(
      typeof entry.resourceVersion === "string"
        && /^(0|[1-9]\d*)$/u.test(entry.resourceVersion)
        && entry.resourceVersion.length <= 64,
      "INVALID_APPROVAL_ENTRY",
      `${field}.resourceVersion must be a bounded decimal string`,
    );
    invariant(
      typeof entry.recordDigest === "string" && /^[a-f0-9]{64}$/u.test(entry.recordDigest),
      "INVALID_APPROVAL_ENTRY",
      `${field}.recordDigest must be a SHA-256 hex digest`,
    );
    const approvalId = validateIdentifier(entry.approvalId, `${field}.approvalId`);
    validateIdentifier(entry.approverId, `${field}.approverId`);
    validateTimestamp(entry.approvedAt, `${field}.approvedAt`);
    validateTimestamp(entry.validUntil, `${field}.validUntil`);
    invariant(
      Date.parse(entry.validUntil) > Date.parse(entry.approvedAt),
      "INVALID_APPROVAL_ENTRY",
      `${field}.validUntil must be after approvedAt`,
    );
    invariant(
      CATALOG_VISIBILITIES.has(entry.catalogVisibility),
      "INVALID_APPROVAL_ENTRY",
      `${field}.catalogVisibility is not supported`,
    );
    invariant(
      OFFERING_DECISIONS.has(entry.offeringDecision),
      "INVALID_APPROVAL_ENTRY",
      `${field}.offeringDecision is not supported`,
    );
    validateEvidenceIds(entry.evidenceIds, `${field}.evidenceIds`);

    const key = identifierTupleKey(sourceSystemId, recordId, entry.resourceVersion);
    invariant(
      !keys.has(key),
      "DUPLICATE_APPROVAL_ENTRY",
      "approval registry contains a duplicate source record version",
      { index },
    );
    keys.add(key);
    invariant(
      !approvalIds.has(approvalId),
      "DUPLICATE_APPROVAL_ID",
      "approval registry contains a duplicate approvalId",
      { index },
    );
    approvalIds.add(approvalId);
  }
  return registry;
}

export function indexApprovalRegistry(registry) {
  validateApprovalRegistry(registry);
  return {
    registryId: registry.registryId,
    entries: new Map(registry.entries.map((entry) => [
      identifierTupleKey(entry.sourceSystemId, entry.recordId, entry.resourceVersion),
      entry,
    ])),
  };
}

export function resolveApproval(index, {
  evaluatedAt,
  record,
  recordDigest,
  recordId,
  resourceVersion,
  sourceSystemId,
}) {
  const key = identifierTupleKey(sourceSystemId, recordId, resourceVersion);
  const entry = index.entries.get(key);

  if (!entry) {
    return unverifiedApproval(index.registryId, "APPROVAL_ENTRY_MISSING");
  }
  const observedDigest = recordDigest ?? digest(record);
  if (observedDigest !== entry.recordDigest) {
    return unverifiedApproval(index.registryId, "APPROVED_DIGEST_MISMATCH");
  }
  if (Date.parse(evaluatedAt) < Date.parse(entry.approvedAt)) {
    return unverifiedApproval(
      index.registryId,
      "APPROVAL_NOT_YET_VALID",
      entry.approvedAt,
    );
  }
  if (Date.parse(evaluatedAt) > Date.parse(entry.validUntil)) {
    return unverifiedApproval(index.registryId, "APPROVAL_EXPIRED");
  }

  return {
    approvalId: entry.approvalId,
    approvalEntryDigest: digest(entry),
    approvedAt: entry.approvedAt,
    approverId: entry.approverId,
    catalogVisibility: entry.catalogVisibility,
    evidenceIds: [...entry.evidenceIds],
    offeringDecision: entry.offeringDecision,
    registryId: index.registryId,
    status: "verified-synthetic",
    syntheticOnly: true,
    validUntil: entry.validUntil,
  };
}

function unverifiedApproval(registryId, reason, nextEvaluationAt = undefined) {
  return {
    catalogVisibility: "internal",
    evidenceIds: [],
    offeringDecision: "pending",
    reason,
    ...(nextEvaluationAt ? { nextEvaluationAt } : {}),
    registryId,
    status: "unverified",
    syntheticOnly: true,
  };
}
