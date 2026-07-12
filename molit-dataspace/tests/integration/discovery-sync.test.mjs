import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  reviewPendingOutboxEvents,
  synchronizeBatch as synchronizeBatchCore,
} from "../../src/discovery/synchronizer.mjs";
import {
  createEmptyState,
  loadState,
  saveState,
  withStateLock,
} from "../../src/discovery/state-repository.mjs";
import { computeOutboxEventId } from "../../src/discovery/outbox-integrity.mjs";
import { digest, stableStringify } from "../../src/discovery/stable-json.mjs";

const baseline = JSON.parse(
  await readFile(new URL("../../fixtures/discovery/baseline.json", import.meta.url), "utf8"),
);
const delta = JSON.parse(
  await readFile(new URL("../../fixtures/discovery/delta.json", import.meta.url), "utf8"),
);
const config = JSON.parse(
  await readFile(new URL("../../fixtures/discovery/config.json", import.meta.url), "utf8"),
);
const approvals = JSON.parse(
  await readFile(new URL("../../fixtures/discovery/approvals.json", import.meta.url), "utf8"),
);

function synchronizeBatch(
  state,
  batch,
  selectedConfig = config,
  registry = approvals,
  options = { now: "2026-07-11T23:30:00+09:00" },
) {
  return synchronizeBatchCore(state, batch, selectedConfig, registry, options);
}

function pendingOutboxEvents(
  state,
  selectedConfig = config,
  registry = approvals,
  now = "2026-07-11T23:30:00+09:00",
) {
  return reviewPendingOutboxEvents(
    state,
    selectedConfig,
    registry,
    { clock: () => now },
  ).assessment.reviewable;
}

test("IT-PLT-001: baseline produces one approved candidate and preserves source mapping", () => {
  const { state, report } = synchronizeBatch(createEmptyState(), baseline, config);

  assert.equal(report.applied, 4);
  assert.equal(report.approved, 1);
  assert.equal(report.catalogOnly, 2);
  assert.equal(report.pendingEvidence, 1);
  assert.match(report.baselineNote, /not deleted/);
  assert.equal(Object.keys(state.records).length, 4);

  const eligible = state.records["mock-molit-platform::road-node-link-snapshot"];
  assert.equal(eligible.sourceRecordId, "road-node-link-snapshot");
  assert.equal(eligible.resourceVersion, "1");
  assert.equal(eligible.decision.state, "APPROVED");
  assert.equal(eligible.offeringCandidate.source.systemId, "mock-molit-platform");

  const nonDataset = state.records["mock-molit-platform::transport-research-agency"];
  assert.equal(nonDataset.decision.state, "CATALOG_ONLY");
  assert.equal(nonDataset.offeringCandidate, undefined);
});

test("FT-PLT-001: replaying the same batch is idempotent", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const second = synchronizeBatch(first.state, baseline, config);

  assert.equal(second.report.applied, 0);
  assert.equal(second.report.duplicates, 4);
  assert.equal(stableStringify(second.state), stableStringify(first.state));
});

test("IT-CAT-005: delta applies update and tombstone and ignores out-of-order version", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const second = synchronizeBatch(first.state, delta, config);

  assert.equal(second.report.applied, 3);
  assert.equal(second.report.stale, 1);
  assert.equal(second.report.withdrawn, 1);
  assert.equal(
    second.state.records["mock-molit-platform::road-node-link-snapshot"].canonical.title,
    "합성 표준 노드·링크 스냅숏 2판",
  );
  assert.equal(
    second.state.records["mock-molit-platform::unverified-traffic-api"].decision.state,
    "WITHDRAWN",
  );
  assert.equal(
    second.state.processedEvents[
      "mock-molit-platform::event-road-snapshot-stale-v1"
    ].result,
    "stale",
  );
});

test("IT-CAT-005: baseline omission never implies deletion", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const partial = structuredClone(baseline);
  partial.batchId = "mock-partial-baseline-002";
  partial.observedAt = "2026-07-11T16:00:00+09:00";
  partial.records = [];
  const second = synchronizeBatch(first.state, partial, config);

  assert.equal(second.report.withdrawn, 0);
  assert.equal(Object.keys(second.state.records).length, 4);
});

test("FT-PLT-001: same resourceVersion with different content fails without mutation", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const conflict = structuredClone(baseline);
  conflict.batchId = "mock-conflict-002";
  conflict.mode = "delta";
  conflict.records = [structuredClone(conflict.records[0])];
  conflict.records[0].eventId = "event-road-snapshot-v1-conflict";
  conflict.records[0].record.title = "같은 버전의 다른 내용";

  assert.throws(
    () => synchronizeBatch(first.state, conflict, config),
    (error) => error.code === "RESOURCE_VERSION_CONFLICT",
  );
  assert.equal(first.state.records["mock-molit-platform::road-node-link-snapshot"].canonical.title,
    "합성 표준 노드·링크 스냅숏");
});

