import { digest, stableStringify } from "./stable-json.mjs";
import { BridgeError, invariant } from "./errors.mjs";
import {
  decideDiscoveryVisibility,
  decideOffering,
  normalizeRecord,
  quarantineDecision,
} from "./model.mjs";
import { toDiscoveryProjection, toOfferingCandidate, validateProjectionConfig } from "./projection.mjs";
import { identifierTupleKey, validateBatch, validateTimestamp } from "./validation.mjs";
import { validateState } from "./state-repository.mjs";
import { indexApprovalRegistry, resolveApproval } from "./approval-registry.mjs";
import { validateMetadataBatchDocument } from "./schema-validator.mjs";
import { computeOutboxEventId } from "./outbox-integrity.mjs";

const pendingOutboxIndexes = new WeakMap();
const ACTIVE_APPROVAL_COMMAND_TYPES = new Set([
  "DISCOVERY_UPSERT",
  "CONNECTOR_REGISTRATION_REVIEW",
  "CONNECTOR_REGISTRATION_REVIEW_REPLACE",
]);
const PROTECTIVE_COMMAND_TYPES = new Set([
  "DISCOVERY_DELETE",
  "CONNECTOR_REGISTRATION_REVIEW_WITHDRAW",
]);

function recordKey(sourceSystemId, recordId) {
  return identifierTupleKey(sourceSystemId, recordId);
}

