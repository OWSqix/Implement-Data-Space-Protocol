import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { digest } from "../discovery/stable-json.mjs";
import { assertCleanUri, validateContract, rejectSecretMaterial } from "./contracts.mjs";
import { appendAudit } from "./store.mjs";
import { evaluateRequiredServices } from "./service-registry.mjs";
import { verifyApprovalDecision } from "./approval-registry.mjs";

const OPERATOR = "dsaas.operator";
const ADMIN = "dsaas.dataspace-admin";
const READER = "dsaas.auditor";
const SCHEDULED_RECONCILE = Symbol("scheduled-reconcile");
const SCHEDULER_ACTOR = Object.freeze({
  subject: "system:dsaas-reconcile-scheduler",
  principalId: "system:dsaas-reconcile-scheduler",
  clientId: "molit-dsaas-control-plane",
  keyId: "internal-reconcile-scheduler-v1",
  roles: Object.freeze([OPERATOR]),
  dataspaceIds: Object.freeze([]),
});

function actorSubject(actor) {
  const identifier = /^[^\s\u0000-\u001f\u007f]{3,256}$/u;
  assertRuntime(identifier.test(actor?.subject ?? "") && actor.principalId === actor.subject, "DSAAS_UNAUTHENTICATED", "authenticated actor principal is missing or differs from subject");
  assertRuntime(identifier.test(actor.clientId ?? "") && identifier.test(actor.keyId ?? ""), "DSAAS_UNAUTHENTICATED", "authenticated actor client or key identifier is missing");
  assertRuntime(Array.isArray(actor.roles) && actor.roles.every((role) => typeof role === "string"), "DSAAS_UNAUTHENTICATED", "authenticated actor roles are missing");
  return actor.subject;
}

function authorizedRole(actor, dataspaceId, write = false) {
  actorSubject(actor);
  if (actor.roles.includes(OPERATOR)) return OPERATOR;
  const member = Array.isArray(actor.dataspaceIds) && actor.dataspaceIds.includes(dataspaceId);
  if (write) return member && actor.roles.includes(ADMIN) ? ADMIN : null;
  if (member && actor.roles.includes(ADMIN)) return ADMIN;
  return member && actor.roles.includes(READER) ? READER : null;
}

function requireAuthorization(actor, dataspaceId, write = false) {
  const role = authorizedRole(actor, dataspaceId, write);
  if (!role) throw new RuntimeError("DSAAS_FORBIDDEN", "actor is not authorized for this dataspace", { dataspaceId });
  return role;
}

function requireOperator(actor) {
  actorSubject(actor);
  if (!actor.roles.includes(OPERATOR)) throw new RuntimeError("DSAAS_FORBIDDEN", "dataspace creation requires the dsaas.operator role");
  return OPERATOR;
}

function auditActor(actor, usedRole) {
  actorSubject(actor);
  assertRuntime(actor.roles.includes(usedRole), "DSAAS_FORBIDDEN", "audit role was not granted to the authenticated actor");
  return {
    actor: actor.subject,
    actorPrincipalId: actor.principalId,
    actorClientId: actor.clientId,
    actorKeyId: actor.keyId,
    actorRoles: [...new Set(actor.roles)].sort(),
    actorUsedRole: usedRole,
  };
}

function assertIdempotencyKey(key) {
  assertRuntime(typeof key === "string" && /^[\x21-\x7e]{8,128}$/u.test(key), "DSAAS_IDEMPOTENCY_KEY_REQUIRED", "a printable 8..128 character Idempotency-Key is required");
}

function idempotencySlot(actor, operation, key) {
  return digest({ actor: actorSubject(actor), operation, key });
}

function priorIdempotent(state, slot, requestDigest) {
  const prior = state.idempotency[slot];
  if (!prior) return null;
  if (prior.requestDigest !== requestDigest) throw new RuntimeError("DSAAS_IDEMPOTENCY_CONFLICT", "Idempotency-Key was reused with different input");
  return structuredClone(prior.response);
}

function rememberIdempotent(state, slot, requestDigest, response, at, maxRecords) {
  if (!state.idempotency[slot] && Object.keys(state.idempotency).length >= maxRecords) {
    throw new RuntimeError("DSAAS_IDEMPOTENCY_CAPACITY", "DSaaS idempotency registry reached its configured capacity");
  }
  state.idempotency[slot] = { at, requestDigest, response: structuredClone(response) };
}

function resourceView(record) {
  return structuredClone(record);
}

function findDataspace(state, dataspaceId) {
  const record = state.dataspaces[dataspaceId];
  if (!record) throw new RuntimeError("DSAAS_NOT_FOUND", "dataspace does not exist", { dataspaceId });
  return record;
}

function exactArtifactAllowed(artifact, allowed) {
  return allowed.some((candidate) => candidate.iri === artifact.iri
    && candidate.version === artifact.version
    && candidate.sha256 === artifact.sha256);
}

function validateApproval(approval) {
  assertRuntime(approval && typeof approval === "object" && !Array.isArray(approval), "DSAAS_APPROVAL_INVALID", "approval is required");
  assertRuntime(Object.keys(approval).every((key) => ["decisionId", "evidenceSha256"].includes(key)), "DSAAS_APPROVAL_INVALID", "approval contains an unsupported field");
  assertRuntime(typeof approval.decisionId === "string" && /^[A-Za-z0-9._:-]{3,128}$/u.test(approval.decisionId), "DSAAS_APPROVAL_INVALID", "approval decisionId is invalid");
  assertRuntime(typeof approval.evidenceSha256 === "string" && /^[a-f0-9]{64}$/u.test(approval.evidenceSha256), "DSAAS_APPROVAL_INVALID", "approval evidenceSha256 is invalid");
}

async function validateCaasObservation(observation, request, correlation) {
  rejectSecretMaterial(observation);
  try {
    await validateContract("caasEnsureResponse", observation);
  } catch (error) {
    if (error?.code !== "DSAAS_CONTRACT_INVALID") throw error;
    throw new RuntimeError("DSAAS_CAAS_RESPONSE_INVALID", "CaaS response does not satisfy the pinned ensure response contract", { contract: "caasEnsureResponse" });
  }
  assertRuntime(Number.isSafeInteger(correlation.desiredGeneration) && correlation.desiredGeneration > 0
    && correlation.caasTenantId === request.caasTenantId
    && correlation.connectorPlanId === request.connectorPlanId
    && ["DESIRED_STATE", "APPROVAL_REVOCATION", "SERVICE_BLOCK"].includes(correlation.intent),
  "DSAAS_CAAS_CORRELATION_INVALID", "CaaS request correlation context is invalid");
  assertRuntime(observation.connectorId === correlation.caasTenantId
    && observation.dataspaceId === request.dataspaceId
    && observation.participantId === request.participantId,
  "DSAAS_CAAS_RESPONSE_INVALID", "CaaS response connector identity correlation failed");
  assertRuntime(!["APPROVAL_REVOCATION", "SERVICE_BLOCK"].includes(correlation.intent) || observation.state !== "ACTIVE", "DSAAS_CAAS_RESPONSE_INVALID", "CaaS suspension response cannot report an active connector");
  if (observation.endpoints) assertCleanUri(observation.endpoints.connectorBase, "$.endpoints.connectorBase", { protocols: ["https:"] });
  return structuredClone(observation);
}

