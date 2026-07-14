import { createHash } from "node:crypto";
import { digest } from "../discovery/stable-json.mjs";
import { validateCaasContract } from "./contracts.mjs";
import { tenantIdentity } from "./config.mjs";
import { resolveEnvironmentSecret, secretEqual, validateDeploymentSecretReference } from "./secrets.mjs";
import { appendAudit, idempotencyReplay, loadCaasState, recordIdempotency, withCaasState, withTenantOperationLock } from "./store.mjs";
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
  constructor({ config, provisioners, env = process.env, now = () => new Date() }) {
    Object.assign(this, { config, provisioners, env, now });
  }

  #stateOptions() {
    return { maxBytes: this.config.limits.maxStateBytes, maxAuditEvents: this.config.limits.maxAuditEvents, now: () => this.now() };
  }

  async register(input, key, actor) {
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
    return withTenantOperationLock(this.config.statePath, request.tenantId, () => withCaasState(this.config.statePath, (state) => {
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
    }, this.#stateOptions()));
  }

  async getTenant(tenantId) {
    const tenant = (await loadCaasState(this.config.statePath, this.config.limits.maxStateBytes)).tenants[tenantId];
    assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
    return publicTenant(tenant);
  }

  async setDesiredState(tenantId, input, key, actor) {
    const request = validateCaasContract("desiredState", structuredClone(input));
    const actorEvidence = auditActor(actor);
    return withTenantOperationLock(this.config.statePath, tenantId, () => withCaasState(this.config.statePath, (state) => {
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
    }, this.#stateOptions()));
  }

  async reconcile(tenantId, key, actor) {
    auditActor(actor);
    return withTenantOperationLock(this.config.statePath, tenantId, () => this.#reconcileLocked(tenantId, key, actor));
  }

  async #reconcileLocked(tenantId, key, actor) {
      const actorEvidence = auditActor(actor);
      const prepared = await withCaasState(this.config.statePath, async (state) => {
        const tenant = state.tenants[tenantId];
        assertCaas(tenant, "CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
        const replay = idempotencyReplay(state, `reconcile:${tenantId}`, key, { generation: tenant.generation, desiredState: tenant.desiredState });
        if (replay.result) {
          const currentResult = publicTenant(tenant);
          if (replay.result.generation === tenant.generation && replay.result.observedState === tenant.observedState) return { completed: currentResult };
          delete state.requests[replay.ledgerKey];
          replay.result = null;
        }
        const finalState = tenant.desiredState === "PROVISIONED" ? "PROVISIONED" : "NOT_PROVISIONED";
        const intentOnlyComplete = tenant.observedState === "INTENT_READY" && this.provisioners[tenant.adapterId]?.intentOnly === true;
        let intentStillObserved = false;
        if (intentOnlyComplete && tenant.observedGeneration === tenant.generation) {
          const provisioner = this.provisioners[tenant.adapterId];
          assertCaas(typeof provisioner?.observe === "function", "CAAS_PROVISIONER_CONTRACT_INVALID", "intent-only provisioner must implement observation");
          const observation = await provisioner.observe(structuredClone(tenant));
          intentStillObserved = observation?.exists === true
            && observation.intentDigest === tenant.lastIntentDigest;
          if (!intentStillObserved) {
            appendAudit(state, {
              tenantId,
              action: "INTENT_DRIFT_DETECTED",
              ...actorEvidence,
              generation: tenant.generation,
              expectedIntentDigest: tenant.lastIntentDigest ?? null,
              observedIntentDigest: /^[a-f0-9]{64}$/u.test(observation?.intentDigest ?? "") ? observation.intentDigest : null,
            }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
          }
        }
        if ((tenant.observedState === finalState || intentStillObserved) && tenant.observedGeneration === tenant.generation) {
          const result = publicTenant(tenant);
          recordIdempotency(state, replay, result, this.now());
          return { completed: result };
        }
        assertCaas(Object.hasOwn(this.provisioners, tenant.adapterId), "CAAS_ADAPTER_NOT_FOUND", "tenant provisioner adapter is not configured");
        const opKey = operationKey(tenant);
        tenant.observedState = tenant.desiredState === "PROVISIONED" ? "PROVISIONING" : "DEPROVISIONING";
        tenant.operationKey = opKey;
        tenant.updatedAt = this.now().toISOString();
        appendAudit(state, { tenantId, action: "RECONCILE_STARTED", ...actorEvidence, desiredState: tenant.desiredState, generation: tenant.generation, operationKey: opKey }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
        return { tenant: structuredClone(tenant), ledger: replay };
      }, this.#stateOptions());
      if (prepared.completed) return prepared.completed;
      const { tenant, ledger } = prepared;
      const provisioner = this.provisioners[tenant.adapterId];
      try {
        const adapterResult = tenant.desiredState === "PROVISIONED"
          ? await provisioner.provision(tenant, tenant.operationKey)
          : await provisioner.deprovision(tenant, tenant.operationKey);
        assertCaas(adapterResult && typeof adapterResult.adapterResourceId === "string" && adapterResult.adapterResourceId.length > 0 && /^[a-f0-9]{64}$/u.test(adapterResult.intentDigest) && typeof adapterResult.converged === "boolean", "CAAS_ADAPTER_CONTRACT_INVALID", "provisioner returned an invalid result contract");
        return await withCaasState(this.config.statePath, (state) => {
          const current = state.tenants[tenantId];
          assertCaas(current?.operationKey === tenant.operationKey && current.generation === tenant.generation, "CAAS_RECONCILE_FENCE_VIOLATION", "tenant changed while reconciliation was in progress");
          current.observedState = adapterResult.converged
            ? current.desiredState === "PROVISIONED" ? "PROVISIONED" : "NOT_PROVISIONED"
            : "INTENT_READY";
          current.observedGeneration = current.generation;
          if (current.desiredState === "PROVISIONED") current.adapterResourceId = adapterResult.adapterResourceId;
          else delete current.adapterResourceId;
          current.lastIntentDigest = adapterResult.intentDigest;
          current.updatedAt = this.now().toISOString();
          delete current.operationKey;
          delete current.lastError;
          appendAudit(state, { tenantId, action: "RECONCILE_COMPLETED", ...actorEvidence, observedState: current.observedState, generation: current.generation, adapterResultDigest: digest(adapterResult) }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
          const result = publicTenant(current);
          recordIdempotency(state, ledger, result, this.now());
          return result;
        }, this.#stateOptions());
      } catch (error) {
        await withCaasState(this.config.statePath, (state) => {
          const current = state.tenants[tenantId];
          if (current?.operationKey === tenant.operationKey) {
            current.observedState = "ERROR";
            current.lastError = { code: persistedAdapterErrorCode(error), message: "provisioner operation failed; inspect restricted adapter telemetry" };
            current.updatedAt = this.now().toISOString();
            appendAudit(state, { tenantId, action: "RECONCILE_FAILED", ...actorEvidence, generation: current.generation, errorCode: current.lastError.code }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
          }
        }, this.#stateOptions());
        throw error;
      }
  }

  async ensureConnector(input, key, actor) {
    const request = validateCaasContract("ensure", structuredClone(input));
    const actorEvidence = auditActor(actor);
    if (actor.role === "controller") {
      assertCaas(actor.allowedDataspaceIds?.includes(request.dataspaceId)
        && actor.allowedTenantIds?.includes(request.caasTenantId)
        && actor.allowedConnectorPlanIds?.includes(request.connectorPlanId),
      "CAAS_CONTROLLER_SCOPE_FORBIDDEN", "controller credential is outside its configured dataspace, tenant, or connector-plan scope", { status: 403 });
    }
    const tenantId = request.caasTenantId;
    return withTenantOperationLock(this.config.statePath, tenantId, async () => {
      const before = await withCaasState(this.config.statePath, (state) => {
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
      }, this.#stateOptions());
      if (before.completed) return before.completed;
      const internalKey = createHash("sha256").update(`ensure-reconcile\0${key}\0${before.generation}`).digest("hex");
      let reconciled;
      try {
        reconciled = await this.#reconcileLocked(tenantId, internalKey, actor);
      } catch (error) {
        const current = await this.getTenant(tenantId);
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
      return withCaasState(this.config.statePath, (state) => {
        const replay = idempotencyReplay(state, `ensure:${tenantId}`, key, request);
        if (replay.result) return replay.result;
        recordIdempotency(state, replay, response, this.now());
        appendAudit(state, { tenantId, action: "DSAAS_CONNECTOR_ENSURED", ...actorEvidence, dsaasState: response.state, generation: state.tenants[tenantId].generation }, { maxAuditEvents: this.config.limits.maxAuditEvents, now: this.now() });
        return response;
      }, this.#stateOptions());
    });
  }

  async audit(tenantId) {
    const state = await loadCaasState(this.config.statePath, this.config.limits.maxStateBytes);
    const selected = state.audit.filter((event) => !tenantId || event.tenantId === tenantId);
    const limit = this.config.limits.maxAuditResponseEvents;
    return { events: selected.slice(-limit), total: selected.length, truncated: selected.length > limit };
  }

  async readiness() {
    const state = await loadCaasState(this.config.statePath, this.config.limits.maxStateBytes);
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
    assertCaas(this.config.environment !== "production" || provisioners.every(({ intentOnly }) => intentOnly !== true), "CAAS_PRODUCTION_PROVISIONER_REQUIRED", "production readiness requires an operational Connector provisioner");
    await Promise.all(provisioners.map((provisioner) => provisioner.readiness()));
    for (const tenant of Object.values(state.tenants)) {
      if (tenant.observedState !== "INTENT_READY") continue;
      const provisioner = this.provisioners[tenant.adapterId];
      assertCaas(provisioner?.intentOnly === true && typeof provisioner.observe === "function", "CAAS_PROVISIONER_CONTRACT_INVALID", "INTENT_READY state requires an observable intent-only provisioner");
      const observation = await provisioner.observe(tenant);
      assertCaas(observation.exists === true && observation.intentDigest === tenant.lastIntentDigest, "CAAS_PROVISIONER_DRIFT", "deployment intent no longer matches the recorded observation");
    }
    const intentOnly = provisioners.some(({ intentOnly: value }) => value === true);
    return {
      ready: true,
      scope: intentOnly ? "INTENT_ONLY" : "CONNECTOR_RUNTIME",
      productionEligible: !intentOnly,
      tenantCount: Object.keys(state.tenants).length,
    };
  }
}
