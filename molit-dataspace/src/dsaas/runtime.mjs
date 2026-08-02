import { ResilientHttpClient } from "../bridge-runtime/http-client.mjs";
import { Telemetry } from "../bridge-runtime/telemetry.mjs";
import { PostgresJsonStore, createPostgresPool } from "../control-store/postgres-json-store.mjs";
import { createNormalizedControlProjection } from "../control-store/normalized-projection.mjs";
import { PostgresTenantStore } from "../control-store/postgres-tenant-store.mjs";
import { PostgresOutbox } from "../control-store/postgres-outbox.mjs";
import { PostgresScopedControlStore } from "../control-store/postgres-scoped-control-store.mjs";
import { BoundedFileSecretProvider, OAuth2MtlsClientCredentials, ReloadingTlsContext, RotatingMtlsMaterial, createOperationalAuthenticator, createRotatingMtlsDispatcherFactory, loadOperationalIdentityConfig } from "../identity/index.mjs";
import { ManagementUsageRecorder, UsageMeter, createOperationalObservabilityBundle, createOperationalSecretResolver, loadOperationalObservabilityConfig, managementUsageMeterOptions } from "../observability/index.mjs";
import { OAuth2IntrospectionAuthenticator, OperationalDsaasAuthenticatorAdapter } from "./auth.mjs";
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

export async function createDsaasStateStore({
  config,
  env = process.env,
  poolFactory = createPostgresPool,
  projectionFactory = createNormalizedControlProjection,
  clock = () => new Date(),
}) {
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
  const store = config.environment === "production" ? new PostgresScopedControlStore({
    pool,
    leasePool,
    component: "dsaas",
    holderId,
    maxBytes: config.limits.maxStateBytes,
    maxAuditEvents: config.limits.maxAuditEvents ?? 1_000_000,
    maxIdempotencyRecords: config.limits.maxIdempotencyRecords,
    maxScopes: config.limits.maxDataspaces,
    statementTimeoutMs: config.stateStore.statementTimeoutMs,
    lockTimeoutMs: config.stateStore.lockTimeoutMs,
    clock,
    codes: {
      ...POSTGRES_CODES,
      capacity: "DSAAS_CAPACITY",
      conflict: "DSAAS_PARTICIPANT_IDENTIFIER_CONFLICT",
    },
  }) : new PostgresJsonStore({
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
    databaseContext: null,
    projection: projectionFactory({
      component: "dsaas",
      codes: {
        conflict: "DSAAS_STATE_PROJECTION_CONFLICT",
        invalid: "DSAAS_STATE_INVALID",
        migration: "DSAAS_STATE_MIGRATION_REQUIRED",
      },
    }),
  });
  try {
    await store.initialize();
    if (config.environment === "production") {
      const tenantStore = new PostgresTenantStore({
        pool,
        component: "dsaas",
        statementTimeoutMs: config.stateStore.statementTimeoutMs,
      });
      await tenantStore.initialize();
      Object.assign(store, { tenantStore });
    }
    return store;
  } catch (error) {
    await store.close().catch(() => {});
    throw error;
  }
}