function safeErrorCode(error, fallback = "CAAS_ERROR") {
  let code;
  try { code = error?.code; } catch { return fallback; }
  return typeof code === "string" && /^[A-Z][A-Z0-9_:-]{0,63}$/u.test(code) ? code : fallback;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("DSaaS reconciliation was aborted");
  error.name = "AbortError";
  throw error;
}

function canonicalNamespace(value) {
  return new URL(value).href;
}

function instantAfter(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds + 1 : null;
}

function nextApprovalCheckAt(record, approvalDecisionRegistry) {
  const approved = Object.values(record.participants).filter(({ approvalState }) => approvalState === "APPROVED");
  if (approved.length === 0) return null;
  const deadlines = [];
  const registryValidUntil = instantAfter(approvalDecisionRegistry?.validUntil ?? approvalDecisionRegistry?.registry?.validUntil);
  if (registryValidUntil !== null) deadlines.push(registryValidUntil);
  const issuedAt = Date.parse(approvalDecisionRegistry?.issuedAt ?? approvalDecisionRegistry?.registry?.issuedAt);
  const maxAgeSeconds = approvalDecisionRegistry?.maxAgeSeconds;
  if (Number.isFinite(issuedAt) && Number.isFinite(maxAgeSeconds)) deadlines.push(issuedAt + maxAgeSeconds * 1000 + 1);
  for (const participant of approved) {
    const decisionValidUntil = instantAfter(participant.approval?.externalDecision?.validUntil);
    if (decisionValidUntil !== null) deadlines.push(decisionValidUntil);
  }
  return deadlines.length === 0 ? null : new Date(Math.min(...deadlines)).toISOString();
}

function nextServiceCheckAt(record, serviceRegistry) {
  const deadlines = [];
  const registryValidUntil = instantAfter(serviceRegistry?.validUntil ?? serviceRegistry?.registry?.validUntil);
  if (registryValidUntil !== null) deadlines.push(registryValidUntil);
  const issuedAt = Date.parse(serviceRegistry?.issuedAt ?? serviceRegistry?.registry?.issuedAt);
  const maxAgeSeconds = serviceRegistry?.maxAgeSeconds;
  if (Number.isFinite(issuedAt) && Number.isFinite(maxAgeSeconds)) deadlines.push(issuedAt + maxAgeSeconds * 1000 + 1);
  for (const serviceId of record.spec.requiredServiceIds) {
    const observedAt = Date.parse(serviceRegistry?.byId?.get(serviceId)?.evidence?.observedAt);
    if (Number.isFinite(observedAt) && Number.isFinite(maxAgeSeconds)) deadlines.push(observedAt + maxAgeSeconds * 1000 + 1);
  }
  return deadlines.length === 0 ? null : new Date(Math.min(...deadlines)).toISOString();
}

function compositeCheckAt(record, approvalDecisionRegistry, serviceRegistry) {
  return [nextApprovalCheckAt(record, approvalDecisionRegistry), nextServiceCheckAt(record, serviceRegistry)]
    .filter(Boolean)
    .sort()[0] ?? null;
}

function retryCheckAt(at, intervalMs) {
  return new Date(Date.parse(at) + intervalMs).toISOString();
}

function caasErrorProjection(observations) {
  return Object.entries(observations)
    .filter(([, observation]) => observation.state === "ERROR")
    .map(([participantId, observation]) => ({ participantId, errorCode: observation.errorCode }))
    .sort((left, right) => left.participantId.localeCompare(right.participantId));
}

function observedServiceReadiness(record) {
  const requiredServiceIds = record.spec.requiredServiceIds;
  const observations = record.serviceObservations ?? [];
  if (observations.length !== requiredServiceIds.length) return null;
  const byId = new Map(observations.map((observation) => [observation.serviceId, observation]));
  if (byId.size !== requiredServiceIds.length || requiredServiceIds.some((serviceId) => !byId.has(serviceId))) return null;
  return requiredServiceIds.every((serviceId) => byId.get(serviceId).effectiveStatus === "READY");
}

function serviceGateAffectsCaasCommand(record) {
  return record.spec.desiredState !== "SUSPENDED"
    && Object.values(record.participants).some((participant) => participant.approvalState === "APPROVED"
      && participant.spec.desiredState !== "SUSPENDED");
}

function nextCaasRetry(previous, errors, dataspaceId, desiredGeneration, at, baseMs, maxMs) {
  const errorFingerprint = digest({ desiredGeneration, errors });
  const repeated = previous?.desiredGeneration === desiredGeneration && previous.errorFingerprint === errorFingerprint;
  const attempt = repeated ? Math.min(previous.attempt + 1, 64) : 1;
  const exponent = Math.min(attempt - 1, 30);
  const nominalDelayMs = Math.min(maxMs, baseMs * (2 ** exponent));
  const jitterSeed = digest({ attempt, dataspaceId, errorFingerprint });
  const jitterPermille = 750 + (Number.parseInt(jitterSeed.slice(0, 8), 16) % 251);
  const delayMs = Math.max(1000, Math.floor((nominalDelayMs * jitterPermille) / 1000));
  return {
    desiredGeneration,
    attempt,
    errorFingerprint,
    errorCodes: [...new Set(errors.map(({ errorCode }) => errorCode))].sort(),
    firstFailureAt: repeated ? previous.firstFailureAt : at,
    lastFailureAt: at,
    nominalDelayMs,
    jitterPermille,
    delayMs,
    nextRetryAt: retryCheckAt(at, delayMs),
    jitterPolicy: "stable-hash-75-100",
  };
}

function assertParticipantIdentifiersUnique(state, dataspaceId, spec) {
  for (const [existingDataspaceId, dataspace] of Object.entries(state.dataspaces)) {
    for (const existing of Object.values(dataspace.participants)) {
      const fields = [
        ["caasTenantId", existing.spec.caasTenantId, spec.caasTenantId],
        ["connectorParticipantId", existing.spec.connectorParticipantId, spec.connectorParticipantId],
        ["connectorNamespace", canonicalNamespace(existing.spec.connectorNamespace), canonicalNamespace(spec.connectorNamespace)],
      ];
      const conflict = fields.find(([, current, candidate]) => current === candidate);
      assertRuntime(!conflict, "DSAAS_PARTICIPANT_IDENTIFIER_CONFLICT", "participant technical identifier is already assigned", {
        conflictingDataspaceId: existingDataspaceId,
        dataspaceId,
        field: conflict?.[0],
      });
    }
  }
}

