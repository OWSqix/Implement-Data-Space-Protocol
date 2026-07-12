import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildUpstreamRequirementInventory,
  UPSTREAM_CSV_COLUMNS,
  upstreamRequirementCsvProjection,
} from "../../tools/profile/build-upstream-requirement-inventory.mjs";
import { verifyUpstreamRequirementInventory } from "../../tools/profile/verify-upstream-requirement-inventory.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(root, "profiles/molit-dcat-ap/releases/1.0.0-rc.1");

test("UPSTREAM-REQ-001: all 990 pinned property rows have isolated evidence", async () => {
  const report = await verifyUpstreamRequirementInventory();
  assert.equal(report.pointerValid, true);
  assert.equal(report.csvPointerValid, true);
  assert.equal(report.schemaValid, true, JSON.stringify(report.schemaErrors));
  assert.equal(report.deterministic, true);
  assert.equal(report.artifactsDeterministic, true, JSON.stringify(report.artifactErrors));
  assert.equal(report.csvDeterministic, true);
  assert.equal(report.uniqueIds, true);
  assert.equal(report.countsMatch, true);
  assert.equal(report.requirements, 990);
  assert.equal(report.blockers, 0);
  assert.equal(report.gatePassed, true);
});

test("UPSTREAM-REQ-002: source constraints and local operationalizations are not conflated", async () => {
  const inventory = await buildUpstreamRequirementInventory();
  assert.deepEqual(inventory.coverage, {
    requirements: 990,
    upstreamSourceConstraints: 984,
    localOperationalizations: 6,
    isolatedPositive: 990,
    isolatedNegative: 990,
    publicationPolicyTestCoverage: 990,
    blockers: 0,
  });
  assert.equal(inventory.requirements.filter((row) => row.evidenceMethod === "exact-target-overlay").length, 946);
  assert.equal(inventory.requirements.filter((row) => row.evidenceMethod === "deterministic-skolem-overlay").length, 38);
  const wrappers = inventory.requirements.filter((row) => row.evidenceMethod === "deprecation-policy-wrapper");
  assert.equal(wrappers.length, 6);
  for (const row of wrappers) {
    assert.equal(row.sourceConstraintEnforceable, false);
    assert.equal(row.sourceQuadCopy, "source-subset-plus-local-policy");
    assert.equal(row.operationalizedBy, row.evidenceShapeId);
    assert.deepEqual(row.constraintComponents, []);
  }
});

test("UPSTREAM-REQ-003: every negative case maps one focus to one atomic sourceShape", async () => {
  const inventory = await buildUpstreamRequirementInventory();
  assert.equal(inventory.evidence.validation.positiveResults, 0);
  assert.equal(inventory.evidence.validation.negativeResults, 990);
  assert.equal(inventory.evidence.validation.matchedNegativeCases, 990);
  assert.equal(new Set(inventory.requirements.map(({ caseId }) => caseId)).size, 990);
  assert.equal(new Set(inventory.requirements.map(({ focusNode }) => focusNode)).size, 990);
  assert.equal(new Set(inventory.requirements.map(({ evidenceShapeId }) => evidenceShapeId)).size, 990);
  for (const row of inventory.requirements) {
    assert.equal(row.expectedNegativeSourceShape, row.evidenceShapeId);
    assert.equal(row.coverageStatus, "isolated");
  }
});

test("UPSTREAM-REQ-004: deterministic shards stay below the public result cap", async () => {
  const inventory = await buildUpstreamRequirementInventory();
  assert.deepEqual(inventory.evidence.shards.map(({ cases }) => cases), [400, 400, 190]);
  assert.equal(inventory.evidence.maxCasesPerShard, 400);
  assert.equal(inventory.evidence.shards.every(({ cases }) => cases <= 400), true);
  for (const shard of inventory.evidence.shards) {
    for (const artifact of [shard.shapes, shard.positive, shard.negative]) {
      const bytes = await readFile(path.join(releaseRoot, ...artifact.path.split("/")));
      assert.ok(bytes.length > 0, artifact.path);
    }
  }
});

test("UPSTREAM-REQ-005: all blank property rows retain source quads before target/policy additions", async () => {
  const inventory = await buildUpstreamRequirementInventory();
  assert.deepEqual(inventory.evidence.blankPropertyShapes, {
    sourceBlankPropertyShapes: 44,
    quadEquivalentSkolemCopies: 38,
    sourceSubsetPolicyWrappers: 6,
  });
  const blankRows = inventory.requirements.filter(({ sourceShapeBlankNode }) => sourceShapeBlankNode);
  assert.equal(blankRows.length, 44);
  assert.equal(blankRows.every(({ sourceShapeSha256, sourceQuadCount }) => (
    /^[a-f0-9]{64}$/u.test(sourceShapeSha256) && sourceQuadCount >= 3
  )), true);
});

test("UPSTREAM-REQ-006: official messages and local audit explanations cover every row", async () => {
  const inventory = await buildUpstreamRequirementInventory();
  const official = inventory.requirements.filter(({ messages }) => (
    messages.some(({ source }) => source === "official-shape")
  ));
  const local = inventory.requirements.filter(({ messages }) => (
    messages.some(({ source }) => source === "local-evidence")
  ));
  assert.equal(official.length, 6);
  assert.equal(local.length, 984);
  for (const row of inventory.requirements) {
    assert.ok(row.messages.length >= 1, row.requirementId);
    assert.match(row.remediation, /^MOLIT 로컬 적용 가이드/u, row.requirementId);
    assert.ok(row.localRationale.length >= 40, row.requirementId);
    for (const message of row.messages) {
      assert.match(message.language, /^(?:und|[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)$/u);
      if (message.source === "official-shape") {
        assert.ok([
          "http://www.w3.org/ns/shacl#message",
          "https://purl.eu/ns/shacl#message",
        ].includes(message.predicate));
      } else assert.equal(message.predicate, null);
    }
  }
  const expectedRemediationText = new Map([
    ["class", "rdf:type"],
    ["datatype", "datatype"],
    ["hasValue", "정확히"],
    ["maxCount", "이하"],
    ["minCount", "이상"],
    ["node", "NodeShape"],
    ["nodeKind", "node kind"],
  ]);
  for (const [component, marker] of expectedRemediationText) {
    const rows = inventory.requirements.filter(({ constraintComponents }) => constraintComponents.includes(component));
    assert.ok(rows.length > 0, component);
    assert.equal(rows.every(({ remediation }) => remediation.includes(marker)), true, component);
  }
  assert.equal(inventory.requirements.filter(({ sourceConstraintEnforceable }) => !sourceConstraintEnforceable)
    .every(({ remediation, localRationale }) => (
      remediation.includes("upstream 원문 외") && localRationale.includes("자체 위반")
    )), true);
});

test("UPSTREAM-REQ-007: CSV is the deterministic human-review projection", async () => {
  const inventory = await buildUpstreamRequirementInventory();
  const csvPath = path.join(releaseRoot, ...inventory.csvProjection.path.split("/"));
  const csv = await readFile(csvPath, "utf8");
  assert.equal(csv, upstreamRequirementCsvProjection(inventory.requirements));
  assert.equal(csv.split("\n")[0], UPSTREAM_CSV_COLUMNS.join(","));
  assert.equal(csv.split("\n").length, 992);
  assert.deepEqual(inventory.csvProjection.columns, [...UPSTREAM_CSV_COLUMNS]);
  assert.equal(
    inventory.csvProjection.sha256,
    createHash("sha256").update(Buffer.from(csv)).digest("hex"),
  );
});