test("ST-SEC-001: inline API key is rejected before state mutation", () => {
  const malicious = structuredClone(baseline);
  malicious.batchId = "mock-secret-001";
  malicious.records = [structuredClone(malicious.records[0])];
  malicious.records[0].eventId = "event-secret-001";
  malicious.records[0].record.apiKey = "SECRET_DO_NOT_LEAK";
  const initial = createEmptyState();

  assert.throws(
    () => synchronizeBatch(initial, malicious, config),
    (error) => ["INLINE_SECRET_FIELD", "METADATA_BATCH_SCHEMA_INVALID"].includes(error.code),
  );
  assert.deepEqual(initial, createEmptyState());
});

test("NFR-REL-003: JSON state repository persists an atomic, reloadable state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-discovery-"));
  const path = join(directory, "state.json");
  try {
    const result = synchronizeBatch(createEmptyState(), baseline, config);
    await saveState(path, result.state);
    const loaded = await loadState(path);
    assert.equal(stableStringify(loaded), stableStringify(result.state));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("IT-PLT-002: semantic-invalid record is quarantined without preserving its payload", () => {
  const malformed = structuredClone(baseline);
  malformed.batchId = "mock-malformed-001";
  malformed.records = [structuredClone(malformed.records[0])];
  malformed.records[0].eventId = "event-malformed-001";
  malformed.records[0].recordId = "malformed-record";
  malformed.records[0].record.publisher.id = "urn:mock:..";

  const { state, report } = synchronizeBatch(createEmptyState(), malformed, config);
  const entry = state.records["mock-molit-platform::malformed-record"];
  assert.equal(report.quarantined, 1);
  assert.equal(entry.decision.state, "QUARANTINED");
  assert.equal(entry.canonical, undefined);
  assert.equal(JSON.stringify(entry).includes("합성 표준 노드"), false);
});

test("ST-SEC-001: credential-like value and URL parameter fail closed", () => {
  const bearer = structuredClone(baseline);
  bearer.batchId = "mock-bearer-001";
  bearer.records = [structuredClone(bearer.records[0])];
  bearer.records[0].eventId = "event-bearer-001";
  bearer.records[0].record.description = "Bearer VERY_SECRET_TOKEN_VALUE";
  assert.throws(
    () => synchronizeBatch(createEmptyState(), bearer, config),
    (error) => error.code === "INLINE_SECRET_VALUE",
  );

  const temporaryAwsCredential = structuredClone(baseline);
  temporaryAwsCredential.batchId = "mock-aws-temporary-001";
  temporaryAwsCredential.records = [structuredClone(temporaryAwsCredential.records[0])];
  temporaryAwsCredential.records[0].eventId = "event-aws-temporary-001";
  temporaryAwsCredential.records[0].record.description = (
    "prefix_ASIA1234567890ABCDEF_suffix"
  );
  assert.throws(
    () => synchronizeBatch(createEmptyState(), temporaryAwsCredential, config),
    (error) => error.code === "INLINE_SECRET_VALUE",
  );

  const query = structuredClone(baseline);
  query.batchId = "mock-url-secret-001";
  query.records = [structuredClone(query.records[0])];
  query.records[0].eventId = "event-url-secret-001";
  query.records[0].record.landingPage = "https://catalog.poc.invalid/data?access_token=value";
  assert.throws(
    () => synchronizeBatch(createEmptyState(), query, config),
    (error) => [
      "INLINE_SECRET_VALUE",
      "SECRET_URL_PARAMETER",
      "METADATA_BATCH_SCHEMA_INVALID",
    ].includes(error.code),
  );
});

test("ST-POL-001: excluded and restricted records cannot produce Offering candidates", () => {
  const excluded = structuredClone(baseline);
  excluded.batchId = "mock-excluded-001";
  excluded.records = [structuredClone(excluded.records[0])];
  excluded.records[0].eventId = "event-excluded-001";
  excluded.records[0].record.accessRights = "excluded";
  const excludedResult = synchronizeBatch(createEmptyState(), excluded, config);
  const excludedEntry = excludedResult.state.records[
    "mock-molit-platform::road-node-link-snapshot"
  ];
  assert.equal(excludedEntry.decision.state, "QUARANTINED");
  assert.equal(excludedEntry.discoveryProjection, undefined);
  assert.equal(excludedEntry.offeringCandidate, undefined);

  const restricted = structuredClone(baseline);
  restricted.batchId = "mock-restricted-001";
  restricted.records = [structuredClone(restricted.records[0])];
  restricted.records[0].eventId = "event-restricted-001";
  restricted.records[0].record.accessRights = "restricted";
  const restrictedResult = synchronizeBatch(createEmptyState(), restricted, config);
  const restrictedEntry = restrictedResult.state.records[
    "mock-molit-platform::road-node-link-snapshot"
  ];
  assert.equal(restrictedEntry.decision.state, "PENDING_EVIDENCE");
  assert.equal(restrictedEntry.offeringCandidate, undefined);
  assert.equal(restrictedEntry.discoveryProjection, undefined);
});

test("ST-POL-001: quarantining an approved record removes previous public projections", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const excluded = structuredClone(baseline);
  excluded.batchId = "mock-excluded-v2";
  excluded.mode = "delta";
  excluded.records = [structuredClone(excluded.records[0])];
  excluded.records[0].eventId = "event-road-excluded-v2";
  excluded.records[0].resourceVersion = "2";
  excluded.records[0].record.accessRights = "excluded";
  const second = synchronizeBatch(first.state, excluded, config);
  const eventTypes = second.report.outboxEventIds.map((id) => second.state.outbox[id].type);

  assert.ok(eventTypes.includes("DISCOVERY_DELETE"));
  assert.ok(eventTypes.includes("CONNECTOR_REGISTRATION_REVIEW_WITHDRAW"));
});

