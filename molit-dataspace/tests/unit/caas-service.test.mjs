import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DryRunManifestProvisioner } from "../../src/caas/provisioner.mjs";
import { CaaSControlService } from "../../src/caas/service.mjs";
import { FileCaasStore } from "../../src/caas/store.mjs";
import { digest } from "../../src/discovery/stable-json.mjs";

const ADMIN_ACTOR = {
  role: "admin",
  principalId: "urn:test:principal:caas-admin",
  clientId: "test-caas-admin-client",
  keyId: "test-caas-admin-key-1",
};

const TENANT_ACTOR = {
  role: "tenant",
  principalId: "urn:test:principal:road-operator",
  clientId: "test-road-operator-client",
  keyId: "test-road-operator-key-1",
};

function setup(directory) {
  const config = {
    adminSecretRef: "env://ADMIN_TOKEN",
    adminPrincipalId: ADMIN_ACTOR.principalId,
    adminClientId: ADMIN_ACTOR.clientId,
    adminKeyId: ADMIN_ACTOR.keyId,
    identityPolicy: { participantIdTemplate: "did:web:example:{tenantId}", namespaceTemplate: "https://data.example/{tenantId}/", endpointTemplate: "https://connector.example/{tenantId}/" },
    limits: { maxStateBytes: 1048576, maxAuditEvents: 100, maxAuditResponseEvents: 50 },
    connectorPlans: { standard: { adapterId: "dry", runtimeProfileRef: "urn:profile:edc", deploymentMode: "isolated", metadataProfile: { iri: "https://profiles.example/metadata", version: "1", sha256: "a".repeat(64) }, protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" }, requiredDeploymentSecretNames: ["vaultAccess"] } },
  };
  const dry = new DryRunManifestProvisioner({ id: "dry", manifestDirectory: join(directory, "manifests") });
  const env = { ADMIN_TOKEN: "admin-token-000000", TENANT_TOKEN: "tenant-token-00000" };
  const store = new FileCaasStore({ path: join(directory, "state.json"), maxBytes: config.limits.maxStateBytes, maxAuditEvents: config.limits.maxAuditEvents });
  return { service: new CaaSControlService({ config, provisioners: { dry }, store, env }), dry, store };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const registration = {
  schemaVersion: "molit.caas-tenant-registration/1",
  tenantId: "road-operator",
  organizationId: "urn:organization:road-operator",
  displayName: "Road operator",
  adapterId: "dry",
  runtimeProfileRef: "urn:profile:edc",
  apiAccessSecretRef: "env://TENANT_TOKEN",
  apiPrincipalId: TENANT_ACTOR.principalId,
  apiClientId: TENANT_ACTOR.clientId,
  apiKeyId: TENANT_ACTOR.keyId,
  deploymentSecretRefs: { vaultAccess: "vault://tenant/road/vault" },
};

test("service reconciles desired state through a secret-free idempotent manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-service-"));
  const { service } = setup(directory);
  const registered = await service.register(registration, "register-1", ADMIN_ACTOR);
  assert.equal(registered.participantId, "did:web:example:road-operator");
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-1", TENANT_ACTOR);
  const provisioned = await service.reconcile("road-operator", "reconcile-1", TENANT_ACTOR);
  assert.equal(provisioned.observedState, "INTENT_READY");
  assert.deepEqual(await service.reconcile("road-operator", "reconcile-1", TENANT_ACTOR), provisioned);
  const manifest = await readFile(join(directory, "manifests", "road-operator.intent.json"), "utf8");
  assert.match(manifest, /vault:\/\/tenant\/road\/vault/u);
  assert.doesNotMatch(manifest, /tenant-token-00000|admin-token-000000/u);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "DEPROVISIONED" }, "desired-2", TENANT_ACTOR);
  assert.equal((await service.reconcile("road-operator", "reconcile-2", TENANT_ACTOR)).observedState, "INTENT_READY");
});

