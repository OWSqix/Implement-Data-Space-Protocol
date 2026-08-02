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
    connectorPlanDigest: tenant.connectorPlanDigest,
    deployedConnectorPlanId: tenant.deployedConnectorPlanId ?? null,
    deployedConnectorPlanDigest: tenant.deployedConnectorPlanDigest ?? null,
    connectorVersionHistory: (tenant.connectorVersionHistory ?? []).map(({ connectorPlanId, connectorPlanDigest, recordedAt }) => ({ connectorPlanId, connectorPlanDigest, recordedAt })),
    lifecycleOperation: tenant.lifecycleOperation ?? null,
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
  return createHash("sha256").update(`molit-caas/2\0${tenant.tenantId}\0${tenant.generation}\0${tenant.desiredState}\0${tenant.connectorPlanDigest}`).digest("hex");
}

function finalObservedState(desiredState) {
  if (desiredState === "PROVISIONED") return "PROVISIONED";
  if (desiredState === "SUSPENDED") return "SUSPENDED";
  if (desiredState === "DELETED") return "DELETED";
  return "NOT_PROVISIONED";
}

function pendingObservedState(tenant) {
  if (tenant.desiredState === "PROVISIONED" && tenant.lifecycleOperation === "UPGRADE") return "UPGRADING";
  if (tenant.desiredState === "PROVISIONED" && tenant.lifecycleOperation === "ROLLBACK") return "ROLLING_BACK";
  if (tenant.desiredState === "PROVISIONED") return "PROVISIONING";
  if (tenant.desiredState === "SUSPENDED") return "SUSPENDING";
  if (tenant.desiredState === "DELETED") return "DELETING";
  return "DEPROVISIONING";
}

function rememberConnectorVersion(tenant, now) {
  tenant.connectorVersionHistory ??= [];
  if (tenant.connectorVersionHistory.some(({ connectorPlanDigest }) => connectorPlanDigest === tenant.connectorPlanDigest)) return;
  assertCaas(tenant.connectorVersionHistory.length < 64, "CAAS_VERSION_HISTORY_CAPACITY", "connector version history is full", { status: 507 });
  tenant.connectorVersionHistory.push({
    connectorPlanId: tenant.connectorPlanId,
    connectorPlanDigest: tenant.connectorPlanDigest,
    connectorPlanSnapshot: structuredClone(tenant.connectorPlanSnapshot),
    recordedAt: now.toISOString(),
  });
}