export class DsaasControlPlane {
  constructor({
    store,
    caas,
    serviceRegistry,
    serviceRegistryProvider,
    approvalDecisionRegistry,
    approvalDecisionRegistryProvider,
    approvedMetadataProfiles,
    approvedGovernanceBundles,
    connectorPlanIds,
    allowedNamespaceOrigins,
    allowedIdentityModes = ["dcp"],
    clock = () => new Date(),
    maxDataspaces = 100,
    maxParticipantsPerDataspace = 10_000,
    maxIdempotencyRecords = 100_000,
    maxReconcileSupersessions = 8,
    schedulerIntervalMs = 60_000,
    caasRetryBaseMs = schedulerIntervalMs,
    caasRetryMaxMs = 3_600_000,
  }) {
    Object.assign(this, {
      store,
      caas,
      serviceRegistry,
      serviceRegistryProvider,
      approvalDecisionRegistry,
      approvalDecisionRegistryProvider,
      approvedMetadataProfiles,
      approvedGovernanceBundles,
      connectorPlanIds,
      allowedNamespaceOrigins,
      allowedIdentityModes,
      clock,
      maxDataspaces,
      maxParticipantsPerDataspace,
      maxIdempotencyRecords,
      maxReconcileSupersessions,
      schedulerIntervalMs,
      caasRetryBaseMs,
      caasRetryMaxMs,
    });
  }

  now() { return this.clock().toISOString(); }

