import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateCaasContract } from "./contracts.mjs";
import { assertCaas } from "./errors.mjs";

function exactlyOneTemplateToken(value, label) {
  assertCaas(value.split("{tenantId}").length === 2 && !/[{}]/u.test(value.replace("{tenantId}", "")), "CAAS_CONFIG_INVALID", `${label} must contain exactly one {tenantId}`);
}

function validateUrlTemplate(value, label, production) {
  exactlyOneTemplateToken(value, label);
  const rendered = value.replace("{tenantId}", "tenant-example");
  const url = new URL(rendered);
  assertCaas(!url.username && !url.password && !url.search && !url.hash, "CAAS_CONFIG_INVALID", `${label} must not contain credentials, query or fragment`);
  assertCaas(!production || url.protocol === "https:", "CAAS_CONFIG_INVALID", `${label} must use HTTPS in production`);
  assertCaas(url.pathname.endsWith("/"), "CAAS_CONFIG_INVALID", `${label} must end with a slash`);
}

function validateHostnameTemplate(value, label) {
  exactlyOneTemplateToken(value, label);
  const rendered = value.replace("{tenantId}", "tenant-example");
  const url = new URL(`https://${rendered}/`);
  assertCaas(url.hostname === rendered && url.port === "" && !rendered.includes(".."),
    "CAAS_CONFIG_INVALID", `${label} must render one lowercase DNS hostname`);
}

