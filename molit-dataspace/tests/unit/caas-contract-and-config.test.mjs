import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateCaasContract } from "../../src/caas/contracts.mjs";
import { assertCaasEnvironment, loadCaasConfig, tenantIdentity } from "../../src/caas/config.mjs";
import { validateDeploymentSecretReference } from "../../src/caas/secrets.mjs";

const registration = {
  schemaVersion: "molit.caas-tenant-registration/1",
  tenantId: "road-operator",
  organizationId: "urn:organization:road-operator",
  displayName: "Road operator",
  adapterId: "dry",
  runtimeProfileRef: "urn:profile:edc",
  apiAccessSecretRef: "env://TENANT_TOKEN",
  apiPrincipalId: "urn:test:principal:road-operator",
  apiClientId: "test-road-operator-client",
  apiKeyId: "test-road-operator-key-1",
  deploymentSecretRefs: { vaultAccess: "vault://tenant/road/vault" },
};

function config() {
  return {
    schemaVersion: "molit.caas-config/1",
    environment: "test",
    listen: { host: "127.0.0.1", port: 0 },
    stateStore: { type: "file", path: "state.json" },
    adminSecretRef: "env://ADMIN_TOKEN",
    adminPrincipalId: "urn:test:principal:caas-admin",
    adminClientId: "test-caas-admin-client",
    adminKeyId: "test-caas-admin-key-1",
    controller: {
      secretRef: "env://CONTROLLER_TOKEN",
      principalId: "urn:test:principal:dsaas-controller",
      clientId: "test-dsaas-controller-client",
      keyId: "test-dsaas-controller-key-1",
      allowedDataspaceIds: ["road-space"],
      allowedTenantIds: ["road-operator"],
      allowedConnectorPlanIds: ["standard"],
    },
    identityPolicy: {
      participantIdTemplate: "did:web:connectors.example:{tenantId}",
      namespaceTemplate: "http://data.example/{tenantId}/",
      endpointTemplate: "http://connectors.example/{tenantId}/",
    },
    limits: { maxRequestBytes: 4096, maxStateBytes: 1048576, maxTenants: 100, maxIdempotencyRecords: 1000, maxAuditEvents: 100, maxAuditResponseEvents: 50, requestTimeoutMs: 1000 },
    connectorPlans: { standard: { adapterId: "dry", runtimeProfileRef: "urn:profile:edc", deploymentMode: "isolated", metadataProfile: { iri: "https://profiles.example/metadata", version: "1", sha256: "a".repeat(64) }, protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" }, requiredDeploymentSecretNames: ["vaultAccess"] } },
    provisioners: { dry: { type: "dry-run-manifest", manifestDirectory: "manifests" } },
  };
}

function productionConfig() {
  const value = config();
  value.environment = "production";
  value.identityConfigPath = "identity.json";
  value.observabilityConfigPath = "observability.json";
  value.tls = { certFile: "tls.crt", keyFile: "tls.key", clientCaFile: "client-ca.crt", reloadIntervalMs: 1000 };
  delete value.adminSecretRef;
  delete value.adminPrincipalId;
  delete value.adminClientId;
  delete value.adminKeyId;
  value.controller = {
    allowedDataspaceIds: value.controller.allowedDataspaceIds,
    allowedTenantIds: value.controller.allowedTenantIds,
    allowedConnectorPlanIds: value.controller.allowedConnectorPlanIds,
  };
  return value;
}

test("registration accepts references and rejects inline or unknown credential material", () => {
  assert.equal(validateCaasContract("registration", registration), registration);
  assert.throws(() => validateCaasContract("registration", { ...registration, apiAccessSecretRef: "plain-secret-value" }), { code: "CAAS_CONTRACT_INVALID" });
  assert.throws(() => validateCaasContract("registration", { ...registration, apiClientId: " " }), { code: "CAAS_CONTRACT_INVALID" });
  assert.throws(() => validateCaasContract("registration", { ...registration, participantId: "did:web:attacker" }), { code: "CAAS_CONTRACT_INVALID" });
  for (const reference of [
    "vault://user:password@vault/path",
    "vault://tenant/path?token=raw",
    "vault://tenant/path#credential",
    "env://TENANT_TOKEN?secret=raw",
  ]) {
    assert.throws(() => validateCaasContract("registration", {
      ...registration,
      deploymentSecretRefs: { vaultAccess: reference },
    }), { code: "CAAS_CONTRACT_INVALID" });
  }
  assert.throws(() => validateDeploymentSecretReference("vault://tenant/../raw-secret"), { code: "CAAS_SECRET_REF_INVALID" });
});

test("identity values are derived from one configured tenant template", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-config-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(config()));
  const loaded = await loadCaasConfig(path);
  assert.deepEqual(tenantIdentity(loaded.identityPolicy, "road-operator"), {
    participantId: "did:web:connectors.example:road-operator",
    namespace: "http://data.example/road-operator/",
    endpoint: "http://connectors.example/road-operator/",
  });
  const invalid = config();
  invalid.identityPolicy.endpointTemplate = "http://connectors.example/shared/";
  await writeFile(path, JSON.stringify(invalid));
  await assert.rejects(loadCaasConfig(path), { code: "CAAS_CONFIG_INVALID" });

  const unknownPlan = config();
  unknownPlan.controller.allowedConnectorPlanIds = ["unreviewed-plan"];
  await writeFile(path, JSON.stringify(unknownPlan));
  await assert.rejects(loadCaasConfig(path), (error) => error.code === "CAAS_CONFIG_INVALID" && /unknown connector plan/u.test(error.message));

  const sharedActorId = config();
  sharedActorId.controller.clientId = sharedActorId.adminClientId;
  await writeFile(path, JSON.stringify(sharedActorId));
  await assert.rejects(loadCaasConfig(path), (error) => error.code === "CAAS_CONFIG_INVALID" && /must differ/u.test(error.message));
});

