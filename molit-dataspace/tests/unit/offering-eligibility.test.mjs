import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decideOffering, normalizeRecord } from "../../src/discovery/model.mjs";
import {
  publicCatalogContainsPrivateReference,
  toDiscoveryProjection,
  toOfferingCandidate,
} from "../../src/discovery/projection.mjs";
import { indexApprovalRegistry, resolveApproval } from "../../src/discovery/approval-registry.mjs";

const baseline = JSON.parse(
  await readFile(new URL("../../fixtures/discovery/baseline.json", import.meta.url), "utf8"),
);
const config = JSON.parse(
  await readFile(new URL("../../fixtures/discovery/config.json", import.meta.url), "utf8"),
);
const approvals = JSON.parse(
  await readFile(new URL("../../fixtures/discovery/approvals.json", import.meta.url), "utf8"),
);
const approvalIndex = indexApprovalRegistry(approvals);

function canonicalAt(index) {
  const event = baseline.records[index];
  const governanceApproval = resolveApproval(approvalIndex, {
    evaluatedAt: "2026-07-11T14:00:00+09:00",
    record: event.record,
    recordId: event.recordId,
    resourceVersion: event.resourceVersion,
    sourceSystemId: baseline.sourceSystemId,
  });
  return normalizeRecord({
    governanceApproval,
    sourceSystemId: baseline.sourceSystemId,
    recordId: event.recordId,
    record: event.record,
  });
}

test("IT-CAT-002: non-Dataset record is CATALOG_ONLY", () => {
  const canonical = canonicalAt(2);
  const decision = decideOffering(canonical);
  assert.equal(canonical.recordType, "organization");
  assert.equal(decision.state, "CATALOG_ONLY");
  assert.deepEqual(decision.reasons.map((item) => item.code), ["NOT_DATASET"]);
});

test("IT-CAT-002: discovery evidence is deduplicated across record and role scopes", () => {
  const canonical = canonicalAt(0);
  canonical.evidenceIds = ["EVD-SHARED"];
  canonical.platformRecordRole.evidenceIds = ["EVD-SHARED"];
  const projection = toDiscoveryProjection(canonical, decideOffering(canonical));
  assert.deepEqual(projection.evidenceIds, ["EVD-SHARED"]);
});

test("IT-CAT-002: themes are deduplicated after URL normalization", () => {
  const event = structuredClone(baseline.records[0]);
  event.record.themes = [
    "https://road-theme.poc.invalid",
    "https://road-theme.poc.invalid/",
  ];
  const canonical = normalizeRecord({
    governanceApproval: { status: "unverified", catalogVisibility: "internal" },
    sourceSystemId: baseline.sourceSystemId,
    recordId: event.recordId,
    record: event.record,
  });
  assert.deepEqual(canonical.themes, ["https://road-theme.poc.invalid/"]);
});

test("IT-CAT-006: index-only record cannot become an Offering candidate", () => {
  const decision = decideOffering(canonicalAt(1));
  assert.equal(decision.state, "CATALOG_ONLY");
  assert.deepEqual(decision.reasons.map((item) => item.code), ["INDEX_ONLY"]);
});

test("IT-PLT-002: missing role and delivery evidence remains PENDING_EVIDENCE", () => {
  const decision = decideOffering(canonicalAt(3));
  assert.equal(decision.state, "PENDING_EVIDENCE");
  assert.ok(decision.reasons.some((item) => item.code === "ROLE_UNKNOWN"));
  assert.ok(decision.reasons.some((item) => item.code === "MISSING_PROVIDER_AUTHORITY"));
  assert.ok(decision.reasons.some((item) => item.code === "MISSING_DISTRIBUTION"));
});

test("ST-BIND-001: public Catalog draft excludes private source binding", () => {
  const canonical = canonicalAt(0);
  const decision = decideOffering(canonical);
  const candidate = toOfferingCandidate(canonical, decision, config);

  assert.equal(decision.state, "APPROVED");
  assert.equal(publicCatalogContainsPrivateReference(candidate), false);
  assert.doesNotMatch(JSON.stringify(candidate.catalogProjection), /binding:\/\//);
  assert.match(candidate.registration.bindings[0].sourceBindingRef, /^binding:\/\//);
  const dataService = candidate.catalogProjection["@graph"].find(
    (item) => item["@type"] === "dcat:DataService",
  );
  assert.equal(
    dataService["dcat:endpointURL"]["@id"],
    config.providerConnectorEndpoint,
  );
});

test("FR-PLT-002: managed lifecycle Distribution requires a revocation method", () => {
  const canonical = structuredClone(canonicalAt(0));
  delete canonical.distributions[0].revocationMode;
  const decision = decideOffering(canonical);

  assert.equal(decision.state, "PENDING_EVIDENCE");
  assert.ok(decision.reasons.some((item) => item.code === "MISSING_REVOCATION"));
});

test("IT-CAT-006: hosted role without evidence remains PENDING_EVIDENCE", () => {
  const canonical = structuredClone(canonicalAt(0));
  canonical.platformRecordRole.evidenceIds = [];
  const decision = decideOffering(canonical);

  assert.equal(decision.state, "PENDING_EVIDENCE");
  assert.ok(decision.reasons.some((item) => item.code === "MISSING_ROLE_EVIDENCE"));
});

test("ST-BIND-001: source binding must be an opaque registry reference", () => {
  const event = structuredClone(baseline.records[0]);
  event.record.distributions[0].sourceBindingRef = "https://source.internal.invalid/data?token=value";

  assert.throws(
    () => normalizeRecord({
      sourceSystemId: baseline.sourceSystemId,
      recordId: event.recordId,
      record: event.record,
    }),
    (error) => error.code === "INVALID_REFERENCE",
  );
});

test("CT-TRN-001: one Dataset transfer format resolves to one binding", () => {
  const canonical = structuredClone(canonicalAt(0));
  const duplicate = structuredClone(canonical.distributions[0]);
  duplicate.id = "second-snapshot";
  duplicate.sourceBindingRef = "binding://mock-road-platform/second-snapshot";
  canonical.distributions.push(duplicate);
  const decision = decideOffering(canonical);

  assert.equal(decision.state, "PENDING_EVIDENCE");
  assert.ok(decision.reasons.some((item) => item.code === "AMBIGUOUS_TRANSFER_FORMAT"));
});

test("ST-BIND-001: binding grammar rejects JSON escape characters", () => {
  const event = structuredClone(baseline.records[0]);
  event.record.distributions[0].sourceBindingRef = "binding://registry/\"PRIVATE\"";
  assert.throws(
    () => normalizeRecord({
      sourceSystemId: baseline.sourceSystemId,
      recordId: event.recordId,
      record: event.record,
    }),
    (error) => error.code === "INVALID_REFERENCE",
  );
});

test("IT-PLT-002: missing transfer decision normalizes to pending evidence", () => {
  const event = structuredClone(baseline.records[0]);
  delete event.record.transferDecision;
  const canonical = normalizeRecord({
    governanceApproval: {
      status: "unverified",
      offeringDecision: "pending",
      catalogVisibility: "internal",
      reason: "APPROVED_DIGEST_MISMATCH",
    },
    sourceSystemId: baseline.sourceSystemId,
    recordId: event.recordId,
    record: event.record,
  });
  const decision = decideOffering(canonical);

  assert.equal(canonical.transferDecision, "pending");
  assert.equal(decision.state, "PENDING_EVIDENCE");
  assert.ok(decision.reasons.some((item) => item.code === "TRANSFER_NOT_APPROVED"));
});