test("failed connector upgrade can be rolled back to an immutable prior plan", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-version-lifecycle-"));
  const { service } = setup(directory);
  const version2 = {
    ...structuredClone(service.config.connectorPlans.standard),
    runtimeProfileRef: "urn:profile:edc:v2",
    images: {
      controlPlane: `registry.example/molit/edc-control@sha256:${"b".repeat(64)}`,
      dataPlane: `registry.example/molit/edc-data@sha256:${"c".repeat(64)}`,
    },
  };
  service.config.connectorPlans.version2 = version2;
  let applied = null;
  let failDigest = null;
  service.provisioners.dry = {
    intentOnly: false,
    fencingCapable: true,
    readiness: async () => true,
    async provision(tenant, key) {
      if (tenant.connectorPlanDigest === failDigest) {
        const error = new Error("injected upgrade failure");
        error.code = "CAAS_TEST_UPGRADE_FAILED";
        throw error;
      }
      const intentDigest = digest({ key, plan: tenant.connectorPlanDigest, desiredState: tenant.desiredState });
      applied = { adapterResourceId: `test:${tenant.tenantId}`, intentDigest, operationKey: key, generation: tenant.generation, desiredState: tenant.desiredState };
      return { adapterResourceId: applied.adapterResourceId, intentDigest, converged: true };
    },
    async deprovision(tenant, key) {
      const intentDigest = digest({ key, plan: tenant.connectorPlanDigest, desiredState: tenant.desiredState });
      applied = { adapterResourceId: `test:${tenant.tenantId}`, intentDigest, operationKey: key, generation: tenant.generation, desiredState: tenant.desiredState };
      return { adapterResourceId: applied.adapterResourceId, intentDigest, converged: true };
    },
    async observe(_tenant, _key) {
      return { ...applied, exists: applied?.desiredState !== "DELETED", converged: true, lastAppliedFencingToken: null };
    },
  };
  await service.register(registration, "version-register", ADMIN_ACTOR);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "version-provision", ADMIN_ACTOR);
  const initial = await service.reconcile("road-operator", "version-reconcile-v1", ADMIN_ACTOR);
  const initialDigest = initial.connectorPlanDigest;
  failDigest = digest(version2);
  const upgrading = await service.upgrade("road-operator", { schemaVersion: "molit.caas-connector-upgrade/1", connectorPlanId: "version2" }, "version-upgrade", ADMIN_ACTOR);
  assert.equal(upgrading.lifecycleOperation, "UPGRADE");
  await assert.rejects(service.reconcile("road-operator", "version-reconcile-v2", ADMIN_ACTOR), { code: "CAAS_TEST_UPGRADE_FAILED" });
  assert.equal((await service.getTenant("road-operator")).observedState, "ERROR");
  failDigest = null;
  const rollingBack = await service.rollback("road-operator", { schemaVersion: "molit.caas-connector-rollback/1", targetConnectorPlanDigest: initialDigest }, "version-rollback", ADMIN_ACTOR);
  assert.equal(rollingBack.lifecycleOperation, "ROLLBACK");
  const restored = await service.reconcile("road-operator", "version-reconcile-rollback", ADMIN_ACTOR);
  assert.equal(restored.observedState, "PROVISIONED");
  assert.equal(restored.connectorPlanDigest, initialDigest);
  assert.equal(restored.deployedConnectorPlanDigest, initialDigest);
  assert.equal(restored.lifecycleOperation, null);
  const actions = (await service.audit("road-operator")).events.map(({ action }) => action);
  assert.ok(actions.includes("CONNECTOR_UPGRADE_REQUESTED"));
  assert.ok(actions.includes("CONNECTOR_ROLLBACK_REQUESTED"));
});

test("INTENT_READY is re-observed and readiness fails closed on manifest drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-intent-drift-"));
  const { service } = setup(directory);
  await service.register(registration, "register-1", ADMIN_ACTOR);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-1", ADMIN_ACTOR);
  await service.reconcile("road-operator", "reconcile-1", ADMIN_ACTOR);
  const manifestPath = join(directory, "manifests", "road-operator.intent.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.connectorIdentity.endpoint = "https://attacker.example/";
  await writeFile(manifestPath, JSON.stringify(manifest));

  await assert.rejects(service.readiness(), { code: "CAAS_PROVISIONER_DRIFT" });
  await assert.rejects(service.reconcile("road-operator", "reconcile-after-drift", ADMIN_ACTOR), {
    code: "CAAS_PROVISIONER_IDEMPOTENCY_CONFLICT",
  });
  assert.equal((await service.getTenant("road-operator")).observedState, "ERROR");
  assert.ok((await service.audit("road-operator")).events.some(({ action }) => action === "INTENT_DRIFT_DETECTED"));
});

