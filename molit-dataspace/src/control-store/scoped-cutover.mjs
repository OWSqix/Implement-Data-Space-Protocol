import { digest } from "../discovery/stable-json.mjs";
import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { emptyCaasState, validateCaasState } from "../caas/store.mjs";
import { emptyDsaasState, validateDsaasState } from "../dsaas/store.mjs";
import { normalizeCaasIdempotencyRecordKey } from "./idempotency-record-key.mjs";

const COMPONENTS = new Set(["caas", "dsaas"]);
const PLATFORM_TENANT_ID = "molit-platform";
const SHA256 = /^[a-f0-9]{64}$/u;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resources(component, state) {
  const source = component === "caas" ? asObject(state.tenants) : asObject(state.dataspaces);
  const kind = component === "caas" ? "tenant" : "dataspace";
  return Object.entries(source).map(([tenantId, payload]) => ({ kind, payload, tenantId }));
}

function projectionResources(component, state) {
  const scopes = resources(component, state);
  if (component !== "dsaas") return scopes.map((row) => ({ ...row, resourceId: row.tenantId }));
  return scopes.flatMap((row) => [
    { ...row, resourceId: row.tenantId },
    ...Object.entries(asObject(row.payload?.participants)).map(([participantId, payload]) => ({
      kind: "participant",
      payload,
      resourceId: `${row.tenantId}/${participantId}`,
      tenantId: row.tenantId,
    })),
  ]);
}

function participantIndexRows(payload, dataspaceId) {
  return Object.entries(asObject(payload?.participants)).map(([participantId, participant]) => ({
    caasTenantId: participant?.spec?.caasTenantId,
    connectorNamespace: new URL(participant?.spec?.connectorNamespace).href,
    connectorParticipantId: participant?.spec?.connectorParticipantId,
    dataspaceId,
    participantId,
    participantSha256: digest(participant),
  })).sort((left, right) => left.participantId.localeCompare(right.participantId));
}

function legacyProjectionTenant(component, payload) {
  return component === "caas"
    ? payload?.result?.tenantId ?? payload?.result?.connectorId ?? PLATFORM_TENANT_ID
    : payload?.response?.dataspaceId ?? PLATFORM_TENANT_ID;
}

function caasLedgerScope(recordKey) {
  let scope;
  try { scope = normalizeCaasIdempotencyRecordKey(recordKey).scope; }
  catch { return null; }
  return /^(?:register|desired|upgrade|rollback|reconcile|ensure):([a-z][a-z0-9-]{2,62})$/u.exec(scope)?.[1] ?? null;
}

function approvedAssignments(value, component, sourceSnapshotSha256) {
  if (value === undefined || value === null) return { approvalEvidenceSha256: null, assignments: new Map(), receiptSha256: null };
  assertRuntime(value && typeof value === "object" && !Array.isArray(value)
    && value.schemaVersion === "molit.control-store-scope-map/1"
    && value.component === component
    && value.sourceSnapshotSha256 === sourceSnapshotSha256
    && typeof value.approvedBy === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{2,255}$/u.test(value.approvedBy)
    && Number.isFinite(Date.parse(value.approvedAt))
    && /^[a-f0-9]{64}$/u.test(value.approvalEvidenceSha256 ?? "")
    && value.assignments && typeof value.assignments === "object" && !Array.isArray(value.assignments),
  "CONTROL_CUTOVER_SCOPE_MAP_INVALID", "approved idempotency scope map is invalid or is not bound to this snapshot");
  const entries = Object.entries(value.assignments);
  assertRuntime(entries.length <= 1_000_000 && entries.every(([recordKey, tenantId]) => recordKey.length >= 1 && recordKey.length <= 2_048
    && /^[a-z][a-z0-9-]{2,62}$/u.test(tenantId)), "CONTROL_CUTOVER_SCOPE_MAP_INVALID", "approved idempotency scope assignments are invalid");
  return {
    approvalEvidenceSha256: value.approvalEvidenceSha256,
    assignments: new Map(entries),
    receiptSha256: digest(value),
  };
}

