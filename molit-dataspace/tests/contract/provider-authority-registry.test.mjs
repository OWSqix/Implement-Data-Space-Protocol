import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  authorityEntryDigest,
  authorityRegistryDigest,
  authorityVerificationPayloadDigest,
  authorityVerificationReceiptDigest,
  resolveProviderAuthority,
  semanticAuthorityErrors,
} from "../../src/governance/provider-authority.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const [schema, registry] = await Promise.all([
  readFile(path.join(root, "contracts/provider-authority-registry.v1.schema.json"), "utf8")
    .then(JSON.parse),
  readFile(path.join(root, "standards/provider-authority-registry.json"), "utf8")
    .then(JSON.parse),
]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function approvedEntry() {
  return {
    authorityId: "AUTH-MOLIT-ROAD-001",
    participantId: "did:web:participant.example.invalid",
    providerId: "did:web:provider.example.invalid",
    legalEntityName: "검증용 국토교통 데이터 제공기관",
    sourceSystemId: "molit-road-platform",
    assetIds: ["road-node-link-snapshot"],
    roles: ["data-owner", "delegated-provider"],
    allowedActions: ["catalog-publish", "contract-negotiate", "data-transfer"],
    basis: {
      kind: "delegation-contract",
      issuerId: "did:web:authority.example.invalid",
      subjectId: "did:web:provider.example.invalid",
      evidenceId: "EVD-AUTH-MOLIT-ROAD-001",
      artifactSha256: "1".repeat(64),
      artifactLocator: "vault://authority/molit-road-001",
    },
    effectiveFrom: "2026-01-01T00:00:00+09:00",
    validUntil: "2027-01-01T00:00:00+09:00",
    revocationStatus: "current",
    revocationCheckedAt: "2026-07-11T09:00:00+09:00",
    decision: "approved",
    approval: {
      status: "verified",
      approvedBy: "did:web:authority.example.invalid",
      approvedAt: "2026-01-02T00:00:00+09:00",
      decisionArtifactSha256: "2".repeat(64),
      signatureRef: "kms://authority/molit-road-001",
      verifiedBy: "did:web:auditor.example.invalid",
      verifiedAt: "2026-01-03T00:00:00+09:00",
    },
  };
}

function approvedRegistry() {
  return {
    ...structuredClone(registry),
    releaseDecision: "eligible-after-runtime-verification",
    entries: [approvedEntry()],
  };
}

function authorityRequest(overrides = {}) {
  return {
    action: "data-transfer",
    assetId: "road-node-link-snapshot",
    decisionRequestId: "REQ-20260712-MUTATION",
    evaluatedAt: "2026-07-12T00:00:00+09:00",
    participantId: "did:web:participant.example.invalid",
    policyEnforcementPointId: "did:web:connector.example.invalid",
    providerId: "did:web:provider.example.invalid",
    sourceSystemId: "molit-road-platform",
    ...overrides,
  };
}