test("IT-CAT-003: non-canonical identifiers are rejected before state mutation", () => {
  const nonCanonical = structuredClone(baseline);
  nonCanonical.batchId = "mock-nfkc-001";
  nonCanonical.records = [structuredClone(nonCanonical.records[0])];
  nonCanonical.records[0].eventId = "event-nfkc-001";
  nonCanonical.records[0].recordId = "cafe\u0301";

  assert.throws(
    () => synchronizeBatch(createEmptyState(), nonCanonical, config),
    (error) => error.code === "INVALID_IDENTIFIER",
  );
});

test("FT-PLT-001: event ledger keys are scoped by source system", () => {
  const firstBatch = structuredClone(baseline);
  firstBatch.records = [structuredClone(firstBatch.records[0])];
  const first = synchronizeBatch(createEmptyState(), firstBatch, config);

  const secondBatch = structuredClone(firstBatch);
  secondBatch.batchId = "mock-other-source-001";
  secondBatch.sourceSystemId = "other-mock-platform";
  const second = synchronizeBatch(first.state, secondBatch, config);
  assert.equal(second.report.applied, 1);
  assert.equal(Object.keys(second.state.processedEvents).length, 2);
});

test("NFR-REL-003: state lock rejects a concurrent writer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-discovery-lock-"));
  const path = join(directory, "state.json");
  try {
    await withStateLock(path, async () => {
      await assert.rejects(
        withStateLock(path, async () => undefined),
        (error) => error.code === "STATE_LOCKED",
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ST-POL-002: a self-asserted record change has no governance approval", () => {
  const unapproved = structuredClone(baseline);
  unapproved.batchId = "mock-unapproved-001";
  unapproved.records = [structuredClone(unapproved.records[0])];
  unapproved.records[0].eventId = "event-unapproved-001";
  unapproved.records[0].record.title = "승인 digest와 다른 자기신고 레코드";

  const result = synchronizeBatch(createEmptyState(), unapproved, config);
  const entry = result.state.records["mock-molit-platform::road-node-link-snapshot"];
  assert.equal(entry.canonical.governanceApproval.status, "unverified");
  assert.equal(entry.decision.state, "PENDING_EVIDENCE");
  assert.equal(entry.discoveryProjection, undefined);
  assert.equal(entry.offeringCandidate, undefined);
});

test("NFR-OPS-001: Connector endpoint change reprojects an existing candidate", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const nextConfig = {
    ...config,
    allowedConnectorHosts: ["provider-connector-2.poc.invalid"],
    providerConnectorEndpoint: "https://provider-connector-2.poc.invalid/dsp/2025-1",
  };
  const empty = {
    ...baseline,
    batchId: "mock-config-change-001",
    mode: "delta",
    observedAt: "2026-07-11T16:00:00+09:00",
    records: [],
  };
  const second = synchronizeBatch(first.state, empty, nextConfig);
  const entry = second.state.records["mock-molit-platform::road-node-link-snapshot"];
  const service = entry.offeringCandidate.catalogProjection["@graph"].find(
    (item) => item["@type"] === "dcat:DataService",
  );
  const eventTypes = second.report.outboxEventIds.map((id) => second.state.outbox[id].type);

  assert.equal(service["dcat:endpointURL"]["@id"], nextConfig.providerConnectorEndpoint);
  assert.ok(eventTypes.includes("CONNECTOR_REGISTRATION_REVIEW"));
  assert.ok(second.report.reconciled > 0);
});

test("NFR-OPS-001: simultaneous config and metadata changes retain prior Dataset IDs", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const configB = { ...config, identifierNamespace: "urn:kr:molit-dataspace:poc:b" };
  const update = {
    ...delta,
    batchId: "config-b-with-road-v2",
    records: [structuredClone(delta.records[0])],
  };
  const second = synchronizeBatch(first.state, update, configB);
  let pending = Object.values(second.state.outbox).find((event) => (
    event.status === "pending" && event.family === "connector-review"
  ));
  assert.equal(pending.type, "CONNECTOR_REGISTRATION_REVIEW_REPLACE");
  assert.equal(pending.payload.previousDatasetIds.length, 1);
  assert.ok(pending.payload.previousDatasetIds[0].includes(":poc:dataset:"));

  const configC = { ...config, identifierNamespace: "urn:kr:molit-dataspace:poc:c" };
  const empty = {
    ...baseline,
    batchId: "config-c-after-unconfirmed-b",
    mode: "delta",
    records: [],
  };
  const third = synchronizeBatch(second.state, empty, configC);
  pending = Object.values(third.state.outbox).find((event) => (
    event.status === "pending" && event.family === "connector-review"
  ));
  assert.equal(pending.type, "CONNECTOR_REGISTRATION_REVIEW_REPLACE");
  assert.equal(pending.payload.previousDatasetIds.length, 2);
  assert.ok(pending.payload.previousDatasetIds.some((id) => id.includes(":poc:dataset:")));
  assert.ok(pending.payload.previousDatasetIds.some((id) => id.includes(":poc:b:dataset:")));

  const { assessment } = reviewPendingOutboxEvents(
    third.state,
    configC,
    approvals,
    { clock: () => "2026-07-11T23:31:00+09:00" },
  );
  assert.ok(assessment.reviewable.some((event) => event.id === pending.id));
});