test("reconcile retries the same adapter operation after a post-side-effect failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-crash-"));
  const { service, dry } = setup(directory);
  let injected = true;
  service.provisioners.dry = {
    intentOnly: true,
    readiness: () => dry.readiness(),
    async provision(tenant, key) {
      const result = await dry.provision(tenant, key);
      if (injected) { injected = false; throw new Error("injected crash after manifest write"); }
      return result;
    },
    deprovision: (tenant, key) => dry.deprovision(tenant, key),
    observe: (tenant, key, options) => dry.observe(tenant, key, options),
  };
  await service.register(registration, "register-1", ADMIN_ACTOR);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-1", ADMIN_ACTOR);
  await assert.rejects(service.reconcile("road-operator", "reconcile-1", ADMIN_ACTOR));
  assert.equal((await service.getTenant("road-operator")).observedState, "ERROR");
  assert.equal((await service.reconcile("road-operator", "reconcile-1", ADMIN_ACTOR)).observedState, "INTENT_READY");
});

test("registration rejects runtime profiles outside the configured connector plan", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-plan-"));
  const { service } = setup(directory);
  await assert.rejects(service.register({ ...registration, runtimeProfileRef: "urn:profile:unreviewed" }, "register-1", ADMIN_ACTOR), { code: "CAAS_PLAN_NOT_ALLOWED" });
});

test("registration rejects client and key identifiers reused by another credential", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-actor-collision-"));
  const { service } = setup(directory);
  service.env.TENANT_TWO_TOKEN = "second-tenant-token-00000";
  await service.register(registration, "register-1", ADMIN_ACTOR);
  await assert.rejects(service.register({
    ...registration,
    tenantId: "rail-operator",
    organizationId: "urn:organization:rail-operator",
    displayName: "Rail operator",
    apiAccessSecretRef: "env://TENANT_TWO_TOKEN",
    apiPrincipalId: "urn:test:principal:rail-operator",
    apiClientId: registration.apiClientId,
    apiKeyId: "test-rail-operator-key-1",
  }, "register-2", ADMIN_ACTOR), { code: "CAAS_ACTOR_ID_COLLISION" });
});

test("only a provisioner that reports convergence can reach PROVISIONED", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-confirmed-"));
  const { service, dry } = setup(directory);
  let lastResult;
  service.provisioners.dry = {
    intentOnly: false,
    readiness: () => dry.readiness(),
    async provision(tenant, key) { lastResult = { ...await dry.provision(tenant, key), converged: true }; return lastResult; },
    async deprovision(tenant, key) { lastResult = { ...await dry.deprovision(tenant, key), converged: true }; return lastResult; },
    async observe(tenant, key) {
      return {
        adapterResourceId: lastResult.adapterResourceId,
        intentDigest: lastResult.intentDigest,
        operationKey: key,
        generation: tenant.generation,
        desiredState: tenant.desiredState,
        exists: tenant.desiredState === "PROVISIONED",
        converged: true,
      };
    },
  };
  await service.register(registration, "register-1", ADMIN_ACTOR);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-1", ADMIN_ACTOR);
  assert.equal((await service.reconcile("road-operator", "reconcile-1", ADMIN_ACTOR)).observedState, "PROVISIONED");
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "DEPROVISIONED" }, "desired-2", ADMIN_ACTOR);
  assert.equal((await service.reconcile("road-operator", "reconcile-2", ADMIN_ACTOR)).observedState, "NOT_PROVISIONED");
});