function verificationFor(candidate, request) {
  const entry = candidate.entries[0];
  const receipt = {
    schemaVersion: "molit.authority-verification-receipt/1",
    canonicalization: "RFC8785",
    authorityId: entry.authorityId,
    evidenceId: entry.basis.evidenceId,
    basisArtifactSha256: entry.basis.artifactSha256,
    decisionArtifactSha256: entry.approval.decisionArtifactSha256,
    decisionRequestId: request.decisionRequestId,
    entrySha256: authorityEntryDigest(entry),
    participantId: request.participantId,
    providerId: request.providerId,
    sourceSystemId: request.sourceSystemId,
    assetId: request.assetId,
    action: request.action,
    evaluatedAt: request.evaluatedAt,
    policyEnforcementPointId: request.policyEnforcementPointId,
    registryAsOf: candidate.asOf,
    registrySha256: authorityRegistryDigest(candidate),
    verifiedAt: request.evaluatedAt,
    verifierId: entry.approval.verifiedBy,
    trustAnchorId: "molit-authority-root-2026",
    keyId: "molit-authority-root-2026-key-1",
    signatureRef: "kms://authority/verification-receipt-1",
    verificationArtifactSha256: "3".repeat(64),
    payloadSha256: authorityVerificationPayloadDigest(entry, request, candidate),
  };
  const signedReceipt = structuredClone(receipt);
  const signedReceiptSha256 = authorityVerificationReceiptDigest(signedReceipt);
  return {
    receipt,
    verifyReceipt: (envelope) => (
      Object.isFrozen(envelope)
        && Object.isFrozen(envelope.receipt)
        && envelope.schemaVersion === "molit.authority-verification-envelope/1"
        && envelope.canonicalization === "RFC8785"
        && envelope.request.decisionRequestId === request.decisionRequestId
        && envelope.request.participantId === request.participantId
        && envelope.request.providerId === request.providerId
        && envelope.request.sourceSystemId === request.sourceSystemId
        && envelope.asset.assetId === request.assetId
        && envelope.action === request.action
        && envelope.evaluatedAt === request.evaluatedAt
        && envelope.evidence.authorityId === entry.authorityId
        && envelope.evidence.evidenceId === entry.basis.evidenceId
        && envelope.evidence.registrySha256 === authorityRegistryDigest(candidate)
        && envelope.policyEnforcementPoint.id === request.policyEnforcementPointId
        && envelope.verifier.id === entry.approval.verifiedBy
        && envelope.verifier.trustAnchorId === "molit-authority-root-2026"
        && envelope.verifier.keyId === "molit-authority-root-2026-key-1"
        && envelope.verifier.signatureRef === signedReceipt.signatureRef
        && envelope.verifier.verificationArtifactSha256 === "3".repeat(64)
        && envelope.payloadSha256 === signedReceipt.payloadSha256
        && envelope.receiptSha256 === signedReceiptSha256
        && authorityVerificationReceiptDigest(envelope.receipt) === signedReceiptSha256
    ),
  };
}

test("AUTH-REG-001: an empty production registry blocks release and authority", () => {
  assert.equal(validate(registry), true, JSON.stringify(validate.errors, null, 2));
  assert.deepEqual(semanticAuthorityErrors(registry), []);
  const decision = resolveProviderAuthority(registry, {
    action: "data-transfer",
    assetId: "road-node-link-snapshot",
    decisionRequestId: "REQ-20260712-0001",
    evaluatedAt: "2026-07-12T00:00:00+09:00",
    policyEnforcementPointId: "did:web:connector.example.invalid",
    participantId: "did:web:participant.example.invalid",
    providerId: "did:web:provider.example.invalid",
    sourceSystemId: "molit-road-platform",
  });
  assert.deepEqual(decision, { allowed: false, reason: "AUTHORITY_NOT_FOUND" });

  const forgedEligible = structuredClone(registry);
  forgedEligible.releaseDecision = "eligible-after-runtime-verification";
  assert.equal(validate(forgedEligible), false);
});