export async function loadCaasConfig(path) {
  const absolute = resolve(path);
  const config = validateCaasContract("config", JSON.parse(await readFile(absolute, "utf8")));
  const policy = config.identityPolicy;
  assertCaas(config.environment !== "production" || config.listen.port > 0, "CAAS_CONFIG_INVALID", "production listen port cannot be ephemeral");
  if (config.stateStore.type === "postgres") {
    assertCaas(config.stateStore.lockTimeoutMs <= config.stateStore.statementTimeoutMs,
      "CAAS_CONFIG_INVALID", "PostgreSQL lockTimeoutMs must not exceed statementTimeoutMs");
  }
  if (config.environment === "production") {
    assertCaas(config.stateStore.type === "postgres", "CAAS_CONFIG_INVALID", "production CaaS requires the PostgreSQL control store");
    assertCaas(config.stateStore.tls.mode === "verify-full", "CAAS_CONFIG_INVALID", "production PostgreSQL requires verify-full TLS");
    config.identityConfigPath = resolve(dirname(absolute), config.identityConfigPath);
    config.observabilityConfigPath = resolve(dirname(absolute), config.observabilityConfigPath);
    for (const field of ["certFile", "keyFile", "clientCaFile"]) config.tls[field] = resolve(dirname(absolute), config.tls[field]);
  }
  exactlyOneTemplateToken(policy.participantIdTemplate, "participantIdTemplate");
  const participant = policy.participantIdTemplate.replace("{tenantId}", "tenant-example");
  assertCaas(/^(?:did:|https:\/\/)[^\s\u0000-\u001f\u007f]+$/u.test(participant), "CAAS_CONFIG_INVALID", "participantIdTemplate must render a DID or HTTPS identifier");
  validateUrlTemplate(policy.namespaceTemplate, "namespaceTemplate", config.environment === "production");
  validateUrlTemplate(policy.endpointTemplate, "endpointTemplate", config.environment === "production");
  for (const [planId, plan] of Object.entries(config.connectorPlans)) {
    assertCaas(Object.hasOwn(config.provisioners, plan.adapterId), "CAAS_CONFIG_INVALID", "connector plan refers to an unknown provisioner", { planId });
    assertCaas(config.environment !== "production" || plan.protocolProfile.identityMode === "dcp", "CAAS_CONFIG_INVALID", "production connector plans require DCP identity mode", { planId });
    assertCaas(config.provisioners[plan.adapterId].type !== "kubernetes-edc" || plan.deploymentMode === "isolated",
      "CAAS_CONFIG_INVALID", "Kubernetes EDC provisioners require isolated tenant deployment mode", { planId });
  }
  for (const planId of config.controller.allowedConnectorPlanIds) {
    assertCaas(Object.hasOwn(config.connectorPlans, planId), "CAAS_CONFIG_INVALID", "controller scope refers to an unknown connector plan", { planId });
  }
  if (config.environment !== "production") {
    const actorClientIds = [config.adminClientId, config.controller.clientId];
    const actorKeyIds = [config.adminKeyId, config.controller.keyId];
    assertCaas(new Set(actorClientIds).size === actorClientIds.length && new Set(actorKeyIds).size === actorKeyIds.length, "CAAS_CONFIG_INVALID", "administrator and controller clientId/keyId values must differ");
  }
  assertCaas(config.environment !== "production" || Object.values(config.provisioners).every(({ type }) => type !== "dry-run-manifest"), "CAAS_CONFIG_INVALID", "production CaaS requires an operational Connector provisioner; intent-only dry-run provisioners are not production eligible");
  if (config.stateStore.type === "file") config.stateStore.path = resolve(dirname(absolute), config.stateStore.path);
  for (const provisioner of Object.values(config.provisioners)) {
    if (provisioner.type === "dry-run-manifest") provisioner.manifestDirectory = resolve(dirname(absolute), provisioner.manifestDirectory);
    if (provisioner.type === "kubernetes-edc") {
      const apiServer = new URL(provisioner.apiServer);
      assertCaas(apiServer.pathname === "/" && !apiServer.username && !apiServer.password && !apiServer.search && !apiServer.hash,
        "CAAS_CONFIG_INVALID", "Kubernetes apiServer must be an origin URL without credentials, query, or fragment");
      assertCaas(config.environment !== "production" || apiServer.protocol === "https:",
        "CAAS_CONFIG_INVALID", "production Kubernetes API access requires HTTPS");
      provisioner.authentication.tokenFile = resolve(dirname(absolute), provisioner.authentication.tokenFile);
      provisioner.authentication.caFile = resolve(dirname(absolute), provisioner.authentication.caFile);
      assertCaas(new Set([provisioner.ports.default, provisioner.ports.management, provisioner.ports.protocol, provisioner.ports.control]).size === 4
        && new Set([provisioner.ports.dataPlaneDefault, provisioner.ports.dataPlaneControl]).size === 2,
      "CAAS_CONFIG_INVALID", "Kubernetes EDC listener ports must be unique within each workload");
      assertCaas(config.environment !== "production" || (provisioner.replicas.controlPlane >= 2 && provisioner.replicas.dataPlane >= 2),
        "CAAS_CONFIG_INVALID", "production Kubernetes EDC workloads require at least two replicas per plane");
      assertCaas(config.environment !== "production" || provisioner.routing.mode === "gateway-api",
        "CAAS_CONFIG_INVALID", "production Kubernetes EDC provisioning requires an approved Gateway API route profile");
      assertCaas(config.environment !== "production" || (provisioner.supplyChainAdmission?.policyName
        && provisioner.supplyChainAdmission.attestationPredicateType === "https://data.molit.go.kr/attestations/release-bundle/v1"
        && /^[a-f0-9]{64}$/u.test(provisioner.supplyChainAdmission.trustAnchorSha256 ?? "")
        && provisioner.supplyChainAdmission.policyName !== provisioner.admissionPolicyName),
      "CAAS_CONFIG_INVALID", "production Kubernetes EDC provisioning requires a distinct signed release-attestation policy and pinned trust anchor");
      if (provisioner.routing.mode === "gateway-api") {
        validateHostnameTemplate(provisioner.routing.protocolHostnameTemplate, "Kubernetes routing.protocolHostnameTemplate");
        validateHostnameTemplate(provisioner.routing.dataPlaneHostnameTemplate, "Kubernetes routing.dataPlaneHostnameTemplate");
        assertCaas(provisioner.routing.protocolHostnameTemplate !== provisioner.routing.dataPlaneHostnameTemplate
          && provisioner.routing.protocolSectionName !== provisioner.routing.dataPlaneSectionName,
        "CAAS_CONFIG_INVALID", "Gateway API protocol and data-plane routes must use distinct hostnames and listener sections");
        const endpointHost = new URL(policy.endpointTemplate.replace("{tenantId}", "tenant-example")).hostname;
        assertCaas(endpointHost === provisioner.routing.protocolHostnameTemplate.replace("{tenantId}", "tenant-example"),
          "CAAS_CONFIG_INVALID", "Connector endpointTemplate hostname must match the Gateway API protocol hostname policy");
      }
      const componentVariables = { "control-plane": [], "data-plane": [] };
      for (const [bindingName, binding] of Object.entries(provisioner.secretBindings)) {
        exactlyOneTemplateToken(binding.secretNameTemplate, `Kubernetes secretBindings.${bindingName}.secretNameTemplate`);
        assertCaas(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(binding.secretNameTemplate.replace("{tenantId}", "tenant-example")),
          "CAAS_CONFIG_INVALID", `Kubernetes secretBindings.${bindingName}.secretNameTemplate must render a DNS label`);
        for (const key of binding.keys) for (const component of key.components) componentVariables[component].push(key.environmentVariable);
      }
      assertCaas(Object.values(componentVariables).every((values) => new Set(values).size === values.length),
        "CAAS_CONFIG_INVALID", "Kubernetes secret bindings must not assign one environment variable more than once per component");
    }
  }
  const directories = Object.values(config.provisioners).filter(({ type }) => type === "dry-run-manifest").map(({ manifestDirectory }) => manifestDirectory.toLowerCase());
  assertCaas(new Set(directories).size === directories.length, "CAAS_CONFIG_INVALID", "provisioners must not share a dry-run manifest directory");
  const planSelectors = Object.values(config.connectorPlans).map((plan) => JSON.stringify([plan.adapterId, plan.runtimeProfileRef, [...plan.requiredDeploymentSecretNames].sort()]));
  assertCaas(new Set(planSelectors).size === planSelectors.length, "CAAS_CONFIG_INVALID", "connector plans must have unique registration selectors");
  for (const [planId, plan] of Object.entries(config.connectorPlans)) {
    const provisioner = config.provisioners[plan.adapterId];
    if (provisioner.type !== "kubernetes-edc") continue;
    assertCaas(plan.requiredDeploymentSecretNames.every((name) => Object.hasOwn(provisioner.secretBindings, name)),
      "CAAS_CONFIG_INVALID", "Kubernetes provisioner lacks a binding for a required deployment secret", { planId });
    assertCaas(config.environment !== "production" || plan.databaseSchema,
      "CAAS_CONFIG_INVALID", "production Kubernetes EDC plans require a pinned database schema migration contract", { planId });
    if (!plan.databaseSchema) continue;
    const schema = plan.databaseSchema;
    const connection = schema.connection;
    const binding = provisioner.secretBindings[connection.secretBindingName];
    assertCaas(binding && plan.requiredDeploymentSecretNames.includes(connection.secretBindingName),
      "CAAS_CONFIG_INVALID", "database schema connection must use a required Kubernetes Secret binding", { planId });
    assertCaas(schema.migrationArtifact.version === schema.requiredVersion
      && schema.migrationTimeoutMs >= schema.pollIntervalMs * 3,
    "CAAS_CONFIG_INVALID", "database schema version, artifact version, or polling bounds are inconsistent", { planId });
    assertCaas(connection.mountPath.startsWith("/var/run/secrets/") && connection.sslMode === "verify-full",
      "CAAS_CONFIG_INVALID", "EDC database trust material must use a read-only Secret mount and verify-full TLS", { planId });
    const referencedKeys = [connection.controlUrlKey, connection.dataUrlKey, connection.usernameKey,
      connection.passwordKey, connection.caKey, connection.clientCertificateKey, connection.clientPrivateKeyKey].filter(Boolean);
    assertCaas(new Set(referencedKeys).size === referencedKeys.length,
      "CAAS_CONFIG_INVALID", "EDC database Secret key roles must be distinct", { planId });
    const hasEnvironmentBinding = (key, environmentVariable, components) => binding.keys.some((entry) => entry.key === key
      && entry.environmentVariable === environmentVariable
      && components.every((component) => entry.components.includes(component)));
    assertCaas(hasEnvironmentBinding(connection.controlUrlKey, "EDC_DATASOURCE_DEFAULT_URL", ["control-plane"])
      && hasEnvironmentBinding(connection.dataUrlKey, "EDC_DATASOURCE_DEFAULT_URL", ["data-plane"])
      && hasEnvironmentBinding(connection.usernameKey, "EDC_DATASOURCE_DEFAULT_USER", ["control-plane", "data-plane"])
      && hasEnvironmentBinding(connection.passwordKey, "EDC_DATASOURCE_DEFAULT_PASSWORD", ["control-plane", "data-plane"]),
    "CAAS_CONFIG_INVALID", "EDC database URL and credential Secret keys are not bound to both runtime planes", { planId });
  }
  return config;
}

export function assertCaasEnvironment(config, env = process.env) {
  const required = config.environment === "production"
    ? []
    : [config.adminSecretRef.slice("env://".length), config.controller?.secretRef?.slice("env://".length)].filter(Boolean);
  if (config.stateStore.type === "postgres") {
    required.push(config.stateStore.connectionStringEnv, config.stateStore.holderIdEnv);
    if (config.stateStore.tls.mode === "verify-full") {
      required.push(config.stateStore.tls.caEnv);
      if (config.stateStore.tls.certEnv) required.push(config.stateStore.tls.certEnv, config.stateStore.tls.keyEnv);
    }
  }
  for (const name of required) {
    assertCaas(typeof env[name] === "string" && env[name].length > 0,
      "CAAS_SECRET_ENV_MISSING", "required credential environment variable is not set", { details: { env: name } });
  }
}

export function tenantIdentity(policy, tenantId) {
  return {
    participantId: policy.participantIdTemplate.replace("{tenantId}", tenantId),
    namespace: policy.namespaceTemplate.replace("{tenantId}", tenantId),
    endpoint: policy.endpointTemplate.replace("{tenantId}", tenantId),
  };
}
