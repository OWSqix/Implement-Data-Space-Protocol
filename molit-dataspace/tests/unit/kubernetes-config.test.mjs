import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadCaasConfig } from "../../src/caas/config.mjs";
import { createCaasProvisioners } from "../../src/caas/provisioner.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function kubernetesConfig() {
  return {
    type: "kubernetes-edc",
    apiServer: "https://kubernetes.default.svc/",
    authentication: { type: "service-account", tokenFile: "secrets/token", caFile: "secrets/ca.crt" },
    controlNamespace: "molit-caas-system",
    admissionPolicyName: "molit-caas-fencing",
    namespacePrefix: "molit-edc-",
    instanceId: "caas-primary",
    routing: { mode: "internal-test" },
    images: {
      controlPlane: `registry.example/molit/edc-control@sha256:${"a".repeat(64)}`,
      dataPlane: `registry.example/molit/edc-data@sha256:${"b".repeat(64)}`,
    },
    replicas: { controlPlane: 2, dataPlane: 2 },
    ports: { default: 8080, management: 8081, protocol: 8082, control: 8083, dataPlaneDefault: 8080, dataPlaneControl: 8083 },
    resources: {
      "control-plane": { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "2Gi" } },
      "data-plane": { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "2Gi" } },
    },
    quota: { "requests.cpu": "4", "requests.memory": "8Gi", pods: "20" },
    limitRange: { default: { cpu: "1", memory: "1Gi" }, defaultRequest: { cpu: "250m", memory: "512Mi" } },
    networkPolicy: { allowedIngressCidrs: ["10.0.0.0/8"], allowedEgressCidrs: ["10.0.0.0/8"] },
    secretBindings: {
      vaultAccess: { secretNameTemplate: "edc-{tenantId}-runtime", keys: [{ key: "management-api-key", environmentVariable: "WEB_HTTP_MANAGEMENT_AUTH_KEY", components: ["control-plane"] }] },
      databaseAccess: { secretNameTemplate: "edc-{tenantId}-database", keys: [
        { key: "control-url", environmentVariable: "EDC_DATASOURCE_DEFAULT_URL", components: ["control-plane"] },
        { key: "data-url", environmentVariable: "EDC_DATASOURCE_DEFAULT_URL", components: ["data-plane"] },
        { key: "username", environmentVariable: "EDC_DATASOURCE_DEFAULT_USER", components: ["control-plane", "data-plane"] },
        { key: "password", environmentVariable: "EDC_DATASOURCE_DEFAULT_PASSWORD", components: ["control-plane", "data-plane"] }
      ] }
    },
    deprovisionPolicy: "delete",
    revisionHistoryLimit: 5,
    terminationGracePeriodSeconds: 30,
    requestTimeoutMs: 10_000,
  };
}

async function baseConfig() {
  return JSON.parse(await readFile(join(here, "../../fixtures/caas/config.example.json"), "utf8"));
}