test("AUTH-REG-002: an exact verified scope resolves and adjacent scopes fail closed", () => {
  const candidate = approvedRegistry();
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors, null, 2));
  assert.deepEqual(semanticAuthorityErrors(candidate), []);
  const request = {
    action: "data-transfer",
    assetId: "road-node-link-snapshot",
    decisionRequestId: "REQ-20260712-0002",
    evaluatedAt: "2026-07-12T00:00:00+09:00",
    policyEnforcementPointId: "did:web:connector.example.invalid",
    participantId: "did:web:participant.example.invalid",
    providerId: "did:web:provider.example.invalid",
    sourceSystemId: "molit-road-platform",
  };
  assert.equal(
    resolveProviderAuthority(candidate, request).reason,
    "AUTHORITY_VERIFICATION_REQUIRED",
  );
  assert.deepEqual(resolveProviderAuthority(candidate, request, verificationFor(candidate, request)), {
    allowed: true,
    authorityId: "AUTH-MOLIT-ROAD-001",
    evidenceId: "EVD-AUTH-MOLIT-ROAD-001",
    validUntil: "2027-01-01T00:00:00+09:00",
  });
  assert.equal(resolveProviderAuthority(candidate, {
    ...request,
    assetId: "other-asset",
  }).reason, "AUTHORITY_NOT_FOUND");
  assert.equal(resolveProviderAuthority(candidate, {
    ...request,
    evaluatedAt: "not-a-date",
  }).reason, "EVALUATION_TIME_INVALID");
  assert.equal(resolveProviderAuthority(candidate, {
    ...request,
    evaluatedAt: "2026-07-13T00:00:01+09:00",
  }).reason, "REGISTRY_SNAPSHOT_TOO_OLD");
  assert.equal(resolveProviderAuthority(candidate, {
    ...request,
    evaluatedAt: "2026-07-11T08:59:59+09:00",
  }).reason, "REVOCATION_EVIDENCE_FROM_FUTURE");

  const forged = verificationFor(candidate, request);
  forged.receipt.assetId = "other-asset";
  assert.equal(
    resolveProviderAuthority(candidate, request, forged).reason,
    "AUTHORITY_VERIFICATION_INVALID",
  );
  const untrusted = verificationFor(candidate, request);
  untrusted.verifyReceipt = () => false;
  assert.equal(
    resolveProviderAuthority(candidate, request, untrusted).reason,
    "AUTHORITY_SIGNATURE_UNVERIFIED",
  );
  const mutatedRegistry = approvedRegistry();
  const receiptBeforeMutation = verificationFor(mutatedRegistry, request);
  mutatedRegistry.entries[0].validUntil = "2028-01-01T00:00:00+09:00";
  assert.equal(
    resolveProviderAuthority(mutatedRegistry, request, receiptBeforeMutation).reason,
    "AUTHORITY_VERIFICATION_INVALID",
  );
});

test("AUTH-REG-003: wildcard, unverified and contradictory authority evidence is rejected", () => {
  const wildcard = approvedRegistry();
  wildcard.entries[0].assetIds = ["*"];
  assert.equal(validate(wildcard), false);

  const unverified = approvedRegistry();
  unverified.entries[0].approval = { status: "unverified", reason: "signature unavailable" };
  assert.equal(validate(unverified), false);

  const subjectMismatch = approvedRegistry();
  subjectMismatch.entries[0].basis.subjectId = "did:web:other.example.invalid";
  assert.ok(semanticAuthorityErrors(subjectMismatch).some((error) => (
    error.includes("subject does not match")
  )));

  const revoked = approvedRegistry();
  revoked.entries[0].revocationStatus = "revoked";
  assert.ok(semanticAuthorityErrors(revoked).length > 0);

  const duplicate = approvedRegistry();
  const second = structuredClone(duplicate.entries[0]);
  second.authorityId = "AUTH-MOLIT-ROAD-002";
  duplicate.entries.push(second);
  assert.ok(semanticAuthorityErrors(duplicate).some((error) => error.includes("evidenceId")));

  const stale = approvedRegistry();
  stale.entries[0].revocationCheckedAt = "2026-07-10T00:00:00+09:00";
  stale.releaseDecision = "blocked-no-approved-authority";
  assert.deepEqual(semanticAuthorityErrors(stale), []);
  assert.equal(resolveProviderAuthority(stale, {
    action: "data-transfer",
    assetId: "road-node-link-snapshot",
    decisionRequestId: "REQ-20260712-0003",
    evaluatedAt: "2026-07-12T00:00:00+09:00",
    policyEnforcementPointId: "did:web:connector.example.invalid",
    participantId: "did:web:participant.example.invalid",
    providerId: "did:web:provider.example.invalid",
    sourceSystemId: "molit-road-platform",
  }).reason, "REVOCATION_EVIDENCE_STALE");

  const structurallyInvalid = {
    asOf: "2026-07-12T00:00:00+09:00",
    revocationMaxAgeSeconds: 86400,
    releaseDecision: "eligible-after-runtime-verification",
    entries: [{
      authorityId: "x",
      participantId: "did:web:p.invalid",
      providerId: "did:web:q.invalid",
      sourceSystemId: "s",
      assetIds: ["a"],
      allowedActions: ["data-transfer"],
      basis: { evidenceId: "e", subjectId: "did:web:q.invalid" },
      effectiveFrom: "2026-01-01T00:00:00Z",
      validUntil: "2027-01-01T00:00:00Z",
      revocationStatus: "current",
      revocationCheckedAt: "2026-07-11T00:00:00Z",
      decision: "approved",
      approval: { status: "verified", approvedAt: "2026-01-02T00:00:00Z", verifiedAt: "2026-01-03T00:00:00Z" },
    }],
  };
  assert.doesNotThrow(() => resolveProviderAuthority(structurallyInvalid, {
    action: "data-transfer",
    assetId: "a",
    decisionRequestId: "REQ-20260712-0004",
    evaluatedAt: "2026-07-12T00:00:00Z",
    policyEnforcementPointId: "did:web:connector.example.invalid",
    participantId: "did:web:p.invalid",
    providerId: "did:web:q.invalid",
    sourceSystemId: "s",
  }));
  assert.equal(resolveProviderAuthority(structurallyInvalid, {
    action: "data-transfer",
    assetId: "a",
    decisionRequestId: "REQ-20260712-0004",
    evaluatedAt: "2026-07-12T00:00:00Z",
    policyEnforcementPointId: "did:web:connector.example.invalid",
    participantId: "did:web:p.invalid",
    providerId: "did:web:q.invalid",
    sourceSystemId: "s",
  }).reason, "REGISTRY_INVALID");
});