test("DSaaS ensure reports ERROR without freezing a transient failure in the idempotency ledger", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-ensure-error-"));
  const { service, dry } = setup(directory);
  let injected = true;
  service.provisioners.dry = {
    intentOnly: true,
    readiness: () => dry.readiness(),
    async provision(tenant, key) {
      if (injected) { injected = false; throw new Error("transient provision failure"); }
      return dry.provision(tenant, key);
    },
    deprovision: (tenant, key) => dry.deprovision(tenant, key),
    observe: (tenant, key, options) => dry.observe(tenant, key, options),
  };
  await service.register(registration, "register-1", ADMIN_ACTOR);
  const request = {
    schemaVersion: "molit.dsaas-caas-request/1",
    dataspaceId: "road-space",
    caasTenantId: "road-operator",
    participantId: "did:web:example:road-operator",
    organizationId: "urn:organization:road-operator",
    connectorPlanId: "standard",
    deploymentMode: "isolated",
    connectorNamespace: "https://data.example/road-operator/",
    metadataProfile: { iri: "https://profiles.example/metadata", version: "1", sha256: "a".repeat(64) },
    protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" },
    desiredGeneration: 1,
    desiredState: "ACTIVE",
  };
  assert.equal((await service.ensureConnector(request, "ensure-1", ADMIN_ACTOR)).state, "ERROR");
  assert.equal((await service.ensureConnector(request, "ensure-1", ADMIN_ACTOR)).state, "PROVISIONING");
});

test("DSaaS ensure keeps completed keys immutable and re-observes with a new key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-ensure-observe-"));
  const { service, dry } = setup(directory);
  const operationKeys = [];
  let lastResult;
  service.provisioners.dry = {
    intentOnly: false,
    readiness: () => dry.readiness(),
    async provision(tenant, key) {
      operationKeys.push(key);
      lastResult = { ...await dry.provision(tenant, key), converged: operationKeys.length > 1 };
      return lastResult;
    },
    async deprovision(tenant, key) { lastResult = { ...await dry.deprovision(tenant, key), converged: true }; return lastResult; },
    async observe(tenant, key) {
      return {
        adapterResourceId: lastResult.adapterResourceId,
        intentDigest: lastResult.intentDigest,
        operationKey: key,
        generation: tenant.generation,
        desiredState: tenant.desiredState,
        exists: tenant.desiredState === "PROVISIONED",
        converged: operationKeys.length > 1,
      };
    },
  };
  await service.register(registration, "register-1", ADMIN_ACTOR);
  const request = {
    schemaVersion: "molit.dsaas-caas-request/1",
    dataspaceId: "road-space",
    caasTenantId: "road-operator",
    participantId: "did:web:example:road-operator",
    organizationId: "urn:organization:road-operator",
    connectorPlanId: "standard",
    deploymentMode: "isolated",
    connectorNamespace: "https://data.example/road-operator/",
    metadataProfile: { iri: "https://profiles.example/metadata", version: "1", sha256: "a".repeat(64) },
    protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" },
    desiredGeneration: 1,
    desiredState: "ACTIVE",
  };

  const pending = await service.ensureConnector(request, "ensure-observe-1", ADMIN_ACTOR);
  assert.equal(pending.state, "PROVISIONING");
  assert.deepEqual(await service.ensureConnector(request, "ensure-observe-1", ADMIN_ACTOR), pending);
  assert.equal(operationKeys.length, 1, "an exact completed-key replay has no adapter side effect");
  assert.equal((await service.ensureConnector(request, "ensure-observe-2", ADMIN_ACTOR)).state, "ACTIVE");
  assert.equal(operationKeys.length, 2);
  assert.equal(operationKeys[1], operationKeys[0], "re-observation preserves the generation-scoped provisioner operation key");
});

test("a DSaaS-bound tenant cannot reactivate itself after administrator suspension", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-dsaas-lifecycle-lock-"));
  const { service } = setup(directory);
  await service.register(registration, "register-1", ADMIN_ACTOR);
  const request = {
    schemaVersion: "molit.dsaas-caas-request/1",
    dataspaceId: "road-space",
    caasTenantId: "road-operator",
    participantId: "did:web:example:road-operator",
    organizationId: "urn:organization:road-operator",
    connectorPlanId: "standard",
    deploymentMode: "isolated",
    connectorNamespace: "https://data.example/road-operator/",
    metadataProfile: { iri: "https://profiles.example/metadata", version: "1", sha256: "a".repeat(64) },
    protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" },
    desiredGeneration: 1,
    desiredState: "ACTIVE",
  };
  await service.ensureConnector(request, "ensure-active", ADMIN_ACTOR);
  await service.ensureConnector({ ...request, desiredGeneration: 2, desiredState: "SUSPENDED" }, "ensure-suspended", ADMIN_ACTOR);

  await assert.rejects(service.setDesiredState("road-operator", {
    schemaVersion: "molit.caas-desired-state/1",
    desiredState: "PROVISIONED",
  }, "tenant-reactivation", TENANT_ACTOR), { code: "CAAS_DSAAS_LIFECYCLE_LOCKED" });
  assert.equal((await service.getTenant("road-operator")).desiredState, "SUSPENDED");
});