function approvedLegacySource(value, component) {
  if (value === undefined || value === null) return null;
  assertRuntime(value && typeof value === "object" && !Array.isArray(value)
    && value.schemaVersion === "molit.control-store-legacy-source/1"
    && value.component === component
    && Number.isSafeInteger(value.revision) && value.revision >= 1
    && Number.isFinite(Date.parse(value.updatedAt))
    && /^[a-f0-9]{64}$/u.test(value.sourceArtifactSha256 ?? "")
    && value.sourceArtifactSha256 === digest(value.state)
    && typeof value.approvedBy === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{2,255}$/u.test(value.approvedBy)
    && Number.isFinite(Date.parse(value.approvedAt))
    && /^[a-f0-9]{64}$/u.test(value.approvalEvidenceSha256 ?? ""),
  "CONTROL_CUTOVER_LEGACY_SOURCE_INVALID", "approved legacy source is invalid or lacks snapshot-bound approval evidence");
  if (component === "caas") validateCaasState(structuredClone(value.state));
  else validateDsaasState(structuredClone(value.state));
  return Object.freeze(value);
}

function idempotency(component, state, approved, resourceIds) {
  const source = component === "caas" ? asObject(state.requests) : asObject(state.idempotency);
  const usedAssignments = new Set();
  const rows = Object.entries(source).map(([sourceRecordKey, payload]) => {
    const normalized = component === "caas"
      ? normalizeCaasIdempotencyRecordKey(sourceRecordKey)
      : { legacyConverted: false, recordKey: sourceRecordKey, sourceRecordKey };
    const mappedSource = approved.assignments.get(sourceRecordKey) ?? null;
    const mappedNormalized = approved.assignments.get(normalized.recordKey) ?? null;
    assertRuntime(mappedSource === null || mappedNormalized === null || mappedSource === mappedNormalized,
      "CONTROL_CUTOVER_SCOPE_MAP_INVALID", "approved scope map assigns conflicting source and normalized keys", { recordKey: sourceRecordKey });
    const mapped = mappedSource ?? mappedNormalized;
    if (mappedSource !== null) usedAssignments.add(sourceRecordKey);
    if (mappedNormalized !== null) usedAssignments.add(normalized.recordKey);
    const candidates = new Set([
      payload?.scopeId ?? null,
      component === "caas" ? caasLedgerScope(sourceRecordKey) : null,
      component === "caas" ? payload?.result?.tenantId ?? payload?.result?.connectorId ?? null : payload?.response?.spec?.dataspaceId ?? null,
      mapped,
    ].filter(Boolean));
    assertRuntime(candidates.size === 1, candidates.size === 0 ? "CONTROL_CUTOVER_SCOPE_UNRESOLVED" : "CONTROL_CUTOVER_SCOPE_CONFLICT",
      candidates.size === 0 ? "idempotency record has no provable scope; an approved scope map is required" : "idempotency scope evidence conflicts",
      { recordKey: sourceRecordKey });
    const tenantId = [...candidates][0];
    assertRuntime(resourceIds.has(tenantId), "CONTROL_CUTOVER_SCOPE_INVALID", "idempotency scope does not identify a source resource", {
      recordKey: sourceRecordKey,
      tenantId,
    });
    return { legacyConverted: normalized.legacyConverted, legacyTenantId: legacyProjectionTenant(component, payload), payload,
      recordKey: normalized.recordKey, sourceRecordKey, tenantId };
  });
  const unused = [...approved.assignments.keys()].filter((recordKey) => !usedAssignments.has(recordKey));
  assertRuntime(unused.length === 0, "CONTROL_CUTOVER_SCOPE_MAP_INVALID", "approved scope map contains records absent from the source snapshot", { unusedCount: unused.length });
  return rows;
}

