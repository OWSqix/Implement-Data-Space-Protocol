import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createEmptyState } from "../../src/discovery/state-repository.mjs";
import { schemaValidators } from "../../src/discovery/schema-validator.mjs";
import { synchronizeBatch } from "../../src/discovery/synchronizer.mjs";

async function fixture(name) {
  return JSON.parse(await readFile(
    new URL(`../../fixtures/discovery/${name}`, import.meta.url),
    "utf8",
  ));
}

const [baseline, delta, config, approvals] = await Promise.all([
  fixture("baseline.json"),
  fixture("delta.json"),
  fixture("config.json"),
  fixture("approvals.json"),
]);

test("CT-SCHEMA-001: versioned input fixtures satisfy executable JSON Schemas", () => {
  assert.equal(schemaValidators.metadataBatch(baseline), true);
  assert.equal(schemaValidators.metadataBatch(delta), true);
  assert.equal(schemaValidators.projectionConfig(config), true);
  assert.equal(schemaValidators.approvalRegistry(approvals), true);
});

test("CT-SCHEMA-002: generated review candidate satisfies its output Schema", () => {
  const result = synchronizeBatch(createEmptyState(), baseline, config, approvals);
  const record = result.state.records["mock-molit-platform::road-node-link-snapshot"];
  const candidate = record.offeringCandidate;

  assert.equal(schemaValidators.candidate(candidate), true);
  assert.equal(schemaValidators.discovery(record.discoveryProjection), true);
  assert.equal(candidate.automaticDispatchAllowed, false);
  assert.equal(candidate.routing, "internal-review-only");

  const boundedReasons = structuredClone(record.discoveryProjection);
  boundedReasons.offeringState = "PENDING_EVIDENCE";
  boundedReasons.decisionReasons = Array.from({ length: 214 }, (_, index) => ({
    code: `MISSING_${index}`,
    field: `field-${index}`,
    message: `missing field ${index}`,
  }));
  boundedReasons.evidenceIds = Array.from({ length: 300 }, (_, index) => `EVD-${index}`);
  assert.equal(schemaValidators.discovery(boundedReasons), true);
});

test("CT-SCHEMA-003: candidate Schema rejects private extension fields and invalid bindings", () => {
  const result = synchronizeBatch(createEmptyState(), baseline, config, approvals);
  const candidate = structuredClone(result.state.records[
    "mock-molit-platform::road-node-link-snapshot"
  ].offeringCandidate);
  candidate.registration.bindings[0].secretValue = "not-allowed";
  candidate.registration.bindings[0].sourceBindingRef = "https://source.invalid/data";

  assert.equal(schemaValidators.candidate(candidate), false);
  assert.ok(schemaValidators.candidate.errors.some((error) => (
    error.keyword === "additionalProperties" || error.keyword === "pattern"
  )));
});

test("CT-SCHEMA-004: batch Schema rejects unversioned fields before domain processing", () => {
  const invalid = structuredClone(baseline);
  invalid.records[0].record.apiKey = "forbidden";
  assert.equal(schemaValidators.metadataBatch(invalid), false);
  assert.ok(schemaValidators.metadataBatch.errors.some((error) => (
    error.keyword === "additionalProperties"
  )));
});

test("CT-SCHEMA-005: outbox Schema enforces synthetic non-dispatch routing", () => {
  const result = synchronizeBatch(createEmptyState(), baseline, config, approvals);
  const event = Object.values(result.state.outbox).find((item) => item.approvalGate);
  assert.equal(schemaValidators.outbox(event), true);
  assert.equal(event.schemaVersion, "molit.review-outbox-envelope/2");
  assert.equal(event.approvalGate.payloadDigest.length, 64);

  const injected = structuredClone(event);
  injected.automaticDispatchAllowed = true;
  injected.routing = "internal-review-only";
  assert.equal(schemaValidators.outbox(injected), false);

  const missingGate = structuredClone(event);
  delete missingGate.approvalGate;
  assert.equal(schemaValidators.outbox(missingGate), false);

  const deletion = {
    ...baseline,
    batchId: "schema-protective-delete",
    mode: "delta",
    observedAt: "2026-07-11T16:00:00+09:00",
    records: [{
      eventId: "schema-road-delete-v2",
      eventType: "record.deleted",
      recordId: "road-node-link-snapshot",
      resourceVersion: "2",
      occurredAt: "2026-07-11T15:59:00+09:00",
    }],
  };
  const deltaResult = synchronizeBatch(result.state, deletion, config, approvals);
  const protective = Object.values(deltaResult.state.outbox).find((item) => (
    item.type === "DISCOVERY_DELETE"
  ));
  const injectedProtective = structuredClone(protective);
  injectedProtective.approvalGate = event.approvalGate;
  assert.equal(schemaValidators.outbox(injectedProtective), false);

  const mismatchedPayload = structuredClone(protective);
  mismatchedPayload.family = "connector-review";
  mismatchedPayload.routing = "internal-review-only";
  mismatchedPayload.type = "CONNECTOR_REGISTRATION_REVIEW_WITHDRAW";
  assert.equal(schemaValidators.outbox(mismatchedPayload), false);
});
