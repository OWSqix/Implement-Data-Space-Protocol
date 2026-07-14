import { ResilientHttpClient } from "../bridge-runtime/http-client.mjs";
import { Telemetry } from "../bridge-runtime/telemetry.mjs";
import { OAuth2IntrospectionAuthenticator } from "./auth.mjs";
import { loadApprovalDecisionRegistry } from "./approval-registry.mjs";
import { HttpCaasClient } from "./caas-client.mjs";
import { assertDsaasEnvironment, loadDsaasConfig } from "./config.mjs";
import { DsaasControlPlane } from "./service.mjs";
import { loadServiceRegistry } from "./service-registry.mjs";
import { createDsaasServer } from "./server.mjs";
import { DsaasReconcileScheduler } from "./scheduler.mjs";
import { FileDsaasStore } from "./store.mjs";

export async function createDsaasRuntime({ configPath, env = process.env, fetchImpl = fetch, telemetry = new Telemetry({ serviceName: "molit-dsaas-control-plane" }) }) {
  const config = await loadDsaasConfig(configPath);
  assertDsaasEnvironment(config, env);
  const serviceRegistryProvider = () => loadServiceRegistry(config.serviceRegistryPath, config.serviceRegistrySha256, {
    maxAgeSeconds: config.serviceRegistryMaxAgeSeconds,
  });
  const serviceRegistry = await serviceRegistryProvider();
  const approvalDecisionRegistryProvider = () => loadApprovalDecisionRegistry(config.approvalDecisionRegistryPath, config.approvalDecisionRegistrySha256, {
    maxAgeSeconds: config.approvalDecisionRegistryMaxAgeSeconds,
  });
  const approvalDecisionRegistry = await approvalDecisionRegistryProvider();
  const http = new ResilientHttpClient({
    policy: config.network,
    telemetry,
    fetchImpl,
    timeoutMs: config.network.timeoutMs,
    maxResponseBytes: config.network.maxResponseBytes,
    retries: config.network.retries,
  });
  const authenticator = new OAuth2IntrospectionAuthenticator({ config: config.auth, http, env });
  const caas = new HttpCaasClient({ config: config.caas, http, env });
  const store = new FileDsaasStore({ path: config.statePath, maxBytes: config.limits.maxStateBytes });
  const controlPlane = new DsaasControlPlane({
    store,
    caas,
    serviceRegistry,
    serviceRegistryProvider,
    approvalDecisionRegistry,
    approvalDecisionRegistryProvider,
    approvedMetadataProfiles: config.approvedMetadataProfiles,
    approvedGovernanceBundles: config.approvedGovernanceBundles,
    connectorPlanIds: config.connectorPlanIds,
    allowedNamespaceOrigins: config.allowedNamespaceOrigins,
    allowedIdentityModes: config.environment === "production" ? ["dcp"] : ["dcp", "test-token"],
    maxDataspaces: config.limits.maxDataspaces,
    maxParticipantsPerDataspace: config.limits.maxParticipantsPerDataspace,
    maxIdempotencyRecords: config.limits.maxIdempotencyRecords,
    maxReconcileSupersessions: config.limits.maxReconcileSupersessions,
    schedulerIntervalMs: config.reconcileScheduler.intervalMs,
    caasRetryBaseMs: config.reconcileScheduler.caasRetryBaseMs,
    caasRetryMaxMs: config.reconcileScheduler.caasRetryMaxMs,
  });
  const scheduler = new DsaasReconcileScheduler({ controlPlane, config: config.reconcileScheduler, telemetry });
  const server = createDsaasServer({ config, controlPlane, authenticator, scheduler, telemetry });
  return Object.freeze({ approvalDecisionRegistry, config, controlPlane, scheduler, server, serviceRegistry, telemetry });
}