function auditTenantId(component, event) {
  if (component === "caas") return event?.tenantId ?? PLATFORM_TENANT_ID;
  return /^dataspace:([^/]+)(?:\/|$)/u.exec(event?.resource ?? "")?.[1] ?? PLATFORM_TENANT_ID;
}

function audits(component, state) {
  const source = component === "caas" ? state.audit : state.audit?.events;
  return (Array.isArray(source) ? source : []).map((event) => ({
    event,
    eventDigest: component === "caas" ? event.eventDigest : event.hash,
    eventId: component === "caas" ? event.eventDigest : event.hash,
    occurredAt: component === "caas" ? event.occurredAt : event.at,
    previousDigest: component === "caas" ? event.previousDigest : event.previousHash,
    sequence: event.sequence,
    tenantId: auditTenantId(component, event),
  }));
}

function auditOutboxId(component, row) {
  return digest({
    component,
    kind: "audit",
    payloadSha256: row.eventDigest,
    resourceId: row.eventId,
    revision: String(row.sequence),
    tenantId: row.tenantId,
    type: "audit.appended",
  });
}

function registryIdentity(component, row) {
  if (component !== "caas") return { connectorNamespace: null, endpoint: null, participantId: null };
  return {
    connectorNamespace: row.payload?.namespace ?? null,
    endpoint: row.payload?.endpoint ?? null,
    participantId: row.payload?.participantId ?? null,
  };
}

function canonicalRows(rows, fields) {
  return rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[field]])));
}

function assertSameRows(actual, expected, label) {
  assertRuntime(digest(actual) === digest(expected), "CONTROL_CUTOVER_MISMATCH", `${label} does not match the source snapshot`, {
    actualCount: actual.length,
    expectedCount: expected.length,
  });
}

export function scopedStateDigest(payload, ledger) {
  return digest({
    idempotency: [...ledger]
      .sort((left, right) => left.recordKey.localeCompare(right.recordKey))
      .map(({ payload: value, recordKey }) => ({ payload: value, recordKey })),
    payload,
  });
}

export function componentStateRoot(registryRows) {
  return digest([...registryRows]
    .sort((left, right) => left.tenantId.localeCompare(right.tenantId))
    .map(({ idempotencyCount, stateRevision, stateSha256, tenantId }) => ({ idempotencyCount, stateRevision, stateSha256, tenantId })));
}