test("ST-POL-002: approval registry change withdraws prior public projections", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const revoked = structuredClone(approvals);
  const road = revoked.entries.find((entry) => (
    entry.recordId === "road-node-link-snapshot" && entry.resourceVersion === "1"
  ));
  road.catalogVisibility = "internal";
  road.offeringDecision = "denied";
  const empty = {
    ...baseline,
    batchId: "mock-approval-change-001",
    mode: "delta",
    observedAt: "2026-07-11T16:00:00+09:00",
    records: [],
  };
  const second = synchronizeBatch(first.state, empty, config, revoked);
  const entry = second.state.records["mock-molit-platform::road-node-link-snapshot"];
  const eventTypes = second.report.outboxEventIds.map((id) => second.state.outbox[id].type);

  assert.equal(entry.decision.state, "PENDING_EVIDENCE");
  assert.equal(entry.discoveryProjection, undefined);
  assert.equal(entry.offeringCandidate, undefined);
  assert.ok(eventTypes.includes("DISCOVERY_DELETE"));
  assert.ok(eventTypes.includes("CONNECTOR_REGISTRATION_REVIEW_WITHDRAW"));
});

test("IT-CAT-005: WITHDRAWN is terminal for the same source record ID", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const deletion = {
    ...baseline,
    batchId: "mock-road-delete-002",
    mode: "delta",
    observedAt: "2026-07-11T16:00:00+09:00",
    records: [{
      eventId: "event-road-delete-002",
      eventType: "record.deleted",
      recordId: "road-node-link-snapshot",
      resourceVersion: "2",
      occurredAt: "2026-07-11T15:50:00+09:00",
    }],
  };
  const withdrawn = synchronizeBatch(first.state, deletion, config);
  const revival = {
    ...baseline,
    batchId: "mock-road-revival-003",
    mode: "delta",
    observedAt: "2026-07-11T17:00:00+09:00",
    records: [structuredClone(baseline.records[0])],
  };
  revival.records[0].eventId = "event-road-revival-003";
  revival.records[0].resourceVersion = "3";

  assert.throws(
    () => synchronizeBatch(withdrawn.state, revival, config),
    (error) => error.code === "TERMINAL_RECORD_REVIVAL",
  );
});

test("NFR-REL-001: outbox retains only the latest pending command per aggregate family", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const second = synchronizeBatch(first.state, delta, config);
  const roadKey = "mock-molit-platform::road-node-link-snapshot";
  const pending = pendingOutboxEvents(second.state).filter((event) => (
    event.aggregateKey === roadKey
  ));

  assert.deepEqual(pending.map((event) => event.family).sort(), ["connector-review", "discovery"]);
  assert.ok(Object.values(second.state.outbox).some((event) => event.status === "superseded"));
});