test("AUTH-REG-004: authority timestamps require a real RFC 3339 calendar instant", () => {
  const invalidTimestamps = [
    "0",
    "2026-07-12T00:00:00",
    "2026-02-30T00:00:00Z",
    "2026-07-12T00:00:00-00:00",
  ];
  const registryTimestampMutations = [
    ["asOf", (candidate, value) => { candidate.asOf = value; }],
    ["effectiveFrom", (candidate, value) => { candidate.entries[0].effectiveFrom = value; }],
    ["validUntil", (candidate, value) => { candidate.entries[0].validUntil = value; }],
    ["revocationCheckedAt", (candidate, value) => {
      candidate.entries[0].revocationCheckedAt = value;
    }],
    ["approvedAt", (candidate, value) => { candidate.entries[0].approval.approvedAt = value; }],
    ["verifiedAt", (candidate, value) => { candidate.entries[0].approval.verifiedAt = value; }],
  ];
  for (const value of invalidTimestamps) {
    for (const [label, mutate] of registryTimestampMutations) {
      const candidate = approvedRegistry();
      mutate(candidate, value);
      assert.ok(
        semanticAuthorityErrors(candidate).length > 0,
        `${label} accepted ${value}`,
      );
    }
    assert.equal(
      resolveProviderAuthority(approvedRegistry(), authorityRequest({ evaluatedAt: value })).reason,
      "EVALUATION_TIME_INVALID",
      `request accepted ${value}`,
    );
    for (const receiptField of ["evaluatedAt", "registryAsOf", "verifiedAt"]) {
      const candidate = approvedRegistry();
      const request = authorityRequest();
      const verification = verificationFor(candidate, request);
      verification.receipt[receiptField] = value;
      assert.equal(
        resolveProviderAuthority(candidate, request, verification).reason,
        "AUTHORITY_VERIFICATION_INVALID",
        `${receiptField} accepted ${value}`,
      );
    }
  }
});