async function writeConfig(value) {
  const directory = await mkdtemp(join(tmpdir(), "molit-kube-config-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(value));
  return path;
}

test("CaaS configuration accepts a digest-pinned Kubernetes EDC provisioner", async () => {
  const value = await baseConfig();
  value.connectorPlans["edc-isolated"].adapterId = "kube-edc";
  value.provisioners = { "kube-edc": kubernetesConfig() };
  const path = await writeConfig(value);
  const loaded = await loadCaasConfig(path);
  assert.equal(loaded.provisioners["kube-edc"].authentication.tokenFile, join(dirname(path), "secrets/token"));
  assert.equal(loaded.provisioners["kube-edc"].authentication.caFile, join(dirname(path), "secrets/ca.crt"));
  const provisioners = createCaasProvisioners(loaded);
  assert.equal(provisioners["kube-edc"].fencingCapable, true);
  assert.equal(provisioners["kube-edc"].intentOnly, false);
});

test("Kubernetes EDC plans reject shared deployment and production plaintext API access", async () => {
  const shared = await baseConfig();
  shared.connectorPlans["edc-isolated"].adapterId = "kube-edc";
  shared.connectorPlans["edc-isolated"].deploymentMode = "virtualized";
  shared.provisioners = { "kube-edc": kubernetesConfig() };
  await assert.rejects(loadCaasConfig(await writeConfig(shared)), { code: "CAAS_CONFIG_INVALID" });

  const production = await baseConfig();
  production.environment = "production";
  delete production.adminSecretRef;
  delete production.adminPrincipalId;
  delete production.adminClientId;
  delete production.adminKeyId;
  delete production.controller.secretRef;
  delete production.controller.principalId;
  delete production.controller.clientId;
  delete production.controller.keyId;
  production.identityConfigPath = "../../deploy/identity/caas.identity.production.example.json";
  production.observabilityConfigPath = "../../deploy/observability/caas.production.example.json";
  production.tls = {
    certFile: "secrets/tls.crt",
    keyFile: "secrets/tls.key",
    clientCaFile: "secrets/client-ca.crt",
    reloadIntervalMs: 5000,
  };
  production.stateStore = {
    type: "postgres",
    connectionStringEnv: "CAAS_DATABASE_URL",
    holderIdEnv: "CAAS_HOLDER_ID",
    applicationName: "molit-caas",
    tls: { mode: "verify-full", caEnv: "CAAS_DATABASE_CA" },
    maxPoolSize: 10,
    maxLeasePoolSize: 10,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 30000,
    statementTimeoutMs: 10000,
    lockTimeoutMs: 5000,
  };
  production.connectorPlans["edc-isolated"].adapterId = "kube-edc";
  production.identityPolicy.endpointTemplate = "https://{tenantId}.connectors.example/";
  production.provisioners = { "kube-edc": { ...kubernetesConfig(), apiServer: "http://127.0.0.1:8001/", routing: {
    mode: "gateway-api",
    parentRef: { name: "molit-connectors", namespace: "molit-gateway-system" },
    protocolSectionName: "dsp-https",
    dataPlaneSectionName: "data-https",
    gatewayAccessLabelValue: "molit-connectors",
    protocolHostnameTemplate: "{tenantId}.connectors.example",
    dataPlaneHostnameTemplate: "{tenantId}.transfer.example",
  } } };
  await assert.rejects(loadCaasConfig(await writeConfig(production)), { code: "CAAS_CONFIG_INVALID" });
});

test("production Kubernetes plan pins schema migration and verify-full Secret bindings", async () => {
  const productionPath = join(here, "../../deploy/kubernetes/caas-config.production.example.json");
  const loaded = await loadCaasConfig(productionPath);
  const schema = loaded.connectorPlans["edc-isolated"].databaseSchema;
  assert.equal(schema.requiredVersion, "edc-0.18.0-sql-v1");
  assert.equal(schema.migrationArtifact.version, schema.requiredVersion);
  assert.match(schema.migrationImage, /@sha256:[a-f0-9]{64}$/u);
  assert.equal(schema.connection.sslMode, "verify-full");
  assert.equal(schema.connection.caKey, "ca.crt");
  assert.equal(schema.connection.mountPath, "/var/run/secrets/edc-database");
  assert.equal(loaded.provisioners["kube-edc"].supplyChainAdmission.policyName, "molit-verify-release-images");
  assert.equal(loaded.provisioners["kube-edc"].supplyChainAdmission.attestationPredicateType,
    "https://data.molit.go.kr/attestations/release-bundle/v1");
  assert.match(loaded.provisioners["kube-edc"].supplyChainAdmission.trustAnchorSha256, /^[a-f0-9]{64}$/u);
});

test("production Kubernetes plan rejects downgraded TLS, absent CA, or an unbound migration version", async (t) => {
  const productionPath = join(here, "../../deploy/kubernetes/caas-config.production.example.json");
  const original = JSON.parse(await readFile(productionPath, "utf8"));
  for (const [name, mutate] of [
    ["verify-ca", (value) => { value.connectorPlans["edc-isolated"].databaseSchema.connection.sslMode = "verify-ca"; }],
    ["absent-ca", (value) => { delete value.connectorPlans["edc-isolated"].databaseSchema.connection.caKey; }],
    ["client-key-pair", (value) => { delete value.connectorPlans["edc-isolated"].databaseSchema.connection.clientPrivateKeyKey; }],
    ["version-mismatch", (value) => { value.connectorPlans["edc-isolated"].databaseSchema.migrationArtifact.version = "edc-0.18.0-sql-v0"; }],
    ["absent-supply-chain-gate", (value) => { delete value.provisioners["kube-edc"].supplyChainAdmission; }],
    ["absent-supply-chain-trust-anchor", (value) => { delete value.provisioners["kube-edc"].supplyChainAdmission.trustAnchorSha256; }],
    ["invalid-supply-chain-trust-anchor", (value) => { value.provisioners["kube-edc"].supplyChainAdmission.trustAnchorSha256 = "not-a-digest"; }],
  ]) await t.test(name, async () => {
    const value = structuredClone(original);
    mutate(value);
    await assert.rejects(loadCaasConfig(await writeConfig(value)), (error) => ["CAAS_CONTRACT_INVALID", "CAAS_CONFIG_INVALID"].includes(error.code));
  });
});