test("IT-PLT-002: missing binding evidence is pending rather than malformed", () => {
  const missing = structuredClone(baseline);
  missing.batchId = "mock-missing-binding-001";
  missing.records = [structuredClone(missing.records[0])];
  missing.records[0].eventId = "event-missing-binding-001";
  delete missing.records[0].record.distributions[0].sourceBindingRef;
  const result = synchronizeBatch(createEmptyState(), missing, config);
  const entry = result.state.records["mock-molit-platform::road-node-link-snapshot"];

  assert.equal(entry.decision.state, "PENDING_EVIDENCE");
  assert.ok(entry.decision.reasons.some((reason) => reason.code === "MISSING_SOURCE_BINDING"));
});

test("ST-AUD-001: invalid calendar timestamps and deep input fail closed", () => {
  const invalidTime = structuredClone(baseline);
  invalidTime.observedAt = "2026-02-30T00:00:00Z";
  assert.throws(
    () => synchronizeBatch(createEmptyState(), invalidTime, config),
    (error) => ["INVALID_TIMESTAMP", "METADATA_BATCH_SCHEMA_INVALID"].includes(error.code),
  );

  const deep = structuredClone(baseline);
  deep.batchId = "mock-deep-input-001";
  deep.records = [structuredClone(deep.records[0])];
  deep.records[0].eventId = "event-deep-input-001";
  let cursor = deep.records[0].record;
  for (let depth = 0; depth < 40; depth += 1) {
    cursor.extra = {};
    cursor = cursor.extra;
  }
  assert.throws(
    () => synchronizeBatch(createEmptyState(), deep, config),
    (error) => ["INPUT_TOO_COMPLEX", "METADATA_BATCH_SCHEMA_INVALID"].includes(error.code),
  );
});

