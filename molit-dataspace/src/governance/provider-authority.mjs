import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import canonicalize from "canonicalize";

const ALLOWED_ACTIONS = new Set([
  "catalog-publish",
  "contract-negotiate",
  "data-transfer",
  "delegate",
]);
const REQUEST_KEYS = [
  "action",
  "assetId",
  "decisionRequestId",
  "evaluatedAt",
  "participantId",
  "policyEnforcementPointId",
  "providerId",
  "sourceSystemId",
];
const registrySchema = JSON.parse(readFileSync(new URL(
  "../../contracts/provider-authority-registry.v1.schema.json",
  import.meta.url,
), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateRegistry = ajv.compile(registrySchema);
const RECEIPT_KEYS = [
  "action",
  "assetId",
  "authorityId",
  "basisArtifactSha256",
  "canonicalization",
  "decisionArtifactSha256",
  "decisionRequestId",
  "evidenceId",
  "entrySha256",
  "evaluatedAt",
  "keyId",
  "participantId",
  "payloadSha256",
  "policyEnforcementPointId",
  "providerId",
  "registryAsOf",
  "registrySha256",
  "schemaVersion",
  "signatureRef",
  "sourceSystemId",
  "trustAnchorId",
  "verifiedAt",
  "verificationArtifactSha256",
  "verifierId",
];
// Detached proof location and proof bytes are added after the signing digest
// exists. Excluding those two fields avoids a receipt-hash/signature-hash
// cycle; every authorization and verifier identity field remains signed.
const RECEIPT_SIGNED_KEYS = RECEIPT_KEYS.filter((key) => (
  key !== "signatureRef" && key !== "verificationArtifactSha256"
));
const DID_ID_COMPONENT = String.raw`(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})+`;
const DID_IDENTITY = new RegExp(
  `^did:[a-z0-9]+:${DID_ID_COMPONENT}(?::${DID_ID_COMPONENT})*$`,
  "u",
);

function sha256Json(value) {
  const encoded = canonicalize(value);
  if (typeof encoded !== "string") throw new Error("RFC 8785 canonicalization failed");
  return createHash("sha256").update(encoded, "utf8").digest("hex");
}

function strictRfc3339(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.](\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const [year, month, day, hour, minute, second] = [
    yearText, monthText, dayText, hourText, minuteText, secondText,
  ].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z") {
    // RFC 3339 uses -00:00 for an unknown local offset. Authorization
    // comparisons require a known instant, so this profile rejects it.
    if (zone === "-00:00") return false;
    const [offsetHour, offsetMinute] = zone.slice(1).split(":").map(Number);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function strictTimestamp(value) {
  return strictRfc3339(value) ? Date.parse(value) : Number.NaN;
}

function validHttpsIdentity(value) {
  if (typeof value !== "string"
    || !value.startsWith("https://")
    || !/^[\x21-\x7E]+$/u.test(value)
    || value.includes("\\")
    || /%(?![0-9A-Fa-f]{2})/u.test(value)) return false;
  const authority = value.slice("https://".length).split(/[/?#]/u, 1)[0];
  if (!authority || authority.includes("@")) return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname;
    const dnsLikeHost = hostname.startsWith("[")
      ? hostname
      : hostname.replace(/[.]$/u, "");
    return parsed.protocol === "https:"
      && parsed.origin !== "null"
      && !parsed.username
      && !parsed.password
      && dnsLikeHost.length > 0
      && (hostname.startsWith("[") || !dnsLikeHost.split(".").includes(""));
  } catch {
    return false;
  }
}

function validDidIdentity(value) {
  if (typeof value !== "string" || !/^[\x21-\x7E]+$/u.test(value)) return false;
  return DID_IDENTITY.test(value);
}

function validIdentityIdentifier(value) {
  return validHttpsIdentity(value) || validDidIdentity(value);
}

function validLocalIdentifier(value) {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 256
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value);
}

function exactKeys(value, keys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function denied(reason, authorityId = undefined) {
  return {
    allowed: false,
    reason,
    ...(authorityId ? { authorityId } : {}),
  };
}

export function semanticAuthorityErrors(registry) {
  if (!validateRegistry(registry)) {
    return (validateRegistry.errors ?? []).map(({ instancePath, keyword, message }) => (
      `registry${instancePath}: ${keyword} ${message}`
    ));
  }
  const errors = [];
  const authorityIds = new Set();
  const evidenceIds = new Set();
  const asOf = strictTimestamp(registry.asOf);
  if (!Number.isFinite(asOf)) errors.push("registry asOf is not a strict RFC 3339 instant");
  if (!Number.isInteger(registry.revocationMaxAgeSeconds)
    || registry.revocationMaxAgeSeconds < 60
    || registry.revocationMaxAgeSeconds > 86400) {
    errors.push("registry revocationMaxAgeSeconds is invalid");
  }
  for (const [index, entry] of registry.entries.entries()) {
    const location = `entries[${index}]`;
    if (authorityIds.has(entry.authorityId)) errors.push(`${location}: duplicate authorityId`);
    authorityIds.add(entry.authorityId);
    if (evidenceIds.has(entry.basis.evidenceId)) errors.push(`${location}: duplicate evidenceId`);
    evidenceIds.add(entry.basis.evidenceId);
    for (const [field, value] of [
      ["participantId", entry.participantId],
      ["providerId", entry.providerId],
      ["basis.issuerId", entry.basis.issuerId],
      ["basis.subjectId", entry.basis.subjectId],
    ]) {
      if (!validIdentityIdentifier(value)) {
        errors.push(`${location}: ${field} is not an exact HTTPS URL or bare DID`);
      }
    }
    if (!validLocalIdentifier(entry.sourceSystemId)
      || entry.assetIds.some((assetId) => !validLocalIdentifier(assetId))) {
      errors.push(`${location}: sourceSystemId and assetIds must be local identifiers`);
    }
    const effectiveFrom = strictTimestamp(entry.effectiveFrom);
    const validUntil = strictTimestamp(entry.validUntil);
    const revocationCheckedAt = strictTimestamp(entry.revocationCheckedAt);
    if (![effectiveFrom, validUntil, revocationCheckedAt].every(Number.isFinite)) {
      errors.push(`${location}: invalid authority timestamp`);
      continue;
    }
    if (!(effectiveFrom < validUntil)) errors.push(`${location}: invalid authority interval`);
    if (revocationCheckedAt > asOf) errors.push(`${location}: revocation check is after registry asOf`);
    if (entry.basis.subjectId !== entry.providerId) {
      errors.push(`${location}: authority subject does not match providerId`);
    }
    if (entry.decision === "approved") {
      if (entry.revocationStatus !== "current") {
        errors.push(`${location}: approved authority is not current`);
      }
      if (entry.approval.status !== "verified") {
        errors.push(`${location}: approved authority lacks verified approval`);
      }
      if (entry.approval.approvedBy !== entry.basis.issuerId) {
        errors.push(`${location}: approval signer does not match authority issuer`);
      }
      if (!validIdentityIdentifier(entry.approval.approvedBy)
        || !validIdentityIdentifier(entry.approval.verifiedBy)) {
        errors.push(`${location}: approval identities are not exact HTTPS URLs or bare DIDs`);
      }
      const approvedAt = strictTimestamp(entry.approval.approvedAt);
      const verifiedAt = strictTimestamp(entry.approval.verifiedAt);
      if (![approvedAt, verifiedAt].every(Number.isFinite)) {
        errors.push(`${location}: invalid approval timestamp`);
        continue;
      }
      if (approvedAt < effectiveFrom || approvedAt > validUntil) {
        errors.push(`${location}: approval timestamp is outside the authority interval`);
      }
      if (verifiedAt < approvedAt || verifiedAt > asOf) {
        errors.push(`${location}: approval verification timestamp is invalid`);
      }
      if (revocationCheckedAt < verifiedAt) {
        errors.push(`${location}: revocation evidence predates approval verification`);
      }
    }
  }
  const hasApprovedCurrent = registry.entries.some((entry) => (
    entry.decision === "approved" && entry.revocationStatus === "current"
      && entry.approval.status === "verified"
      && Number.isFinite(asOf)
      && strictTimestamp(entry.effectiveFrom) <= asOf
      && asOf < strictTimestamp(entry.validUntil)
      && strictTimestamp(entry.revocationCheckedAt) <= asOf
      && asOf - strictTimestamp(entry.revocationCheckedAt)
        <= registry.revocationMaxAgeSeconds * 1000
  ));
  const expectedDecision = hasApprovedCurrent
    ? "eligible-after-runtime-verification"
    : "blocked-no-approved-authority";
  if (registry.releaseDecision !== expectedDecision) {
    errors.push(`releaseDecision must be ${expectedDecision}`);
  }
  return errors;
}

export function authorityEntryDigest(entry) {
  return sha256Json(entry);
}

export function authorityRegistryDigest(registry) {
  return sha256Json(registry);
}

export function authorityVerificationReceiptDigest(receipt) {
  return sha256Json(Object.fromEntries(
    RECEIPT_SIGNED_KEYS.map((key) => [key, receipt[key]]),
  ));
}

export function authorityVerificationPayloadDigest(entry, request, registry) {
  return sha256Json({
    canonicalization: "RFC8785",
    action: request.action,
    assetId: request.assetId,
    authorityId: entry.authorityId,
    basisArtifactSha256: entry.basis.artifactSha256,
    decisionArtifactSha256: entry.approval.decisionArtifactSha256,
    decisionRequestId: request.decisionRequestId,
    entrySha256: authorityEntryDigest(entry),
    evidenceId: entry.basis.evidenceId,
    evaluatedAt: request.evaluatedAt,
    participantId: request.participantId,
    providerId: request.providerId,
    policyEnforcementPointId: request.policyEnforcementPointId,
    registryAsOf: registry.asOf,
    registrySha256: authorityRegistryDigest(registry),
    sourceSystemId: request.sourceSystemId,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function verificationEnvelope(entry, request, registry, receipt) {
  return deepFreeze({
    action: request.action,
    asset: {
      assetId: request.assetId,
    },
    canonicalization: "RFC8785",
    evaluatedAt: request.evaluatedAt,
    evidence: {
      authorityId: entry.authorityId,
      basisArtifactSha256: entry.basis.artifactSha256,
      decisionArtifactSha256: entry.approval.decisionArtifactSha256,
      entrySha256: authorityEntryDigest(entry),
      evidenceId: entry.basis.evidenceId,
      registryAsOf: registry.asOf,
      registrySha256: authorityRegistryDigest(registry),
    },
    payloadSha256: receipt.payloadSha256,
    policyEnforcementPoint: {
      id: request.policyEnforcementPointId,
    },
    receipt: structuredClone(receipt),
    receiptSha256: authorityVerificationReceiptDigest(receipt),
    request: {
      decisionRequestId: request.decisionRequestId,
      participantId: request.participantId,
      providerId: request.providerId,
      sourceSystemId: request.sourceSystemId,
    },
    schemaVersion: "molit.authority-verification-envelope/1",
    verifier: {
      id: receipt.verifierId,
      keyId: receipt.keyId,
      signatureRef: receipt.signatureRef,
      trustAnchorId: receipt.trustAnchorId,
      verificationArtifactSha256: receipt.verificationArtifactSha256,
      verifiedAt: receipt.verifiedAt,
    },
  });
}

function validAuthorityRequest(request) {
  if (!exactKeys(request, REQUEST_KEYS)
    || !Object.values(request).every((value) => (
      typeof value === "string" && value.length > 0 && value.length <= 512
  ))) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/u.test(request.decisionRequestId)
    && validIdentityIdentifier(request.policyEnforcementPointId)
    && validIdentityIdentifier(request.participantId)
    && validIdentityIdentifier(request.providerId)
    && validLocalIdentifier(request.sourceSystemId)
    && validLocalIdentifier(request.assetId);
}

function receiptMatches(receipt, entry, request, registry) {
  if (!exactKeys(receipt, RECEIPT_KEYS)) {
    return false;
  }
  const strings = Object.values(receipt).every((value) => (
    typeof value === "string" && value.length > 0 && value.length <= 512
  ));
  if (!strings
    || receipt.schemaVersion !== "molit.authority-verification-receipt/1"
    || receipt.canonicalization !== "RFC8785"
    || !/^[a-f0-9]{64}$/u.test(receipt.payloadSha256)
    || !/^[a-f0-9]{64}$/u.test(receipt.verificationArtifactSha256)
    || !/^(?:vault|kms):\/\/[A-Za-z0-9._/-]+$/u.test(receipt.signatureRef)
    || !validIdentityIdentifier(receipt.verifierId)
    || !validIdentityIdentifier(receipt.policyEnforcementPointId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/u.test(receipt.decisionRequestId)
    || !validLocalIdentifier(receipt.trustAnchorId)
    || !validLocalIdentifier(receipt.keyId)
    || !strictRfc3339(receipt.evaluatedAt)
    || !strictRfc3339(receipt.registryAsOf)
    || !strictRfc3339(receipt.verifiedAt)) {
    return false;
  }
  return receipt.authorityId === entry.authorityId
    && receipt.evidenceId === entry.basis.evidenceId
    && receipt.basisArtifactSha256 === entry.basis.artifactSha256
    && receipt.decisionArtifactSha256 === entry.approval.decisionArtifactSha256
    && receipt.entrySha256 === authorityEntryDigest(entry)
    && receipt.participantId === request.participantId
    && receipt.providerId === request.providerId
    && receipt.sourceSystemId === request.sourceSystemId
    && receipt.assetId === request.assetId
    && receipt.action === request.action
    && receipt.decisionRequestId === request.decisionRequestId
    && receipt.policyEnforcementPointId === request.policyEnforcementPointId
    && receipt.evaluatedAt === request.evaluatedAt
    && receipt.verifierId === entry.approval.verifiedBy
    && receipt.registryAsOf === registry.asOf
    && receipt.registrySha256 === authorityRegistryDigest(registry)
    && receipt.payloadSha256 === authorityVerificationPayloadDigest(entry, request, registry);
}

export function resolveProviderAuthority(registry, request, verification = undefined) {
  if (semanticAuthorityErrors(registry).length > 0) return denied("REGISTRY_INVALID");
  if (!validAuthorityRequest(request)) return denied("REQUEST_INVALID");
  if (!ALLOWED_ACTIONS.has(request.action)) return denied("ACTION_UNSUPPORTED");
  if (!strictRfc3339(request.evaluatedAt)) return denied("EVALUATION_TIME_INVALID");
  const evaluatedAt = strictTimestamp(request.evaluatedAt);
  const registryAsOf = strictTimestamp(registry.asOf);
  if (evaluatedAt > registryAsOf) return denied("REGISTRY_SNAPSHOT_TOO_OLD");
  const candidates = registry.entries.filter((entry) => (
    entry.participantId === request.participantId
      && entry.providerId === request.providerId
      && entry.sourceSystemId === request.sourceSystemId
      && entry.assetIds.includes(request.assetId)
      && entry.allowedActions.includes(request.action)
  ));
  if (candidates.length !== 1) {
    return denied(candidates.length === 0 ? "AUTHORITY_NOT_FOUND" : "AUTHORITY_AMBIGUOUS");
  }
  const [entry] = candidates;
  if (entry.decision !== "approved" || entry.approval.status !== "verified") {
    return denied("AUTHORITY_NOT_APPROVED", entry.authorityId);
  }
  if (entry.revocationStatus !== "current") {
    return denied("AUTHORITY_NOT_CURRENT", entry.authorityId);
  }
  if (evaluatedAt < strictTimestamp(entry.effectiveFrom)
    || evaluatedAt >= strictTimestamp(entry.validUntil)) {
    return denied("AUTHORITY_OUTSIDE_VALIDITY", entry.authorityId);
  }
  if (strictTimestamp(entry.revocationCheckedAt) > evaluatedAt) {
    return denied("REVOCATION_EVIDENCE_FROM_FUTURE", entry.authorityId);
  }
  if (evaluatedAt - strictTimestamp(entry.revocationCheckedAt)
    > registry.revocationMaxAgeSeconds * 1000) {
    return denied("REVOCATION_EVIDENCE_STALE", entry.authorityId);
  }
  if (!verification || typeof verification.verifyReceipt !== "function") {
    return denied("AUTHORITY_VERIFICATION_REQUIRED", entry.authorityId);
  }
  const receipt = verification.receipt;
  if (!receiptMatches(receipt, entry, request, registry)) {
    return denied("AUTHORITY_VERIFICATION_INVALID", entry.authorityId);
  }
  if (!strictRfc3339(receipt.verifiedAt)) {
    return denied("AUTHORITY_VERIFICATION_STALE", entry.authorityId);
  }
  const receiptVerifiedAt = strictTimestamp(receipt.verifiedAt);
  if (receiptVerifiedAt < strictTimestamp(entry.approval.verifiedAt)
    || receiptVerifiedAt > evaluatedAt
    || evaluatedAt - receiptVerifiedAt > registry.revocationMaxAgeSeconds * 1000) {
    return denied("AUTHORITY_VERIFICATION_STALE", entry.authorityId);
  }
  let cryptographicallyVerified = false;
  try {
    cryptographicallyVerified = verification.verifyReceipt(
      verificationEnvelope(entry, request, registry, receipt),
    ) === true;
  } catch {
    cryptographicallyVerified = false;
  }
  if (!cryptographicallyVerified) {
    return denied("AUTHORITY_SIGNATURE_UNVERIFIED", entry.authorityId);
  }
  return {
    allowed: true,
    authorityId: entry.authorityId,
    evidenceId: entry.basis.evidenceId,
    validUntil: entry.validUntil,
  };
}
