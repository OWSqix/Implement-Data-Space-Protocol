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

export async function loadCaasConfig(path) {
  const absolute = resolve(path);
  const config = validateCaasContract("config", JSON.parse(await readFile(absolute, "utf8")));
  const policy = config.identityPolicy;
  assertCaas(config.environment !== "production" || config.listen.port > 0, "CAAS_CONFIG_INVALID", "production listen port cannot be ephemeral");
  assertCaas(config.environment !== "production" || ["127.0.0.1", "::1"].includes(config.listen.host), "CAAS_CONFIG_INVALID", "production CaaS must bind its plain HTTP listener to loopback behind the approved TLS boundary");
  if (config.stateStore.type === "postgres") {
    assertCaas(config.stateStore.lockTimeoutMs <= config.stateStore.statementTimeoutMs,
      "CAAS_CONFIG_INVALID", "PostgreSQL lockTimeoutMs must not exceed statementTimeoutMs");
  }
  if (config.environment === "production") {
    assertCaas(config.stateStore.type === "postgres", "CAAS_CONFIG_INVALID", "production CaaS requires the PostgreSQL control store");
    assertCaas(config.stateStore.tls.mode === "verify-full", "CAAS_CONFIG_INVALID", "production PostgreSQL requires verify-full TLS");
  }
  exactlyOneTemplateToken(policy.participantIdTemplate, "participantIdTemplate");
  const participant = policy.participantIdTemplate.replace("{tenantId}", "tenant-example");
  assertCaas(/^(?:did:|https:\/\/)[^\s\u0000-\u001f\u007f]+$/u.test(participant), "CAAS_CONFIG_INVALID", "participantIdTemplate must render a DID or HTTPS identifier");
  validateUrlTemplate(policy.namespaceTemplate, "namespaceTemplate", config.environment === "production");
  validateUrlTemplate(policy.endpointTemplate, "endpointTemplate", config.environment === "production");
  for (const [planId, plan] of Object.entries(config.connectorPlans)) {
    assertCaas(Object.hasOwn(config.provisioners, plan.adapterId), "CAAS_CONFIG_INVALID", "connector plan refers to an unknown provisioner", { planId });
    assertCaas(config.environment !== "production" || plan.protocolProfile.identityMode === "dcp", "CAAS_CONFIG_INVALID", "production connector plans require DCP identity mode", { planId });
  }
  for (const planId of config.controller.allowedConnectorPlanIds) {
    assertCaas(Object.hasOwn(config.connectorPlans, planId), "CAAS_CONFIG_INVALID", "controller scope refers to an unknown connector plan", { planId });
  }
  const actorClientIds = [config.adminClientId, config.controller.clientId];
  const actorKeyIds = [config.adminKeyId, config.controller.keyId];
  assertCaas(new Set(actorClientIds).size === actorClientIds.length && new Set(actorKeyIds).size === actorKeyIds.length, "CAAS_CONFIG_INVALID", "administrator and controller clientId/keyId values must differ");
  assertCaas(config.environment !== "production" || Object.values(config.provisioners).every(({ type }) => type !== "dry-run-manifest"), "CAAS_CONFIG_INVALID", "production CaaS requires an operational Connector provisioner; intent-only dry-run provisioners are not production eligible");
  if (config.stateStore.type === "file") config.stateStore.path = resolve(dirname(absolute), config.stateStore.path);
  for (const provisioner of Object.values(config.provisioners)) provisioner.manifestDirectory = resolve(dirname(absolute), provisioner.manifestDirectory);
  const directories = Object.values(config.provisioners).map(({ manifestDirectory }) => manifestDirectory.toLowerCase());
  assertCaas(new Set(directories).size === directories.length, "CAAS_CONFIG_INVALID", "provisioners must not share a dry-run manifest directory");
  const planSelectors = Object.values(config.connectorPlans).map((plan) => JSON.stringify([plan.adapterId, plan.runtimeProfileRef, [...plan.requiredDeploymentSecretNames].sort()]));
  assertCaas(new Set(planSelectors).size === planSelectors.length, "CAAS_CONFIG_INVALID", "connector plans must have unique registration selectors");
  return config;
}

export function assertCaasEnvironment(config, env = process.env) {
  const required = [config.adminSecretRef.slice("env://".length), config.controller?.secretRef?.slice("env://".length)].filter(Boolean);
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
