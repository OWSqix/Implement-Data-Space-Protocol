import { PostgresJsonStore, createPostgresPool } from "../control-store/postgres-json-store.mjs";
import { PostgresTenantStore } from "../control-store/postgres-tenant-store.mjs";
import { PostgresOutbox } from "../control-store/postgres-outbox.mjs";
import { PostgresScopedControlStore } from "../control-store/postgres-scoped-control-store.mjs";
import { BoundedFileSecretProvider, ReloadingTlsContext, createOperationalAuthenticator, loadOperationalIdentityConfig } from "../identity/index.mjs";
import { ManagementUsageRecorder, UsageMeter, createOperationalObservabilityBundle, createOperationalSecretResolver, loadOperationalObservabilityConfig, managementUsageMeterOptions } from "../observability/index.mjs";
import { assertCaasEnvironment, loadCaasConfig } from "./config.mjs";
import { createCaasProvisioners } from "./provisioner.mjs";
import { CaaSControlService } from "./service.mjs";
import { CaaSAuthorizer } from "./auth.mjs";
import { createCaaSHttpServer } from "./server.mjs";
import { CaaSError } from "./errors.mjs";
import { FileCaasStore, emptyCaasState, sealCaasState, validateCaasState } from "./store.mjs";

const POSTGRES_CODES = Object.freeze({
  aborted: "CAAS_STATE_ABORTED",
  closed: "CAAS_STATE_CLOSED",
  commitUnknown: "CAAS_STATE_COMMIT_UNKNOWN",
  fenceLost: "CAAS_RECONCILE_FENCE_LOST",
  invalid: "CAAS_STATE_INVALID",
  locked: "CAAS_STATE_LOCKED",
  migration: "CAAS_STATE_MIGRATION_REQUIRED",
  missing: "CAAS_STATE_MISSING",
  resourceLocked: "CAAS_TENANT_BUSY",
  timeout: "CAAS_STATE_TIMEOUT",
  tooLarge: "CAAS_STATE_TOO_LARGE",
  unavailable: "CAAS_STATE_UNAVAILABLE",
});