test("AUTH-REG-005: trusted verifier envelope binds request, scope, evidence and receipt digest", () => {
  const candidate = approvedRegistry();
  const request = authorityRequest();
  const verification = verificationFor(candidate, request);
  const trustedVerifier = verification.verifyReceipt;
  let observedEnvelope;
  verification.verifyReceipt = (envelope) => {
    observedEnvelope = envelope;
    return trustedVerifier(envelope);
  };
  assert.equal(resolveProviderAuthority(candidate, request, verification).allowed, true);
  assert.deepEqual(Object.keys(observedEnvelope).sort(), [
    "action",
    "asset",
    "canonicalization",
    "evaluatedAt",
    "evidence",
    "payloadSha256",
    "policyEnforcementPoint",
    "receipt",
    "receiptSha256",
    "request",
    "schemaVersion",
    "verifier",
  ]);
  assert.equal(
    observedEnvelope.receiptSha256,
    authorityVerificationReceiptDigest(observedEnvelope.receipt),
  );
  assert.deepEqual(observedEnvelope.request, {
    decisionRequestId: request.decisionRequestId,
    participantId: request.participantId,
    providerId: request.providerId,
    sourceSystemId: request.sourceSystemId,
  });
  assert.deepEqual(observedEnvelope.asset, { assetId: request.assetId });
  assert.equal(observedEnvelope.action, request.action);
  assert.equal(observedEnvelope.evidence.evidenceId, candidate.entries[0].basis.evidenceId);
  assert.equal(observedEnvelope.evaluatedAt, request.evaluatedAt);
  assert.equal(observedEnvelope.verifier.id, candidate.entries[0].approval.verifiedBy);
  assert.equal(observedEnvelope.policyEnforcementPoint.id, request.policyEnforcementPointId);

  const receiptMutations = [
    ["request ID", (receipt) => { receipt.decisionRequestId = "REQ-20260712-OTHER"; }],
    ["request participant", (receipt) => {
      receipt.participantId = "did:web:other-participant.example.invalid";
    }],
    ["asset", (receipt) => { receipt.assetId = "other-road-asset"; }],
    ["action", (receipt) => { receipt.action = "catalog-publish"; }],
    ["evidence", (receipt) => { receipt.evidenceId = "EVD-AUTH-MOLIT-ROAD-999"; }],
    ["evaluatedAt", (receipt) => {
      receipt.evaluatedAt = "2026-07-11T23:59:59+09:00";
    }],
    ["verifier", (receipt) => {
      receipt.verifierId = "did:web:other-auditor.example.invalid";
    }],
    ["PEP", (receipt) => {
      receipt.policyEnforcementPointId = "did:web:other-connector.example.invalid";
    }],
  ];
  for (const [label, mutate] of receiptMutations) {
    const mutated = verificationFor(candidate, request);
    mutate(mutated.receipt);
    assert.equal(
      resolveProviderAuthority(candidate, request, mutated).reason,
      "AUTHORITY_VERIFICATION_INVALID",
      label,
    );
  }

  for (const [label, mutate] of [
    ["signatureRef", (receipt) => {
      receipt.signatureRef = "kms://authority/verification-receipt-2";
    }],
    ["verificationArtifactSha256", (receipt) => {
      receipt.verificationArtifactSha256 = "4".repeat(64);
    }],
    ["verifiedAt", (receipt) => {
      receipt.verifiedAt = "2026-07-11T23:59:59+09:00";
    }],
  ]) {
    const mutated = verificationFor(candidate, request);
    const signedProjectionBefore = authorityVerificationReceiptDigest(mutated.receipt);
    mutate(mutated.receipt);
    const signedProjectionAfter = authorityVerificationReceiptDigest(mutated.receipt);
    if (label === "verifiedAt") {
      assert.notEqual(signedProjectionAfter, signedProjectionBefore);
    } else {
      assert.equal(signedProjectionAfter, signedProjectionBefore);
    }
    assert.equal(
      resolveProviderAuthority(candidate, request, mutated).reason,
      "AUTHORITY_SIGNATURE_UNVERIFIED",
      `${label} was not bound by the receipt envelope`,
    );
  }

  assert.equal(resolveProviderAuthority(candidate, {
    ...request,
    unboundContext: "must-not-be-ignored",
  }).reason, "REQUEST_INVALID");

  const asynchronous = verificationFor(candidate, request);
  asynchronous.verifyReceipt = async () => true;
  assert.equal(
    resolveProviderAuthority(candidate, request, asynchronous).reason,
    "AUTHORITY_SIGNATURE_UNVERIFIED",
  );
});