test("production templates require HTTPS and a fixed listen port", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-production-"));
  const path = join(directory, "config.json");
  const value = productionConfig();
  await writeFile(path, JSON.stringify(value));
  await assert.rejects(loadCaasConfig(path), { code: "CAAS_CONFIG_INVALID" });
});

test("production config permits a direct TLS bind and rejects intent-only provisioners", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-production-boundary-"));
  const path = join(directory, "config.json");
  const value = productionConfig();
  value.listen = { host: "0.0.0.0", port: 8787 };
  value.identityPolicy.namespaceTemplate = "https://data.example/{tenantId}/";
  value.identityPolicy.endpointTemplate = "https://connectors.example/{tenantId}/";
  await writeFile(path, JSON.stringify(value));
  await assert.rejects(loadCaasConfig(path), (error) => error.code === "CAAS_CONFIG_INVALID" && /PostgreSQL control store/u.test(error.message));

  value.stateStore = {
    type: "postgres",
    connectionStringEnv: "CAAS_DATABASE_URL",
    holderIdEnv: "CAAS_HOLDER_ID",
    applicationName: "molit-caas",
    tls: { mode: "verify-full", caEnv: "CAAS_POSTGRES_CA" },
    maxPoolSize: 10,
    maxLeasePoolSize: 4,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 30000,
    statementTimeoutMs: 30000,
    lockTimeoutMs: 5000,
  };
  await writeFile(path, JSON.stringify(value));
  await assert.rejects(loadCaasConfig(path), (error) => error.code === "CAAS_CONFIG_INVALID" && /intent-only/u.test(error.message));
});

test("PostgreSQL state-store secrets are checked without embedding credential values in config", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-postgres-config-"));
  const path = join(directory, "config.json");
  const value = config();
  value.stateStore = {
    type: "postgres",
    connectionStringEnv: "CAAS_DATABASE_URL",
    holderIdEnv: "CAAS_HOLDER_ID",
    applicationName: "molit-caas",
    tls: { mode: "verify-full", caEnv: "CAAS_POSTGRES_CA" },
    maxPoolSize: 10,
    maxLeasePoolSize: 4,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 30000,
    statementTimeoutMs: 30000,
    lockTimeoutMs: 5000,
  };
  await writeFile(path, JSON.stringify(value));
  const loaded = await loadCaasConfig(path);
  const env = {
    ADMIN_TOKEN: "admin-token-at-least-16-characters",
    CONTROLLER_TOKEN: "controller-token-at-least-16-characters",
    CAAS_DATABASE_URL: "postgresql://caas.invalid/control",
    CAAS_HOLDER_ID: "caas-test-holder",
    CAAS_POSTGRES_CA: "test-ca",
  };
  assert.doesNotThrow(() => assertCaasEnvironment(loaded, env));
  assert.throws(() => assertCaasEnvironment(loaded, { ...env, CAAS_POSTGRES_CA: "" }), { code: "CAAS_SECRET_ENV_MISSING" });
});
