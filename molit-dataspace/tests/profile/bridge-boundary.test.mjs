import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assessDraftProjectionGaps } from "../../src/profile/bridge-boundary.mjs";
import { createEmptyState } from "../../src/discovery/state-repository.mjs";
import { synchronizeBatch } from "../../src/discovery/synchronizer.mjs";

async function fixture(name) {
  return JSON.parse(await readFile(
    new URL(`../../fixtures/discovery/${name}`, import.meta.url),
    "utf8",
  ));
}

const [baseline, config, approvals] = await Promise.all([
  fixture("baseline.json"),
  fixture("config.json"),
  fixture("approvals.json"),
]);

test("CT-SEM-BRIDGE-000: S1 candidate is rejected as an application-profile graph", () => {
  const synchronized = synchronizeBatch(createEmptyState(), baseline, config, approvals);
  const candidate = synchronized.state.records[
    "mock-molit-platform::road-node-link-snapshot"
  ].offeringCandidate;
  const assessment = assessDraftProjectionGaps(candidate);
  const codes = new Set(assessment.blockingIssues.map((item) => item.code));

  assert.equal(assessment.profileReadyForRdfValidation, false);
  assert.equal(assessment.shaclValidationStillRequired, true);
  for (const code of [
    "CURRENT_PROJECTION_DECLARED_DRAFT",
    "MISSING_CATALOG",
    "MISSING_CATALOG_RECORD",
    "MISSING_CATALOG_PROFILE_CONFORMANCE",
    "MISSING_RECORD_PROFILE_CONFORMANCE",
    "UNTAGGED_TITLE_LITERAL",
    "UNTAGGED_DESCRIPTION_LITERAL",
    "LITERAL_ACCESS_RIGHTS",
    "MISSING_AGENT_NODE",
    "LITERAL_FORMAT",
    "MISSING_ACCESS_URL",
    "MISSING_DATA_SERVICE_TITLE",
  ]) {
    assert.ok(codes.has(code), code);
  }
  assert.equal(candidate.catalogProjection.profileStatus, "project-draft-not-dsp-wire-message");
});

// FR-META-002의 format 축 — 검증 계획 CT-META-002. 경계 검사가 강제하는 것은
// "문자열 리터럴 거부"이며 승인 목록 대조는 이 계층의 범위가 아니다.
test("CT-META-002: dct:format literal is rejected at its exact path and an IRI node clears it", () => {
  const synchronized = synchronizeBatch(createEmptyState(), baseline, config, approvals);
  const candidate = structuredClone(synchronized.state.records[
    "mock-molit-platform::road-node-link-snapshot"
  ].offeringCandidate);
  const graph = candidate.catalogProjection["@graph"];
  const distributionIndex = graph.findIndex((node) => {
    const type = node["@type"];
    return type === "dcat:Distribution" || (Array.isArray(type) && type.includes("dcat:Distribution"));
  });
  assert.notEqual(distributionIndex, -1, "fixture candidate must carry a Distribution node");

  // 실패축 — 문자열 리터럴은 정확한 경로로 지목돼 거부된다.
  assert.equal(typeof graph[distributionIndex]["dct:format"], "string");
  const literalIssues = assessDraftProjectionGaps(candidate).blockingIssues
    .filter((item) => item.code === "LITERAL_FORMAT");
  assert.equal(literalIssues.length, 1);
  assert.equal(
    literalIssues[0].path,
    `catalogProjection.@graph[${distributionIndex}].dct:format`,
  );

  // 정상축 — File Type IRI 노드는 LITERAL_FORMAT을 해소한다.
  graph[distributionIndex]["dct:format"] = {
    "@id": "http://publications.europa.eu/resource/authority/file-type/CSV",
  };
  const remaining = assessDraftProjectionGaps(candidate).blockingIssues
    .map((item) => item.code);
  assert.equal(remaining.includes("LITERAL_FORMAT"), false);
});

test("CT-SEM-BRIDGE-000A: bridge preflight rejects duplicate and mixed profile markers", () => {
  const core = "https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0";
  const geo = `${core}/geo`;
  const assessment = assessDraftProjectionGaps({
    catalogProjection: {
      profileStatus: "molit-dcat-ap-0.1.0-validated",
      "@graph": [
        {
          "@id": "https://data.molit.go.kr/id/test/catalog",
          "@type": "dcat:Catalog",
          "dct:conformsTo": [{ "@id": core }, { "@id": geo }],
        },
        {
          "@id": "https://data.molit.go.kr/id/test/record",
          "@type": "dcat:CatalogRecord",
          "dct:conformsTo": { "@id": core },
        },
      ],
    },
  });
  const codes = new Set(assessment.blockingIssues.map((item) => item.code));
  assert.ok(codes.has("AMBIGUOUS_CATALOG_PROFILE_CONFORMANCE"));
  assert.ok(codes.has("PROFILE_CONFORMANCE_MISMATCH"));
  assert.equal(assessment.profileReadyForRdfValidation, false);
});