test("AUTH-REG-006: identity schemes require a parsed HTTPS host or a bare DID", () => {
  const malformedIdentities = [
    "https://",
    "https:///missing-host",
    "http://identity.example.invalid",
    "HTTPS://identity.example.invalid",
    "https://user@example.invalid",
    "https://example..invalid",
    "did:",
    "did:web:",
    "did:Web:identity.example.invalid",
    "did:web:identity.example.invalid/path",
    "did:web:identity.example.invalid%ZZ",
  ];
  for (const identity of malformedIdentities) {
    for (const field of [
      "participantId",
      "providerId",
      "policyEnforcementPointId",
    ]) {
      assert.equal(
        resolveProviderAuthority(approvedRegistry(), authorityRequest({ [field]: identity })).reason,
        "REQUEST_INVALID",
        `${field} accepted ${identity}`,
      );
    }
    for (const receiptField of [
      "verifierId",
      "policyEnforcementPointId",
    ]) {
      const candidate = approvedRegistry();
      const request = authorityRequest();
      const verification = verificationFor(candidate, request);
      verification.receipt[receiptField] = identity;
      assert.equal(
        resolveProviderAuthority(candidate, request, verification).reason,
        "AUTHORITY_VERIFICATION_INVALID",
        `${receiptField} accepted ${identity}`,
      );
    }
  }

  for (const localIdentifier of [
    "https://",
    "did:web:identity.example.invalid",
    "source:namespace",
    "ab",
  ]) {
    for (const field of ["sourceSystemId", "assetId"]) {
      assert.equal(
        resolveProviderAuthority(
          approvedRegistry(),
          authorityRequest({ [field]: localIdentifier }),
        ).reason,
        "REQUEST_INVALID",
        `${field} accepted ${localIdentifier}`,
      );
    }
    for (const receiptField of ["trustAnchorId", "keyId"]) {
      const candidate = approvedRegistry();
      const request = authorityRequest();
      const verification = verificationFor(candidate, request);
      verification.receipt[receiptField] = localIdentifier;
      assert.equal(
        resolveProviderAuthority(candidate, request, verification).reason,
        "AUTHORITY_VERIFICATION_INVALID",
        `${receiptField} accepted ${localIdentifier}`,
      );
    }
  }

  const validHttps = approvedRegistry();
  const entry = validHttps.entries[0];
  entry.participantId = "https://participant.example.invalid/id/road";
  entry.providerId = "https://provider.example.invalid/id/road";
  entry.basis.subjectId = entry.providerId;
  entry.basis.issuerId = "https://authority.example.invalid/id/root";
  entry.approval.approvedBy = entry.basis.issuerId;
  entry.approval.verifiedBy = "https://auditor.example.invalid/id/receipt";
  assert.deepEqual(semanticAuthorityErrors(validHttps), []);
  const httpsRequest = authorityRequest({
    participantId: entry.participantId,
    policyEnforcementPointId: "https://pep.example.invalid/runtime/provider-authority",
    providerId: entry.providerId,
  });
  assert.equal(
    resolveProviderAuthority(validHttps, httpsRequest, verificationFor(validHttps, httpsRequest)).allowed,
    true,
  );

  const schemaValidButUnapprovedDidUrl = approvedRegistry();
  schemaValidButUnapprovedDidUrl.entries[0].participantId = (
    "did:web:participant.example.invalid/path"
  );
  assert.equal(validate(schemaValidButUnapprovedDidUrl), true);
  assert.ok(semanticAuthorityErrors(schemaValidButUnapprovedDidUrl).some((error) => (
    error.includes("bare DID")
  )));

  const schemaValidButUnapprovedSource = approvedRegistry();
  schemaValidButUnapprovedSource.entries[0].sourceSystemId = "source:namespace";
  assert.equal(validate(schemaValidButUnapprovedSource), true);
  assert.ok(semanticAuthorityErrors(schemaValidButUnapprovedSource).some((error) => (
    error.includes("local identifiers")
  )));
});