test("NFR-REL-003: stale lock fails closed until operator recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-discovery-stale-lock-"));
  const path = join(directory, "state.json");
  try {
    await writeFile(`${path}.lock`, JSON.stringify({
      pid: 2_000_000_000,
      host: hostname(),
      acquiredAt: "2026-07-11T00:00:00Z",
    }));
    await assert.rejects(
      withStateLock(path, async () => "must-not-run"),
      (error) => error.code === "STATE_LOCKED",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("NFR-OPS-001: A-B-A-B config cycle leaves the latest B review pending", () => {
  const configB = {
    ...config,
    allowedConnectorHosts: ["provider-connector-b.poc.invalid"],
    providerConnectorEndpoint: "https://provider-connector-b.poc.invalid/dsp/2025-1",
  };
  let result = synchronizeBatch(createEmptyState(), baseline, config);
  const empty = (id) => ({
    ...baseline,
    batchId: id,
    mode: "delta",
    records: [],
  });
  result = synchronizeBatch(result.state, empty("config-cycle-b1"), configB);
  result = synchronizeBatch(result.state, empty("config-cycle-a2"), config);
  result = synchronizeBatch(result.state, empty("config-cycle-b3"), configB);

  const event = pendingOutboxEvents(result.state, configB).find((item) => (
    item.aggregateKey === "mock-molit-platform::road-node-link-snapshot"
      && item.family === "connector-review"
  ));
  const candidate = event.type === "CONNECTOR_REGISTRATION_REVIEW_REPLACE"
    ? event.payload.candidate
    : event.payload;
  const service = candidate.catalogProjection["@graph"].find(
    (item) => item["@type"] === "dcat:DataService",
  );

  assert.equal(event.status, "pending");
  assert.equal(service["dcat:endpointURL"]["@id"], configB.providerConnectorEndpoint);
});

test("ST-POL-002: trusted processing clock expires approval despite backdated source time", () => {
  const backdated = {
    ...baseline,
    batchId: "backdated-expiry-attempt",
    observedAt: "2026-07-11T14:00:00+09:00",
    records: [structuredClone(baseline.records[0])],
  };
  const result = synchronizeBatch(
    createEmptyState(),
    backdated,
    config,
    approvals,
    { now: "2028-07-11T14:00:00+09:00" },
  );
  const entry = result.state.records["mock-molit-platform::road-node-link-snapshot"];

  assert.equal(entry.canonical.governanceApproval.reason, "APPROVAL_EXPIRED");
  assert.equal(entry.offeringCandidate, undefined);
  assert.equal(entry.discoveryProjection, undefined);
});

test("NFR-REL-003: state byte limit rejects write and removes temporary residue", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-state-cap-"));
  const path = join(directory, "state.json");
  const state = createEmptyState();
  state.processedEvents.large = { value: "x".repeat(2_000) };
  try {
    await assert.rejects(
      saveState(path, state, { maxBytes: 512 }),
      (error) => error.code === "STATE_TOO_LARGE",
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ST-AUD-001: changing occurredAt on the same event ID is a conflict", () => {
  const firstBatch = structuredClone(baseline);
  firstBatch.records = [structuredClone(firstBatch.records[0])];
  const first = synchronizeBatch(createEmptyState(), firstBatch, config);
  const replay = structuredClone(firstBatch);
  replay.batchId = "event-time-conflict-002";
  replay.records[0].occurredAt = "2026-07-11T13:52:00+09:00";

  assert.throws(
    () => synchronizeBatch(first.state, replay, config),
    (error) => error.code === "EVENT_ID_CONFLICT",
  );
});

test("ST-SEC-003: S1 public metadata cannot advertise loopback URLs", () => {
  const loopback = structuredClone(baseline);
  loopback.batchId = "loopback-public-url-001";
  loopback.records = [structuredClone(loopback.records[0])];
  loopback.records[0].eventId = "event-loopback-public-url-001";
  loopback.records[0].record.landingPage = "https://127.0.0.1/dataset";
  const result = synchronizeBatch(createEmptyState(), loopback, config);
  const entry = result.state.records["mock-molit-platform::road-node-link-snapshot"];

  assert.equal(entry.decision.state, "QUARANTINED");
  assert.equal(entry.discoveryProjection, undefined);
  assert.equal(entry.offeringCandidate, undefined);
});

test("ST-POL-002: not-yet-valid approval is reevaluated when trusted time becomes due", () => {
  const earlyBatch = structuredClone(baseline);
  earlyBatch.observedAt = "2026-07-01T00:05:00+09:00";
  earlyBatch.records = [structuredClone(earlyBatch.records[0])];
  earlyBatch.records[0].occurredAt = "2026-07-01T00:00:00+09:00";
  const early = synchronizeBatch(
    createEmptyState(),
    earlyBatch,
    config,
    approvals,
    { now: "2026-07-01T00:00:00+09:00" },
  );
  let entry = early.state.records["mock-molit-platform::road-node-link-snapshot"];
  assert.equal(entry.canonical.governanceApproval.reason, "APPROVAL_NOT_YET_VALID");
  assert.equal(entry.offeringCandidate, undefined);

  const empty = {
    ...baseline,
    batchId: "approval-became-valid-001",
    mode: "delta",
    records: [],
  };
  const due = synchronizeBatch(
    early.state,
    empty,
    config,
    approvals,
    { now: "2026-07-12T00:00:00+09:00" },
  );
  entry = due.state.records["mock-molit-platform::road-node-link-snapshot"];
  assert.equal(entry.canonical.governanceApproval.status, "verified-synthetic");
  assert.equal(entry.decision.state, "APPROVED");
  assert.ok(entry.offeringCandidate);
});

test("ST-AUD-001: trusted processing clock cannot move backward", () => {
  const first = synchronizeBatch(
    createEmptyState(),
    baseline,
    config,
    approvals,
    { now: "2026-07-12T00:00:00+09:00" },
  );
  const empty = {
    ...baseline,
    batchId: "processing-clock-rollback-001",
    mode: "delta",
    observedAt: "2026-06-30T00:00:00+09:00",
    records: [],
  };

  assert.throws(
    () => synchronizeBatch(
      first.state,
      empty,
      config,
      approvals,
      { now: "2026-07-01T00:00:00+09:00" },
    ),
    (error) => error.code === "PROCESSING_CLOCK_REGRESSION",
  );
});

test("NFR-REL-001: sync report lists only commands still pending after the batch", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const updates = {
    ...delta,
    batchId: "multi-version-one-batch-001",
    records: [structuredClone(delta.records[0]), structuredClone(delta.records[0])],
  };
  updates.records[1].eventId = "event-road-snapshot-v3-unapproved";
  updates.records[1].resourceVersion = "3";
  updates.records[1].occurredAt = "2026-07-11T14:41:00+09:00";
  const result = synchronizeBatch(first.state, updates, config);

  assert.ok(result.report.outboxEventIds.length > 0);
  assert.ok(result.report.outboxEventIds.every((id) => (
    result.state.outbox[id].status === "pending"
  )));
});

test("ST-POL-003: review blocks approvals that expired after synchronization", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const { assessment, state } = reviewPendingOutboxEvents(
    first.state,
    config,
    approvals,
    { clock: () => "2028-07-11T12:00:01+09:00" },
  );

  assert.equal(assessment.reconciliationRequired, true);
  assert.equal(assessment.reviewable.length, 0);
  assert.ok(assessment.blocked.length > 0);
  assert.ok(assessment.blocked.every((item) => item.reason === "APPROVAL_EXPIRED"));
  assert.equal(state.lastReviewAt, "2028-07-11T12:00:01+09:00");

  assert.throws(
    () => reviewPendingOutboxEvents(
      state,
      config,
      approvals,
      { clock: () => "2026-07-12T00:00:01+09:00" },
    ),
    (error) => error.code === "REVIEW_CLOCK_REGRESSION",
  );

  const empty = {
    ...baseline,
    batchId: "review-clock-rollback-sync",
    mode: "delta",
    records: [],
  };
  assert.throws(
    () => synchronizeBatch(
      state,
      empty,
      config,
      approvals,
      { now: "2026-07-12T00:00:01+09:00" },
    ),
    (error) => error.code === "PROCESSING_CLOCK_REGRESSION",
  );
});

test("ST-POL-003: reconciliation replaces expired additions with protective reviews", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const empty = {
    ...baseline,
    batchId: "approval-expiry-reconcile",
    mode: "delta",
    records: [],
  };
  const reconciled = synchronizeBatch(
    first.state,
    empty,
    config,
    approvals,
    { now: "2028-07-11T12:00:01+09:00" },
  );
  const { assessment } = reviewPendingOutboxEvents(
    reconciled.state,
    config,
    approvals,
    { clock: () => "2028-07-11T12:00:02+09:00" },
  );

  assert.equal(assessment.reconciliationRequired, false);
  assert.equal(assessment.blocked.length, 0);
  assert.ok(assessment.reviewable.length > 0);
  assert.ok(assessment.reviewable.every((event) => (
    ["DISCOVERY_DELETE", "CONNECTOR_REGISTRATION_REVIEW_WITHDRAW"].includes(event.type)
  )));
});