test("state snapshot integrity detects direct tenant mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-tenant-snapshot-"));
  const { service } = setup(directory);
  await service.register(registration, "register-1", ADMIN_ACTOR);
  const raw = JSON.parse(await readFile(service.store.path, "utf8"));
  raw.tenants[registration.tenantId].displayName = "Tampered operator";
  await writeFile(service.store.path, JSON.stringify(raw));
  await assert.rejects(service.getTenant(registration.tenantId), { code: "CAAS_STATE_SNAPSHOT_INVALID" });
});

test("unbounded adapter error codes are replaced before state and audit persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-adapter-error-"));
  const { service, dry } = setup(directory);
  const unsafeCode = `LEAKED_SECRET\n${"X".repeat(200)}`;
  service.provisioners.dry = {
    readiness: () => dry.readiness(),
    async provision() {
      const error = new Error("restricted adapter detail");
      error.code = unsafeCode;
      throw error;
    },
    deprovision: (tenant, key) => dry.deprovision(tenant, key),
  };
  await service.register(registration, "register-1", ADMIN_ACTOR);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-1", ADMIN_ACTOR);
  await assert.rejects(service.reconcile("road-operator", "reconcile-1", ADMIN_ACTOR));
  const tenant = await service.getTenant("road-operator");
  assert.deepEqual(tenant.lastError, {
    code: "CAAS_ADAPTER_FAILED",
    message: "provisioner operation failed; inspect restricted adapter telemetry",
  });
  const failure = (await service.audit("road-operator")).events.find(({ action }) => action === "RECONCILE_FAILED");
  assert.equal(failure.errorCode, "CAAS_ADAPTER_FAILED");
  assert.equal((await readFile(service.store.path, "utf8")).includes("LEAKED_SECRET"), false);
});

test("operational convergence requires a generation-bound fresh observation and repairs drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-operational-observation-"));
  const { service, dry } = setup(directory);
  let observationConverged = false;
  let resourceExists = false;
  let lastResult;
  let provisionCalls = 0;
  let provisionSignal;
  let observationSignal;
  let deprovisionSignal;
  service.provisioners.dry = {
    intentOnly: false,
    readiness: (options) => dry.readiness(options),
    async provision(tenant, key, options) {
      provisionSignal = options.signal;
      provisionCalls += 1;
      lastResult = { ...await dry.provision(tenant, key, options), converged: true };
      resourceExists = true;
      return lastResult;
    },
    async deprovision(tenant, key, options) {
      deprovisionSignal = options.signal;
      lastResult = { ...await dry.deprovision(tenant, key, options), converged: true };
      resourceExists = false;
      return lastResult;
    },
    async observe(tenant, key, { signal }) {
      observationSignal = signal;
      return {
        adapterResourceId: resourceExists ? lastResult?.adapterResourceId ?? `runtime:${tenant.tenantId}` : null,
        intentDigest: lastResult?.intentDigest ?? tenant.lastIntentDigest ?? null,
        operationKey: key,
        generation: tenant.generation,
        desiredState: tenant.desiredState,
        exists: resourceExists,
        converged: observationConverged,
      };
    },
  };

  await service.register(registration, "register-operational", ADMIN_ACTOR);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-operational", ADMIN_ACTOR);
  const controller = new AbortController();
  const pending = await service.reconcile("road-operator", "reconcile-operational-pending", ADMIN_ACTOR, { signal: controller.signal });
  assert.equal(pending.observedState, "PROVISIONING", "adapter success alone cannot establish PROVISIONED");
  assert.equal(provisionSignal, controller.signal);
  assert.equal(observationSignal, controller.signal);

  observationConverged = true;
  assert.equal((await service.reconcile("road-operator", "reconcile-operational-confirmed", ADMIN_ACTOR)).observedState, "PROVISIONED");
  const callsBeforeDrift = provisionCalls;
  resourceExists = false;
  assert.equal((await service.reconcile("road-operator", "reconcile-operational-drift", ADMIN_ACTOR)).observedState, "PROVISIONED");
  assert.equal(provisionCalls, callsBeforeDrift + 1, "fresh observation detects deletion and invokes repair");
  assert.ok((await service.audit("road-operator")).events.some(({ action }) => action === "RUNTIME_DRIFT_DETECTED"));

  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "DEPROVISIONED" }, "desired-operational-stop", ADMIN_ACTOR);
  assert.equal((await service.reconcile("road-operator", "reconcile-operational-stop", ADMIN_ACTOR, { signal: controller.signal })).observedState, "NOT_PROVISIONED");
  assert.equal(deprovisionSignal, controller.signal);
});

