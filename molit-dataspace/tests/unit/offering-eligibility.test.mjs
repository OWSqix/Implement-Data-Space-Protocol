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

// FR-CAT-003은 원 보유기관, Offering Provider, source system과 원천 식별자의
// 구분을 요구한다. 아래 두 시험이 상호 분리 보존(정상)과 주체별 누락 거부
// (실패)를 검증한다 — 검증 계획 IT-CAT-003.

test("IT-CAT-003: four distinct parties survive normalization without conflation", () => {
  const event = structuredClone(baseline.records[0]);
  event.record.originDataHolderId = "mock-holder-a";
  event.record.providerParticipantId = "mock-provider-b";
  event.record.contractingPartyId = "mock-contracting-c";
  const canonical = normalizeRecord({
    governanceApproval: resolveApproval(approvalIndex, {
      evaluatedAt: "2026-07-11T14:00:00+09:00",
      record: event.record,
      recordId: event.recordId,
      resourceVersion: event.resourceVersion,
      sourceSystemId: baseline.sourceSystemId,
    }),
    sourceSystemId: baseline.sourceSystemId,
    recordId: event.recordId,
    record: event.record,
  });
  // 네 주체가 각자의 필드로 보존되고 어느 것도 다른 값으로 섞이지 않는다.
  const parties = [
    canonical.originDataHolderId,
    canonical.providerParticipantId,
    canonical.contractingPartyId,
    canonical.sourceSystemId,
  ];
  assert.deepEqual(parties, ["mock-holder-a", "mock-provider-b", "mock-contracting-c", baseline.sourceSystemId]);
  assert.equal(new Set(parties).size, 4);
  assert.equal(canonical.publisher.id, event.record.publisher.id);
  // 주체 누락 계열의 사유가 없어야 한다 — 분리 자체는 차단 사유가 아니다.
  const codes = decideOffering(canonical).reasons.map((item) => item.code);
  for (const code of ["MISSING_DATA_HOLDER", "MISSING_PROVIDER_PARTICIPANT", "MISSING_OPERATING_ROLE"]) {
    assert.equal(codes.includes(code), false, `${code} must not fire for distinct parties`);
  }
});

test("IT-CAT-003: each missing party is rejected with its own reason, not a generic one", () => {
  const cases = [
    { field: "originDataHolderId", code: "MISSING_DATA_HOLDER" },
    { field: "providerParticipantId", code: "MISSING_PROVIDER_PARTICIPANT" },
    { field: "contractingPartyId", code: "MISSING_OPERATING_ROLE" },
  ];
  for (const { field, code } of cases) {
    const event = structuredClone(baseline.records[0]);
    delete event.record[field];
    const canonical = normalizeRecord({
      governanceApproval: resolveApproval(approvalIndex, {
        evaluatedAt: "2026-07-11T14:00:00+09:00",
        record: event.record,
        recordId: event.recordId,
        resourceVersion: event.resourceVersion,
        sourceSystemId: baseline.sourceSystemId,
      }),
      sourceSystemId: baseline.sourceSystemId,
      recordId: event.recordId,
      record: event.record,
    });
    const decision = decideOffering(canonical);
    const codes = decision.reasons.map((item) => item.code);
    assert.ok(codes.includes(code), `${field} 누락은 ${code}로 거부돼야 한다 (실제: ${codes.join(",")})`);
    assert.notEqual(decision.state, "OFFERING_CANDIDATE");
  }
});

// FR-SEM-005의 빠진 축 — 공개 RDF와 source binding·credential·"승인 증거"의
// 분리. 기존 시험은 binding 문법·mailbox·host를 다뤘고, 승인 증거가 공개
// graph에 새지 않는다는 단언은 없었다 — 검증 계획 CT-SEM-MAILBOX-001 옆의
// 분리 축.
test("CT-SEM-SEPARATION-001: approval evidence and bindings never leak into the public graph", () => {
  const event = structuredClone(baseline.records[0]);
  const canonical = normalizeRecord({
    governanceApproval: resolveApproval(approvalIndex, {
      evaluatedAt: "2026-07-11T14:00:00+09:00",
      record: event.record,
      recordId: event.recordId,
      resourceVersion: event.resourceVersion,
      sourceSystemId: baseline.sourceSystemId,
    }),
    sourceSystemId: baseline.sourceSystemId,
    recordId: event.recordId,
    record: event.record,
  });
  const candidate = toOfferingCandidate(canonical, decideOffering(canonical), config);
  const publicGraph = JSON.stringify(candidate.catalogProjection);
  // 승인 증거 ID, source binding 참조, 승인 레코드가 공개 투영에 없어야 한다.
  assert.equal(publicGraph.includes("EVD-"), false, "evidence IDs must stay private");
  assert.equal(publicGraph.includes("binding://"), false, "source bindings must stay private");
  assert.equal(publicGraph.includes("governanceApproval"), false, "approval records must stay private");
  // 같은 정보는 내부 결속 절에는 존재한다 — 삭제가 아니라 분리다.
  const privateSection = JSON.stringify(candidate.sourceBinding ?? candidate.binding ?? candidate);
  assert.equal(privateSection.includes("EVD-"), true);
  assert.equal(privateSection.includes("binding://"), true);
  // 전용 헬퍼도 같은 판정을 내려야 한다.
  assert.equal(publicCatalogContainsPrivateReference(candidate), false);
});

// 아래 두 건은 시험 공백이 아니라 구현 공백이다. 검증 계획 §4.2의
// GAP-IMPL 항목과 함께 등록되며, 구현이 생기기 전에는 todo로 남긴다.

test(
  "IT-CAT-004(축 유보): discovery projection은 provenance를 담아야 한다",
  { todo: "FR-CAT-004의 provenance 축 — toDiscoveryProjection·toOfferingCandidate 어디에도 provenance 방출이 없다(GAP-IMPL-01)" },
  () => {},
);

test(
  "DQ-META-001(축 유보): 시간대·link version 오류는 quarantine돼야 한다",
  { todo: "FR-META-003의 시간대·link version 축 — DQ 경로에 검사가 없다. xsd-lexical의 timezone 구문 검증은 datatype 층위라 이 축을 대신하지 않는다(GAP-IMPL-02)" },
  () => {},
);