test("ST-POL-003: newer unapproved version refreshes a pending withdrawal", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const empty = {
    ...baseline,
    batchId: "approval-expiry-before-new-version",
    mode: "delta",
    records: [],
  };
  const expired = synchronizeBatch(
    first.state,
    empty,
    config,
    approvals,
    { now: "2028-07-11T12:00:01+09:00" },
  );
  const update = {
    ...delta,
    batchId: "unapproved-version-after-expiry",
    observedAt: "2028-07-11T12:01:00+09:00",
    records: [structuredClone(delta.records[0])],
  };
  update.records[0].eventId = "unapproved-road-v2-after-expiry";
  update.records[0].occurredAt = "2028-07-11T12:00:30+09:00";
  const updated = synchronizeBatch(
    expired.state,
    update,
    config,
    approvals,
    { now: "2028-07-11T12:01:01+09:00" },
  );
  const connector = Object.values(updated.state.outbox).find((event) => (
    event.status === "pending" && event.family === "connector-review"
  ));
  assert.equal(connector.type, "CONNECTOR_REGISTRATION_REVIEW_WITHDRAW");
  assert.equal(connector.resourceVersion, "2");

  const { assessment } = reviewPendingOutboxEvents(
    updated.state,
    config,
    approvals,
    { clock: () => "2028-07-11T12:01:02+09:00" },
  );
  assert.ok(assessment.reviewable.some((event) => event.id === connector.id));
});

test("ST-POL-003: withdrawal retains every unconfirmed candidate Dataset ID", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const configB = {
    ...config,
    identifierNamespace: "urn:kr:molit-dataspace:poc:v2",
  };
  const empty = (batchId) => ({
    ...baseline,
    batchId,
    mode: "delta",
    records: [],
  });
  const replaced = synchronizeBatch(
    first.state,
    empty("candidate-id-history-replace"),
    configB,
    approvals,
    { now: "2026-07-12T00:00:00+09:00" },
  );
  const expired = synchronizeBatch(
    replaced.state,
    empty("candidate-id-history-expire"),
    configB,
    approvals,
    { now: "2028-07-11T12:00:01+09:00" },
  );
  const withdrawal = Object.values(expired.state.outbox).find((event) => (
    event.status === "pending" && event.type === "CONNECTOR_REGISTRATION_REVIEW_WITHDRAW"
  ));

  assert.equal(withdrawal.payload.candidateDatasetIds.length, 2);
  assert.ok(withdrawal.payload.candidateDatasetIds.some((id) => id.includes(":poc:dataset:")));
  assert.ok(withdrawal.payload.candidateDatasetIds.some((id) => id.includes(":poc:v2:dataset:")));
  const { assessment } = reviewPendingOutboxEvents(
    expired.state,
    configB,
    approvals,
    { clock: () => "2028-07-11T12:00:02+09:00" },
  );
  assert.ok(assessment.reviewable.some((event) => event.id === withdrawal.id));
});

test("ST-POL-003: current registry and config must be reconciled before review", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const changedRegistry = structuredClone(approvals);
  changedRegistry.registryId = "mock-governance-registry-2026-revised";
  const changedConfig = {
    ...config,
    allowedConnectorHosts: ["provider-connector-revised.poc.invalid"],
    providerConnectorEndpoint: "https://provider-connector-revised.poc.invalid/dsp/2025-1",
  };

  for (const [selectedConfig, registry] of [
    [config, changedRegistry],
    [changedConfig, approvals],
  ]) {
    assert.throws(
      () => reviewPendingOutboxEvents(
        first.state,
        selectedConfig,
        registry,
        { clock: () => "2026-07-11T23:31:00+09:00" },
      ),
      (error) => error.code === "RECONCILIATION_REQUIRED",
    );
  }
});