async function verifyProjection(client, component, source, approved, { unprojected = false } = {}) {
  const expectedScopes = resources(component, source);
  const expectedResources = projectionResources(component, source);
  const expectedLedger = idempotency(component, source, approved, new Set(expectedScopes.map(({ tenantId }) => tenantId)));
  const expectedAudit = audits(component, source);
  if (unprojected) {
    const residue = await client.query(
      `SELECT
         (SELECT count(*) FROM molit_control_store.resource_state WHERE component = $1)
       + (SELECT count(*) FROM molit_control_store.idempotency_record WHERE component = $1)
       + (SELECT count(*) FROM molit_control_store.audit_event WHERE component = $1)
       + (SELECT count(*) FROM molit_control_store.outbox_event WHERE component = $1)
       + (SELECT count(*) FROM molit_control_store.projection_checkpoint WHERE component = $1)
       + (SELECT count(*) FROM molit_control_store.projection_tenant_registry WHERE component = $1)
         AS row_count`,
      [component],
    );
    assertRuntime(Number(residue.rows[0]?.row_count) === 0, "CONTROL_CUTOVER_MISMATCH",
      "approved legacy source cannot be combined with normalized projection residue");
    return { expectedAudit, expectedLedger, expectedResources: expectedScopes, unprojected: true };
  }
  const actualResources = await client.query(
    `SELECT tenant_id, resource_kind, resource_id, payload, payload_sha256
     FROM molit_control_store.resource_state
     WHERE component = $1
     ORDER BY tenant_id, resource_kind, resource_id`,
    [component],
  );
  assertSameRows(
    canonicalRows(actualResources.rows, ["tenant_id", "resource_kind", "resource_id", "payload", "payload_sha256"]),
    expectedResources.map(({ kind, payload, resourceId, tenantId }) => ({
      tenant_id: tenantId, resource_kind: kind, resource_id: resourceId, payload, payload_sha256: digest(payload),
    })).sort((left, right) => `${left.tenant_id}\0${left.resource_kind}\0${left.resource_id}`.localeCompare(`${right.tenant_id}\0${right.resource_kind}\0${right.resource_id}`)),
    "normalized resource rows",
  );

  const actualLedger = await client.query(
    `SELECT tenant_id, record_key, payload, payload_sha256
     FROM molit_control_store.idempotency_record
     WHERE component = $1
     ORDER BY tenant_id, record_key`,
    [component],
  );
  const normalizedActualLedger = actualLedger.rows.map((row) => ({
    payload: row.payload, payload_sha256: row.payload_sha256, record_key: row.record_key, tenant_id: row.tenant_id,
  })).sort((left, right) => left.record_key.localeCompare(right.record_key));
  const normalizedExpectedLedger = expectedLedger.map(({ legacyConverted, legacyTenantId, payload, recordKey, tenantId }) => ({
    allowed_tenant_ids: [...new Set([tenantId, legacyTenantId])], legacyConverted, payload, payload_sha256: digest(payload), record_key: recordKey,
  })).sort((left, right) => left.record_key.localeCompare(right.record_key));
  const actualByKey = new Map(normalizedActualLedger.map((row) => [row.record_key, row]));
  assertRuntime(actualByKey.size === normalizedActualLedger.length
    && normalizedActualLedger.every((row) => normalizedExpectedLedger.some((expected) => expected.record_key === row.record_key))
    && normalizedExpectedLedger.every((expected) => {
      const row = actualByKey.get(expected.record_key);
      return row === undefined ? component === "caas" && expected.legacyConverted
        : expected.allowed_tenant_ids.includes(row.tenant_id)
          && row.payload_sha256 === expected.payload_sha256 && digest(row.payload) === digest(expected.payload);
    }),
  "CONTROL_CUTOVER_MISMATCH", "normalized idempotency rows do not match the source snapshot and resolved scope", {
    actualCount: normalizedActualLedger.length, expectedCount: normalizedExpectedLedger.length,
  });

  const actualAudit = await client.query(
    `SELECT tenant_id, sequence::text, event_id, occurred_at, previous_digest, event_digest, event
     FROM molit_control_store.audit_event
     WHERE component = $1
     ORDER BY sequence`,
    [component],
  );
  const normalizedActualAudit = actualAudit.rows.map((row) => ({
    event: row.event,
    eventDigest: row.event_digest,
    eventId: row.event_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    previousDigest: row.previous_digest,
    sequence: Number(row.sequence),
    tenantId: row.tenant_id,
  }));
  assertSameRows(normalizedActualAudit, expectedAudit, "normalized audit rows");

  const generic = await client.query(
    `SELECT count(*)::integer AS count
     FROM molit_control_store.outbox_event
     WHERE component = $1 AND event_type IN ('resource.upserted', 'resource.deleted')`,
    [component],
  );
  assertRuntime(generic.rows[0]?.count === 0, "CONTROL_CUTOVER_UNCONSUMED_EVENTS", "generic resource outbox rows have no production consumer");

  const actualOutbox = await client.query(
    `SELECT event_id, tenant_id, event_type, payload, payload_sha256
     FROM molit_control_store.outbox_event
     WHERE component = $1 AND event_type = 'audit.appended'
     ORDER BY event_id`,
    [component],
  );
  const expectedOutbox = expectedAudit.map((row) => {
    const payload = {
      schemaVersion: "molit.audit-outbox/1",
      sourceComponent: component,
      sourceSequence: row.sequence,
      sourceEventDigest: row.eventDigest,
      auditEvent: row.event,
      auditEventPayloadSha256: digest(row.event),
    };
    return { event_id: auditOutboxId(component, row), tenant_id: row.tenantId, event_type: "audit.appended", payload, payload_sha256: digest(payload) };
  }).sort((left, right) => left.event_id.localeCompare(right.event_id));
  assertSameRows(canonicalRows(actualOutbox.rows, ["event_id", "tenant_id", "event_type", "payload", "payload_sha256"]), expectedOutbox, "audit outbox rows");
  return { expectedAudit, expectedLedger, expectedResources: expectedScopes, unprojected: false };
}

