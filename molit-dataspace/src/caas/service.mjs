import { createHash } from "node:crypto";
import { digest } from "../discovery/stable-json.mjs";
import { validateCaasContract } from "./contracts.mjs";
import { tenantIdentity } from "./config.mjs";
import { resolveEnvironmentSecret, secretEqual, validateDeploymentSecretReference } from "./secrets.mjs";
import { appendAudit, idempotencyReplay, recordIdempotency } from "./store.mjs";
import { assertCaas } from "./errors.mjs";

function publicTenant(tenant) {
  return {
    tenantId: tenant.tenantId,
    organizationId: tenant.organizationId,
    displayName: tenant.displayName,
    participantId: tenant.participantId,
    namespace: tenant.namespace,
    endpoint: tenant.endpoint,
    adapterId: tenant.adapterId,
    connectorPlanId: tenant.connectorPlanId,
    runtimeProfileRef: tenant.runtimeProfileRef,
    apiPrincipalId: tenant.apiPrincipalId,
    apiClientId: tenant.apiClientId,
    apiKeyId: tenant.apiKeyId,
    dataspaceId: tenant.dataspaceId ?? null,
    deploymentSecretNames: Object.keys(tenant.deploymentSecretRefs).sort(),
    desiredState: tenant.desiredState,
    observedState: tenant.observedState,
    generation: tenant.generation,
    observedGeneration: tenant.observedGeneration,
    adapterResourceId: tenant.adapterResourceId ?? null,
    lastError: tenant.lastError ?? null,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

function operationKey(tenant) {
  return createHash("sha256").update(`molit-caas/1\0${tenant.tenantId}\0${tenant.generation}\0${tenant.desiredState}`).digest("hex");
}

function sortedKeys(value) { return Object.keys(value).sort(); }

const actorIdentifier = /^[^\s\u0000-\u001f\u007f]{3,256}$/u;
const boundedErrorCode = /^[A-Z0-9_:-]{1,64}$/u;
const sha256 = /^[a-f0-9]{64}$/u;

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("CaaS operation was aborted");
  error.name = "AbortError";
  throw error;
}

function validateOperationalObservation(value) {
  assertCaas(value && typeof value === "object" && !Array.isArray(value)
    && typeof value.exists === "boolean" && typeof value.converged === "boolean",
  "CAAS_ADAPTER_OBSERVATION_INVALID", "operational provisioner returned an invalid observation");
  assertCaas(value.adapterResourceId === null || (typeof value.adapterResourceId === "string" && value.adapterResourceId.length > 0),
    "CAAS_ADAPTER_OBSERVATION_INVALID", "operational observation adapterResourceId is invalid");
  assertCaas(value.intentDigest === null || sha256.test(value.intentDigest),
    "CAAS_ADAPTER_OBSERVATION_INVALID", "operational observation intentDigest is invalid");
  assertCaas(value.operationKey === null || sha256.test(value.operationKey),
    "CAAS_ADAPTER_OBSERVATION_INVALID", "operational observation operationKey is invalid");
  assertCaas(value.generation === null || (Number.isSafeInteger(value.generation) && value.generation >= 0),
    "CAAS_ADAPTER_OBSERVATION_INVALID", "operational observation generation is invalid");
  assertCaas(value.desiredState === null || ["PROVISIONED", "DEPROVISIONED"].includes(value.desiredState),
    "CAAS_ADAPTER_OBSERVATION_INVALID", "operational observation desiredState is invalid");
  assertCaas(value.lastAppliedFencingToken === null || value.lastAppliedFencingToken === undefined || /^[1-9][0-9]*$/u.test(value.lastAppliedFencingToken),
    "CAAS_ADAPTER_OBSERVATION_INVALID", "operational observation lastAppliedFencingToken is invalid");
  return value;
}

function adapterCommandOptions(lease) {
  return Object.freeze({
    signal: lease.signal,
    fencingToken: lease.fencingToken,
    holderId: lease.holderId,
    acquiredAt: lease.acquiredAt,
  });
}

function adapterPassiveObservationOptions(lease, expectedLastAppliedFencingToken) {
  return Object.freeze({
    signal: lease.signal,
    expectedLastAppliedFencingToken: expectedLastAppliedFencingToken ?? null,
  });
}

function assertFencingCapability(provisioner, lease) {
  if (lease.fencingToken === null) return;
  assertCaas(provisioner.fencingCapable === true,
    "CAAS_PROVISIONER_FENCING_REQUIRED", "operational provisioner must enforce PostgreSQL fencing tokens before external side effects");
}

function validateAdapterResult(value, lease) {
  assertCaas(value && typeof value.adapterResourceId === "string" && value.adapterResourceId.length > 0
    && sha256.test(value.intentDigest) && typeof value.converged === "boolean",
  "CAAS_ADAPTER_CONTRACT_INVALID", "provisioner returned an invalid result contract");
  if (lease.fencingToken !== null) {
    assertCaas(value.fencingAccepted === true && value.fencingToken === lease.fencingToken,
      "CAAS_ADAPTER_FENCING_NOT_ENFORCED", "operational provisioner did not return an external fencing acceptance receipt");
  }
  return value;
}

async function observeOperational(provisioner, tenant, opKey, lease, {
  expectedLastAppliedFencingToken = null,
  postCommand = false,
} = {}) {
  assertCaas(typeof provisioner?.observe === "function", "CAAS_PROVISIONER_CONTRACT_INVALID", "operational provisioner must implement observation");
  assertFencingCapability(provisioner, lease);
  throwIfAborted(lease.signal);
  const options = postCommand
    ? adapterCommandOptions(lease)
    : adapterPassiveObservationOptions(lease, expectedLastAppliedFencingToken);
  const observation = validateOperationalObservation(await provisioner.observe(structuredClone(tenant), opKey, options));
  throwIfAborted(lease.signal);
  return observation;
}

function observationConverged(observation, tenant, opKey, intentDigest, adapterResourceId = null, expectedFencingToken = null) {
  if (!observation.converged
    || observation.operationKey !== opKey
    || observation.generation !== tenant.generation
    || observation.desiredState !== tenant.desiredState
    || observation.intentDigest !== intentDigest
    || (expectedFencingToken !== null && observation.lastAppliedFencingToken !== expectedFencingToken)) return false;
  if (tenant.desiredState === "PROVISIONED") {
    return observation.exists === true
      && observation.adapterResourceId === adapterResourceId;
  }
  return observation.exists === false;
}

function auditActor(actor) {
  assertCaas(actor && ["admin", "controller", "tenant"].includes(actor.role), "CAAS_ACTOR_INVALID", "authenticated actor role is required");
  for (const field of ["principalId", "clientId", "keyId"]) assertCaas(actorIdentifier.test(actor[field] ?? ""), "CAAS_ACTOR_INVALID", `authenticated actor ${field} is required`);
  return { actorRole: actor.role, actorPrincipalId: actor.principalId, actorClientId: actor.clientId, actorKeyId: actor.keyId };
}

function persistedAdapterErrorCode(error) {
  let code;
  try { code = error?.code; } catch { return "CAAS_ADAPTER_FAILED"; }
  return typeof code === "string" && boundedErrorCode.test(code) ? code : "CAAS_ADAPTER_FAILED";
}

function registrationPlan(config, request) {
  const supplied = sortedKeys(request.deploymentSecretRefs);
  const matches = Object.entries(config.connectorPlans).filter(([, plan]) =>
    plan.adapterId === request.adapterId
    && plan.runtimeProfileRef === request.runtimeProfileRef
    && JSON.stringify([...plan.requiredDeploymentSecretNames].sort()) === JSON.stringify(supplied));
  assertCaas(matches.length === 1, "CAAS_PLAN_NOT_ALLOWED", "registration must match exactly one configured connector plan and its secret-reference names", { status: 400 });
  return { connectorPlanId: matches[0][0], plan: matches[0][1] };
}

export class CaaSControlService {
  constructor({ config, provisioners, store, env = process.env, now = () => new Date() }) {
    assertCaas(store && ["read", "transact", "withResourceLock", "readiness", "close"].every((method) => typeof store[method] === "function"),
      "CAAS_STATE_STORE_INVALID", "CaaS state store does not implement the required interface");
    Object.assign(this, { config, provisioners, store, env, now });
  }

  async register(input, key, actor, { signal } = {}) {
    throwIfAborted(signal);
    const request = validateCaasContract("registration", structuredClone(input));
    Object.values(request.deploymentSecretRefs).forEach(validateDeploymentSecretReference);
    assertCaas(Object.hasOwn(this.provisioners, request.adapterId), "CAAS_ADAPTER_NOT_FOUND", "requested provisioner adapter is not configured", { status: 400 });
    const selectedPlan = registrationPlan(this.config, request);
    const apiSecret = resolveEnvironmentSecret(request.apiAccessSecretRef, this.env);
    const reservedSecrets = [resolveEnvironmentSecret(this.config.adminSecretRef, this.env)];
    if (this.config.controller) reservedSecrets.push(resolveEnvironmentSecret(this.config.controller.secretRef, this.env));
    assertCaas(reservedSecrets.every((reserved) => !secretEqual(apiSecret, reserved)), "CAAS_SECRET_COLLISION", "tenant credential must differ from administrator and controller credentials", { status: 400 });
    const reservedClientIds = [this.config.adminClientId, this.config.controller?.clientId].filter(Boolean);
    const reservedKeyIds = [this.config.adminKeyId, this.config.controller?.keyId].filter(Boolean);
    assertCaas(!reservedClientIds.includes(request.apiClientId) && !reservedKeyIds.includes(request.apiKeyId), "CAAS_ACTOR_ID_COLLISION", "tenant clientId and keyId must differ from administrator and controller identifiers", { status: 400 });
    const actorEvidence = auditActor(actor);
    return this.store.withResourceLock(`tenant:${request.tenantId}`, () => this.store.transact((state) => {
      throwIfAborted(signal);
      const replay = idempotencyReplay(state, `register:${request.tenantId}`, key, request);
      if (replay.result) return replay.result;
      assertCaas(!state.tenants[request.tenantId], "CAAS_TENANT_EXISTS", "tenant already exists", { status: 409 });
      for (const tenant of Object.values(state.tenants)) {
        const other = resolveEnvironmentSecret(tenant.apiAccessSecretRef, this.env);
        assertCaas(!secretEqual(apiSecret, other), "CAAS_SECRET_COLLISION", "tenant API credential collides with another tenant", { status: 400 });
        assertCaas(request.apiClientId !== tenant.apiClientId && request.apiKeyId !== tenant.apiKeyId, "CAAS_ACTOR_ID_COLLISION", "tenant clientId and keyId must be unique", { status: 400 });
      }
      const derived = tenantIdentity(this.config.identityPolicy, request.tenantId);
      for (const tenant of Object.values(state.tenants)) {
        for (const field of ["participantId", "namespace", "endpoint"]) assertCaas(tenant[field] !== derived[field], "CAAS_IDENTITY_COLLISION", `derived ${field} is already assigned`, { status: 409 });
      }
      const timestamp = this.now();
      const tenant = {
        tenantId: request.tenantId,
        organizationId: request.organizationId,
        displayName: request.displayName,
        ...derived,
        adapterId: request.adapterId,
        runtimeProfileRef: request.runtimeProfileRef,
        connectorPlanId: selectedPlan.connectorPlanId,
        connectorPlanSnapshot: structuredClone(selectedPlan.plan),
        connectorPlanDigest: digest(selectedPlan.plan),
        apiAccessSecretRef: request.apiAccessSecretRef,
        apiPrincipalId: request.apiPrincipalId,
        apiClientId: request.apiClientId,
        apiKeyId: request.apiKeyId,
        deploymentSecretRefs: request.deploymentSecretRefs,
        desiredState: "DEPROVISIONED",
        observedState: "NOT_PROVISIONED",
        generation: 0,
        observedGeneration: 0,
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
      };
      state.tenants[tenant.tenantId] = tenant;
      appendAudit(state, { tenantId: tenant.tenantId, action: "TENANT_REGISTERED", ...actorEvidence, generation: 0, requestDigest: digest(request) }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: timestamp });
      const result = publicTenant(tenant);
      recordIdempotency(state, replay, result, timestamp);
      return result;
    }, { signal }), { signal });
  }

  async getTenant(tenantId, { signal } = {}) {
    throwIfAborted(signal);
    const tenant = await this.store.read((state) => state.tenants[tenantId], { signal });
    assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
    return publicTenant(tenant);
  }

  async setDesiredState(tenantId, input, key, actor, { signal } = {}) {
    throwIfAborted(signal);
    const request = validateCaasContract("desiredState", structuredClone(input));
    const actorEvidence = auditActor(actor);
    return this.store.withResourceLock(`tenant:${tenantId}`, () => this.store.transact((state) => {
      throwIfAborted(signal);
      const tenant = state.tenants[tenantId];
      assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
      assertCaas(!tenant.dataspaceId || actor.role === "admin", "CAAS_DSAAS_LIFECYCLE_LOCKED", "DSaaS-bound connector lifecycle can be changed only by the CaaS administrator", { status: 403 });
      const replay = idempotencyReplay(state, `desired:${tenantId}`, key, request);
      if (replay.result) return replay.result;
      const timestamp = this.now();
      if (tenant.desiredState !== request.desiredState) {
        tenant.desiredState = request.desiredState;
        tenant.generation += 1;
        tenant.updatedAt = timestamp.toISOString();
        delete tenant.lastError;
        appendAudit(state, { tenantId, action: "DESIRED_STATE_CHANGED", ...actorEvidence, desiredState: tenant.desiredState, generation: tenant.generation }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: timestamp });
      }
      const result = publicTenant(tenant);
      recordIdempotency(state, replay, result, timestamp);
      return result;
    }, { signal }), { signal });
  }

  async reconcile(tenantId, key, actor, { signal } = {}) {
    throwIfAborted(signal);
    auditActor(actor);
    return this.store.withResourceLock(`tenant:${tenantId}`, (lease) => this.#reconcileLocked(tenantId, key, actor, lease), { signal });
  }

  async #reconcileLocked(tenantId, key, actor, lease) {
      const signal = lease.signal;
      throwIfAborted(signal);
      const actorEvidence = auditActor(actor);
      const snapshot = await this.store.read((state) => {
        const tenant = state.tenants[tenantId];
        assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
        assertCaas(Object.hasOwn(this.provisioners, tenant.adapterId), "CAAS_ADAPTER_NOT_FOUND", "tenant provisioner adapter is not configured");
        return structuredClone(tenant);
      }, { signal });
      const provisioner = this.provisioners[snapshot.adapterId];
      const finalState = snapshot.desiredState === "PROVISIONED" ? "PROVISIONED" : "NOT_PROVISIONED";
      const opKey = operationKey(snapshot);
      let intentObservation = null;
      if (snapshot.observedState === "INTENT_READY" && provisioner.intentOnly === true
        && snapshot.observedGeneration === snapshot.generation) {
        assertCaas(typeof provisioner.observe === "function", "CAAS_PROVISIONER_CONTRACT_INVALID", "intent-only provisioner must implement observation");
        intentObservation = await provisioner.observe(structuredClone(snapshot), opKey, { signal });
        throwIfAborted(signal);
      }
      let runtimeObservation = null;
      if (provisioner.intentOnly !== true
        && snapshot.observedState === finalState
        && snapshot.observedGeneration === snapshot.generation) {
        if (lease.fencingToken !== null) {
          assertCaas(snapshot.lastAppliedFencingToken !== undefined,
            "CAAS_ADAPTER_FENCING_STATE_MISSING", "operational tenant lacks the last externally applied fencing token");
        }
        runtimeObservation = await observeOperational(provisioner, snapshot, opKey, lease, {
          expectedLastAppliedFencingToken: snapshot.lastAppliedFencingToken ?? null,
        });
      }
      const prepared = await this.store.transact((state) => {
        throwIfAborted(signal);
        const tenant = state.tenants[tenantId];
        assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
        const replay = idempotencyReplay(state, `reconcile:${tenantId}`, key, { generation: tenant.generation, desiredState: tenant.desiredState });
        if (replay.result) {
          const currentResult = publicTenant(tenant);
          if (replay.result.generation === tenant.generation && replay.result.observedState === tenant.observedState) return { completed: currentResult };
          delete state.requests[replay.ledgerKey];
          replay.result = null;
        }
        assertCaas(tenant.generation === snapshot.generation
          && tenant.desiredState === snapshot.desiredState
          && tenant.observedGeneration === snapshot.observedGeneration
          && tenant.observedState === snapshot.observedState
          && (tenant.operationKey ?? null) === (snapshot.operationKey ?? null)
          && (tenant.lastIntentDigest ?? null) === (snapshot.lastIntentDigest ?? null)
          && (tenant.lastAppliedFencingToken ?? null) === (snapshot.lastAppliedFencingToken ?? null),
        "CAAS_RECONCILE_FENCE_VIOLATION", "tenant changed while external observation was in progress");
        const intentStillObserved = intentObservation?.exists === true
          && intentObservation.intentDigest === tenant.lastIntentDigest;
        if (intentObservation !== null) {
          if (!intentStillObserved) {
            appendAudit(state, {
              tenantId,
              action: "INTENT_DRIFT_DETECTED",
              ...actorEvidence,
              generation: tenant.generation,
              expectedIntentDigest: tenant.lastIntentDigest ?? null,
              observedIntentDigest: /^[a-f0-9]{64}$/u.test(intentObservation?.intentDigest ?? "") ? intentObservation.intentDigest : null,
            }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
          }
        }
        const runtimeStillObserved = runtimeObservation !== null
          && observationConverged(runtimeObservation, tenant, opKey, tenant.lastIntentDigest,
            tenant.desiredState === "PROVISIONED" ? tenant.adapterResourceId : null,
            tenant.lastAppliedFencingToken ?? null);
        if (runtimeObservation !== null) {
          if (!runtimeStillObserved) {
            appendAudit(state, {
              tenantId,
              action: "RUNTIME_DRIFT_DETECTED",
              ...actorEvidence,
              generation: tenant.generation,
              expectedIntentDigest: tenant.lastIntentDigest ?? null,
              expectedFencingToken: tenant.lastAppliedFencingToken ?? null,
              observedIntentDigest: runtimeObservation.intentDigest,
              observedOperationKey: runtimeObservation.operationKey,
              observedFencingToken: runtimeObservation.lastAppliedFencingToken ?? null,
            }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
          }
        }
        if ((intentStillObserved || runtimeStillObserved) && tenant.observedGeneration === tenant.generation) {
          const result = publicTenant(tenant);
          recordIdempotency(state, replay, result, this.now());
          return { completed: result };
        }
        tenant.observedState = tenant.desiredState === "PROVISIONED" ? "PROVISIONING" : "DEPROVISIONING";
        tenant.operationKey = opKey;
        tenant.updatedAt = this.now().toISOString();
        appendAudit(state, { tenantId, action: "RECONCILE_STARTED", ...actorEvidence, desiredState: tenant.desiredState, generation: tenant.generation, operationKey: opKey }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
        return { tenant: structuredClone(tenant), ledger: replay };
      }, { signal });
      if (prepared.completed) return prepared.completed;
      const { tenant, ledger } = prepared;
      let acceptedFencingToken = null;
      let persistingResult = false;
      try {
        throwIfAborted(signal);
        if (provisioner.intentOnly !== true) assertFencingCapability(provisioner, lease);
        const adapterResult = tenant.desiredState === "PROVISIONED"
          ? await provisioner.provision(tenant, tenant.operationKey, adapterCommandOptions(lease))
          : await provisioner.deprovision(tenant, tenant.operationKey, adapterCommandOptions(lease));
        throwIfAborted(signal);
        validateAdapterResult(adapterResult, lease);
        acceptedFencingToken = lease.fencingToken;
        const observation = provisioner.intentOnly === true
          ? null
          : await observeOperational(provisioner, tenant, tenant.operationKey, lease, { postCommand: true });
        if (observation !== null && lease.fencingToken !== null) {
          assertCaas(observation.lastAppliedFencingToken === lease.fencingToken,
            "CAAS_ADAPTER_FENCING_NOT_ENFORCED", "post-command observation did not confirm the externally applied fencing token");
        }
        const observedConvergence = observation !== null
          && observationConverged(observation, tenant, tenant.operationKey, adapterResult.intentDigest,
            adapterResult.adapterResourceId, lease.fencingToken);
        persistingResult = true;
        return await this.store.transact((state) => {
          throwIfAborted(signal);
          const current = state.tenants[tenantId];
          assertCaas(current?.operationKey === tenant.operationKey && current.generation === tenant.generation, "CAAS_RECONCILE_FENCE_VIOLATION", "tenant changed while reconciliation was in progress");
          const finalState = current.desiredState === "PROVISIONED" ? "PROVISIONED" : "NOT_PROVISIONED";
          const pendingState = current.desiredState === "PROVISIONED" ? "PROVISIONING" : "DEPROVISIONING";
          current.observedState = provisioner.intentOnly === true
            ? "INTENT_READY"
            : observedConvergence ? finalState : pendingState;
          current.observedGeneration = current.generation;
          if (current.desiredState === "PROVISIONED") current.adapterResourceId = adapterResult.adapterResourceId;
          else if (observedConvergence) delete current.adapterResourceId;
          current.lastIntentDigest = adapterResult.intentDigest;
          if (lease.fencingToken !== null) current.lastAppliedFencingToken = lease.fencingToken;
          current.updatedAt = this.now().toISOString();
          if (provisioner.intentOnly === true || observedConvergence) delete current.operationKey;
          delete current.lastError;
          appendAudit(state, {
            tenantId,
            action: "RECONCILE_COMPLETED",
            ...actorEvidence,
            observedState: current.observedState,
            generation: current.generation,
            adapterResultDigest: digest(adapterResult),
            observationDigest: observation === null ? null : digest(observation),
          }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
          const result = publicTenant(current);
          recordIdempotency(state, ledger, result, this.now());
          return result;
        }, { signal });
      } catch (error) {
        throwIfAborted(signal);
        if (persistingResult) throw error;
        await this.store.transact((state) => {
          throwIfAborted(signal);
          const current = state.tenants[tenantId];
          if (current?.operationKey === tenant.operationKey) {
            current.observedState = "ERROR";
            if (acceptedFencingToken !== null) current.lastAppliedFencingToken = acceptedFencingToken;
            current.lastError = { code: persistedAdapterErrorCode(error), message: "provisioner operation failed; inspect restricted adapter telemetry" };
            current.updatedAt = this.now().toISOString();
            appendAudit(state, { tenantId, action: "RECONCILE_FAILED", ...actorEvidence, generation: current.generation, errorCode: current.lastError.code }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
          }
        }, { signal });
        throw error;
      }
  }

  async ensureConnector(input, key, actor, { signal } = {}) {
    throwIfAborted(signal);
    const request = validateCaasContract("ensure", structuredClone(input));
    const actorEvidence = auditActor(actor);
    if (actor.role === "controller") {
      assertCaas(actor.allowedDataspaceIds?.includes(request.dataspaceId)
        && actor.allowedTenantIds?.includes(request.caasTenantId)
        && actor.allowedConnectorPlanIds?.includes(request.connectorPlanId),
      "CAAS_CONTROLLER_SCOPE_FORBIDDEN", "controller credential is outside its configured dataspace, tenant, or connector-plan scope", { status: 403 });
    }
    const tenantId = request.caasTenantId;
    return this.store.withResourceLock(`tenant:${tenantId}`, async (lease) => {
      const operationSignal = lease.signal;
      const before = await this.store.transact((state) => {
        throwIfAborted(operationSignal);
        const tenant = state.tenants[tenantId];
        assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "organization must be onboarded as a CaaS tenant before connector convergence", { status: 404 });
        const replay = idempotencyReplay(state, `ensure:${tenantId}`, key, request);
        if (replay.result) return { completed: replay.result };
        assertCaas(Object.hasOwn(this.config.connectorPlans, request.connectorPlanId), "CAAS_PLAN_NOT_ALLOWED", "connector plan is not configured", { status: 400 });
        const plan = this.config.connectorPlans[request.connectorPlanId];
        assertCaas(tenant.connectorPlanDigest === digest(plan), "CAAS_PLAN_CHANGED", "configured connector plan differs from the tenant onboarding snapshot; an explicit migration is required", { status: 409 });
        assertCaas(tenant.connectorPlanId === request.connectorPlanId && tenant.adapterId === plan.adapterId && tenant.runtimeProfileRef === plan.runtimeProfileRef, "CAAS_PLAN_MISMATCH", "connector plan does not match the onboarded tenant", { status: 409 });
        assertCaas(request.organizationId === tenant.organizationId, "CAAS_ORGANIZATION_MISMATCH", "DSaaS legal organization identifier differs from tenant onboarding", { status: 409 });
        assertCaas(request.participantId === tenant.participantId && request.connectorNamespace === tenant.namespace, "CAAS_IDENTITY_MISMATCH", "DSaaS participant or Connector namespace differs from the CaaS identity policy", { status: 409 });
        assertCaas(request.deploymentMode === plan.deploymentMode, "CAAS_PLAN_MISMATCH", "deploymentMode differs from the configured connector plan", { status: 409 });
        for (const field of ["metadataProfile", "protocolProfile"]) assertCaas(digest(request[field]) === digest(plan[field]), "CAAS_PLAN_MISMATCH", `${field} differs from the configured connector plan`, { status: 409 });
        assertCaas(!tenant.dataspaceId || tenant.dataspaceId === request.dataspaceId, "CAAS_DATASPACE_BINDING_CONFLICT", "tenant is already bound to another dataspace", { status: 409 });
        tenant.dataspaceId ??= request.dataspaceId;
        if (tenant.dsaasDesiredGeneration !== undefined) {
          assertCaas(request.desiredGeneration >= tenant.dsaasDesiredGeneration,
            "CAAS_DSAAS_GENERATION_STALE", "DSaaS desired generation is older than the tenant generation fence", { status: 409 });
          assertCaas(request.desiredGeneration !== tenant.dsaasDesiredGeneration || replay.payloadDigest === tenant.dsaasRequestDigest,
            "CAAS_DSAAS_GENERATION_CONFLICT", "DSaaS desired generation is already bound to a different request", { status: 409 });
        }
        if (tenant.dsaasDesiredGeneration === undefined || request.desiredGeneration > tenant.dsaasDesiredGeneration) {
          tenant.dsaasDesiredGeneration = request.desiredGeneration;
          tenant.dsaasRequestDigest = replay.payloadDigest;
          appendAudit(state, {
            tenantId,
            action: "DSAAS_COMMAND_ACCEPTED",
            ...actorEvidence,
            desiredGeneration: request.desiredGeneration,
            requestDigest: replay.payloadDigest,
          }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
        }
        const desiredState = request.desiredState === "ACTIVE" ? "PROVISIONED" : "DEPROVISIONED";
        if (tenant.desiredState !== desiredState) {
          tenant.desiredState = desiredState;
          tenant.generation += 1;
          tenant.updatedAt = this.now().toISOString();
          appendAudit(state, { tenantId, action: "DSAAS_DESIRED_STATE_MAPPED", ...actorEvidence, dsaasDesiredState: request.desiredState, desiredState, generation: tenant.generation }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
        }
        return { ledger: replay, generation: tenant.generation };
      }, { signal: operationSignal });
      if (before.completed) return before.completed;
      const internalKey = createHash("sha256").update(`ensure-reconcile\0${key}\0${before.generation}`).digest("hex");
      let reconciled;
      try {
        reconciled = await this.#reconcileLocked(tenantId, internalKey, actor, lease);
      } catch (error) {
        throwIfAborted(operationSignal);
        const current = await this.getTenant(tenantId, { signal: operationSignal });
        if (current.observedState !== "ERROR") throw error;
        return validateCaasContract("ensureResponse", {
          connectorId: tenantId,
          dataspaceId: request.dataspaceId,
          participantId: request.participantId,
          state: "ERROR",
          ...(new URL(current.endpoint).protocol === "https:" ? { endpoints: { connectorBase: current.endpoint } } : {}),
        });
      }
      const response = validateCaasContract("ensureResponse", {
        connectorId: tenantId,
        dataspaceId: request.dataspaceId,
        participantId: request.participantId,
        state: reconciled.observedState === "ERROR"
          ? "ERROR"
          : request.desiredState === "ACTIVE" && reconciled.observedState === "PROVISIONED"
            ? "ACTIVE"
            : request.desiredState === "SUSPENDED" && reconciled.observedState === "NOT_PROVISIONED"
              ? "SUSPENDED"
              : "PROVISIONING",
        ...(new URL(reconciled.endpoint).protocol === "https:" ? { endpoints: { connectorBase: reconciled.endpoint } } : {}),
      });
      return this.store.transact((state) => {
        throwIfAborted(operationSignal);
        const replay = idempotencyReplay(state, `ensure:${tenantId}`, key, request);
        if (replay.result) return replay.result;
        recordIdempotency(state, replay, response, this.now());
        appendAudit(state, { tenantId, action: "DSAAS_CONNECTOR_ENSURED", ...actorEvidence, dsaasState: response.state, generation: state.tenants[tenantId].generation }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
        return response;
      }, { signal: operationSignal });
    }, { signal });
  }

  async audit(tenantId, { signal } = {}) {
    throwIfAborted(signal);
    const state = await this.store.read((value) => value, { signal });
    const selected = state.audit.filter((event) => !tenantId || event.tenantId === tenantId);
    const limit = this.config.limits.maxAuditResponseEvents;
    return { events: selected.slice(-limit), total: selected.length, truncated: selected.length > limit };
  }

  async readiness({ signal } = {}) {
    throwIfAborted(signal);
    const storeReadiness = await this.store.readiness({ signal });
    assertCaas(storeReadiness.ready === true, storeReadiness.failureCode ?? "CAAS_STATE_UNAVAILABLE", "CaaS state store is not ready");
    const state = await this.store.read((value) => value, { signal });
    const values = [resolveEnvironmentSecret(this.config.adminSecretRef, this.env)];
    const clientIds = [this.config.adminClientId];
    const keyIds = [this.config.adminKeyId];
    if (this.config.controller) {
      values.push(resolveEnvironmentSecret(this.config.controller.secretRef, this.env));
      clientIds.push(this.config.controller.clientId);
      keyIds.push(this.config.controller.keyId);
    }
    for (const tenant of Object.values(state.tenants)) {
      values.push(resolveEnvironmentSecret(tenant.apiAccessSecretRef, this.env));
      clientIds.push(tenant.apiClientId);
      keyIds.push(tenant.apiKeyId);
    }
    assertCaas(new Set(values).size === values.length, "CAAS_SECRET_COLLISION", "administrator, controller, and tenant API credentials must be unique");
    assertCaas(new Set(clientIds).size === clientIds.length && new Set(keyIds).size === keyIds.length, "CAAS_ACTOR_ID_COLLISION", "administrator, controller, and tenant clientId/keyId values must be unique");
    const provisioners = Object.values(this.provisioners);
    assertCaas(this.config.environment !== "production" || this.store.supportsDistributedFencing === true,
      "CAAS_STATE_STORE_FENCING_REQUIRED", "production CaaS requires a distributed state store with fencing leases");
    assertCaas(this.config.environment !== "production" || provisioners.every(({ intentOnly }) => intentOnly !== true), "CAAS_PRODUCTION_PROVISIONER_REQUIRED", "production readiness requires an operational Connector provisioner");
    for (const provisioner of provisioners) {
      if (provisioner.intentOnly !== true) {
        assertCaas(typeof provisioner.observe === "function", "CAAS_PROVISIONER_CONTRACT_INVALID", "operational provisioner must implement observation");
        assertCaas(this.config.environment !== "production" || provisioner.fencingCapable === true,
          "CAAS_PROVISIONER_FENCING_REQUIRED", "production operational provisioner must declare and enforce fencing-token support");
      }
    }
    await Promise.all(provisioners.map((provisioner) => provisioner.readiness({ signal })));
    throwIfAborted(signal);
    for (const tenant of Object.values(state.tenants)) {
      if (tenant.observedState !== "INTENT_READY") continue;
      const provisioner = this.provisioners[tenant.adapterId];
      assertCaas(provisioner?.intentOnly === true && typeof provisioner.observe === "function", "CAAS_PROVISIONER_CONTRACT_INVALID", "INTENT_READY state requires an observable intent-only provisioner");
      const observation = await provisioner.observe(tenant, operationKey(tenant), { signal });
      throwIfAborted(signal);
      assertCaas(observation.exists === true && observation.intentDigest === tenant.lastIntentDigest, "CAAS_PROVISIONER_DRIFT", "deployment intent no longer matches the recorded observation");
    }
    const intentOnly = provisioners.some(({ intentOnly: value }) => value === true);
    const productionEligible = !intentOnly
      && this.store.supportsDistributedFencing === true
      && provisioners.every(({ fencingCapable }) => fencingCapable === true);
    return {
      ready: true,
      scope: intentOnly ? "INTENT_ONLY" : "CONNECTOR_RUNTIME",
      productionEligible,
      tenantCount: Object.keys(state.tenants).length,
    };
  }
}