test("operational provisioners without observation fail readiness", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-observation-required-"));
  const { service, dry } = setup(directory);
  service.provisioners.dry = {
    intentOnly: false,
    readiness: (options) => dry.readiness(options),
    provision: (tenant, key, options) => dry.provision(tenant, key, options),
    deprovision: (tenant, key, options) => dry.deprovision(tenant, key, options),
  };
  await assert.rejects(service.readiness(), { code: "CAAS_PROVISIONER_CONTRACT_INVALID" });
});

test("slow external observation does not hold the state transaction or block another tenant write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-observe-concurrency-"));
  const { service, dry } = setup(directory);
  service.env.SECOND_TENANT_TOKEN = "second-tenant-token-00000";
  const observations = new Map();
  const observeStarted = deferred();
  const releaseObserve = deferred();
  let pauseObservation = false;
  service.provisioners.dry = {
    intentOnly: false,
    readiness: (options) => dry.readiness(options),
    async provision(tenant, key, options) {
      const result = { ...await dry.provision(tenant, key, options), converged: true };
      observations.set(tenant.tenantId, result);
      return result;
    },
    async deprovision(tenant, key, options) {
      const result = { ...await dry.deprovision(tenant, key, options), converged: true };
      observations.set(tenant.tenantId, result);
      return result;
    },
    async observe(tenant, key) {
      if (pauseObservation && tenant.tenantId === "road-operator") {
        observeStarted.resolve();
        await releaseObserve.promise;
      }
      const result = observations.get(tenant.tenantId);
      return {
        adapterResourceId: result.adapterResourceId,
        intentDigest: result.intentDigest,
        operationKey: key,
        generation: tenant.generation,
        desiredState: tenant.desiredState,
        exists: tenant.desiredState === "PROVISIONED",
        converged: true,
      };
    },
  };
  await service.register(registration, "register-primary", ADMIN_ACTOR);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-primary", TENANT_ACTOR);
  await service.reconcile("road-operator", "reconcile-primary", TENANT_ACTOR);

  pauseObservation = true;
  const slowReconcile = service.reconcile("road-operator", "reobserve-primary", TENANT_ACTOR);
  await observeStarted.promise;
  const secondRegistration = {
    ...registration,
    tenantId: "rail-operator",
    organizationId: "urn:organization:rail-operator",
    displayName: "Rail operator",
    apiAccessSecretRef: "env://SECOND_TENANT_TOKEN",
    apiPrincipalId: "urn:test:principal:rail-operator",
    apiClientId: "test-rail-operator-client",
    apiKeyId: "test-rail-operator-key-1",
  };
  const secondWrite = service.register(secondRegistration, "register-secondary", ADMIN_ACTOR);
  const outcome = await Promise.race([
    secondWrite.then(() => "completed"),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 250)),
  ]);
  releaseObserve.resolve();
  await Promise.all([slowReconcile, secondWrite]);
  assert.equal(outcome, "completed");
});