export async function createDsaasRuntime({
  configPath,
  env = process.env,
  fetchImpl = fetch,
  telemetry = new Telemetry({ serviceName: "molit-dsaas-control-plane" }),
  poolFactory = createPostgresPool,
  revocationChecker,
  identityConfigLoader = loadOperationalIdentityConfig,
  authenticatorFactory = createOperationalAuthenticator,
  tlsRuntimeFactory = async (tlsConfig) => new ReloadingTlsContext(tlsConfig).initialize(),
  observabilityConfigLoader = loadOperationalObservabilityConfig,
  observabilityFactory = createOperationalObservabilityBundle,
  secretResolverFactory = createOperationalSecretResolver,
  outboxFactory = (options) => new PostgresOutbox(options),
  usageMeterFactory = (options) => new UsageMeter(options),
  usageRecorderFactory = (options) => new ManagementUsageRecorder(options),
}) {
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
  const caasMtls = config.caas.auth.type === "oauth2-client-credentials-mtls"
    ? new RotatingMtlsMaterial(config.caas.auth)
    : null;
  const http = new ResilientHttpClient({
    policy: config.network,
    telemetry,
    fetchImpl,
    timeoutMs: config.network.timeoutMs,
    maxResponseBytes: config.network.maxResponseBytes,
    retries: config.network.retries,
    ...(caasMtls ? { dispatcherFactory: createRotatingMtlsDispatcherFactory(caasMtls) } : {}),
  });
  let identityConfig = null;
  let tlsRuntime = null;
  let operationalAuthenticator = null;
  let authenticator;
  if (config.identityConfigPath) {
    identityConfig = await identityConfigLoader(config.identityConfigPath, { production: config.environment === "production" });
    operationalAuthenticator = authenticatorFactory({
      config: identityConfig,
      fetchImpl,
      revocationChecker,
      secretProvider: new BoundedFileSecretProvider(),
    });
    authenticator = new OperationalDsaasAuthenticatorAdapter({ authenticator: operationalAuthenticator });
  } else {
    authenticator = new OAuth2IntrospectionAuthenticator({ config: config.auth, http, env });
  }
  if (config.tls) tlsRuntime = await tlsRuntimeFactory(config.tls);
  const caasTokenProvider = caasMtls
    ? new OAuth2MtlsClientCredentials({ config: config.caas.auth, http, material: caasMtls })
    : null;
  let store;
  let observability = null;
  let usageMeter = null;
  let usageRecorder = null;
  try {
    store = await createDsaasStateStore({ config, env, poolFactory });
    if (config.environment === "production") {
      const observabilityConfig = await observabilityConfigLoader(config.observabilityConfigPath);
      assertRuntime(observabilityConfig.service.name === "molit-dsaas" && observabilityConfig.service.environment === "production",
        "DSAAS_OBSERVABILITY_CONFIG_INVALID", "DSaaS observability configuration is bound to a different service or environment");
      observability = await observabilityFactory({
        config: observabilityConfig,
        secretResolver: secretResolverFactory({ env }),
        fetchImpl,
      });
      usageMeter = usageMeterFactory({
        pool: store.pool,
        component: "dsaas",
        statementTimeoutMs: config.stateStore.statementTimeoutMs,
        ...managementUsageMeterOptions(observabilityConfig.usageMeter),
      });
      await usageMeter.initialize();
      usageRecorder = usageRecorderFactory({
        meter: usageMeter,
        telemetry: observability.telemetry,
        component: "dsaas",
        config: observabilityConfig.usageMeter,
      });
      const outbox = outboxFactory({
        pool: store.pool,
        component: "dsaas",
        workerId: `dsaas-worm-${store.holderId}`,
        eventTypes: ["audit.appended", "tenant.security.access"],
        statementTimeoutMs: config.stateStore.statementTimeoutMs,
        tenantService: { actorId: "service:dsaas-worm-dispatcher", discoverFromRegistry: true, registryMode: "scoped-authoritative" },
      });
      const dispatcher = observability.createAuditDispatcher({ outbox });
      await dispatcher.start();
      const usageOutbox = outboxFactory({
        pool: store.pool,
        component: "dsaas",
        workerId: `dsaas-usage-${store.holderId}`,
        eventTypes: ["usage.meter.recorded", "usage.meter.reprocessed"],
        maxAttempts: observabilityConfig.usageMeter.outbox.maxAttempts,
        statementTimeoutMs: config.stateStore.statementTimeoutMs,
        tenantService: { actorId: "service:dsaas-usage-dispatcher", discoverFromRegistry: true, registryMode: "scoped-authoritative" },
      });
      const usageDispatcher = observability.createUsageDispatcher({
        outbox: usageOutbox,
        batchSize: observabilityConfig.usageMeter.outbox.batchSize,
        leaseMs: observabilityConfig.usageMeter.outbox.leaseMs,
        pollIntervalMs: observabilityConfig.usageMeter.outbox.pollIntervalMs,
        retryBaseMs: observabilityConfig.usageMeter.outbox.retryBaseMs,
        retryMaxMs: observabilityConfig.usageMeter.outbox.retryMaxMs,
        healthIntervalMs: observabilityConfig.usageMeter.outbox.healthIntervalMs,
      });
      await usageDispatcher.start();
    }
  } catch (error) {
    await usageRecorder?.close({ timeoutMs: 0 }).catch(() => {});
    await observability?.close().catch(() => {});
    await store?.close?.().catch(() => {});
    await tlsRuntime?.close().catch(() => {});
    throw error;
  }
  const caas = new HttpCaasClient({ config: config.caas, http, env, tokenProvider: caasTokenProvider, tracer: observability?.tracer ?? null });
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
  let server;
  try {
    const operationalReadiness = observability ? async (options) => {
      const [identity, observation, usage] = await Promise.all([
        authenticator.readiness(options),
        observability.readiness(options),
        usageRecorder.readiness(),
      ]);
      return Object.freeze({ ready: identity.ready === true && observation.ready === true && usage.ready === true, identity, observation, usageMeter: usage });
    } : null;
    server = createDsaasServer({
      config,
      controlPlane,
      authenticator,
      scheduler,
      telemetry,
      tlsRuntime,
      tracer: observability?.tracer ?? null,
      operationalTelemetry: observability?.telemetry ?? null,
      observabilityReadiness: operationalReadiness,
      usageRecorder,
      tenantAccessStore: store.tenantStore ?? null,
    });
  } catch (error) {
    await usageRecorder?.close({ timeoutMs: 0 }).catch(() => {});
    await observability?.close().catch(() => {});
    await store.close?.().catch(() => {});
    await tlsRuntime?.close().catch(() => {});
    throw error;
  }
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
        await usageRecorder?.close({ timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (error) { failure ??= error; }
      try {
        await observability?.close({ timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (error) { failure ??= error; }
      try {
        await store.close?.({ deadline, timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (error) { failure ??= error; }
      if (failure) throw failure;
    })();
    return closePromise;
  };
  return Object.freeze({ approvalDecisionRegistry, close, config, controlPlane, identityConfig, observability, scheduler, server, serviceRegistry, store, telemetry, tlsRuntime, usageMeter, usageRecorder });
}
