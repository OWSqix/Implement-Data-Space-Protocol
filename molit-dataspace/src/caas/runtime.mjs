import { PostgresJsonStore, createPostgresPool } from "../control-store/postgres-json-store.mjs";
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
  const store = new PostgresJsonStore({
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
  });
  Object.assign(store, { kind: "postgres", supportsDistributedFencing: true });
  try {
    await store.initialize();
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
}) {
  const config = await loadCaasConfig(configPath);
  assertCaasEnvironment(config, env);
  const provisioners = createCaasProvisioners(config);
  const store = await createCaasStateStore({ config, env, poolFactory });
  let service;
  let authorizer;
  let server;
  try {
    service = new CaaSControlService({ config, provisioners, store, env });
    authorizer = new CaaSAuthorizer({ config, store, env });
    server = serverFactory({ config, service, authorizer });
    server.caasSetReady(false);
  } catch (error) {
    await store.close().catch(() => {});
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
        await store.close({ deadline, timeoutMs: Math.max(0, deadline - Date.now()) });
      } catch (error) { failure ??= error; }
      started = false;
      if (failure) throw failure;
    })();
    return closePromise;
  };
  return {
    config,
    provisioners,
    store,
    service,
    authorizer,
    server,
    async start() {
      if (started || server.listening) throw new CaaSError("CAAS_ALREADY_STARTED", "CaaS runtime is already started");
      try {
        await service.readiness();
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