test("operational adapters receive the lease and must prove external fencing acceptance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-adapter-fencing-"));
  const { service: base, dry, store: backing } = setup(directory);
  let nextFencingToken = 38;
  const store = {
    supportsDistributedFencing: true,
    read: backing.read.bind(backing),
    transact: backing.transact.bind(backing),
    readiness: backing.readiness.bind(backing),
    close: backing.close.bind(backing),
    withResourceLock: (resourceId, operation) => operation(Object.freeze({
      resourceId,
      holderId: "caas-instance-a",
      fencingToken: String(++nextFencingToken),
      acquiredAt: "2026-07-14T00:00:00.000Z",
      signal: undefined,
    })),
  };
  const received = [];
  const target = { lastAppliedFencingToken: null };
  let lastResult;
  const operational = {
    intentOnly: false,
    fencingCapable: true,
    readiness: (options) => dry.readiness(options),
    async provision(tenant, key, options) {
      received.push({ method: "provision", options });
      lastResult = {
        ...await dry.provision(tenant, key, options),
        converged: true,
        fencingAccepted: true,
        fencingToken: options.fencingToken,
      };
      target.lastAppliedFencingToken = options.fencingToken;
      return lastResult;
    },
    async deprovision(tenant, key, options) {
      return this.provision(tenant, key, options);
    },
    async observe(tenant, key, options) {
      received.push({ method: "observe", options });
      return {
        adapterResourceId: lastResult.adapterResourceId,
        intentDigest: lastResult.intentDigest,
        operationKey: key,
        generation: tenant.generation,
        desiredState: tenant.desiredState,
        exists: tenant.desiredState === "PROVISIONED",
        converged: true,
        lastAppliedFencingToken: target.lastAppliedFencingToken,
      };
    },
  };
  base.config.environment = "production";
  const service = new CaaSControlService({ config: base.config, provisioners: { dry: operational }, store, env: base.env });
  await service.register(registration, "register-fenced", ADMIN_ACTOR);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-fenced", TENANT_ACTOR);
  const result = await service.reconcile("road-operator", "reconcile-fenced", TENANT_ACTOR);

  assert.equal(result.observedState, "PROVISIONED");
  assert.equal((await backing.read((state) => state.tenants["road-operator"].lastAppliedFencingToken)), "41");
  const observedAgain = await service.reconcile("road-operator", "reobserve-fenced", TENANT_ACTOR);
  assert.equal(observedAgain.observedState, "PROVISIONED");
  assert.equal((await backing.read((state) => state.tenants["road-operator"].lastAppliedFencingToken)), "41");
  assert.deepEqual(received.map(({ method, options }) => ({
    method,
    fencingToken: options.fencingToken,
    holderId: options.holderId,
    acquiredAt: options.acquiredAt,
    expectedLastAppliedFencingToken: options.expectedLastAppliedFencingToken,
  })), [
    { method: "provision", fencingToken: "41", holderId: "caas-instance-a", acquiredAt: "2026-07-14T00:00:00.000Z", expectedLastAppliedFencingToken: undefined },
    { method: "observe", fencingToken: "41", holderId: "caas-instance-a", acquiredAt: "2026-07-14T00:00:00.000Z", expectedLastAppliedFencingToken: undefined },
    { method: "observe", fencingToken: undefined, holderId: undefined, acquiredAt: undefined, expectedLastAppliedFencingToken: "41" },
  ]);
  const unfenced = new CaaSControlService({
    config: base.config,
    provisioners: { dry: { ...operational, fencingCapable: false } },
    store,
    env: base.env,
  });
  await assert.rejects(unfenced.readiness(), { code: "CAAS_PROVISIONER_FENCING_REQUIRED" });

  const rejectedDirectory = await mkdtemp(join(tmpdir(), "molit-caas-adapter-fencing-rejected-"));
  const { service: rejectedBase, dry: rejectedDry, store: rejectedBacking } = setup(rejectedDirectory);
  const rejectedStore = {
    ...store,
    read: rejectedBacking.read.bind(rejectedBacking),
    transact: rejectedBacking.transact.bind(rejectedBacking),
    readiness: rejectedBacking.readiness.bind(rejectedBacking),
    close: rejectedBacking.close.bind(rejectedBacking),
  };
  const rejectedAdapter = {
    intentOnly: false,
    fencingCapable: true,
    readiness: (options) => rejectedDry.readiness(options),
    async provision(tenant, key, options) {
      return { ...await rejectedDry.provision(tenant, key, options), converged: true };
    },
    deprovision(tenant, key, options) { return this.provision(tenant, key, options); },
    observe() { throw new Error("observe must not run without a fencing acceptance receipt"); },
  };
  const rejected = new CaaSControlService({ config: rejectedBase.config, provisioners: { dry: rejectedAdapter }, store: rejectedStore, env: rejectedBase.env });
  await rejected.register(registration, "register-rejected-fence", ADMIN_ACTOR);
  await rejected.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-rejected-fence", TENANT_ACTOR);
  await assert.rejects(rejected.reconcile("road-operator", "reconcile-rejected-fence", TENANT_ACTOR), { code: "CAAS_ADAPTER_FENCING_NOT_ENFORCED" });
});