function applyConnectorVersion(tenant, version) {
  tenant.connectorPlanId = version.connectorPlanId;
  tenant.connectorPlanSnapshot = structuredClone(version.connectorPlanSnapshot);
  tenant.connectorPlanDigest = version.connectorPlanDigest;
  tenant.adapterId = version.connectorPlanSnapshot.adapterId;
  tenant.runtimeProfileRef = version.connectorPlanSnapshot.runtimeProfileRef;
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
  assertCaas(value.desiredState === null || ["PROVISIONED", "SUSPENDED", "DELETED", "DEPROVISIONED"].includes(value.desiredState),
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
  if (["PROVISIONED", "SUSPENDED"].includes(tenant.desiredState)) {
    return observation.exists === true
      && observation.adapterResourceId === adapterResourceId;
  }
  return observation.exists === false;
}

function auditActor(actor) {
  assertCaas(actor && ["admin", "controller", "tenant"].includes(actor.role), "CAAS_ACTOR_INVALID", "authenticated actor role is required");
  for (const field of ["principalId", "clientId", "keyId"]) assertCaas(actorIdentifier.test(actor[field] ?? ""), "CAAS_ACTOR_INVALID", `authenticated actor ${field} is required`);
  assertCaas(actor.traceId === undefined || /^[a-f0-9]{32}$/u.test(actor.traceId), "CAAS_ACTOR_INVALID", "authenticated actor traceId is invalid");
  assertCaas(actor.correlationId === undefined || /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(actor.correlationId), "CAAS_ACTOR_INVALID", "authenticated actor correlationId is invalid");
  return {
    actorRole: actor.role,
    actorPrincipalId: actor.principalId,
    actorClientId: actor.clientId,
    actorKeyId: actor.keyId,
    ...(actor.traceId ? { traceId: actor.traceId } : {}),
    ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
  };
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
    const stateMethods = store?.kind === "postgres-scoped"
      ? ["readScope", "createScope", "transactScope", "listScopeIds", "readAudit"]
      : ["read", "transact"];
    assertCaas(store && [...stateMethods, "withResourceLock", "readiness", "close"].every((method) => typeof store[method] === "function"),
      "CAAS_STATE_STORE_INVALID", "CaaS state store does not implement the required interface");
    Object.assign(this, { config, provisioners, store, env, now });
  }

  #read(tenantId, operation, options) {
    return this.store.kind === "postgres-scoped"
      ? this.store.readScope(tenantId, operation, options)
      : this.store.read(operation, options);
  }

  #transact(tenantId, operation, options) {
    return this.store.kind === "postgres-scoped"
      ? this.store.transactScope(tenantId, operation, options)
      : this.store.transact(operation, options);
  }

  #create(tenantId, operation, options) {
    return this.store.kind === "postgres-scoped"
      ? this.store.createScope(tenantId, operation, { ...options, capacity: this.config.limits.maxTenants ?? 10_000 })
      : this.store.transact(operation, options);
  }

  async #allTenantState({ signal } = {}) {
    if (this.store.kind !== "postgres-scoped") return this.store.read((state) => state, { signal });
    const maxTenants = this.config.limits.maxTenants ?? 10_000;
    const tenantIds = [];
    let after = "";
    while (tenantIds.length < maxTenants) {
      const page = await this.store.listScopeIds({ after, limit: Math.min(1_000, maxTenants - tenantIds.length), signal });
      tenantIds.push(...page);
      if (page.length < Math.min(1_000, maxTenants - tenantIds.length + page.length)) break;
      after = page.at(-1);
    }
    assertCaas(tenantIds.length <= maxTenants, "CAAS_CAPACITY", "tenant registry exceeds configured capacity");
    const tenants = {};
    for (const tenantId of tenantIds) {
      tenants[tenantId] = await this.store.readScope(tenantId, (state) => state.tenants[tenantId], { signal });
    }
    return { tenants };
  }

  async register(input, key, actor, { signal } = {}) {
    throwIfAborted(signal);
    const request = validateCaasContract("registration", structuredClone(input));
    Object.values(request.deploymentSecretRefs).forEach(validateDeploymentSecretReference);
    assertCaas(Object.hasOwn(this.provisioners, request.adapterId), "CAAS_ADAPTER_NOT_FOUND", "requested provisioner adapter is not configured", { status: 400 });
    const selectedPlan = registrationPlan(this.config, request);
    const staticAuthentication = this.config.environment !== "production";
    const apiSecret = staticAuthentication ? resolveEnvironmentSecret(request.apiAccessSecretRef, this.env) : null;
    if (staticAuthentication) {
      const reservedSecrets = [resolveEnvironmentSecret(this.config.adminSecretRef, this.env)];
      if (this.config.controller) reservedSecrets.push(resolveEnvironmentSecret(this.config.controller.secretRef, this.env));
      assertCaas(reservedSecrets.every((reserved) => !secretEqual(apiSecret, reserved)), "CAAS_SECRET_COLLISION", "tenant credential must differ from administrator and controller credentials", { status: 400 });
      const reservedClientIds = [this.config.adminClientId, this.config.controller?.clientId].filter(Boolean);
      const reservedKeyIds = [this.config.adminKeyId, this.config.controller?.keyId].filter(Boolean);
      assertCaas(!reservedClientIds.includes(request.apiClientId) && !reservedKeyIds.includes(request.apiKeyId), "CAAS_ACTOR_ID_COLLISION", "tenant clientId and keyId must differ from administrator and controller identifiers", { status: 400 });
    }
    const actorEvidence = auditActor(actor);
    return this.store.withResourceLock(`tenant:${request.tenantId}`, () => this.#create(request.tenantId, (state) => {
      throwIfAborted(signal);
      const replay = idempotencyReplay(state, `register:${request.tenantId}`, key, request);
      if (replay.result) return replay.result;
      assertCaas(!state.tenants[request.tenantId], "CAAS_TENANT_EXISTS", "tenant already exists", { status: 409 });
      for (const tenant of Object.values(state.tenants)) {
        if (staticAuthentication) {
          const other = resolveEnvironmentSecret(tenant.apiAccessSecretRef, this.env);
          assertCaas(!secretEqual(apiSecret, other), "CAAS_SECRET_COLLISION", "tenant API credential collides with another tenant", { status: 400 });
          assertCaas(request.apiClientId !== tenant.apiClientId && request.apiKeyId !== tenant.apiKeyId, "CAAS_ACTOR_ID_COLLISION", "tenant clientId and keyId must be unique", { status: 400 });
        }
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
        connectorVersionHistory: [],
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
    const tenant = await this.#read(tenantId, (state) => state.tenants[tenantId], { signal });
    assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
    return publicTenant(tenant);
  }

  async setDesiredState(tenantId, input, key, actor, { signal } = {}) {
    throwIfAborted(signal);
    const request = validateCaasContract("desiredState", structuredClone(input));
    const actorEvidence = auditActor(actor);
    return this.store.withResourceLock(`tenant:${tenantId}`, () => this.#transact(tenantId, (state) => {
      throwIfAborted(signal);
      const tenant = state.tenants[tenantId];
      assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
      assertCaas(!tenant.dataspaceId || actor.role === "admin", "CAAS_DSAAS_LIFECYCLE_LOCKED", "DSaaS-bound connector lifecycle can be changed only by the CaaS administrator", { status: 403 });
      const replay = idempotencyReplay(state, `desired:${tenantId}`, key, request);
      if (replay.result) return replay.result;
      const timestamp = this.now();
      const desiredState = request.desiredState;
      if (tenant.desiredState !== desiredState) {
        tenant.desiredState = desiredState;
        tenant.generation += 1;
        tenant.updatedAt = timestamp.toISOString();
        delete tenant.lifecycleOperation;
        delete tenant.lastError;
        appendAudit(state, { tenantId, action: "DESIRED_STATE_CHANGED", ...actorEvidence, desiredState: tenant.desiredState, generation: tenant.generation }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: timestamp });
      } else if (this.store.kind === "postgres-scoped") {
        appendAudit(state, { tenantId, action: "DESIRED_STATE_CONFIRMED", ...actorEvidence, desiredState: tenant.desiredState, generation: tenant.generation }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: timestamp });
      }
      const result = publicTenant(tenant);
      recordIdempotency(state, replay, result, timestamp);
      return result;
    }, { signal }), { signal });
  }

  async upgrade(tenantId, input, key, actor, { signal } = {}) {
    throwIfAborted(signal);
    const request = validateCaasContract("upgrade", structuredClone(input));
    const actorEvidence = auditActor(actor);
    assertCaas(actor.role === "admin" || actor.role === "tenant", "CAAS_UPGRADE_FORBIDDEN", "connector upgrade requires tenant or administrator authority", { status: 403 });
    return this.store.withResourceLock(`tenant:${tenantId}`, () => this.#transact(tenantId, (state) => {
      throwIfAborted(signal);
      const tenant = state.tenants[tenantId];
      assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
      const replay = idempotencyReplay(state, `upgrade:${tenantId}`, key, request);
      if (replay.result) return replay.result;
      assertCaas(tenant.desiredState === "PROVISIONED" && tenant.observedState === "PROVISIONED",
        "CAAS_UPGRADE_STATE_INVALID", "connector must be fully provisioned before upgrade", { status: 409 });
      const plan = this.config.connectorPlans[request.connectorPlanId];
      assertCaas(plan, "CAAS_PLAN_NOT_ALLOWED", "upgrade connector plan is not configured", { status: 400 });
      assertCaas(Object.hasOwn(this.provisioners, plan.adapterId), "CAAS_ADAPTER_NOT_FOUND", "upgrade provisioner adapter is not configured", { status: 400 });
      assertCaas(digest(plan) !== tenant.connectorPlanDigest, "CAAS_UPGRADE_NO_CHANGE", "upgrade target is already selected", { status: 409 });
      assertCaas(JSON.stringify([...plan.requiredDeploymentSecretNames].sort()) === JSON.stringify(Object.keys(tenant.deploymentSecretRefs).sort()),
        "CAAS_UPGRADE_SECRET_SET_MISMATCH", "upgrade target requires a different deployment secret set", { status: 409 });
      const timestamp = this.now();
      rememberConnectorVersion(tenant, timestamp);
      applyConnectorVersion(tenant, { connectorPlanId: request.connectorPlanId, connectorPlanDigest: digest(plan), connectorPlanSnapshot: plan });
      tenant.desiredState = "PROVISIONED";
      tenant.lifecycleOperation = "UPGRADE";
      tenant.generation += 1;
      tenant.updatedAt = timestamp.toISOString();
      delete tenant.lastError;
      appendAudit(state, { tenantId, action: "CONNECTOR_UPGRADE_REQUESTED", ...actorEvidence, connectorPlanId: tenant.connectorPlanId, connectorPlanDigest: tenant.connectorPlanDigest, generation: tenant.generation }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: timestamp });
      const result = publicTenant(tenant);
      recordIdempotency(state, replay, result, timestamp);
      return result;
    }, { signal }), { signal });
  }

  async rollback(tenantId, input, key, actor, { signal } = {}) {
    throwIfAborted(signal);
    const request = validateCaasContract("rollback", structuredClone(input));
    const actorEvidence = auditActor(actor);
    assertCaas(actor.role === "admin" || actor.role === "tenant", "CAAS_ROLLBACK_FORBIDDEN", "connector rollback requires tenant or administrator authority", { status: 403 });
    return this.store.withResourceLock(`tenant:${tenantId}`, () => this.#transact(tenantId, (state) => {
      throwIfAborted(signal);
      const tenant = state.tenants[tenantId];
      assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
      const replay = idempotencyReplay(state, `rollback:${tenantId}`, key, request);
      if (replay.result) return replay.result;
      const target = (tenant.connectorVersionHistory ?? []).find(({ connectorPlanDigest }) => connectorPlanDigest === request.targetConnectorPlanDigest);
      assertCaas(target, "CAAS_ROLLBACK_TARGET_NOT_FOUND", "rollback target is not present in connector version history", { status: 404 });
      assertCaas(target.connectorPlanDigest !== tenant.connectorPlanDigest, "CAAS_ROLLBACK_NO_CHANGE", "rollback target is already selected", { status: 409 });
      assertCaas(Object.hasOwn(this.provisioners, target.connectorPlanSnapshot.adapterId), "CAAS_ADAPTER_NOT_FOUND", "rollback provisioner adapter is not configured", { status: 409 });
      const timestamp = this.now();
      rememberConnectorVersion(tenant, timestamp);
      applyConnectorVersion(tenant, target);
      tenant.desiredState = "PROVISIONED";
      tenant.lifecycleOperation = "ROLLBACK";
      tenant.generation += 1;
      tenant.updatedAt = timestamp.toISOString();
      delete tenant.lastError;
      appendAudit(state, { tenantId, action: "CONNECTOR_ROLLBACK_REQUESTED", ...actorEvidence, connectorPlanId: tenant.connectorPlanId, connectorPlanDigest: tenant.connectorPlanDigest, generation: tenant.generation }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: timestamp });
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
      const snapshot = await this.#read(tenantId, (state) => {
        const tenant = state.tenants[tenantId];
        assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
        assertCaas(Object.hasOwn(this.provisioners, tenant.adapterId), "CAAS_ADAPTER_NOT_FOUND", "tenant provisioner adapter is not configured");
        return structuredClone(tenant);
      }, { signal });
      const provisioner = this.provisioners[snapshot.adapterId];
      const finalState = finalObservedState(snapshot.desiredState);
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
      const prepared = await this.#transact(tenantId, (state) => {
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
            ["PROVISIONED", "SUSPENDED"].includes(tenant.desiredState) ? tenant.adapterResourceId : null,
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
        tenant.observedState = pendingObservedState(tenant);
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
        const options = adapterCommandOptions(lease);
        const adapterResult = tenant.desiredState === "PROVISIONED"
          ? await provisioner.provision(tenant, tenant.operationKey, options)
          : tenant.desiredState === "SUSPENDED" && typeof provisioner.suspend === "function"
            ? await provisioner.suspend(tenant, tenant.operationKey, options)
            : tenant.desiredState === "DELETED" && typeof provisioner.delete === "function"
              ? await provisioner.delete(tenant, tenant.operationKey, options)
              : await provisioner.deprovision(tenant, tenant.operationKey, options);
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
        return await this.#transact(tenantId, (state) => {
          throwIfAborted(signal);
          const current = state.tenants[tenantId];
          assertCaas(current?.operationKey === tenant.operationKey && current.generation === tenant.generation, "CAAS_RECONCILE_FENCE_VIOLATION", "tenant changed while reconciliation was in progress");
          const finalState = finalObservedState(current.desiredState);
          const pendingState = pendingObservedState(current);
          current.observedState = provisioner.intentOnly === true
            ? "INTENT_READY"
            : observedConvergence ? finalState : pendingState;
          current.observedGeneration = current.generation;
          if (["PROVISIONED", "SUSPENDED"].includes(current.desiredState)) current.adapterResourceId = adapterResult.adapterResourceId;
          else if (observedConvergence) delete current.adapterResourceId;
          if (observedConvergence && current.desiredState === "PROVISIONED") {
            current.deployedConnectorPlanId = current.connectorPlanId;
            current.deployedConnectorPlanDigest = current.connectorPlanDigest;
            delete current.lifecycleOperation;
          } else if (observedConvergence && ["DELETED", "DEPROVISIONED"].includes(current.desiredState)) {
            delete current.deployedConnectorPlanId;
            delete current.deployedConnectorPlanDigest;
          }
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
        await this.#transact(tenantId, (state) => {
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
      const before = await this.#transact(tenantId, (state) => {
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
        const desiredState = request.desiredState === "ACTIVE" ? "PROVISIONED" : "SUSPENDED";
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
            : request.desiredState === "SUSPENDED" && reconciled.observedState === "SUSPENDED"
              ? "SUSPENDED"
              : "PROVISIONING",
        ...(new URL(reconciled.endpoint).protocol === "https:" ? { endpoints: { connectorBase: reconciled.endpoint } } : {}),
      });
      return this.#transact(tenantId, (state) => {
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
    if (this.store.kind === "postgres-scoped") {
      return this.store.readAudit(tenantId, { limit: this.config.limits.maxAuditResponseEvents, signal });
    }
    const state = await this.store.read((value) => value, { signal });
    const selected = state.audit.filter((event) => !tenantId || event.tenantId === tenantId);
    const limit = this.config.limits.maxAuditResponseEvents;
    return { events: selected.slice(-limit), total: selected.length, truncated: selected.length > limit };
  }

  async readiness({ signal } = {}) {
    throwIfAborted(signal);
    const storeReadiness = await this.store.readiness({ signal });
    assertCaas(storeReadiness.ready === true, storeReadiness.failureCode ?? "CAAS_STATE_UNAVAILABLE", "CaaS state store is not ready");
    const state = await this.#allTenantState({ signal });
    if (this.config.environment !== "production") {
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
    }
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
