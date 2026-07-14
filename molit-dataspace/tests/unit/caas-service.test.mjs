import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DryRunManifestProvisioner } from "../../src/caas/provisioner.mjs";
import { CaaSControlService } from "../../src/caas/service.mjs";

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
    statePath: join(directory, "state.json"),
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
  return { service: new CaaSControlService({ config, provisioners: { dry }, env }), dry };
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
    readiness: () => dry.readiness(),
    async provision(tenant, key) {
      const result = await dry.provision(tenant, key);
      if (injected) { injected = false; throw new Error("injected crash after manifest write"); }
      return result;
    },
    deprovision: (tenant, key) => dry.deprovision(tenant, key),
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
  service.provisioners.dry = {
    intentOnly: false,
    readiness: () => dry.readiness(),
    async provision(tenant, key) { return { ...await dry.provision(tenant, key), converged: true }; },
    async deprovision(tenant, key) { return { ...await dry.deprovision(tenant, key), converged: true }; },
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
    readiness: () => dry.readiness(),
    async provision(tenant, key) {
      if (injected) { injected = false; throw new Error("transient provision failure"); }
      return dry.provision(tenant, key);
    },
    deprovision: (tenant, key) => dry.deprovision(tenant, key),
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
  service.provisioners.dry = {
    intentOnly: false,
    readiness: () => dry.readiness(),
    async provision(tenant, key) {
      operationKeys.push(key);
      return { ...await dry.provision(tenant, key), converged: operationKeys.length > 1 };
    },
    async deprovision(tenant, key) { return { ...await dry.deprovision(tenant, key), converged: true }; },
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
  assert.equal((await service.getTenant("road-operator")).desiredState, "DEPROVISIONED");
});

test("state snapshot integrity detects direct tenant mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-tenant-snapshot-"));
  const { service } = setup(directory);
  await service.register(registration, "register-1", ADMIN_ACTOR);
  const raw = JSON.parse(await readFile(service.config.statePath, "utf8"));
  raw.tenants[registration.tenantId].displayName = "Tampered operator";
  await writeFile(service.config.statePath, JSON.stringify(raw));
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
  assert.equal((await readFile(service.config.statePath, "utf8")).includes("LEAKED_SECRET"), false);
});