test("an aborted operational adapter result cannot commit a late success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-late-adapter-"));
  const { service } = setup(directory);
  const called = deferred();
  const result = deferred();
  let adapterSignal;
  let observeCalls = 0;
  service.provisioners.dry = {
    intentOnly: false,
    async readiness() { return true; },
    async provision(_tenant, _key, { signal }) {
      adapterSignal = signal;
      called.resolve();
      return result.promise;
    },
    async deprovision() { throw new Error("not used"); },
    async observe() {
      observeCalls += 1;
      throw new Error("observation must not run after abort");
    },
  };
  await service.register(registration, "register-abort", ADMIN_ACTOR);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-abort", ADMIN_ACTOR);
  const controller = new AbortController();
  const reconciliation = service.reconcile("road-operator", "reconcile-abort", ADMIN_ACTOR, { signal: controller.signal });
  await called.promise;
  const reason = new Error("shutdown deadline expired");
  controller.abort(reason);
  result.resolve({ adapterResourceId: "runtime:road-operator", intentDigest: "b".repeat(64), converged: true });
  await assert.rejects(reconciliation, reason);
  assert.equal(adapterSignal, controller.signal);
  assert.equal(adapterSignal.aborted, true);
  assert.equal(observeCalls, 0);
  assert.equal((await service.getTenant("road-operator")).observedState, "PROVISIONING");
  const actions = (await service.audit("road-operator")).events.map(({ action }) => action);
  assert.equal(actions.includes("RECONCILE_COMPLETED"), false);
  assert.equal(actions.includes("RECONCILE_FAILED"), false);
});

test("an unknown final commit outcome is not rewritten as an adapter failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-commit-unknown-"));
  const { service: base, dry, store: backing } = setup(directory);
  let failAfterCommit = false;
  const store = {
    read: backing.read.bind(backing),
    readiness: backing.readiness.bind(backing),
    close: backing.close.bind(backing),
    withResourceLock: backing.withResourceLock.bind(backing),
    async transact(operation, options) {
      const result = await backing.transact(operation, options);
      if (failAfterCommit && result?.observedState === "INTENT_READY") {
        failAfterCommit = false;
        throw Object.assign(new Error("commit outcome is unknown"), { code: "CAAS_STATE_COMMIT_UNKNOWN" });
      }
      return result;
    },
  };
  const service = new CaaSControlService({ config: base.config, provisioners: { dry }, store, env: base.env });
  await service.register(registration, "register-commit-unknown", ADMIN_ACTOR);
  await service.setDesiredState("road-operator", { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" }, "desired-commit-unknown", ADMIN_ACTOR);
  failAfterCommit = true;
  await assert.rejects(
    service.reconcile("road-operator", "reconcile-commit-unknown", ADMIN_ACTOR),
    { code: "CAAS_STATE_COMMIT_UNKNOWN" },
  );
  const committed = await backing.read((state) => state.tenants["road-operator"]);
  assert.equal(committed.observedState, "INTENT_READY");
  const actions = (await service.audit("road-operator")).events.map(({ action }) => action);
  assert.equal(actions.filter((action) => action === "RECONCILE_COMPLETED").length, 1);
  assert.equal(actions.includes("RECONCILE_FAILED"), false);
  const replay = await service.reconcile("road-operator", "reconcile-commit-unknown", ADMIN_ACTOR);
  assert.equal(replay.observedState, "INTENT_READY");
});