export async function prepareScopedControlStoreCutover({ pool, component, approvedScopeMap, legacySource, clock = () => new Date() }) {
  assertRuntime(pool?.connect, "CONTROL_CUTOVER_CONFIG_INVALID", "cutover requires a PostgreSQL migration pool");
  assertRuntime(COMPONENTS.has(component), "CONTROL_CUTOVER_CONFIG_INVALID", "cutover component is invalid");
  const at = clock();
  assertRuntime(at instanceof Date && Number.isFinite(at.valueOf()), "CONTROL_CUTOVER_CLOCK_INVALID", "cutover clock is invalid");
  const client = await pool.connect();
  let transaction = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transaction = true;
    const authority = await client.query(
      "SELECT rolsuper OR rolbypassrls AS migration_authority FROM pg_catalog.pg_roles WHERE rolname = session_user",
    );
    assertRuntime(authority.rows[0]?.migration_authority === true, "CONTROL_CUTOVER_AUTHORITY_REQUIRED",
      "cutover requires a dedicated migration role with BYPASSRLS or superuser authority");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`molit:scoped-cutover:${component}`]);
    const migration = await client.query(
      "SELECT version FROM molit_control_store.schema_migration WHERE component = 'postgres-scoped-control-store'",
    );
    assertRuntime(Number(migration.rows[0]?.version) === 4, "CONTROL_CUTOVER_MIGRATION_REQUIRED", "scoped control-store migration 4 is required");
    const mode = await client.query(
      `SELECT mode, source_kind, source_snapshot_sha256, source_approval_evidence_sha256, scope_map_sha256,
              scope_map_approval_evidence_sha256, legacy_key_conversion_count,
              cutover_state_root_sha256, state_root_sha256
       FROM molit_control_store.control_store_mode WHERE component = $1 FOR UPDATE`,
      [component],
    );
    assertRuntime(mode.rowCount === 1, "CONTROL_CUTOVER_MIGRATION_REQUIRED", "control-store mode row is missing");
    if (mode.rows[0].mode === "scoped-authoritative") {
      const registry = await client.query(
        `SELECT tenant_id, state_revision::text, state_sha256, idempotency_count
         FROM molit_control_store.control_scope_registry WHERE component = $1 ORDER BY tenant_id`,
        [component],
      );
      const root = componentStateRoot(registry.rows.map((row) => ({
        idempotencyCount: Number(row.idempotency_count),
        stateRevision: Number(row.state_revision),
        stateSha256: row.state_sha256,
        tenantId: row.tenant_id,
      })));
      const head = await client.query(
        "SELECT state_root_sha256 FROM molit_control_store.component_audit_head WHERE component = $1",
        [component],
      );
      assertRuntime(SHA256.test(mode.rows[0].cutover_state_root_sha256 ?? "")
        && root === mode.rows[0].state_root_sha256 && head.rows[0]?.state_root_sha256 === root,
      "CONTROL_CUTOVER_MISMATCH", "live authoritative registry root no longer matches the component audit head");
      await client.query("COMMIT");
      transaction = false;
      return Object.freeze({
        alreadyCutover: true,
        component,
        legacyKeyConversionCount: Number(mode.rows[0].legacy_key_conversion_count),
        sourceKind: mode.rows[0].source_kind,
        sourceApprovalEvidenceSha256: mode.rows[0].source_approval_evidence_sha256,
        scopeMapApprovalEvidenceSha256: mode.rows[0].scope_map_approval_evidence_sha256,
        scopeMapSha256: mode.rows[0].scope_map_sha256,
        currentStateRootSha256: root,
        stateRootSha256: mode.rows[0].cutover_state_root_sha256,
      });
    }

    const snapshotResult = await client.query(
      "SELECT revision::text, state, updated_at FROM molit_control_store.json_snapshot WHERE component = $1 FOR UPDATE",
      [component],
    );
    assertRuntime(snapshotResult.rowCount <= 1, "CONTROL_CUTOVER_MISMATCH", "source JSON snapshot is not unique");
    let sourceKind = "json-snapshot";
    let sourceRevision;
    let sourceUpdatedAt;
    let snapshot;
    let sourceApprovalEvidenceSha256 = null;
    let unprojected = false;
    const approvedLegacy = approvedLegacySource(legacySource, component);
    if (snapshotResult.rowCount === 1) {
      assertRuntime(approvedLegacy === null, "CONTROL_CUTOVER_LEGACY_SOURCE_INVALID", "database and legacy file snapshots cannot both be authoritative");
      sourceRevision = Number(snapshotResult.rows[0].revision);
      sourceUpdatedAt = snapshotResult.rows[0].updated_at;
      snapshot = snapshotResult.rows[0].state;
    } else if (approvedLegacy !== null) {
      sourceKind = "legacy-file-snapshot";
      sourceRevision = approvedLegacy.revision;
      sourceUpdatedAt = approvedLegacy.updatedAt;
      sourceApprovalEvidenceSha256 = approvedLegacy.approvalEvidenceSha256;
      snapshot = approvedLegacy.state;
      unprojected = true;
    } else {
      const residue = await client.query(
        `SELECT
           (SELECT count(*) FROM molit_control_store.resource_state WHERE component = $1)
         + (SELECT count(*) FROM molit_control_store.idempotency_record WHERE component = $1)
         + (SELECT count(*) FROM molit_control_store.audit_event WHERE component = $1)
         + (SELECT count(*) FROM molit_control_store.outbox_event WHERE component = $1)
         + (SELECT count(*) FROM molit_control_store.projection_checkpoint WHERE component = $1)
         + (SELECT count(*) FROM molit_control_store.projection_tenant_registry WHERE component = $1)
           AS row_count`,
        [component],
      );
      assertRuntime(Number(residue.rows[0]?.row_count) === 0, "CONTROL_CUTOVER_SNAPSHOT_MISSING",
        "source snapshot is absent but legacy projection residue exists; fresh-install cutover is forbidden");
      sourceKind = "fresh-install";
      sourceRevision = 1;
      sourceUpdatedAt = at.toISOString();
      snapshot = component === "caas" ? emptyCaasState() : emptyDsaasState();
    }
    const sourceSnapshotSha256 = digest(snapshot);
    const approved = approvedAssignments(approvedScopeMap, component, sourceSnapshotSha256);
    const verified = await verifyProjection(client, component, snapshot, approved, { unprojected });

    await client.query("DELETE FROM molit_control_store.scoped_control_state WHERE component = $1", [component]);
    await client.query("DELETE FROM molit_control_store.control_scope_registry WHERE component = $1", [component]);
    await client.query("DELETE FROM molit_control_store.component_audit_head WHERE component = $1", [component]);
    if (component === "dsaas") await client.query("DELETE FROM molit_control_store.control_participant_registry WHERE component = 'dsaas'");

    const registryRows = [];
    const byTenant = new Map();
    for (const row of verified.expectedLedger) {
      const entries = byTenant.get(row.tenantId) ?? [];
      entries.push(row);
      byTenant.set(row.tenantId, entries);
      let reassigned = await client.query(
        `UPDATE molit_control_store.idempotency_record
         SET tenant_id = $3
         WHERE component = $1 AND record_key = $2
         RETURNING tenant_id, payload, payload_sha256`,
        [component, row.recordKey, row.tenantId],
      );
      if (reassigned.rowCount === 0 && (verified.unprojected || component === "caas" && row.legacyConverted)) {
        reassigned = await client.query(
          `INSERT INTO molit_control_store.idempotency_record
             (component, tenant_id, record_key, payload, payload_sha256, snapshot_revision, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6::bigint, $7::timestamptz)
           RETURNING tenant_id, payload, payload_sha256`,
          [component, row.tenantId, row.recordKey, JSON.stringify(row.payload), digest(row.payload), String(sourceRevision), sourceUpdatedAt],
        );
      }
      assertRuntime(reassigned.rowCount === 1 && reassigned.rows[0].tenant_id === row.tenantId
        && reassigned.rows[0].payload_sha256 === digest(row.payload)
        && digest(reassigned.rows[0].payload) === digest(row.payload),
      "CONTROL_CUTOVER_MISMATCH", "idempotency record could not be reassigned to its resolved scope", { recordKey: row.recordKey });
    }
    if (verified.unprojected) {
      for (const row of verified.expectedAudit) {
        await client.query(
          `INSERT INTO molit_control_store.audit_event
             (component, tenant_id, sequence, event_id, occurred_at, previous_digest, event_digest, event)
           VALUES ($1, $2, $3::bigint, $4, $5::timestamptz, $6, $7, $8::jsonb)`,
          [component, row.tenantId, String(row.sequence), row.eventId, row.occurredAt,
            row.previousDigest, row.eventDigest, JSON.stringify(row.event)],
        );
        const payload = {
          schemaVersion: "molit.audit-outbox/1",
          sourceComponent: component,
          sourceSequence: row.sequence,
          sourceEventDigest: row.eventDigest,
          auditEvent: row.event,
          auditEventPayloadSha256: digest(row.event),
        };
        await client.query(
          `INSERT INTO molit_control_store.outbox_event
             (component, event_id, aggregate_kind, aggregate_id, tenant_id, event_type,
              payload, payload_sha256, created_at, available_at)
           VALUES ($1, $2, 'audit', $3, $4, 'audit.appended', $5::jsonb, $6, $7::timestamptz, $7::timestamptz)`,
          [component, auditOutboxId(component, row), row.eventId, row.tenantId,
            JSON.stringify(payload), digest(payload), row.occurredAt],
        );
      }
    }
    for (const row of verified.expectedResources) {
      const ledger = byTenant.get(row.tenantId) ?? [];
      const stateSha256 = scopedStateDigest(row.payload, ledger);
      const identity = registryIdentity(component, row);
      await client.query(
        `INSERT INTO molit_control_store.scoped_control_state
           (component, tenant_id, resource_kind, revision, payload, payload_sha256, updated_at)
         VALUES ($1, $2, $3, $4::bigint, $5::jsonb, $6, $7::timestamptz)`,
        [component, row.tenantId, row.kind, String(sourceRevision), JSON.stringify(row.payload), digest(row.payload), sourceUpdatedAt],
      );
      if (component === "dsaas") {
        for (const participant of participantIndexRows(row.payload, row.tenantId)) {
          await client.query(
            `INSERT INTO molit_control_store.control_participant_registry
               (component, dataspace_id, participant_id, caas_tenant_id, connector_participant_id,
                connector_namespace, participant_sha256, updated_at)
             VALUES ('dsaas', $1, $2, $3, $4, $5, $6, $7::timestamptz)`,
            [row.tenantId, participant.participantId, participant.caasTenantId, participant.connectorParticipantId,
              participant.connectorNamespace, participant.participantSha256, sourceUpdatedAt],
          );
        }
      }
      await client.query(
        `INSERT INTO molit_control_store.control_scope_registry
           (component, tenant_id, resource_kind, participant_id, connector_namespace, endpoint,
            state_revision, state_sha256, idempotency_count, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::bigint, $8, $9, $10::timestamptz, $10::timestamptz)`,
        [component, row.tenantId, row.kind, identity.participantId, identity.connectorNamespace, identity.endpoint,
          String(sourceRevision), stateSha256, ledger.length, sourceUpdatedAt],
      );
      registryRows.push({ idempotencyCount: ledger.length, stateRevision: sourceRevision, stateSha256, tenantId: row.tenantId });
    }
    const platformLedger = byTenant.get(PLATFORM_TENANT_ID) ?? [];
    const platformSha256 = scopedStateDigest({}, platformLedger);
    await client.query(
      `INSERT INTO molit_control_store.control_scope_registry
         (component, tenant_id, resource_kind, state_revision, state_sha256, idempotency_count, first_seen_at, last_seen_at)
       VALUES ($1, $2, 'platform', 0, $3, $4, $5::timestamptz, $5::timestamptz)
       ON CONFLICT (component, tenant_id) DO NOTHING`,
      [component, PLATFORM_TENANT_ID, platformSha256, platformLedger.length, sourceUpdatedAt],
    );
    registryRows.push({ idempotencyCount: platformLedger.length, stateRevision: 0, stateSha256: platformSha256, tenantId: PLATFORM_TENANT_ID });

    const lastAudit = verified.expectedAudit.at(-1);
    const stateRootSha256 = componentStateRoot(registryRows);
    await client.query(
      `INSERT INTO molit_control_store.component_audit_head
         (component, sequence, event_digest, occurred_at, state_root_sha256, updated_at)
       VALUES ($1, $2::bigint, $3, $4::timestamptz, $5, $6::timestamptz)`,
      [component, String(lastAudit?.sequence ?? 0), lastAudit?.eventDigest ?? "0".repeat(64), lastAudit?.occurredAt ?? null, stateRootSha256, at.toISOString()],
    );
    const updated = await client.query(
       `UPDATE molit_control_store.control_store_mode
       SET mode = 'scoped-authoritative', source_kind = $2,
           source_snapshot_revision = $3::bigint, source_snapshot_sha256 = $4,
           source_approval_evidence_sha256 = $5,
           scope_map_sha256 = $6, scope_map_approval_evidence_sha256 = $7,
           legacy_key_conversion_count = $8, cutover_state_root_sha256 = $9, state_root_sha256 = $9,
           cutover_at = $10::timestamptz, updated_at = $10::timestamptz
       WHERE component = $1 AND mode = 'projection'`,
      [component, sourceKind, String(sourceRevision), sourceSnapshotSha256, sourceApprovalEvidenceSha256,
        approved.receiptSha256, approved.approvalEvidenceSha256,
        verified.expectedLedger.filter(({ legacyConverted }) => legacyConverted).length,
        stateRootSha256, at.toISOString()],
    );
    assertRuntime(updated.rowCount === 1, "CONTROL_CUTOVER_MISMATCH", "control-store cutover mode fence was lost");
    await client.query("COMMIT");
    transaction = false;
    return Object.freeze({
      alreadyCutover: false,
      component,
      legacyKeyConversionCount: verified.expectedLedger.filter(({ legacyConverted }) => legacyConverted).length,
      sourceKind,
      sourceApprovalEvidenceSha256,
      scopeMapApprovalEvidenceSha256: approved.approvalEvidenceSha256,
      scopeMapSha256: approved.receiptSha256,
      sourceSnapshotSha256,
      currentStateRootSha256: stateRootSha256,
      stateRootSha256,
    });
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release(transaction);
  }
}