function compareVersions(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function trustedClockWatermark(state) {
  const values = [state.lastEvaluationAt, state.lastReviewAt].filter(Boolean);
  if (values.length === 0) {
    return null;
  }
  return values.reduce((latest, value) => (
    Date.parse(value) > Date.parse(latest) ? value : latest
  ));
}

function eventResourceDigest(event) {
  return digest({
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    recordId: event.recordId,
    resourceVersion: event.resourceVersion,
    record: event.record,
  });
}

function addOutbox(state, type, key, version, payload, { approvalGate } = {}) {
  invariant(
    Number.isSafeInteger(state.nextOutboxSequence),
    "OUTBOX_SEQUENCE_EXHAUSTED",
    "outbox sequence is not a safe integer",
  );
  const sequence = state.nextOutboxSequence;
  state.nextOutboxSequence += 1;
  const id = computeOutboxEventId({
    approvalGate,
    sequence,
    type,
    aggregateKey: key,
    resourceVersion: version,
    payload,
  });
  const family = type.startsWith("DISCOVERY_") ? "discovery" : "connector-review";
  const pendingKey = `${key}\u0000${family}`;
  const pendingIndex = pendingOutboxIndex(state);
  const previousId = pendingIndex.get(pendingKey);
  if (previousId) {
    const previous = state.outbox[previousId];
    previous.status = "superseded";
    previous.supersededBy = id;
  }
  setOwn(state.outbox, id, {
    schemaVersion: "molit.review-outbox-envelope/2",
    automaticDispatchAllowed: false,
    family,
    id,
    sequence,
    type,
    aggregateKey: key,
    resourceVersion: version,
    routing: family === "discovery"
      ? "synthetic-discovery-review-only"
      : "internal-review-only",
    status: "pending",
    trustMode: "synthetic-test-only",
    payload,
    ...(approvalGate ? { approvalGate } : {}),
  });
  pendingIndex.set(pendingKey, id);
  return id;
}

function pendingOutboxIndex(state) {
  let index = pendingOutboxIndexes.get(state);
  if (index) {
    return index;
  }
  index = new Map();
  for (const event of Object.values(state.outbox)) {
    if (event.status === "pending") {
      index.set(`${event.aggregateKey}\u0000${event.family}`, event.id);
    }
  }
  pendingOutboxIndexes.set(state, index);
  return index;
}

function own(dictionary, key) {
  return Object.hasOwn(dictionary, key) ? dictionary[key] : undefined;
}

function setOwn(dictionary, key, value) {
  Object.defineProperty(dictionary, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function compactOutbox(state) {
  const superseded = new Map();
  for (const event of Object.values(state.outbox)) {
    if (event.status !== "superseded") {
      continue;
    }
    const key = `${event.aggregateKey}\u0000${event.family}`;
    const values = superseded.get(key) ?? [];
    values.push(event);
    superseded.set(key, values);
  }

  for (const values of superseded.values()) {
    values.sort((left, right) => {
      const versionOrder = compareVersions(right.resourceVersion, left.resourceVersion);
      return versionOrder || right.sequence - left.sequence;
    });
    for (const obsolete of values.slice(5)) {
      delete state.outbox[obsolete.id];
    }
  }
}

function enforceStateCapacity(state) {
  invariant(
    Object.keys(state.records).length <= 100_000
      && Object.keys(state.processedEvents).length <= 250_000
      && Object.keys(state.outbox).length <= 200_000,
    "STATE_CAPACITY_EXCEEDED",
    "S1 state capacity was exceeded; migrate to the transactional store",
  );
}

function minimalQuarantineEntry(batch, event, decision, resourceDigest, previous = undefined) {
  return {
    sourceSystemId: batch.sourceSystemId,
    sourceRecordId: event.recordId,
    resourceVersion: event.resourceVersion,
    eventResourceDigest: resourceDigest,
    lastEventId: event.eventId,
    lastObservedAt: batch.observedAt,
    lastOccurredAt: event.occurredAt,
    ...(knownCandidateDatasetIds(previous).length > 0
      ? { knownCandidateDatasetIds: knownCandidateDatasetIds(previous) }
      : {}),
    ...(previous?.discoveryWasProjected ? { discoveryWasProjected: true } : {}),
    decision,
  };
}

function knownCandidateDatasetIds(previous, currentCandidate = undefined) {
  const identifiers = new Set(previous?.knownCandidateDatasetIds ?? []);
  const previousId = previous?.offeringCandidate?.registration?.datasetId;
  const currentId = currentCandidate?.registration?.datasetId;
  if (previousId) {
    identifiers.add(previousId);
  }
  if (currentId) {
    identifiers.add(currentId);
  }
  invariant(
    identifiers.size <= 50,
    "CANDIDATE_HISTORY_EXCEEDED",
    "candidate Dataset ID history requires an applied-resource ledger",
  );
  return [...identifiers].sort();
}

function withdrawalPayload(previous, batch, event, reason) {
  const candidateDatasetIds = knownCandidateDatasetIds(previous);
  invariant(
    candidateDatasetIds.length > 0,
    "WITHDRAWAL_TARGET_MISSING",
    "connector withdrawal requires at least one prior candidate Dataset ID",
  );
  return {
    schemaVersion: "molit.connector-registration-withdrawal/1",
    source: {
      systemId: batch.sourceSystemId,
      recordId: event.recordId,
    },
    candidateDatasetIds,
    reason,
  };
}

function discoveryDeletePayload(batch, event, reason) {
  return {
    schemaVersion: "molit.discovery-delete/1",
    source: { systemId: batch.sourceSystemId, recordId: event.recordId },
    reason,
  };
}

function registrationReplacementPayload(previous, candidate, reason) {
  const currentDatasetId = candidate.registration.datasetId;
  const previousDatasetIds = knownCandidateDatasetIds(previous).filter((id) => (
    id !== currentDatasetId
  ));
  invariant(
    previousDatasetIds.length > 0,
    "REPLACEMENT_TARGET_MISSING",
    "connector replacement requires a prior candidate Dataset ID",
  );
  return {
    schemaVersion: "molit.connector-registration-replacement/1",
    automaticDispatchAllowed: false,
    routing: "internal-review-only",
    previousDatasetIds,
    candidate,
    reason,
  };
}

function candidateReviewCommand(previous, candidate, reason) {
  const currentDatasetId = candidate.registration.datasetId;
  const requiresReplacement = knownCandidateDatasetIds(previous).some((id) => (
    id !== currentDatasetId
  ));
  return requiresReplacement
    ? {
      type: "CONNECTOR_REGISTRATION_REVIEW_REPLACE",
      payload: registrationReplacementPayload(previous, candidate, reason),
    }
    : {
      type: "CONNECTOR_REGISTRATION_REVIEW",
      payload: candidate,
    };
}

function activeApprovalGate({
  approvalRegistryDigest,
  canonical,
  evaluatedAt,
  observedRecordDigest,
  payload,
  projectionConfigDigest,
  resourceVersion,
}) {
  const approval = canonical.governanceApproval;
  invariant(
    approval?.status === "verified-synthetic",
    "OUTBOX_APPROVAL_REQUIRED",
    "active review commands require a verified synthetic approval",
  );
  return {
    approvalRegistryDigest,
    registryId: approval.registryId,
    approvalEntryDigest: approval.approvalEntryDigest,
    approvalId: approval.approvalId,
    approverId: approval.approverId,
    sourceSystemId: canonical.sourceSystemId,
    recordId: canonical.sourceRecordId,
    resourceVersion,
    recordDigest: observedRecordDigest,
    approvedAt: approval.approvedAt,
    validUntil: approval.validUntil,
    catalogVisibility: approval.catalogVisibility,
    offeringDecision: approval.offeringDecision,
    evaluatedAt,
    payloadDigest: digest(payload),
    projectionConfigDigest,
  };
}

function reconcileStoredRecords(state, {
  approvalIndex,
  approvalRegistryDigest,
  evaluatedAt,
  projectionConfig,
  projectionConfigDigest,
  report,
}) {
  const approvalChanged = state.approvalRegistryDigest !== null
    && state.approvalRegistryDigest !== approvalRegistryDigest;
  const approvalExpired = Object.values(state.records).some((entry) => (
    entry.canonical?.governanceApproval?.status === "verified-synthetic"
      && Date.parse(evaluatedAt) > Date.parse(entry.canonical.governanceApproval.validUntil)
  ));
  const approvalDue = Object.values(state.records).some((entry) => (
    entry.canonical?.governanceApproval?.nextEvaluationAt
      && Date.parse(evaluatedAt)
        >= Date.parse(entry.canonical.governanceApproval.nextEvaluationAt)
  ));
  const approvalMustBeReevaluated = approvalChanged || approvalExpired || approvalDue;
  const configChanged = state.projectionConfigDigest !== null
    && state.projectionConfigDigest !== projectionConfigDigest;
  const activeGateContextChanged = approvalChanged || configChanged;

  if (!approvalMustBeReevaluated && !configChanged) {
    state.approvalRegistryDigest = approvalRegistryDigest;
    state.projectionConfigDigest = projectionConfigDigest;
    return;
  }

  for (const [key, previous] of Object.entries(state.records)) {
    if (!previous.canonical || previous.decision?.state === "WITHDRAWN") {
      continue;
    }

    const governanceApproval = resolveApproval(approvalIndex, {
      evaluatedAt,
      record: previous.observedRecord,
      recordId: previous.sourceRecordId,
      resourceVersion: previous.resourceVersion,
      sourceSystemId: previous.sourceSystemId,
    });
    const canonical = normalizeRecord({
      governanceApproval,
      sourceSystemId: previous.sourceSystemId,
      recordId: previous.sourceRecordId,
      record: previous.observedRecord,
    });
    const decision = decideOffering(canonical);
    const discoveryDecision = decideDiscoveryVisibility(canonical, decision);
    const discoveryProjection = discoveryDecision.publish
      ? toDiscoveryProjection(canonical, decision)
      : undefined;
    const offeringCandidate = decision.state === "APPROVED"
      ? toOfferingCandidate(canonical, decision, projectionConfig)
      : undefined;
    const contextBatch = { sourceSystemId: previous.sourceSystemId };
    const contextEvent = {
      recordId: previous.sourceRecordId,
      resourceVersion: previous.resourceVersion,
    };

    if (discoveryProjection && (
      !previous.discoveryProjection
      || digest(discoveryProjection) !== digest(previous.discoveryProjection)
      || activeGateContextChanged
    )) {
      report.outboxEventIds.push(addOutbox(
        state,
        "DISCOVERY_UPSERT",
        key,
        previous.resourceVersion,
        discoveryProjection,
        { approvalGate: activeApprovalGate({
          approvalRegistryDigest,
          canonical,
          evaluatedAt,
          observedRecordDigest: previous.observedRecordDigest,
          payload: discoveryProjection,
          projectionConfigDigest,
          resourceVersion: previous.resourceVersion,
        }) },
      ));
    } else if (!discoveryProjection && previous.discoveryProjection) {
      report.outboxEventIds.push(addOutbox(
        state,
        "DISCOVERY_DELETE",
        key,
        previous.resourceVersion,
        discoveryDeletePayload(contextBatch, contextEvent, discoveryDecision.reason),
      ));
    }

    if (offeringCandidate && previous.offeringCandidate
      && (digest(offeringCandidate) !== digest(previous.offeringCandidate)
        || activeGateContextChanged)) {
      const command = candidateReviewCommand(
        previous,
        offeringCandidate,
        approvalMustBeReevaluated ? "APPROVAL_REEVALUATED" : "PROJECTION_CONFIG_CHANGED",
      );
      report.outboxEventIds.push(addOutbox(
        state,
        command.type,
        key,
        previous.resourceVersion,
        command.payload,
        { approvalGate: activeApprovalGate({
          approvalRegistryDigest,
          canonical,
          evaluatedAt,
          observedRecordDigest: previous.observedRecordDigest,
          payload: command.payload,
          projectionConfigDigest,
          resourceVersion: previous.resourceVersion,
        }) },
      ));
    } else if (offeringCandidate && !previous.offeringCandidate) {
      const command = candidateReviewCommand(
        previous,
        offeringCandidate,
        approvalMustBeReevaluated ? "APPROVAL_REEVALUATED" : "PROJECTION_CONFIG_CHANGED",
      );
      report.outboxEventIds.push(addOutbox(
        state,
        command.type,
        key,
        previous.resourceVersion,
        command.payload,
        { approvalGate: activeApprovalGate({
          approvalRegistryDigest,
          canonical,
          evaluatedAt,
          observedRecordDigest: previous.observedRecordDigest,
          payload: command.payload,
          projectionConfigDigest,
          resourceVersion: previous.resourceVersion,
        }) },
      ));
    } else if (!offeringCandidate && knownCandidateDatasetIds(previous).length > 0) {
      report.outboxEventIds.push(addOutbox(
        state,
        "CONNECTOR_REGISTRATION_REVIEW_WITHDRAW",
        key,
        previous.resourceVersion,
        withdrawalPayload(previous, contextBatch, contextEvent, "APPROVAL_REEVALUATED"),
      ));
    }

    state.records[key] = {
      ...previous,
      canonical,
      canonicalRecordDigest: digest(canonical),
      decision,
      discoveryDecision,
      discoveryProjection,
      offeringCandidate,
      ...(knownCandidateDatasetIds(previous, offeringCandidate).length > 0
        ? { knownCandidateDatasetIds: knownCandidateDatasetIds(previous, offeringCandidate) }
        : {}),
      ...((previous.discoveryWasProjected || discoveryProjection)
        ? { discoveryWasProjected: true }
        : {}),
      projectionConfigDigest,
    };
    report.reconciled += 1;
  }

  state.approvalRegistryDigest = approvalRegistryDigest;
  state.projectionConfigDigest = projectionConfigDigest;
}

export function synchronizeBatch(
  currentState,
  batch,
  config,
  approvalRegistry,
  { now = new Date().toISOString() } = {},
) {
  validateState(currentState);
  validateMetadataBatchDocument(batch);
  validateBatch(batch);
  const evaluatedAt = validateTimestamp(now, "processingClock");
  const clockWatermark = trustedClockWatermark(currentState);
  invariant(
    clockWatermark === null
      || Date.parse(evaluatedAt) >= Date.parse(clockWatermark),
    "PROCESSING_CLOCK_REGRESSION",
    "trusted processing clock moved behind the persisted sync or review watermark",
    { field: "processingClock" },
  );
  invariant(
    Date.parse(batch.observedAt) <= Date.parse(evaluatedAt) + 5 * 60 * 1000,
    "SOURCE_CLOCK_AHEAD",
    "batch observedAt is ahead of the trusted processing clock beyond allowed skew",
    { field: "observedAt" },
  );
  const projectionConfig = validateProjectionConfig(config);
  const approvalIndex = indexApprovalRegistry(approvalRegistry);
  const currentApprovalRegistryDigest = digest(approvalRegistry);
  const currentProjectionConfigDigest = digest(projectionConfig);
  const estimatedStateBytes = Buffer.byteLength(stableStringify(currentState), "utf8")
    + Buffer.byteLength(stableStringify(batch), "utf8") * 8;
  invariant(
    estimatedStateBytes <= 64 * 1024 * 1024,
    "STATE_ADMISSION_EXCEEDED",
    "batch could exceed the S1 state byte limit after projection",
  );

  const state = structuredClone(currentState);
  const report = {
    schemaVersion: "molit.discovery-sync-report/1",
    batchId: batch.batchId,
    sourceSystemId: batch.sourceSystemId,
    mode: batch.mode,
    observedAt: batch.observedAt,
    evaluatedAt,
    applied: 0,
    duplicates: 0,
    stale: 0,
    quarantined: 0,
    withdrawn: 0,
    approved: 0,
    catalogOnly: 0,
    pendingEvidence: 0,
    reconciled: 0,
    outboxEventIds: [],
    results: [],
    baselineNote: batch.mode === "baseline"
      ? "records absent from the baseline are not deleted without an explicit tombstone"
      : undefined,
  };

  reconcileStoredRecords(state, {
    approvalIndex,
    approvalRegistryDigest: currentApprovalRegistryDigest,
    evaluatedAt,
    projectionConfig,
    projectionConfigDigest: currentProjectionConfigDigest,
    report,
  });

  for (const event of batch.records) {
    const key = recordKey(batch.sourceSystemId, event.recordId);
    const resourceDigest = eventResourceDigest(event);
    const processedEventKey = identifierTupleKey(batch.sourceSystemId, event.eventId);
    const processed = own(state.processedEvents, processedEventKey);

    if (processed) {
      invariant(
        processed.resourceDigest === resourceDigest && processed.aggregateKey === key,
        "EVENT_ID_CONFLICT",
        "eventId was reused for a different resource event",
        { eventId: event.eventId, aggregateKey: key },
      );
      report.duplicates += 1;
      report.results.push({ eventId: event.eventId, recordId: event.recordId, result: "duplicate" });
      continue;
    }

    const previous = state.records[key];
    if (previous) {
      const versionComparison = compareVersions(event.resourceVersion, previous.resourceVersion);
      if (versionComparison < 0) {
        setOwn(state.processedEvents, processedEventKey, {
          aggregateKey: key,
          resourceDigest,
          result: "stale",
        });
        report.stale += 1;
        report.results.push({ eventId: event.eventId, recordId: event.recordId, result: "stale" });
        continue;
      }
      if (versionComparison === 0) {
        invariant(
          previous.eventResourceDigest === resourceDigest,
          "RESOURCE_VERSION_CONFLICT",
          "same resourceVersion contains different record content",
          { aggregateKey: key, resourceVersion: event.resourceVersion },
        );
        setOwn(state.processedEvents, processedEventKey, {
          aggregateKey: key,
          resourceDigest,
          result: "duplicate-version",
        });
        report.duplicates += 1;
        report.results.push({
          eventId: event.eventId,
          recordId: event.recordId,
          result: "duplicate-version",
        });
        continue;
      }
    }

    invariant(
      !(previous?.decision?.state === "WITHDRAWN" && event.eventType === "record.upsert"),
      "TERMINAL_RECORD_REVIVAL",
      "a withdrawn source record requires a new recordId for a new incarnation",
      { field: "recordId" },
    );

    if (event.eventType === "record.deleted") {
      const decision = {
        state: "WITHDRAWN",
        reasons: [{ code: "SOURCE_DELETED", field: "eventType", message: "source sent a tombstone" }],
      };
      const entry = minimalQuarantineEntry(batch, event, decision, resourceDigest, previous);
      state.records[key] = entry;
      if (previous?.discoveryWasProjected || previous?.discoveryProjection) {
        report.outboxEventIds.push(addOutbox(
          state,
          "DISCOVERY_DELETE",
          key,
          event.resourceVersion,
          discoveryDeletePayload(batch, event, "SOURCE_DELETED"),
        ));
      }
      if (knownCandidateDatasetIds(previous).length > 0) {
        report.outboxEventIds.push(addOutbox(
          state,
          "CONNECTOR_REGISTRATION_REVIEW_WITHDRAW",
          key,
          event.resourceVersion,
          withdrawalPayload(previous, batch, event, "SOURCE_DELETED"),
        ));
      }
      report.applied += 1;
      report.withdrawn += 1;
      report.results.push({ eventId: event.eventId, recordId: event.recordId, result: "withdrawn" });
      setOwn(state.processedEvents, processedEventKey, {
        aggregateKey: key,
        resourceDigest,
        result: "withdrawn",
      });
      continue;
    }

    let canonical;
    let decision;
    try {
      const governanceApproval = resolveApproval(approvalIndex, {
        evaluatedAt,
        record: event.record,
        recordId: event.recordId,
        resourceVersion: event.resourceVersion,
        sourceSystemId: batch.sourceSystemId,
      });
      canonical = normalizeRecord({
        governanceApproval,
        sourceSystemId: batch.sourceSystemId,
        recordId: event.recordId,
        record: event.record,
      });
      decision = decideOffering(canonical);
    } catch (error) {
      decision = quarantineDecision(error);
      state.records[key] = minimalQuarantineEntry(
        batch,
        event,
        decision,
        resourceDigest,
        previous,
      );
      if (previous?.discoveryWasProjected || previous?.discoveryProjection) {
        report.outboxEventIds.push(addOutbox(
          state,
          "DISCOVERY_DELETE",
          key,
          event.resourceVersion,
          discoveryDeletePayload(batch, event, "RECORD_QUARANTINED"),
        ));
      }
      if (knownCandidateDatasetIds(previous).length > 0) {
        report.outboxEventIds.push(addOutbox(
          state,
          "CONNECTOR_REGISTRATION_REVIEW_WITHDRAW",
          key,
          event.resourceVersion,
          withdrawalPayload(previous, batch, event, "RECORD_QUARANTINED"),
        ));
      }
      report.applied += 1;
      report.quarantined += 1;
      report.results.push({
        eventId: event.eventId,
        recordId: event.recordId,
        result: "quarantined",
        reasons: decision.reasons,
      });
      setOwn(state.processedEvents, processedEventKey, {
        aggregateKey: key,
        resourceDigest,
        result: "quarantined",
      });
      continue;
    }

    const discoveryDecision = decideDiscoveryVisibility(canonical, decision);
    const discoveryProjection = discoveryDecision.publish
      ? toDiscoveryProjection(canonical, decision)
      : undefined;
    const offeringCandidate = decision.state === "APPROVED"
      ? toOfferingCandidate(canonical, decision, projectionConfig)
      : undefined;
    const observedRecordDigest = digest(event.record);

    state.records[key] = {
      sourceSystemId: batch.sourceSystemId,
      sourceRecordId: event.recordId,
      resourceVersion: event.resourceVersion,
      eventResourceDigest: resourceDigest,
      lastEventId: event.eventId,
      lastObservedAt: batch.observedAt,
      lastOccurredAt: event.occurredAt,
      observedRecordDigest,
      observedRecord: structuredClone(event.record),
      projectionConfigDigest: currentProjectionConfigDigest,
      canonical,
      canonicalRecordDigest: digest(canonical),
      decision,
      discoveryDecision,
      discoveryProjection,
      offeringCandidate,
      ...(knownCandidateDatasetIds(previous, offeringCandidate).length > 0
        ? { knownCandidateDatasetIds: knownCandidateDatasetIds(previous, offeringCandidate) }
        : {}),
      ...((previous?.discoveryWasProjected || discoveryProjection)
        ? { discoveryWasProjected: true }
        : {}),
    };

    if (!discoveryProjection && (previous?.discoveryWasProjected || previous?.discoveryProjection)) {
      report.outboxEventIds.push(addOutbox(
        state,
        "DISCOVERY_DELETE",
        key,
        event.resourceVersion,
        discoveryDeletePayload(batch, event, discoveryDecision.reason),
      ));
    }

    if (discoveryProjection) {
      report.outboxEventIds.push(addOutbox(
        state,
        "DISCOVERY_UPSERT",
        key,
        event.resourceVersion,
        discoveryProjection,
        { approvalGate: activeApprovalGate({
          approvalRegistryDigest: currentApprovalRegistryDigest,
          canonical,
          evaluatedAt,
          observedRecordDigest,
          payload: discoveryProjection,
          projectionConfigDigest: currentProjectionConfigDigest,
          resourceVersion: event.resourceVersion,
        }) },
      ));
    }

    if (offeringCandidate) {
      const command = candidateReviewCommand(
        previous,
        offeringCandidate,
        "PROJECTION_CONFIG_CHANGED",
      );
      report.outboxEventIds.push(addOutbox(
        state,
        command.type,
        key,
        event.resourceVersion,
        command.payload,
        { approvalGate: activeApprovalGate({
          approvalRegistryDigest: currentApprovalRegistryDigest,
          canonical,
          evaluatedAt,
          observedRecordDigest,
          payload: command.payload,
          projectionConfigDigest: currentProjectionConfigDigest,
          resourceVersion: event.resourceVersion,
        }) },
      ));
      report.approved += 1;
    } else if (knownCandidateDatasetIds(previous).length > 0) {
      report.outboxEventIds.push(addOutbox(
        state,
        "CONNECTOR_REGISTRATION_REVIEW_WITHDRAW",
        key,
        event.resourceVersion,
        withdrawalPayload(previous, batch, event, decision.state),
      ));
    }

    if (decision.state === "CATALOG_ONLY") {
      report.catalogOnly += 1;
    } else if (decision.state === "PENDING_EVIDENCE") {
      report.pendingEvidence += 1;
    } else if (decision.state === "QUARANTINED") {
      report.quarantined += 1;
    }

    report.applied += 1;
    report.results.push({
      eventId: event.eventId,
      recordId: event.recordId,
      result: decision.state.toLowerCase(),
      reasons: decision.reasons,
    });
    setOwn(state.processedEvents, processedEventKey, {
      aggregateKey: key,
      resourceDigest,
      result: decision.state.toLowerCase(),
    });
  }

  report.outboxEventIds = [...new Set(report.outboxEventIds)];
  compactOutbox(state);
  report.outboxEventIds = report.outboxEventIds.filter((id) => (
    Object.hasOwn(state.outbox, id) && state.outbox[id].status === "pending"
  ));
  enforceStateCapacity(state);
  state.lastEvaluationAt = evaluatedAt;
  return { state, report };
}

function pendingOutboxEvents(state) {
  validateState(state);
  return Object.values(state.outbox)
    .filter((event) => event.status === "pending")
    .sort((left, right) => (
      left.aggregateKey.localeCompare(right.aggregateKey)
      || left.family.localeCompare(right.family)
      || compareVersions(left.resourceVersion, right.resourceVersion)
      || left.sequence - right.sequence
    ));
}

function requireCurrentAggregate(state, event) {
  const entry = own(state.records, event.aggregateKey);
  invariant(
    entry
      && recordKey(entry.sourceSystemId, entry.sourceRecordId) === event.aggregateKey
      && entry.resourceVersion === event.resourceVersion,
    "OUTBOX_AGGREGATE_STALE",
    "pending review command no longer matches the current source aggregate version",
    { field: "outbox.aggregateKey" },
  );
  return entry;
}

function validateProtectiveCommand(state, event) {
  const entry = requireCurrentAggregate(state, event);
  invariant(
    event.payload?.source?.systemId === entry.sourceSystemId
      && event.payload?.source?.recordId === entry.sourceRecordId,
    "OUTBOX_PROTECTIVE_SCOPE_INVALID",
    "protective review command does not match its current source scope",
    { field: "outbox.payload.source" },
  );
  if (event.type === "DISCOVERY_DELETE") {
    invariant(
      entry.discoveryWasProjected === true && !entry.discoveryProjection,
      "OUTBOX_PROTECTIVE_ACTION_STALE",
      "discovery delete requires prior publication and no current public projection",
      { field: "outbox.type" },
    );
    return;
  }
  const knownIds = knownCandidateDatasetIds(entry);
  invariant(
    !entry.offeringCandidate
      && knownIds.length > 0
      && digest(event.payload.candidateDatasetIds) === digest(knownIds),
    "OUTBOX_PROTECTIVE_ACTION_STALE",
    "connector withdrawal no longer matches the current Offering mapping",
    { field: "outbox.payload.candidateDatasetIds" },
  );
}

function validateActiveCommandGate(
  state,
  event,
  entry,
  approval,
  evaluatedAt,
  projectionConfig,
) {
  const gate = event.approvalGate;
  invariant(
    gate
      && gate.approvalRegistryDigest === state.approvalRegistryDigest
      && gate.projectionConfigDigest === state.projectionConfigDigest
      && gate.sourceSystemId === entry.sourceSystemId
      && gate.recordId === entry.sourceRecordId
      && gate.resourceVersion === entry.resourceVersion
      && gate.recordDigest === entry.observedRecordDigest
      && gate.payloadDigest === digest(event.payload)
      && Date.parse(gate.evaluatedAt) >= Date.parse(gate.approvedAt)
      && Date.parse(gate.evaluatedAt) <= Date.parse(gate.validUntil)
      && Date.parse(gate.evaluatedAt) <= Date.parse(state.lastEvaluationAt)
      && Date.parse(gate.evaluatedAt) <= Date.parse(evaluatedAt),
    "OUTBOX_APPROVAL_GATE_INVALID",
    "active review command approval gate does not match current state",
    { field: "outbox.approvalGate" },
  );

  const currentApproval = entry.canonical?.governanceApproval;
  for (const field of [
    "registryId",
    "approvalEntryDigest",
    "approvalId",
    "approverId",
    "approvedAt",
    "validUntil",
    "catalogVisibility",
    "offeringDecision",
  ]) {
    invariant(
      gate[field] === approval[field] && gate[field] === currentApproval?.[field],
      "OUTBOX_APPROVAL_GATE_INVALID",
      "active review command approval no longer matches the current registry",
      { field: `outbox.approvalGate.${field}` },
    );
  }

  const expectedCanonical = normalizeRecord({
    governanceApproval: approval,
    sourceSystemId: entry.sourceSystemId,
    recordId: entry.sourceRecordId,
    record: entry.observedRecord,
  });
  const expectedDecision = decideOffering(expectedCanonical);
  const expectedDiscoveryDecision = decideDiscoveryVisibility(
    expectedCanonical,
    expectedDecision,
  );
  invariant(
    digest(expectedCanonical) === entry.canonicalRecordDigest
      && digest(expectedCanonical) === digest(entry.canonical)
      && digest(expectedDecision) === digest(entry.decision)
      && digest(expectedDiscoveryDecision) === digest(entry.discoveryDecision),
    "OUTBOX_DERIVED_STATE_INVALID",
    "stored projection state cannot be reproduced from the approved source record",
    { field: "records.canonical" },
  );

  if (event.type === "DISCOVERY_UPSERT") {
    const expectedProjection = expectedDiscoveryDecision.publish
      ? toDiscoveryProjection(expectedCanonical, expectedDecision)
      : undefined;
    invariant(
      expectedProjection
        && digest(expectedProjection) === digest(entry.discoveryProjection)
        && digest(expectedProjection) === digest(event.payload)
        && approval.catalogVisibility === "public",
      "OUTBOX_PROJECTION_STALE",
      "discovery upsert no longer matches the current public projection",
      { field: "outbox.payload" },
    );
    return;
  }

  const candidate = event.type === "CONNECTOR_REGISTRATION_REVIEW_REPLACE"
    ? event.payload.candidate
    : event.payload;
  if (event.type === "CONNECTOR_REGISTRATION_REVIEW_REPLACE") {
    const expectedPreviousIds = knownCandidateDatasetIds(entry).filter((id) => (
      id !== candidate.registration.datasetId
    ));
    invariant(
      expectedPreviousIds.length > 0
        && digest(event.payload.previousDatasetIds) === digest(expectedPreviousIds)
        && ["APPROVAL_REEVALUATED", "PROJECTION_CONFIG_CHANGED"].includes(event.payload.reason),
      "OUTBOX_REPLACEMENT_SCOPE_INVALID",
      "connector replacement does not reference known candidate state",
      { field: "outbox.payload.previousDatasetIds" },
    );
  }
  const expectedCandidate = expectedDecision.state === "APPROVED"
    ? toOfferingCandidate(expectedCanonical, expectedDecision, projectionConfig)
    : undefined;
  invariant(
    expectedCandidate
      && approval.offeringDecision === "approved"
      && digest(expectedCandidate) === digest(entry.offeringCandidate)
      && digest(expectedCandidate) === digest(candidate),
    "OUTBOX_PROJECTION_STALE",
    "connector review no longer matches the current approved candidate",
    { field: "outbox.payload" },
  );
}

export function reviewPendingOutboxEvents(
  currentState,
  config,
  approvalRegistry,
  { clock = () => new Date() } = {},
) {
  validateState(currentState);
  const state = structuredClone(currentState);
  const projectionConfig = validateProjectionConfig(config);
  const approvalIndex = indexApprovalRegistry(approvalRegistry);
  invariant(
    digest(projectionConfig) === state.projectionConfigDigest
      && digest(approvalRegistry) === state.approvalRegistryDigest,
    "RECONCILIATION_REQUIRED",
    "current config or approval registry must be reconciled before review",
  );
  const clockValue = clock();
  const evaluatedAt = validateTimestamp(
    clockValue instanceof Date ? clockValue.toISOString() : clockValue,
    "reviewClock",
  );
  const clockWatermark = trustedClockWatermark(state);
  invariant(
    state.lastEvaluationAt !== null
      && (clockWatermark === null
        || Date.parse(evaluatedAt) >= Date.parse(clockWatermark)),
    "REVIEW_CLOCK_REGRESSION",
    "trusted review clock moved behind the persisted sync or review watermark",
    { field: "reviewClock" },
  );

  const assessment = {
    schemaVersion: "molit.review-queue-assessment/1",
    automaticDispatchAllowed: false,
    executionAuthority: "none",
    evaluatedAt,
    approvalRegistryDigest: state.approvalRegistryDigest,
    projectionConfigDigest: state.projectionConfigDigest,
    reconciliationRequired: false,
    reviewable: [],
    blocked: [],
  };

  for (const event of pendingOutboxEvents(state)) {
    if (PROTECTIVE_COMMAND_TYPES.has(event.type)) {
      validateProtectiveCommand(state, event);
      assessment.reviewable.push(event);
      continue;
    }
    invariant(
      ACTIVE_APPROVAL_COMMAND_TYPES.has(event.type),
      "OUTBOX_TYPE_UNSUPPORTED",
      "pending review command type is not supported",
      { field: "outbox.type" },
    );
    const entry = requireCurrentAggregate(state, event);
    const approval = resolveApproval(approvalIndex, {
      evaluatedAt,
      recordDigest: entry.observedRecordDigest,
      recordId: entry.sourceRecordId,
      resourceVersion: entry.resourceVersion,
      sourceSystemId: entry.sourceSystemId,
    });
    if (approval.status !== "verified-synthetic") {
      assessment.reconciliationRequired = true;
      assessment.blocked.push({
        id: event.id,
        type: event.type,
        reason: approval.reason,
      });
      continue;
    }
    validateActiveCommandGate(
      state,
      event,
      entry,
      approval,
      evaluatedAt,
      projectionConfig,
    );
    assessment.reviewable.push(event);
  }

  state.lastReviewAt = evaluatedAt;
  assessment.stateDigest = digest(state);
  assessment.assessmentDigest = digest(assessment);
  return { assessment, state };
}

export function inspectState(state) {
  validateState(state);
  const decisions = {};
  for (const entry of Object.values(state.records)) {
    const decision = entry.decision?.state ?? "UNKNOWN";
    decisions[decision] = (decisions[decision] ?? 0) + 1;
  }
  const outbox = {};
  for (const event of Object.values(state.outbox)) {
    const key = `${event.type}:${event.status}`;
    outbox[key] = (outbox[key] ?? 0) + 1;
  }
  return {
    schemaVersion: state.schemaVersion,
    stateDigest: digest(state),
    recordCount: Object.keys(state.records).length,
    processedEventCount: Object.keys(state.processedEvents).length,
    lastEvaluationAt: state.lastEvaluationAt,
    lastReviewAt: state.lastReviewAt,
    decisions,
    outbox,
  };
}