export async function createCaasStateStore({ config, env = process.env, poolFactory = createPostgresPool, clock = () => new Date() }) {
  if (config.stateStore.type === "file") {
    const store = new FileCaasStore({
      path: config.stateStore.path,
      maxBytes: config.limits.maxStateBytes,
      maxAuditEvents: config.limits.maxAuditEvents,
      clock,
    });
    await store.initialize();
    return store;
  }
  const { holderId, pool, leasePool } = await poolFactory({
    config: config.stateStore,
    env,
    errorCodes: {
      configInvalid: "CAAS_CONFIG_INVALID",
      secretMissing: "CAAS_SECRET_ENV_MISSING",
    },
  });
  const store = config.environment === "production" ? new PostgresScopedControlStore({
    pool,
    leasePool,
    component: "caas",
    holderId,
    maxBytes: config.limits.maxStateBytes,
    maxAuditEvents: config.limits.maxAuditEvents,
    maxIdempotencyRecords: config.limits.maxIdempotencyRecords ?? 1_000_000,
    maxScopes: config.limits.maxTenants ?? 10_000,
    statementTimeoutMs: config.stateStore.statementTimeoutMs,
    lockTimeoutMs: config.stateStore.lockTimeoutMs,
    clock,
    codes: {
      ...POSTGRES_CODES,
      capacity: "CAAS_CAPACITY",
      conflict: "CAAS_IDENTITY_COLLISION",
    },
    preserveError: (error) => error instanceof CaaSError,
  }) : new PostgresJsonStore({
    pool,
    leasePool,
    component: "caas",
    holderId,
    initialState: emptyCaasState,
    validateState: validateCaasState,
    sealState: (state, at) => sealCaasState(state, {
      maxAuditEvents: config.limits.maxAuditEvents,
      now: new Date(at),
    }),
    maxBytes: config.limits.maxStateBytes,
    statementTimeoutMs: config.stateStore.statementTimeoutMs,
    lockTimeoutMs: config.stateStore.lockTimeoutMs,
    clock,
    codes: POSTGRES_CODES,
    preserveError: (error) => error instanceof CaaSError,
    databaseContext: null,
    projection: null,
  });
  if (config.environment !== "production") Object.assign(store, { kind: "postgres", supportsDistributedFencing: true });
  try {
    await store.initialize();
    if (config.environment === "production") {
      const tenantStore = new PostgresTenantStore({
        pool,
        component: "caas",
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

export async function createCaaSRuntime({
  configPath,
  env = process.env,
  poolFactory = createPostgresPool,
  serverFactory = createCaaSHttpServer,
  fetchImpl = fetch,
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
  const config = await loadCaasConfig(configPath);
  assertCaasEnvironment(config, env);
  let identityConfig = null;
  let operationalAuthenticator = null;
  let tlsRuntime = null;
  let observability = null;
  let usageMeter = null;
  let usageRecorder = null;
  if (config.environment === "production") {
    identityConfig = await identityConfigLoader(config.identityConfigPath, { production: true });
    operationalAuthenticator = authenticatorFactory({
      config: identityConfig,
      fetchImpl,
      revocationChecker,
      secretProvider: new BoundedFileSecretProvider(),
    });
    tlsRuntime = await tlsRuntimeFactory(config.tls);
  }
  const provisioners = createCaasProvisioners(config);
  let store;
  try {
    store = await createCaasStateStore({ config, env, poolFactory });
    if (config.environment === "production") {
      const observabilityConfig = await observabilityConfigLoader(config.observabilityConfigPath);
      assertCaas(observabilityConfig.service.name === "molit-caas" && observabilityConfig.service.environment === "production",
        "CAAS_OBSERVABILITY_CONFIG_INVALID", "CaaS observability configuration is bound to a different service or environment");
      observability = await observabilityFactory({
        config: observabilityConfig,
        secretResolver: secretResolverFactory({ env }),
        fetchImpl,
      });
      usageMeter = usageMeterFactory({
        pool: store.pool,
        component: "caas",
        statementTimeoutMs: config.stateStore.statementTimeoutMs,
        ...managementUsageMeterOptions(observabilityConfig.usageMeter),
      });
      await usageMeter.initialize();
      usageRecorder = usageRecorderFactory({
        meter: usageMeter,
        telemetry: observability.telemetry,
        component: "caas",
        config: observabilityConfig.usageMeter,
      });
      const outbox = outboxFactory({
        pool: store.pool,
        component: "caas",
        workerId: `caas-worm-${store.holderId}`,
        eventTypes: ["audit.appended", "tenant.security.access"],
        statementTimeoutMs: config.stateStore.statementTimeoutMs,
        tenantService: { actorId: "service:caas-worm-dispatcher", discoverFromRegistry: true, registryMode: "scoped-authoritative" },
      });
      const dispatcher = observability.createAuditDispatcher({ outbox });
      await dispatcher.start();
      const usageOutbox = outboxFactory({
        pool: store.pool,
        component: "caas",
        workerId: `caas-usage-${store.holderId}`,
        eventTypes: ["usage.meter.recorded", "usage.meter.reprocessed"],
        maxAttempts: observabilityConfig.usageMeter.outbox.maxAttempts,
        statementTimeoutMs: config.stateStore.statementTimeoutMs,
        tenantService: { actorId: "service:caas-usage-dispatcher", discoverFromRegistry: true, registryMode: "scoped-authoritative" },
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
    await store?.close().catch(() => {});
    await tlsRuntime?.close().catch(() => {});
    throw error;
  }
  let service;
  let authorizer;
  let server;
  try {
    service = new CaaSControlService({ config, provisioners, store, env });
    authorizer = new CaaSAuthorizer({ config, store, env, authenticator: operationalAuthenticator });
    const operationalReadiness = observability ? async (options) => {
      const [identity, observation, usage] = await Promise.all([
        operationalAuthenticator.readiness(options),
        observability.readiness(options),
        usageRecorder.readiness(),
      ]);
      return Object.freeze({ ready: identity.ready === true && observation.ready === true && usage.ready === true, identity, observation, usageMeter: usage });
    } : null;
    server = serverFactory({
      config,
      service,
      authorizer,
      tlsRuntime,
      tracer: observability?.tracer ?? null,
      operationalTelemetry: observability?.telemetry ?? null,
      observabilityReadiness: operationalReadiness,
      usageRecorder,
      tenantAccessStore: store.tenantStore ?? null,
    });
    server.caasSetReady(false);
  } catch (error) {
    await usageRecorder?.close({ timeoutMs: 0 }).catch(() => {});
    await observability?.close().catch(() => {});
    await store.close().catch(() => {});
    await tlsRuntime?.close().catch(() => {});
    throw error;
  }
  let started = false;
  let closePromise = null;
  const close = (options = {}) => {
    if (closePromise) return closePromise;
    const budgetMs = Number.isFinite(options.timeoutMs)
      ? Math.max(0, options.timeoutMs)
      : config.limits.gracefulShutdownMs ?? 10_000;
    const deadline = Number.isFinite(options.deadline) ? Math.max(0, options.deadline) : Date.now() + budgetMs;
    closePromise = (async () => {
      let failure;
      try {
        await server.closeGracefully({ deadline, timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (error) { failure = error; }
      try {
        await usageRecorder?.close({ timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (error) { failure ??= error; }
      try {
        await observability?.close({ timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (error) { failure ??= error; }
      try {
        await store.close({ deadline, timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (error) { failure ??= error; }
      started = false;
      if (failure) throw failure;
    })();
    return closePromise;
  };
  return {
    config,
    identityConfig,
    provisioners,
    store,
    service,
    authorizer,
    server,
    tlsRuntime,
    observability,
    usageMeter,
    usageRecorder,
    async start() {
      if (started || server.listening) throw new CaaSError("CAAS_ALREADY_STARTED", "CaaS runtime is already started");
      try {
        if (operationalAuthenticator) {
          await operationalAuthenticator.initialize();
          const identity = await operationalAuthenticator.readiness({ probe: false });
          assertCaas(identity.ready === true, "CAAS_PRODUCTION_AUTH_NOT_READY", "CaaS identity provider is not ready", { status: 503 });
        }
        await service.readiness();
        if (observability) {
          const [observation, usage] = await Promise.all([observability.readiness(), usageRecorder.readiness()]);
          const status = { ready: observation.ready === true && usage.ready === true };
          assertCaas(status.ready === true, "CAAS_OBSERVABILITY_NOT_READY", "CaaS operational observability is not ready", { status: 503 });
        }
        await new Promise((resolve, reject) => {
          const onError = (error) => {
            server.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            server.off("error", onError);
            resolve();
          };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(config.listen.port, config.listen.host);
        });
        started = true;
        server.caasSetReady(true);
        return server.address();
      } catch (error) {
        await close({ timeoutMs: 0 }).catch(() => {});
        throw error;
      }
    },
    close,
  };
}