test("ST-AUD-002: review detects approval gate and canonical state tampering", () => {
  const first = synchronizeBatch(createEmptyState(), baseline, config);
  const gateTampered = structuredClone(first.state);
  const active = Object.values(gateTampered.outbox).find((event) => event.approvalGate);
  active.approvalGate.payloadDigest = "0".repeat(64);
  assert.throws(
    () => reviewPendingOutboxEvents(
      gateTampered,
      config,
      approvals,
      { clock: () => "2026-07-11T23:31:00+09:00" },
    ),
    (error) => error.code === "OUTBOX_INTEGRITY_ERROR",
  );

  const gateTimeTampered = structuredClone(first.state);
  const timed = Object.values(gateTimeTampered.outbox).find((event) => event.approvalGate);
  const previousId = timed.id;
  timed.approvalGate.evaluatedAt = "2020-01-01T00:00:00Z";
  timed.id = computeOutboxEventId(timed);
  delete gateTimeTampered.outbox[previousId];
  gateTimeTampered.outbox[timed.id] = timed;
  assert.throws(
    () => reviewPendingOutboxEvents(
      gateTimeTampered,
      config,
      approvals,
      { clock: () => "2026-07-11T23:31:00+09:00" },
    ),
    (error) => error.code === "OUTBOX_APPROVAL_GATE_INVALID",
  );

  const canonicalTampered = structuredClone(first.state);
  canonicalTampered.records[
    "mock-molit-platform::road-node-link-snapshot"
  ].canonical.title = "tampered";
  assert.throws(
    () => reviewPendingOutboxEvents(
      canonicalTampered,
      config,
      approvals,
      { clock: () => "2026-07-11T23:31:00+09:00" },
    ),
    (error) => error.code === "STATE_RECORD_INTEGRITY_ERROR",
  );

  const pairedCanonicalTamper = structuredClone(first.state);
  const pairedEntry = pairedCanonicalTamper.records[
    "mock-molit-platform::road-node-link-snapshot"
  ];
  pairedEntry.canonical.title = "tampered-with-recomputed-digest";
  pairedEntry.canonicalRecordDigest = digest(pairedEntry.canonical);
  assert.throws(
    () => reviewPendingOutboxEvents(
      pairedCanonicalTamper,
      config,
      approvals,
      { clock: () => "2026-07-11T23:31:00+09:00" },
    ),
    (error) => error.code === "OUTBOX_DERIVED_STATE_INVALID",
  );

  const candidateTampered = structuredClone(first.state);
  const connectorEvent = Object.values(candidateTampered.outbox).find((event) => (
    event.type === "CONNECTOR_REGISTRATION_REVIEW"
  ));
  const connectorPreviousId = connectorEvent.id;
  const attackerBinding = "binding://attacker/redirect";
  connectorEvent.payload.registration.bindings[0].sourceBindingRef = attackerBinding;
  connectorEvent.approvalGate.payloadDigest = digest(connectorEvent.payload);
  connectorEvent.id = computeOutboxEventId(connectorEvent);
  delete candidateTampered.outbox[connectorPreviousId];
  candidateTampered.outbox[connectorEvent.id] = connectorEvent;
  candidateTampered.records[
    "mock-molit-platform::road-node-link-snapshot"
  ].offeringCandidate.registration.bindings[0].sourceBindingRef = attackerBinding;
  assert.throws(
    () => reviewPendingOutboxEvents(
      candidateTampered,
      config,
      approvals,
      { clock: () => "2026-07-11T23:31:00+09:00" },
    ),
    (error) => error.code === "OUTBOX_PROJECTION_STALE",
  );

  const unrelatedHistory = structuredClone(first.state);
  unrelatedHistory.records[
    "mock-molit-platform::road-node-link-snapshot"
  ].knownCandidateDatasetIds.push("urn:kr:victim-space:dataset:unrelated");
  assert.throws(
    () => reviewPendingOutboxEvents(
      unrelatedHistory,
      config,
      approvals,
      { clock: () => "2026-07-11T23:31:00+09:00" },
    ),
    (error) => error.code === "INVALID_STATE",
  );
});

test("ST-POL-003: approval identifiers are unique within a registry", () => {
  const duplicateId = structuredClone(approvals);
  duplicateId.entries[1].approvalId = duplicateId.entries[0].approvalId;
  assert.throws(
    () => synchronizeBatch(createEmptyState(), baseline, config, duplicateId),
    (error) => error.code === "DUPLICATE_APPROVAL_ID",
  );
});
