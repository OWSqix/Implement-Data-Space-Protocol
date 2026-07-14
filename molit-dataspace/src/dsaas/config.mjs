import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { assertCleanUri } from "./contracts.mjs";

export async function loadDsaasConfig(path) {
  const absolutePath = resolve(path);
  const config = JSON.parse(await readFile(absolutePath, "utf8"));
  const schema = JSON.parse(await readFile(new URL("../../contracts/dsaas-runtime-config.v1.schema.json", import.meta.url), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(config)) throw new RuntimeError("DSAAS_CONFIG_INVALID", "DSaaS runtime configuration is invalid", { errors: validate.errors });

  const publicUrl = new URL(config.publicOrigin);
  const caasUrl = new URL(config.caas.baseUrl);
  const introspectionUrl = new URL(config.auth.introspectionUrl);
  const ensurePath = config.caas.ensurePath;
  assertRuntime(publicUrl.origin === config.publicOrigin && !publicUrl.username && !publicUrl.password, "DSAAS_CONFIG_INVALID", "publicOrigin must be a bare origin without userinfo");
  assertRuntime(!caasUrl.username && !caasUrl.password && !introspectionUrl.username && !introspectionUrl.password, "DSAAS_CONFIG_INVALID", "outbound endpoints must not contain URL userinfo");
  assertCleanUri(config.caas.baseUrl, "$.caas.baseUrl", { protocols: ["http:", "https:"] });
  assertCleanUri(config.auth.introspectionUrl, "$.auth.introspectionUrl", { protocols: ["http:", "https:"] });
  const issuerUrl = assertCleanUri(config.auth.issuer, "$.auth.issuer", { protocols: ["http:", "https:"] });
  assertRuntime(caasUrl.href === `${caasUrl.origin}/`, "DSAAS_CONFIG_INVALID", "caas.baseUrl must be a bare origin with one trailing slash");
  for (const [index, origin] of config.network.allowedOrigins.entries()) {
    const url = assertCleanUri(origin, `$.network.allowedOrigins[${index}]`, { protocols: ["http:", "https:"] });
    assertRuntime(url.origin === origin, "DSAAS_CONFIG_INVALID", "network.allowedOrigins entries must be bare origins");
  }
  for (const [index, origin] of config.network.privateOrigins.entries()) {
    const url = assertCleanUri(origin, `$.network.privateOrigins[${index}]`, { protocols: ["http:", "https:"] });
    assertRuntime(url.origin === origin, "DSAAS_CONFIG_INVALID", "network.privateOrigins entries must be bare origins");
  }
  for (const [index, origin] of config.allowedNamespaceOrigins.entries()) {
    const url = assertCleanUri(origin, `$.allowedNamespaceOrigins[${index}]`, { protocols: ["https:"] });
    assertRuntime(url.origin === origin, "DSAAS_CONFIG_INVALID", "allowedNamespaceOrigins entries must be bare HTTPS origins");
  }
  for (const [collection, artifacts] of [["approvedMetadataProfiles", config.approvedMetadataProfiles], ["approvedGovernanceBundles", config.approvedGovernanceBundles]]) {
    for (const [index, artifact] of artifacts.entries()) assertCleanUri(artifact.iri, `$.${collection}[${index}].iri`, { protocols: ["https:"] });
  }
  assertRuntime(config.allowedHosts.includes(publicUrl.host), "DSAAS_CONFIG_INVALID", "allowedHosts must contain the publicOrigin authority");
  assertRuntime(config.network.allowedOrigins.includes(caasUrl.origin) && config.network.allowedOrigins.includes(introspectionUrl.origin), "DSAAS_CONFIG_INVALID", "CaaS and introspection origins must be in network.allowedOrigins");
  const joinedEnsureUrl = new URL(ensurePath, caasUrl.origin);
  assertRuntime(ensurePath.startsWith("/") && !ensurePath.startsWith("//")
    && !/[\\?#\s\u0000-\u001f\u007f]/u.test(ensurePath)
    && !/%(?:2f|5c)/iu.test(ensurePath)
    && joinedEnsureUrl.origin === caasUrl.origin
    && joinedEnsureUrl.pathname === ensurePath
    && joinedEnsureUrl.search === "" && joinedEnsureUrl.hash === "",
  "DSAAS_CONFIG_INVALID", "caas.ensurePath must be one unambiguous absolute path without authority, query, fragment, traversal, or encoded separators");
  assertRuntime(config.reconcileScheduler.readinessMaxLagMs >= config.reconcileScheduler.intervalMs * 2, "DSAAS_CONFIG_INVALID", "reconcile scheduler readinessMaxLagMs must cover at least two intervals");
  assertRuntime(config.reconcileScheduler.caasRetryMaxMs >= config.reconcileScheduler.caasRetryBaseMs, "DSAAS_CONFIG_INVALID", "CaaS retry maximum backoff must be greater than or equal to the base backoff");
  if (config.stateStore.type === "postgres") {
    assertRuntime(config.stateStore.lockTimeoutMs <= config.stateStore.statementTimeoutMs, "DSAAS_CONFIG_INVALID", "PostgreSQL lockTimeoutMs must not exceed statementTimeoutMs");
  }
  if (config.environment === "production") {
    assertRuntime(["127.0.0.1", "::1"].includes(config.listenHost), "DSAAS_CONFIG_INVALID", "production DSaaS must bind its plain HTTP listener to loopback behind the approved TLS boundary");
    assertRuntime(publicUrl.protocol === "https:" && caasUrl.protocol === "https:" && introspectionUrl.protocol === "https:" && issuerUrl.protocol === "https:", "DSAAS_CONFIG_INVALID", "production endpoints and issuer require HTTPS");
    assertRuntime(config.network.allowHttp === false && config.network.allowPrivate === false, "DSAAS_CONFIG_INVALID", "production forbids HTTP and the broad private-network bypass");
    assertRuntime(config.stateStore.type === "postgres", "DSAAS_CONFIG_INVALID", "production DSaaS requires the PostgreSQL control store");
    assertRuntime(config.stateStore.tls.mode === "verify-full", "DSAAS_CONFIG_INVALID", "production PostgreSQL requires verify-full TLS");
  }
  if (config.stateStore.type === "file") config.stateStore.path = resolve(dirname(absolutePath), config.stateStore.path);
  config.serviceRegistryPath = resolve(dirname(absolutePath), config.serviceRegistryPath);
  config.approvalDecisionRegistryPath = resolve(dirname(absolutePath), config.approvalDecisionRegistryPath);
  return config;
}

export function assertDsaasEnvironment(config, env = process.env) {
  const required = [config.auth.clientIdEnv, config.auth.clientSecretEnv, config.caas.auth.env];
  if (config.stateStore.type === "postgres") {
    required.push(config.stateStore.connectionStringEnv, config.stateStore.holderIdEnv);
    if (config.stateStore.tls.mode === "verify-full") {
      required.push(config.stateStore.tls.caEnv);
      if (config.stateStore.tls.certEnv) required.push(config.stateStore.tls.certEnv, config.stateStore.tls.keyEnv);
    }
  }
  for (const name of required) {
    assertRuntime(typeof env[name] === "string" && env[name].length > 0, "DSAAS_SECRET_ENV_MISSING", "required credential environment variable is not set", { env: name });
  }
}