  async #currentApprovalDecisionRegistry() {
    return this.approvalDecisionRegistryProvider
      ? this.approvalDecisionRegistryProvider()
      : this.approvalDecisionRegistry;
  }

  async #currentServiceRegistry() {
    return this.serviceRegistryProvider ? this.serviceRegistryProvider() : this.serviceRegistry;
  }

  async readiness({ signal } = {}) {
    throwIfAborted(signal);
    const checks = {
      state: "NOT_READY",
      serviceRegistry: "NOT_READY",
      approvalRegistry: "NOT_READY",
      caas: "NOT_VERIFIED",
    };
    const failureCodes = [];
    try {
      await this.store.read(() => null, { signal });
      checks.state = "READY";
    } catch (error) {
      throwIfAborted(signal);
      failureCodes.push(safeErrorCode(error, "DSAAS_STATE_READINESS_FAILED"));
    }
    try {
      await this.#currentServiceRegistry();
      throwIfAborted(signal);
      checks.serviceRegistry = "READY";
    } catch (error) {
      throwIfAborted(signal);
      failureCodes.push(safeErrorCode(error, "DSAAS_SERVICE_REGISTRY_REFRESH_FAILED"));
    }
    try {
      const approvalDecisionRegistry = await this.#currentApprovalDecisionRegistry();
      throwIfAborted(signal);
      assertRuntime(approvalDecisionRegistry?.status === "READY", "DSAAS_EXTERNAL_APPROVAL_GATE_BLOCKED", "external institutional approval registry is not ready");
      checks.approvalRegistry = "READY";
    } catch (error) {
      throwIfAborted(signal);
      failureCodes.push(safeErrorCode(error, "DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED"));
    }
    return Object.freeze({
      ready: failureCodes.length === 0,
      scope: "LOCAL_CONTROL_PLANE",
      checks: Object.freeze(checks),
      failureCodes: Object.freeze([...new Set(failureCodes)].sort()),
    });
  }

  async scheduledReconciliationTargets({ signal } = {}) {
    throwIfAborted(signal);
    const now = this.now();
    let registryDigest = null;
    let registryUnavailable = false;
    try {
      const approvalDecisionRegistry = await this.#currentApprovalDecisionRegistry();
      throwIfAborted(signal);
      registryUnavailable = approvalDecisionRegistry?.status !== "READY";
      registryDigest = approvalDecisionRegistry?.actualSha256 ?? null;
    } catch (error) {
      throwIfAborted(signal);
      registryUnavailable = true;
    }
    let serviceRegistry;
    let serviceRegistryUnavailable = false;
    try {
      serviceRegistry = await this.#currentServiceRegistry();
      throwIfAborted(signal);
    } catch (error) {
      throwIfAborted(signal);
      serviceRegistryUnavailable = true;
    }
    throwIfAborted(signal);
    const targets = await this.store.read((state) => Object.entries(state.dataspaces)
      .filter(([, record]) => {
        const approved = Object.values(record.participants).filter(({ approvalState }) => approvalState === "APPROVED");
        const registryChanged = approved.some((participant) => participant.approval?.externalDecision?.registrySha256 !== registryDigest);
        const approvalRefreshRequired = approved.length > 0 && (registryUnavailable || registryChanged);
        let serviceProjectionChanged = true;
        try {
          const currentServices = evaluateRequiredServices(record.spec.requiredServiceIds, serviceRegistry, now).services;
          serviceProjectionChanged = serviceRegistryUnavailable
            || record.serviceRegistrySha256 !== (serviceRegistry.actualSha256 ?? null)
            || digest(currentServices) !== digest(record.serviceObservations ?? []);
        } catch {
          serviceProjectionChanged = true;
        }
        const durableDeadlineMissing = record.nextCheckAt === undefined;
        const deadlineDue = typeof record.nextCheckAt === "string" && Date.parse(record.nextCheckAt) <= Date.parse(now);
        return approvalRefreshRequired || serviceProjectionChanged || durableDeadlineMissing || deadlineDue;
      })
      .map(([dataspaceId]) => dataspaceId)
      .sort());
    throwIfAborted(signal);
    return targets;
  }

  async reconciliationBacklog({ signal } = {}) {
    throwIfAborted(signal);
    const backlog = await this.store.read((state) => {
      const failures = [];
      const blocked = [];
      for (const [dataspaceId, record] of Object.entries(state.dataspaces)) {
        if (record.caasRetry) {
          failures.push({ dataspaceId, errorCodes: record.caasRetry.errorCodes, nextRetryAt: record.caasRetry.nextRetryAt });
          continue;
        }
        if (!record.reconcilePending) continue;
        const approvalBlocked = Object.values(record.participants).some(({ approvalState }) => approvalState === "REAPPROVAL_REQUIRED");
        const serviceBlocked = record.serviceObservations.some(({ effectiveStatus }) => effectiveStatus !== "READY");
        blocked.push({
          dataspaceId,
          errorCode: approvalBlocked
            ? "DSAAS_APPROVAL_BLOCKED"
            : serviceBlocked ? "DSAAS_REQUIRED_SERVICE_BLOCKED" : "DSAAS_RECONCILIATION_BLOCKED",
        });
      }
      return { blocked, failures };
    });
    throwIfAborted(signal);
    return backlog;
  }

  async reconcileScheduled(dataspaceId, runId, { signal } = {}) {
    throwIfAborted(signal);
    assertRuntime(typeof runId === "string" && /^[A-Za-z0-9._:-]{8,128}$/u.test(runId), "DSAAS_SCHEDULER_RUN_ID_INVALID", "scheduled reconciliation run ID is invalid");
    return this.reconcile(dataspaceId, SCHEDULER_ACTOR, runId, SCHEDULED_RECONCILE, { signal });
  }

  async createDataspace(spec, actor, key, { signal } = {}) {
    throwIfAborted(signal);
    const actorAudit = auditActor(actor, requireOperator(actor));
    assertIdempotencyKey(key);
    await validateContract("dataspace", spec);
    throwIfAborted(signal);
    rejectSecretMaterial(spec);
    assertCleanUri(spec.namespaceBase, "$.namespaceBase", { protocols: ["https:"] });
    assertCleanUri(spec.metadataProfile.iri, "$.metadataProfile.iri", { protocols: ["https:"] });
    assertCleanUri(spec.governanceBundle.iri, "$.governanceBundle.iri", { protocols: ["https:"] });
    assertRuntime(exactArtifactAllowed(spec.metadataProfile, this.approvedMetadataProfiles), "DSAAS_PROFILE_NOT_APPROVED", "metadata profile is not in the approved artifact registry");
    assertRuntime(exactArtifactAllowed(spec.governanceBundle, this.approvedGovernanceBundles), "DSAAS_GOVERNANCE_NOT_APPROVED", "governance bundle is not in the approved artifact registry");
    assertRuntime(this.connectorPlanIds.includes(spec.connectorPlanId), "DSAAS_CONNECTOR_PLAN_NOT_APPROVED", "connector plan is not approved", { connectorPlanId: spec.connectorPlanId });
    assertRuntime(this.allowedNamespaceOrigins.includes(new URL(spec.namespaceBase).origin), "DSAAS_NAMESPACE_NOT_APPROVED", "namespace origin is not approved", { origin: new URL(spec.namespaceBase).origin });
    assertRuntime(this.allowedIdentityModes.includes(spec.protocolProfile.identityMode), "DSAAS_IDENTITY_MODE_NOT_APPROVED", "protocol identity mode is not approved", { identityMode: spec.protocolProfile.identityMode });
    const operation = "dataspace.create";
    const requestDigest = digest(spec);
    const slot = idempotencySlot(actor, operation, key);
    return this.store.transact((state) => {
      throwIfAborted(signal);
      const prior = priorIdempotent(state, slot, requestDigest);
      if (prior) return prior;
      assertRuntime(!state.dataspaces[spec.dataspaceId], "DSAAS_ALREADY_EXISTS", "dataspace already exists", { dataspaceId: spec.dataspaceId });
      assertRuntime(Object.keys(state.dataspaces).length < this.maxDataspaces, "DSAAS_CAPACITY", "dataspace capacity has been reached");
      const at = this.now();
      const record = {
        spec: structuredClone(spec),
        revision: 1,
        desiredGeneration: 1,
        appliedGeneration: 0,
        reconcilePending: true,
        observedState: "PENDING",
        serviceObservations: [],
        serviceRegistrySha256: null,
        caasRetry: null,
        participants: {},
        createdAt: at,
        createdBy: actor.subject,
        updatedAt: at,
        lastReconcileAt: null,
        nextCheckAt: at,
      };
      state.dataspaces[spec.dataspaceId] = record;
      appendAudit(state, { ...actorAudit, action: operation, resource: `dataspace:${spec.dataspaceId}`, outcome: "accepted", detailsDigest: requestDigest, at });
      const response = resourceView(record);
      rememberIdempotent(state, slot, requestDigest, response, at, this.maxIdempotencyRecords);
      return response;
    }, { signal });
  }

  async getDataspace(dataspaceId, actor, { signal } = {}) {
    throwIfAborted(signal);
    requireAuthorization(actor, dataspaceId, false);
    return this.store.read((state) => resourceView(findDataspace(state, dataspaceId)), { signal });
  }

  async getParticipant(dataspaceId, participantId, actor, { signal } = {}) {
    throwIfAborted(signal);
    requireAuthorization(actor, dataspaceId, false);
    return this.store.read((state) => {
      const participant = findDataspace(state, dataspaceId).participants[participantId];
      if (!participant) throw new RuntimeError("DSAAS_PARTICIPANT_NOT_FOUND", "participant does not exist", { participantId });
      return resourceView(participant);
    }, { signal });
  }

  async setDesiredState(dataspaceId, desiredState, expectedRevision, actor, key, { signal } = {}) {
    throwIfAborted(signal);
    const actorAudit = auditActor(actor, requireAuthorization(actor, dataspaceId, true));
    assertIdempotencyKey(key);
    assertRuntime(["ACTIVE", "SUSPENDED"].includes(desiredState), "DSAAS_DESIRED_STATE_INVALID", "desired state must be ACTIVE or SUSPENDED");
    assertRuntime(Number.isSafeInteger(expectedRevision) && expectedRevision > 0, "DSAAS_REVISION_REQUIRED", "a positive expected revision is required");
    const operation = "dataspace.desired-state.set";
    const input = { dataspaceId, desiredState, expectedRevision };
    const requestDigest = digest(input);
    const slot = idempotencySlot(actor, operation, key);
    return this.store.transact((state) => {
      throwIfAborted(signal);
      const prior = priorIdempotent(state, slot, requestDigest);
      if (prior) return prior;
      const record = findDataspace(state, dataspaceId);
      assertRuntime(record.revision === expectedRevision, "DSAAS_REVISION_CONFLICT", "dataspace revision changed", { actual: record.revision, expected: expectedRevision });
      const at = this.now();
      record.spec.desiredState = desiredState;
      record.desiredGeneration += 1;
      record.reconcilePending = true;
      record.observedState = "RECONCILING";
      record.nextCheckAt = at;
      record.caasRetry = null;
      record.revision += 1;
      record.updatedAt = at;
      appendAudit(state, { ...actorAudit, action: operation, resource: `dataspace:${dataspaceId}`, outcome: "accepted", detailsDigest: requestDigest, at });
      const response = resourceView(record);
      rememberIdempotent(state, slot, requestDigest, response, at, this.maxIdempotencyRecords);
      return response;
    }, { signal });
  }

  async submitParticipant(dataspaceId, spec, actor, key, { signal } = {}) {
    throwIfAborted(signal);
    const actorAudit = auditActor(actor, requireAuthorization(actor, dataspaceId, true));
    assertIdempotencyKey(key);
    await validateContract("participant", spec);
    throwIfAborted(signal);
    rejectSecretMaterial(spec);
    assertCleanUri(spec.connectorNamespace, "$.connectorNamespace", { protocols: ["https:"] });
    assertCleanUri(spec.evidence.uri, "$.evidence.uri");
    assertRuntime(this.connectorPlanIds.includes(spec.connectorPlanId), "DSAAS_CONNECTOR_PLAN_NOT_APPROVED", "participant connector plan is not approved", { connectorPlanId: spec.connectorPlanId });
    const operation = "participant.submit";
    const requestDigest = digest({ dataspaceId, spec });
    const slot = idempotencySlot(actor, operation, key);
    return this.store.transact((state) => {
      throwIfAborted(signal);
      const prior = priorIdempotent(state, slot, requestDigest);
      if (prior) return prior;
      const record = findDataspace(state, dataspaceId);
      assertRuntime(spec.connectorPlanId === record.spec.connectorPlanId, "DSAAS_CONNECTOR_PLAN_MISMATCH", "participant connector plan must equal the dataspace connector plan", {
        dataspaceConnectorPlanId: record.spec.connectorPlanId,
        participantConnectorPlanId: spec.connectorPlanId,
      });
      assertRuntime(!record.participants[spec.participantId], "DSAAS_PARTICIPANT_EXISTS", "participant already exists", { participantId: spec.participantId });
      assertParticipantIdentifiersUnique(state, dataspaceId, spec);
      assertRuntime(Object.keys(record.participants).length < this.maxParticipantsPerDataspace, "DSAAS_PARTICIPANT_CAPACITY", "participant capacity has been reached");
      const at = this.now();
      const participant = {
        spec: structuredClone(spec),
        revision: 1,
        approvalState: "PENDING_APPROVAL",
        observedState: "PENDING_APPROVAL",
        submittedAt: at,
        submittedBy: actor.subject,
        approval: null,
        approvalErrorCode: null,
        connector: null,
        lastKnownConnector: null,
        lastError: null,
        revokePending: false,
        updatedAt: at,
      };
      record.participants[spec.participantId] = participant;
      record.revision += 1;
      record.updatedAt = at;
      appendAudit(state, { ...actorAudit, action: operation, resource: `dataspace:${dataspaceId}/participant:${spec.participantId}`, outcome: "pending-approval", detailsDigest: requestDigest, at });
      const response = resourceView(participant);
      rememberIdempotent(state, slot, requestDigest, response, at, this.maxIdempotencyRecords);
      return response;
    }, { signal });
  }

  async approveParticipant(dataspaceId, participantId, approval, actor, key, { signal } = {}) {
    throwIfAborted(signal);
    const actorAudit = auditActor(actor, requireAuthorization(actor, dataspaceId, true));
    assertIdempotencyKey(key);
    validateApproval(approval);
    const operation = "participant.approve";
    const requestDigest = digest({ dataspaceId, participantId, approval });
    const slot = idempotencySlot(actor, operation, key);
    const replay = await this.store.read((state) => priorIdempotent(state, slot, requestDigest));
    throwIfAborted(signal);
    if (replay) return replay;
    const approvalDecisionRegistry = await this.#currentApprovalDecisionRegistry();
    throwIfAborted(signal);
    return this.store.transact((state) => {
      throwIfAborted(signal);
      const prior = priorIdempotent(state, slot, requestDigest);
      if (prior) return prior;
      const record = findDataspace(state, dataspaceId);
      const participant = record.participants[participantId];
      assertRuntime(participant, "DSAAS_PARTICIPANT_NOT_FOUND", "participant does not exist", { participantId });
      assertRuntime(["PENDING_APPROVAL", "REAPPROVAL_REQUIRED"].includes(participant.approvalState), "DSAAS_APPROVAL_STATE_INVALID", "participant is not awaiting initial approval or reapproval");
      const approvalOutcome = participant.approvalState === "REAPPROVAL_REQUIRED" ? "reapproved" : "approved";
      assertRuntime(participant.submittedBy !== actor.subject, "DSAAS_FOUR_EYES_REQUIRED", "the submitter cannot approve the same participant application");
      assertRuntime(participant.spec.evidence.sha256 === approval.evidenceSha256, "DSAAS_APPROVAL_EVIDENCE_MISMATCH", "approval does not bind the submitted evidence digest");
      const at = this.now();
      const externalDecision = verifyApprovalDecision(approvalDecisionRegistry, {
        approval,
        dataspaceId,
        participant,
      }, at);
      participant.approvalState = "APPROVED";
      participant.approvalErrorCode = null;
      participant.observedState = "PROVISIONING";
      participant.approval = { ...structuredClone(approval), approvedAt: at, approvedBy: actor.subject, externalDecision };
      participant.revokePending = false;
      participant.revision += 1;
      participant.updatedAt = at;
      record.desiredGeneration += 1;
      record.reconcilePending = true;
      record.observedState = "RECONCILING";
      record.nextCheckAt = at;
      record.caasRetry = null;
      record.revision += 1;
      record.updatedAt = at;
      appendAudit(state, { ...actorAudit, action: operation, resource: `dataspace:${dataspaceId}/participant:${participantId}`, outcome: approvalOutcome, detailsDigest: requestDigest, at });
      const response = resourceView(participant);
      rememberIdempotent(state, slot, requestDigest, response, at, this.maxIdempotencyRecords);
      return response;
    }, { signal });
  }

  async reconcile(dataspaceId, actor, key, mode = null, { signal } = {}) {
    throwIfAborted(signal);
    const scheduled = mode === SCHEDULED_RECONCILE;
    assertRuntime(mode === null || scheduled, "DSAAS_RECONCILE_MODE_INVALID", "reconcile mode is invalid");
    if (scheduled) {
      assertRuntime(actor === SCHEDULER_ACTOR, "DSAAS_RECONCILE_MODE_INVALID", "scheduled reconciliation actor is invalid");
    }
    const actorAudit = auditActor(actor, requireAuthorization(actor, dataspaceId, true));
    assertIdempotencyKey(key);
    const operation = scheduled ? "dataspace.reconcile.scheduled" : "dataspace.reconcile";
    const slot = scheduled ? null : idempotencySlot(actor, operation, key);
    const requestSignal = signal;
    return this.store.withResourceLock(`dataspace:${dataspaceId}`, async (lease) => {
      const signal = lease?.signal && requestSignal
        ? AbortSignal.any([requestSignal, lease.signal])
        : lease?.signal ?? requestSignal;
      throwIfAborted(signal);
      const requestDigest = digest({ dataspaceId });
      const replay = slot === null ? null : await this.store.read((state) => priorIdempotent(state, slot, requestDigest));
      throwIfAborted(signal);
      if (replay) return replay;
      // Desired-state writers use the state transaction lock, not this long-lived
      // resource lock. The generation/revision fence below therefore detects an
      // interleaving write after a remote side effect and immediately re-applies
      // the newest snapshot before any observation is committed.
      let supersessions = 0;
      while (supersessions < this.maxReconcileSupersessions) {
        throwIfAborted(signal);
        let snapshot = await this.store.read((state) => resourceView(findDataspace(state, dataspaceId)));
        throwIfAborted(signal);
        const observedAt = this.now();
        let serviceRegistry;
        let serviceRegistryErrorCode = null;
        try {
          serviceRegistry = await this.#currentServiceRegistry();
          throwIfAborted(signal);
        } catch (error) {
          throwIfAborted(signal);
          serviceRegistryErrorCode = safeErrorCode(error, "DSAAS_SERVICE_REGISTRY_REFRESH_FAILED");
        }
        const services = serviceRegistryErrorCode
          ? {
            ready: false,
            registryFresh: false,
            services: snapshot.spec.requiredServiceIds.map((serviceId) => ({ serviceId, status: "UNAVAILABLE", effectiveStatus: "UNAVAILABLE", errorCode: serviceRegistryErrorCode })),
          }
          : evaluateRequiredServices(snapshot.spec.requiredServiceIds, serviceRegistry, observedAt);
        const approvalChecks = {};
        let approvalDecisionRegistry;
        let approvalRegistryErrorCode = null;
        try {
          approvalDecisionRegistry = await this.#currentApprovalDecisionRegistry();
          throwIfAborted(signal);
        } catch (error) {
          throwIfAborted(signal);
          approvalRegistryErrorCode = safeErrorCode(error, "DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED");
        }
        for (const [participantId, participant] of Object.entries(snapshot.participants)) {
          if (participant.approvalState === "REAPPROVAL_REQUIRED") {
            approvalChecks[participantId] = {
              valid: false,
              errorCode: safeErrorCode({ code: participant.approvalErrorCode }, "DSAAS_REAPPROVAL_REQUIRED"),
            };
            continue;
          }
          if (participant.approvalState !== "APPROVED") continue;
          if (approvalRegistryErrorCode) {
            approvalChecks[participantId] = { valid: false, errorCode: approvalRegistryErrorCode };
            continue;
          }
          try {
            const externalDecision = verifyApprovalDecision(approvalDecisionRegistry, {
              approval: participant.approval,
              dataspaceId,
              participant,
            }, observedAt);
            approvalChecks[participantId] = { valid: true, externalDecision };
          } catch (error) {
            approvalChecks[participantId] = { valid: false, errorCode: safeErrorCode(error, "DSAAS_APPROVAL_REVALIDATION_FAILED") };
          }
        }
        const approvalFailures = Object.fromEntries(Object.entries(approvalChecks).filter(([, result]) => !result.valid));
        const approvalBlocked = Object.keys(approvalFailures).length > 0;
        const approvalsUnchanged = Object.entries(approvalChecks).every(([participantId, result]) => {
          const participant = snapshot.participants[participantId];
          return result.valid
            ? digest(result.externalDecision) === digest(participant.approval?.externalDecision)
            : participant.approvalState === "REAPPROVAL_REQUIRED" && participant.approvalErrorCode === result.errorCode;
        });
        const servicesUnchanged = snapshot.serviceRegistrySha256 === (serviceRegistry?.actualSha256 ?? null)
          && digest(snapshot.serviceObservations ?? []) === digest(services.services);
        const approvalTransitionRequired = Object.keys(approvalFailures).some((participantId) => snapshot.participants[participantId].approvalState !== "REAPPROVAL_REQUIRED");
        if (scheduled && approvalsUnchanged && servicesUnchanged && snapshot.nextCheckAt !== undefined) {
          const retryWaiting = snapshot.caasRetry?.desiredGeneration === snapshot.desiredGeneration
            && Date.parse(snapshot.caasRetry.nextRetryAt) > Date.parse(observedAt);
          if (retryWaiting) return snapshot;
          const revocationComplete = approvalBlocked && Object.keys(approvalFailures).every((participantId) => {
            const participant = snapshot.participants[participantId];
            return participant.approvalState === "REAPPROVAL_REQUIRED"
              && participant.revokePending === false
              && participant.connector?.state === "SUSPENDED";
          });
          if (revocationComplete && snapshot.caasRetry === null) return snapshot;
        }
        if (scheduled && !approvalBlocked) {
          const servicesUnchanged = snapshot.serviceRegistrySha256 === (serviceRegistry?.actualSha256 ?? null)
            && digest(snapshot.serviceObservations ?? []) === digest(services.services);
          const participantsCurrent = Object.values(snapshot.participants)
            .filter(({ approvalState }) => approvalState === "APPROVED")
            .every(({ connector, revokePending, spec }) => {
              const wanted = snapshot.spec.desiredState === "SUSPENDED" || !services.ready ? "SUSPENDED" : spec.desiredState;
              return !revokePending && connector?.state === wanted;
            });
          const expectedState = snapshot.spec.desiredState === "SUSPENDED"
            ? participantsCurrent ? "SUSPENDED" : "RECONCILING"
            : !services.ready ? "BLOCKED" : participantsCurrent ? "ACTIVE" : "RECONCILING";
          if (snapshot.nextCheckAt !== undefined && approvalsUnchanged && servicesUnchanged && participantsCurrent && snapshot.observedState === expectedState) {
            return snapshot;
          }
        }
        if (approvalBlocked && approvalTransitionRequired) {
          throwIfAborted(signal);
          const prepared = await this.store.transact((state) => {
            throwIfAborted(signal);
            const prior = slot === null ? null : priorIdempotent(state, slot, requestDigest);
            if (prior) return { completed: prior, retry: false };
            const record = findDataspace(state, dataspaceId);
            if (record.revision !== snapshot.revision || record.desiredGeneration !== snapshot.desiredGeneration) {
              return {
                actualGeneration: record.desiredGeneration,
                expectedGeneration: snapshot.desiredGeneration,
                retry: true,
              };
            }
            const at = this.now();
            for (const [participantId, failure] of Object.entries(approvalFailures)) {
              const participant = record.participants[participantId];
              assertRuntime(["APPROVED", "REAPPROVAL_REQUIRED"].includes(participant?.approvalState), "DSAAS_APPROVAL_STATE_INVALID", "participant approval state changed during revalidation", { participantId });
              if (participant.connector && !participant.lastKnownConnector) participant.lastKnownConnector = structuredClone(participant.connector);
              participant.approvalState = "REAPPROVAL_REQUIRED";
              participant.approvalErrorCode = failure.errorCode;
              participant.connector = null;
              participant.observedState = "REVOKING";
              participant.lastError = { code: failure.errorCode, at };
              participant.revokePending = true;
              participant.revision += 1;
              participant.updatedAt = at;
            }
            record.desiredGeneration += 1;
            record.observedState = "BLOCKED";
            record.reconcilePending = true;
            record.nextCheckAt = at;
            record.caasRetry = null;
            record.serviceObservations = services.services;
            record.serviceRegistrySha256 = serviceRegistry?.actualSha256 ?? null;
            record.lastReconcileAt = at;
            record.updatedAt = at;
            record.revision += 1;
            appendAudit(state, {
              ...actorAudit,
              action: operation,
              resource: `dataspace:${dataspaceId}`,
              outcome: "revocation-pending",
              detailsDigest: digest({ approvalFailures, desiredGeneration: record.desiredGeneration, services: services.services }),
              at,
            });
            return { retry: false, snapshot: resourceView(record) };
          }, { signal });
          throwIfAborted(signal);
          if (prepared.completed) return prepared.completed;
          if (prepared.retry) {
            supersessions += 1;
            continue;
          }
          snapshot = prepared.snapshot;
        }
        const serviceProjectionChanged = snapshot.serviceRegistrySha256 !== (serviceRegistry?.actualSha256 ?? null)
          || digest(snapshot.serviceObservations ?? []) !== digest(services.services);
        const previousServiceReadiness = observedServiceReadiness(snapshot);
        const serviceCommandTransitionRequired = serviceProjectionChanged
          && previousServiceReadiness !== null
          && previousServiceReadiness !== services.ready
          && serviceGateAffectsCaasCommand(snapshot);
        if (serviceCommandTransitionRequired) {
          throwIfAborted(signal);
          const prepared = await this.store.transact((state) => {
            throwIfAborted(signal);
            const prior = slot === null ? null : priorIdempotent(state, slot, requestDigest);
            if (prior) return { completed: prior, retry: false };
            const record = findDataspace(state, dataspaceId);
            if (record.revision !== snapshot.revision || record.desiredGeneration !== snapshot.desiredGeneration) {
              return {
                actualGeneration: record.desiredGeneration,
                expectedGeneration: snapshot.desiredGeneration,
                retry: true,
              };
            }
            const at = this.now();
            const previousReadiness = observedServiceReadiness(record);
            const commandChanged = previousReadiness !== null
              && previousReadiness !== services.ready
              && serviceGateAffectsCaasCommand(record);
            if (commandChanged) {
              record.desiredGeneration += 1;
              record.caasRetry = null;
              record.observedState = services.ready ? "RECONCILING" : "BLOCKED";
            }
            record.serviceObservations = services.services;
            record.serviceRegistrySha256 = serviceRegistry?.actualSha256 ?? null;
            record.reconcilePending = true;
            record.nextCheckAt = at;
            record.lastReconcileAt = at;
            record.updatedAt = at;
            record.revision += 1;
            appendAudit(state, {
              ...actorAudit,
              action: operation,
              resource: `dataspace:${dataspaceId}`,
              outcome: commandChanged ? "service-gate-transition" : "service-projection-updated",
              detailsDigest: digest({
                commandChanged,
                desiredGeneration: record.desiredGeneration,
                previousReadiness,
                serviceRegistrySha256: record.serviceRegistrySha256,
                services: services.services,
              }),
              at,
            });
            return { retry: false, snapshot: resourceView(record) };
          }, { signal });
          throwIfAborted(signal);
          if (prepared.completed) return prepared.completed;
          if (prepared.retry) {
            supersessions += 1;
            continue;
          }
          snapshot = prepared.snapshot;
        }
        const observations = {};
        const correlations = {};
        for (const [participantId, participant] of Object.entries(snapshot.participants)) {
          throwIfAborted(signal);
          if (!approvalChecks[participantId]) continue;
          const serviceBlock = approvalChecks[participantId].valid
            && !services.ready
            && snapshot.spec.desiredState !== "SUSPENDED"
            && participant.spec.desiredState !== "SUSPENDED";
          const correlation = {
            caasTenantId: participant.spec.caasTenantId,
            desiredGeneration: snapshot.desiredGeneration,
            connectorPlanId: participant.spec.connectorPlanId,
            intent: !approvalChecks[participantId].valid
              ? "APPROVAL_REVOCATION"
              : serviceBlock ? "SERVICE_BLOCK" : "DESIRED_STATE",
          };
          const request = {
            schemaVersion: "molit.dsaas-caas-request/1",
            dataspaceId,
            caasTenantId: participant.spec.caasTenantId,
            participantId: participant.spec.connectorParticipantId,
            organizationId: participant.spec.organizationId,
            connectorPlanId: participant.spec.connectorPlanId,
            deploymentMode: snapshot.spec.deploymentMode,
            connectorNamespace: participant.spec.connectorNamespace,
            metadataProfile: snapshot.spec.metadataProfile,
            protocolProfile: snapshot.spec.protocolProfile,
            desiredGeneration: snapshot.desiredGeneration,
            desiredState: approvalChecks[participantId].valid
              ? snapshot.spec.desiredState === "SUSPENDED" || serviceBlock ? "SUSPENDED" : participant.spec.desiredState
              : "SUSPENDED",
          };
          correlations[participantId] = correlation;
          const operationKey = `dsaas:${digest({ correlation, reconcileKey: key, request })}`;
          try {
            await validateContract("caasEnsureRequest", request);
            throwIfAborted(signal);
            const response = await this.caas.ensureConnector(request, operationKey, { signal });
            throwIfAborted(signal);
            const observation = await validateCaasObservation(response, request, correlation);
            throwIfAborted(signal);
            observations[participantId] = observation.state === "ERROR"
              ? { state: "ERROR", errorCode: "CAAS_REPORTED_ERROR" }
              : observation;
          } catch (error) {
            throwIfAborted(signal);
            observations[participantId] = { state: "ERROR", errorCode: safeErrorCode(error) };
          }
        }
        throwIfAborted(signal);
        const caasErrors = caasErrorProjection(observations);
        const committed = await this.store.transact((state) => {
          throwIfAborted(signal);
          const prior = slot === null ? null : priorIdempotent(state, slot, requestDigest);
          if (prior) return { response: prior, retry: false };
          const record = findDataspace(state, dataspaceId);
          if (record.revision !== snapshot.revision || record.desiredGeneration !== snapshot.desiredGeneration) {
            return {
              actualGeneration: record.desiredGeneration,
              expectedGeneration: snapshot.desiredGeneration,
              retry: true,
            };
          }
          const at = this.now();
          for (const [participantId, observation] of Object.entries(observations)) {
            const participant = record.participants[participantId];
            const participantBefore = digest(participant);
            const correlation = correlations[participantId];
            const expectedIntent = !approvalChecks[participantId].valid
              ? "APPROVAL_REVOCATION"
              : !services.ready && record.spec.desiredState !== "SUSPENDED" && participant.spec.desiredState !== "SUSPENDED"
                ? "SERVICE_BLOCK"
                : "DESIRED_STATE";
            assertRuntime(correlation?.desiredGeneration === record.desiredGeneration
              && correlation.caasTenantId === participant.spec.caasTenantId
              && correlation.connectorPlanId === participant.spec.connectorPlanId
              && correlation.connectorPlanId === record.spec.connectorPlanId
              && correlation.intent === expectedIntent,
            "DSAAS_CAAS_CORRELATION_INVALID", "CaaS observation does not match the current generation, tenant, and connector plan", { participantId });
            const approvalCheck = approvalChecks[participantId];
            if (!approvalCheck.valid) {
              participant.approvalState = "REAPPROVAL_REQUIRED";
              participant.approvalErrorCode = approvalCheck.errorCode;
              if (observation.state === "ERROR") {
                const repeatedError = participant.connector === null
                  && participant.observedState === "ERROR"
                  && participant.lastError?.code === observation.errorCode
                  && participant.revokePending === true;
                if (!repeatedError) {
                  participant.connector = null;
                  participant.observedState = "ERROR";
                  participant.lastError = { code: observation.errorCode, at };
                  participant.revokePending = true;
                }
              } else if (observation.state === "SUSPENDED") {
                participant.connector = structuredClone(observation);
                participant.observedState = "SUSPENDED";
                participant.lastError = { code: approvalCheck.errorCode, at };
                participant.revokePending = false;
              } else {
                participant.connector = structuredClone(observation);
                participant.observedState = "REVOKING";
                participant.lastError = { code: approvalCheck.errorCode, at };
                participant.revokePending = true;
              }
            } else if (observation.state === "ERROR") {
              participant.approval.externalDecision = structuredClone(approvalCheck.externalDecision);
              participant.approvalErrorCode = null;
              const repeatedError = participant.connector === null
                && participant.observedState === "ERROR"
                && participant.lastError?.code === observation.errorCode
                && participant.revokePending === false;
              if (!repeatedError) {
                if (participant.connector && !participant.lastKnownConnector) participant.lastKnownConnector = structuredClone(participant.connector);
                participant.connector = null;
                participant.observedState = "ERROR";
                participant.lastError = { code: observation.errorCode, at };
                participant.revokePending = false;
              }
            } else {
              participant.approval.externalDecision = structuredClone(approvalCheck.externalDecision);
              participant.approvalErrorCode = null;
              participant.connector = structuredClone(observation);
              participant.lastKnownConnector = structuredClone(observation);
              participant.observedState = observation.state;
              participant.lastError = null;
              participant.revokePending = false;
            }
            if (digest(participant) !== participantBefore) {
              participant.revision += 1;
              participant.updatedAt = at;
            }
          }
          const priorCaasRetry = record.caasRetry ?? null;
          record.caasRetry = caasErrors.length > 0
            ? nextCaasRetry(priorCaasRetry, caasErrors, dataspaceId, record.desiredGeneration, at, this.caasRetryBaseMs, this.caasRetryMaxMs)
            : null;
          const repeatedCaasError = record.caasRetry !== null
            && priorCaasRetry?.desiredGeneration === record.caasRetry.desiredGeneration
            && priorCaasRetry.errorFingerprint === record.caasRetry.errorFingerprint;
          const approved = Object.values(record.participants).filter(({ approvalState }) => approvalState === "APPROVED");
          const participantsConverged = approved.every(({ spec, observedState }) => {
            const wanted = record.spec.desiredState === "SUSPENDED" || !services.ready ? "SUSPENDED" : spec.desiredState;
            return observedState === wanted;
          });
          if (approvalBlocked) record.observedState = "BLOCKED";
          else if (record.spec.desiredState === "SUSPENDED") record.observedState = participantsConverged ? "SUSPENDED" : "RECONCILING";
          else if (!services.ready) record.observedState = "BLOCKED";
          else record.observedState = participantsConverged ? "ACTIVE" : "RECONCILING";
          const targetReached = !approvalBlocked && (record.spec.desiredState === "SUSPENDED"
            ? participantsConverged
            : services.ready && participantsConverged);
          if (targetReached) record.appliedGeneration = snapshot.desiredGeneration;
          record.reconcilePending = !targetReached;
          if (approvalBlocked) {
            const approvalDeadline = nextApprovalCheckAt(record, approvalDecisionRegistry);
            const serviceDeadline = Object.values(record.participants).some(({ approvalState }) => approvalState === "APPROVED")
              ? nextServiceCheckAt(record, serviceRegistry)
              : null;
            const revocationRetry = Object.values(record.participants).some(({ revokePending }) => revokePending)
              ? record.caasRetry?.nextRetryAt ?? retryCheckAt(at, this.schedulerIntervalMs)
              : null;
            record.nextCheckAt = [approvalDeadline, serviceDeadline, revocationRetry].filter(Boolean).sort()[0] ?? null;
          } else {
            const governanceDeadline = compositeCheckAt(record, approvalDecisionRegistry, serviceRegistry);
            const convergenceRetry = record.caasRetry?.nextRetryAt ?? retryCheckAt(at, this.schedulerIntervalMs);
            if (targetReached) record.nextCheckAt = governanceDeadline;
            else if (!services.ready && participantsConverged && record.caasRetry === null) {
              record.nextCheckAt = nextApprovalCheckAt(record, approvalDecisionRegistry);
            } else record.nextCheckAt = [governanceDeadline, convergenceRetry].filter(Boolean).sort()[0] ?? convergenceRetry;
          }
          record.serviceObservations = services.services;
          record.serviceRegistrySha256 = serviceRegistry?.actualSha256 ?? null;
          record.lastReconcileAt = at;
          record.updatedAt = at;
          record.revision += 1;
          if (!scheduled || !repeatedCaasError) {
            appendAudit(state, {
              ...actorAudit,
              action: operation,
              resource: `dataspace:${dataspaceId}`,
              outcome: record.caasRetry === null ? record.observedState.toLowerCase() : "caas-error",
              detailsDigest: digest({ approvalChecks, correlations, desiredGeneration: snapshot.desiredGeneration, observations, services: services.services }),
              at,
            });
          }
          const response = resourceView(record);
          if (slot !== null) rememberIdempotent(state, slot, requestDigest, response, at, this.maxIdempotencyRecords);
          return { response, retry: false };
        }, { signal });
        if (!committed.retry) return committed.response;
        supersessions += 1;
      }
      throwIfAborted(signal);
      await this.store.transact((state) => {
        throwIfAborted(signal);
        const record = findDataspace(state, dataspaceId);
        const at = this.now();
        record.reconcilePending = true;
        record.observedState = "RECONCILING";
        record.nextCheckAt = at;
        record.lastReconcileAt = at;
        record.updatedAt = at;
        record.revision += 1;
        appendAudit(state, {
          ...actorAudit,
          action: operation,
          resource: `dataspace:${dataspaceId}`,
          outcome: "superseded",
          detailsDigest: digest({ desiredGeneration: record.desiredGeneration, supersessions }),
          at,
        });
      }, { signal });
      throw new RuntimeError("DSAAS_RECONCILE_SUPERSEDED", "dataspace changed repeatedly during reconciliation; pending intent was retained for a later bounded attempt", {
        dataspaceId,
        supersessions,
      });
    }, { signal: requestSignal });
  }
}

export const DSAAS_ROLES = Object.freeze({ ADMIN, OPERATOR, READER });
