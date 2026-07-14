import { ResilientHttpClient } from "../bridge-runtime/http-client.mjs";
import { Telemetry } from "../bridge-runtime/telemetry.mjs";
import { PostgresJsonStore, createPostgresPool } from "../control-store/postgres-json-store.mjs";
import { OAuth2IntrospectionAuthenticator } from "./auth.mjs";
import { loadApprovalDecisionRegistry } from "./approval-registry.mjs";
import { HttpCaasClient } from "./caas-client.mjs";
import { assertDsaasEnvironment, loadDsaasConfig } from "./config.mjs";
import { DsaasControlPlane } from "./service.mjs";
import { loadServiceRegistry } from "./service-registry.mjs";
import { createDsaasServer } from "./server.mjs";
import { DsaasReconcileScheduler } from "./scheduler.mjs";
import { FileDsaasStore, emptyDsaasState, sealDsaasState, validateDsaasState } from "./store.mjs";

const POSTGRES_CODES = Object.freeze({
  aborted: "DSAAS_STATE_ABORTED",
  closed: "DSAAS_STATE_CLOSED",
  commitUnknown: "DSAAS_STATE_COMMIT_UNKNOWN",
  fenceLost: "DSAAS_RECONCILE_FENCE_LOST",
  invalid: "DSAAS_STATE_INVALID",
  locked: "DSAAS_STATE_LOCKED",
  migration: "DSAAS_STATE_MIGRATION_REQUIRED",
  missing: "DSAAS_STATE_MISSING",
  resourceLocked: "DSAAS_RECONCILE_IN_PROGRESS",
  timeout: "DSAAS_STATE_TIMEOUT",
  tooLarge: "DSAAS_STATE_TOO_LARGE",
  unavailable: "DSAAS_STATE_UNAVAILABLE",
});

export async function createDsaasStateStore({ config, env = process.env, poolFactory = createPostgresPool }) {
  if (config.stateStore.type === "file") {
    return new FileDsaasStore({ path: config.stateStore.path, maxBytes: config.limits.maxStateBytes });
  }
  const { holderId, pool, leasePool } = await poolFactory({
    config: config.stateStore,
    env,
    errorCodes: {
      configInvalid: "DSAAS_CONFIG_INVALID",
      secretMissing: "DSAAS_SECRET_ENV_MISSING",
    },
  });
  const store = new PostgresJsonStore({
    pool,
    leasePool,
    component: "dsaas",
    holderId,
    initialState: emptyDsaasState,
    validateState: validateDsaasState,
    sealState: sealDsaasState,
    maxBytes: config.limits.maxStateBytes,
    statementTimeoutMs: config.stateStore.statementTimeoutMs,
    lockTimeoutMs: config.stateStore.lockTimeoutMs,
    codes: POSTGRES_CODES,
  });
  try {
    await store.initialize();
    return store;
  } catch (error) {
    await store.close().catch(() => {});
    throw error;
  }
}

export async function createDsaasRuntime({ configPath, env = process.env, fetchImpl = fetch, telemetry = new Telemetry({ serviceName: "molit-dsaas-control-plane" }), poolFactory = createPostgresPool }) {
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
  const store = await createDsaasStateStore({ config, env, poolFactory });
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
  let closePromise = null;
  const close = (options = {}) => {
    if (closePromise) return closePromise;
    const budgetMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : config.limits.gracefulShutdownMs;
    const deadline = Number.isFinite(options.deadline) ? Math.max(0, options.deadline) : Date.now() + budgetMs;
    closePromise = (async () => {
      let failure;
      try {
        await server.close({ deadline, timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (error) { failure = error; }
      try {
        await store.close?.({ deadline, timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (error) { failure ??= error; }
      if (failure) throw failure;
    })();
    return closePromise;
  };
  return Object.freeze({ approvalDecisionRegistry, close, config, controlPlane, scheduler, server, serviceRegistry, store, telemetry });
}
