import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";

import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";

const { Client, Pool } = pg;

const MIGRATION_COMPONENT = "postgres-json-store";
const MIGRATION_VERSION = 1;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/u;
const POOL_HEALTH = new WeakMap();
const ABORT_PENDING_CONNECTIONS = Symbol("molit.abortPendingPostgresConnections");

const DEFAULT_CODES = Object.freeze({
  aborted: "CONTROL_STORE_ABORTED",
  closed: "CONTROL_STORE_CLOSED",
  commitUnknown: "CONTROL_STORE_COMMIT_UNKNOWN",
  fenceLost: "CONTROL_STORE_FENCE_LOST",
  invalid: "CONTROL_STORE_INVALID",
  locked: "CONTROL_STORE_LOCKED",
  migration: "CONTROL_STORE_MIGRATION_REQUIRED",
  missing: "CONTROL_STORE_STATE_MISSING",
  resourceLocked: "CONTROL_STORE_RESOURCE_LOCKED",
  timeout: "CONTROL_STORE_TIMEOUT",
  tooLarge: "CONTROL_STORE_STATE_TOO_LARGE",
  unavailable: "CONTROL_STORE_UNAVAILABLE",
});

function throwIfAborted(signal, code, preserveError = () => false) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof RuntimeError || preserveError(signal.reason)) throw signal.reason;
  throw new RuntimeError(code, "control-store operation was aborted", { causeCode: errorCode(signal.reason) ?? signal.reason?.name ?? "ABORTED" });
}

function postgresCause(error) {
  if (error instanceof RuntimeError) return error;
  return error;
}

function errorCode(error) {
  try { return error?.code; } catch { return undefined; }
}

function mapPostgresError(error, codes, { commitStarted = false, migrationCheck = false } = {}) {
  if (error instanceof RuntimeError) return error;
  const code = errorCode(error);
  if (migrationCheck && ["3F000", "42P01", "42703"].includes(code)) {
    return new RuntimeError(codes.migration, "PostgreSQL control-store migration is missing or incompatible", { causeCode: code });
  }
  if (commitStarted) {
    return new RuntimeError(codes.commitUnknown, "PostgreSQL transaction outcome is unknown after COMMIT started", { causeCode: code ?? "POSTGRES_ERROR" });
  }
  if (code === "55P03") return new RuntimeError(codes.locked, "PostgreSQL control-store lock timeout elapsed", { causeCode: code });
  if (code === "57014") return new RuntimeError(codes.timeout, "PostgreSQL control-store statement timeout elapsed", { causeCode: code });
  return new RuntimeError(codes.unavailable, "PostgreSQL control-store request failed", { causeCode: code ?? "POSTGRES_ERROR" });
}

function stateValue(value) {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { throw new RuntimeError(DEFAULT_CODES.invalid, "PostgreSQL JSONB state is not valid JSON"); }
  }
  return structuredClone(value);
}

function jsonBytes(value) {
  const body = JSON.stringify(value);
  return { body, bytes: Buffer.byteLength(body) };
}

function validatedDatabaseContext(value) {
  if (value === null) return null;
  assertRuntime(value && typeof value === "object" && !Array.isArray(value)
    && value.tenantId === "molit-platform" && value.accessMode === "service"
    && typeof value.actorId === "string" && IDENTIFIER.test(value.actorId),
  DEFAULT_CODES.invalid, "PostgreSQL platform service context is invalid");
  return Object.freeze({ accessMode: "service", actorId: value.actorId, tenantId: "molit-platform" });
}

async function setLocalTimeouts(client, statementTimeoutMs, lockTimeoutMs) {
  await client.query("SELECT set_config('statement_timeout', $1, true)", [`${statementTimeoutMs}ms`]);
  await client.query("SELECT set_config('lock_timeout', $1, true)", [`${lockTimeoutMs}ms`]);
}

async function queryBeforeDeadline(client, text, values, deadline, codes) {
  const remainingMs = Math.max(0, deadline - Date.now());
  if (remainingMs === 0) throw new RuntimeError(codes.timeout, "PostgreSQL resource-lock cleanup deadline elapsed");
  const timeoutSignal = AbortSignal.timeout(remainingMs);
  let onAbort;
  const timeout = new Promise((_, reject) => {
    onAbort = () => reject(new RuntimeError(codes.timeout, "PostgreSQL resource-lock cleanup deadline elapsed"));
    timeoutSignal.addEventListener("abort", onAbort, { once: true });
  });
  const query = Promise.resolve().then(() => client.query(text, values));
  query.catch(() => {});
  try {
    return await Promise.race([query, timeout]);
  } finally {
    timeoutSignal.removeEventListener("abort", onAbort);
  }
}

function monitorPool(pool) {
  const existing = POOL_HEALTH.get(pool);
  if (existing) return existing;
  const health = { failure: null, failedAt: null, generation: 0 };
  if (typeof pool.on === "function") {
    pool.on("error", (error) => {
      health.failure = error;
      health.failedAt = new Date().toISOString();
      health.generation += 1;
    });
  }
  POOL_HEALTH.set(pool, health);
  return health;
}

function createTrackedPool(options) {
  const pending = new Set();
  class TrackedClient extends Client {
    constructor(config) {
      super(config);
      this.binary = false;
      this.connectionParameters.binary = false;
    }

    connect(callback) {
      pending.add(this);
      if (typeof callback === "function") {
        try {
          return super.connect((error) => {
            pending.delete(this);
            callback(error);
          });
        } catch (error) {
          pending.delete(this);
          throw error;
        }
      }
      let connection;
      try {
        connection = super.connect();
      } catch (error) {
        pending.delete(this);
        throw error;
      }
      Promise.resolve(connection).then(
        () => pending.delete(this),
        () => pending.delete(this),
      );
      return connection;
    }
  }
  const pool = new Pool({ ...options, Client: TrackedClient });
  Object.defineProperty(pool, ABORT_PENDING_CONNECTIONS, {
    value() {
      for (const client of [...pending]) {
        const stream = client.connection?.stream;
        if (stream && !stream.destroyed) stream.destroy();
        else Promise.resolve(client.end()).catch(() => {});
      }
    },
  });
  return pool;
}

function closeDeadline({ deadline, timeoutMs }, fallbackMs) {
  if (Number.isFinite(deadline)) return Math.max(0, deadline);
  const budgetMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : fallbackMs;
  return Date.now() + budgetMs;
}

async function settleBeforeDeadline(promise, deadline) {
  const remainingMs = Math.max(0, deadline - Date.now());
  if (remainingMs === 0) return { timedOut: true };
  let timer;
  const outcome = await Promise.race([
    promise.then((value) => ({ timedOut: false, value })),
    new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), remainingMs); }),
  ]);
  clearTimeout(timer);
  return outcome;
}

function linkAbort(controller, signals) {
  const listeners = [];
  for (const signal of new Set(signals.filter(Boolean))) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    listeners.push([signal, onAbort]);
  }
  return () => {
    for (const [signal, onAbort] of listeners) signal.removeEventListener("abort", onAbort);
  };
}

export function createPostgresPool({ config, env = process.env, errorCodes = {} }) {
  const poolCodes = {
    configInvalid: "CONTROL_STORE_CONFIG_INVALID",
    secretMissing: "CONTROL_STORE_SECRET_ENV_MISSING",
    ...errorCodes,
  };
  const connectionString = env[config.connectionStringEnv];
  const holderId = env[config.holderIdEnv];
  assertRuntime(typeof connectionString === "string" && connectionString.length > 0, poolCodes.secretMissing, "PostgreSQL connection string environment variable is not set", { env: config.connectionStringEnv });
  assertRuntime(typeof holderId === "string" && IDENTIFIER.test(holderId), poolCodes.configInvalid, "PostgreSQL control-store holder ID is missing or invalid", { env: config.holderIdEnv });
  let connectionUrl;
  try { connectionUrl = new URL(connectionString); } catch { throw new RuntimeError(poolCodes.configInvalid, "PostgreSQL connection string is not a valid URL"); }
  assertRuntime(["postgres:", "postgresql:"].includes(connectionUrl.protocol), poolCodes.configInvalid, "PostgreSQL connection string must use postgres or postgresql");
  assertRuntime(connectionUrl.username.length > 0 && connectionUrl.password.length > 0
    && connectionUrl.hostname.length > 0 && connectionUrl.port.length > 0
    && connectionUrl.pathname.length > 1 && connectionUrl.hash.length === 0,
  poolCodes.configInvalid, "PostgreSQL connection string must include explicit user, password, host, port, and database without a fragment");
  const connectionParameter = [...connectionUrl.searchParams.keys()][0];
  assertRuntime(connectionParameter === undefined, poolCodes.configInvalid, "PostgreSQL connection string query parameters are forbidden", { parameter: connectionParameter });
  let user;
  let password;
  let database;
  try {
    user = decodeURIComponent(connectionUrl.username);
    password = decodeURIComponent(connectionUrl.password);
    database = decodeURIComponent(connectionUrl.pathname.slice(1));
  } catch {
    throw new RuntimeError(poolCodes.configInvalid, "PostgreSQL connection string contains an invalid percent-encoded component");
  }
  assertRuntime(user.length > 0 && password.length > 0 && database.length > 0,
    poolCodes.configInvalid, "PostgreSQL connection credentials and database must not be empty");
  const port = Number(connectionUrl.port);
  assertRuntime(Number.isSafeInteger(port) && port >= 1 && port <= 65_535,
    poolCodes.configInvalid, "PostgreSQL connection string port is invalid");
  const host = connectionUrl.hostname.startsWith("[") && connectionUrl.hostname.endsWith("]")
    ? connectionUrl.hostname.slice(1, -1)
    : connectionUrl.hostname;

  let ssl = false;
  if (config.tls.mode === "verify-full") {
    const ca = env[config.tls.caEnv];
    assertRuntime(typeof ca === "string" && ca.length > 0, poolCodes.secretMissing, "PostgreSQL trust anchor environment variable is not set", { env: config.tls.caEnv });
    ssl = { ca, rejectUnauthorized: true };
    if (config.tls.certEnv) {
      const cert = env[config.tls.certEnv];
      const key = env[config.tls.keyEnv];
      assertRuntime(typeof cert === "string" && cert.length > 0 && typeof key === "string" && key.length > 0, poolCodes.secretMissing, "PostgreSQL client certificate or key environment variable is not set", { certEnv: config.tls.certEnv, keyEnv: config.tls.keyEnv });
      Object.assign(ssl, { cert, key });
    }
  }

  const poolOptions = {
    database,
    host,
    password,
    port,
    user,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    idle_in_transaction_session_timeout: config.statementTimeoutMs,
    lock_timeout: config.lockTimeoutMs,
    max: config.maxPoolSize,
    options: "-c synchronous_commit=on",
    query_timeout: config.statementTimeoutMs,
    replication: "false",
    ssl,
    sslnegotiation: "postgres",
    statement_timeout: config.statementTimeoutMs,
    client_encoding: "UTF8",
  };

  const pool = createTrackedPool({
    ...poolOptions,
    application_name: config.applicationName,
  });
  const leasePool = createTrackedPool({
    ...poolOptions,
    application_name: `${config.applicationName.slice(0, 55)}-lease`,
    max: config.maxLeasePoolSize,
  });
  monitorPool(pool);
  monitorPool(leasePool);
  return Object.freeze({ holderId, pool, leasePool });
}

export class PostgresJsonStore {
  constructor({
    pool,
    leasePool,
    component,
    holderId,
    initialState,
    validateState,
    sealState,
    maxBytes = 64 * 1024 * 1024,
    statementTimeoutMs = 30_000,
    lockTimeoutMs = 5_000,
    cleanupTimeoutMs = Math.min(statementTimeoutMs, 5_000),
    clock = () => new Date(),
    codes = {},
    preserveError = () => false,
    projection = null,
    databaseContext = null,
  }) {
    assertRuntime(pool && typeof pool.connect === "function" && typeof pool.end === "function", DEFAULT_CODES.invalid, "PostgreSQL pool is invalid");
    assertRuntime(leasePool && typeof leasePool.connect === "function" && typeof leasePool.end === "function" && leasePool !== pool, DEFAULT_CODES.invalid, "PostgreSQL lease pool must be a distinct pool");
    assertRuntime(typeof component === "string" && IDENTIFIER.test(component), DEFAULT_CODES.invalid, "control-store component is invalid");
    assertRuntime(typeof holderId === "string" && IDENTIFIER.test(holderId), DEFAULT_CODES.invalid, "control-store holder ID is invalid");
    assertRuntime(typeof initialState === "function" && typeof validateState === "function" && typeof sealState === "function", DEFAULT_CODES.invalid, "control-store state codec is invalid");
    assertRuntime(Number.isSafeInteger(maxBytes) && maxBytes > 0, DEFAULT_CODES.invalid, "control-store byte limit is invalid");
    assertRuntime(Number.isSafeInteger(statementTimeoutMs) && statementTimeoutMs >= 100, DEFAULT_CODES.invalid, "control-store statement timeout is invalid");
    assertRuntime(Number.isSafeInteger(lockTimeoutMs) && lockTimeoutMs >= 100 && lockTimeoutMs <= statementTimeoutMs, DEFAULT_CODES.invalid, "control-store lock timeout is invalid");
    assertRuntime(Number.isSafeInteger(cleanupTimeoutMs) && cleanupTimeoutMs >= 10 && cleanupTimeoutMs <= statementTimeoutMs, DEFAULT_CODES.invalid, "control-store cleanup timeout is invalid");
    assertRuntime(typeof preserveError === "function", DEFAULT_CODES.invalid, "control-store error-preservation policy is invalid");
    assertRuntime(projection === null || (typeof projection.initialize === "function" && typeof projection.apply === "function"),
      DEFAULT_CODES.invalid, "control-store normalized projection is invalid");
    Object.assign(this, {
      pool,
      leasePool,
      component,
      holderId,
      initialState,
      validateState,
      sealState,
      maxBytes,
      statementTimeoutMs,
      lockTimeoutMs,
      cleanupTimeoutMs,
      clock,
      codes: Object.freeze({ ...DEFAULT_CODES, ...codes }),
      preserveError,
      projection,
      databaseContext: validatedDatabaseContext(databaseContext),
    });
    this.initialized = false;
    this.closed = false;
    this.closePromise = null;
    this.leaseContext = new AsyncLocalStorage();
    this.activeClients = new Set();
    this.pendingConnects = new Set();
    this.poolHealth = [monitorPool(pool), monitorPool(leasePool)];
  }

  now() { return this.clock().toISOString(); }

  #databaseContextQuery() {
    if (!this.databaseContext) return null;
    return {
      text: `SELECT
        set_config('molit.tenant_id', $1, true),
        set_config('molit.actor_id', $2, true),
        set_config('molit.access_mode', 'service', true),
        set_config('molit.trace_id', $3, true),
        set_config('molit.correlation_id', $4, true),
        set_config('molit.break_glass_reason', '', true),
        set_config('molit.break_glass_expires_at', '', true)`,
      values: [this.databaseContext.tenantId, this.databaseContext.actorId,
        randomBytes(16).toString("hex"), `${this.component}:${randomUUID()}`],
    };
  }

  async #setDatabaseContext(client) {
    const query = this.#databaseContextQuery();
    if (query) await client.query(query.text, query.values);
  }

  #assertUsable() {
    assertRuntime(!this.closed, this.codes.closed, "PostgreSQL control-store is closed");
    assertRuntime(this.initialized, this.codes.migration, "PostgreSQL control-store migration has not been verified");
  }

  async #connect(pool, controller, onForce) {
    const pendingConnect = { controller };
    this.pendingConnects.add(pendingConnect);
    const connection = Promise.resolve().then(() => pool.connect());
    let onConnectAbort;
    const aborted = controller && new Promise((_, reject) => {
      onConnectAbort = () => reject(controller.signal.reason ?? new RuntimeError(this.codes.aborted, "control-store connection was aborted"));
      controller.signal.addEventListener("abort", onConnectAbort, { once: true });
      if (controller.signal.aborted) onConnectAbort();
    });
    let client;
    try {
      client = await (aborted ? Promise.race([connection, aborted]) : connection);
    } catch (error) {
      if (controller?.signal.aborted) {
        connection.then((lateClient) => lateClient.release(true), () => {});
        throwIfAborted(controller.signal, this.codes.aborted, this.preserveError);
      }
      throw error;
    } finally {
      controller?.signal.removeEventListener("abort", onConnectAbort);
      this.pendingConnects.delete(pendingConnect);
    }
    if (this.closed) {
      client.release(true);
      throw new RuntimeError(this.codes.closed, "PostgreSQL control-store is closed");
    }
    const health = monitorPool(pool);
    let entry;
    const notifyForce = () => {
      if (entry.forceNotified) return;
      entry.forceNotified = true;
      entry.onForce?.();
    };
    const onError = (error) => {
      health.failure = error;
      health.failedAt = new Date().toISOString();
      health.generation += 1;
      entry.connectionFailed = true;
      notifyForce();
      if (!entry.controller?.signal.aborted) entry.controller?.abort(mapPostgresError(error, this.codes));
      this.#release(entry, true);
    };
    const onAbort = () => {
      entry.forced = true;
      notifyForce();
      this.#release(entry, true);
    };
    entry = { client, connectionFailed: false, controller, forceNotified: false, forced: false, onAbort, onError, onForce, released: false };
    client.on?.("error", onError);
    controller?.signal.addEventListener("abort", onAbort, { once: true });
    this.activeClients.add(entry);
    if (controller?.signal.aborted) {
      onAbort();
      throwIfAborted(controller.signal, this.codes.aborted, this.preserveError);
    }
    return entry;
  }

  #release(entry, destroy = false) {
    if (!entry || entry.released) return;
    entry.released = true;
    this.activeClients.delete(entry);
    entry.client.off?.("error", entry.onError);
    entry.controller?.signal.removeEventListener("abort", entry.onAbort);
    try { entry.client.release(destroy || entry.connectionFailed); } catch { /* already destroyed by the pool */ }
  }

  #forceReleaseActive(reason) {
    for (const entry of [...this.activeClients]) {
      entry.forced = true;
      if (!entry.forceNotified) {
        entry.forceNotified = true;
        entry.onForce?.();
      }
      if (!entry.controller?.signal.aborted) entry.controller?.abort(reason);
      this.#release(entry, true);
    }
  }

  #abortPendingConnects(reason) {
    for (const { controller } of [...this.pendingConnects]) {
      if (!controller?.signal.aborted) controller?.abort(reason);
    }
  }

  async #rollback(entry) {
    if (!entry || entry.forced || entry.connectionFailed || entry.released) return;
    try {
      await entry.client.query("ROLLBACK");
    } catch {
      entry.connectionFailed = true;
    }
  }

  #decode(value) {
    let state;
    try { state = stateValue(value); } catch (error) {
      if (error instanceof RuntimeError) throw new RuntimeError(this.codes.invalid, error.message);
      throw error;
    }
    return this.validateState(state);
  }

  #encode(state) {
    this.validateState(state);
    const encoded = jsonBytes(state);
    assertRuntime(encoded.bytes <= this.maxBytes, this.codes.tooLarge, "PostgreSQL control-store state exceeds the configured byte limit", { actualBytes: encoded.bytes, maxBytes: this.maxBytes });
    return encoded.body;
  }

  async initialize({ signal } = {}) {
    assertRuntime(!this.closed, this.codes.closed, "PostgreSQL control-store is closed");
    if (this.initialized) return;
    const operationController = new AbortController();
    const unlinkAbort = linkAbort(operationController, [signal]);
    const executionSignal = signal ? AbortSignal.any([signal, operationController.signal]) : operationController.signal;
    throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
    let client;
    let entry;
    let transaction = false;
    try {
      entry = await this.#connect(this.pool, operationController);
      client = entry.client;
      throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
      await client.query("BEGIN");
      transaction = true;
      await this.#setDatabaseContext(client);
      await setLocalTimeouts(client, this.statementTimeoutMs, this.lockTimeoutMs);
      const migration = await client.query(
        "SELECT version FROM molit_control_store.schema_migration WHERE component = $1",
        [MIGRATION_COMPONENT],
      );
      assertRuntime(migration.rowCount === 1 && Number(migration.rows[0].version) === MIGRATION_VERSION,
        this.codes.migration, "PostgreSQL control-store migration version is missing or incompatible", {
          actual: migration.rowCount === 1 ? migration.rows[0].version : null,
          expected: MIGRATION_VERSION,
        });
      await client.query("SELECT component, revision, state, updated_at FROM molit_control_store.json_snapshot WHERE false");
      await client.query("SELECT component, resource_id, fencing_token, holder_id, acquired_at, released_at FROM molit_control_store.resource_fence WHERE false");
      const initial = this.initialState();
      const body = this.#encode(initial);
      await client.query(
        `INSERT INTO molit_control_store.json_snapshot (component, revision, state, updated_at)
         VALUES ($1, 1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (component) DO NOTHING`,
        [this.component, body, this.now()],
      );
      if (this.projection) {
        const current = await client.query(
          "SELECT revision, state FROM molit_control_store.json_snapshot WHERE component = $1 FOR UPDATE",
          [this.component],
        );
        assertRuntime(current.rowCount === 1, this.codes.missing, "PostgreSQL control-store snapshot row is missing");
        const currentState = this.#decode(current.rows[0].state);
        await this.projection.initialize({
          client,
          component: this.component,
          nextState: structuredClone(currentState),
          now: this.now(),
          snapshotRevision: String(current.rows[0].revision),
        });
      }
      throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
      await client.query("COMMIT");
      transaction = false;
      this.#release(entry);
      entry = undefined;
      try {
        entry = await this.#connect(this.leasePool, operationController);
        await entry.client.query("SELECT 1 AS ready");
      } finally {
        this.#release(entry);
        entry = undefined;
      }
      this.initialized = true;
    } catch (error) {
      if (transaction) await this.#rollback(entry);
      throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
      if (this.preserveError(error)) throw error;
      throw mapPostgresError(postgresCause(error), this.codes, { migrationCheck: true });
    } finally {
      this.#release(entry);
      unlinkAbort();
    }
  }

  async read(operation = (state) => state, { signal } = {}) {
    this.#assertUsable();
    const activeLease = this.leaseContext.getStore();
    const operationController = new AbortController();
    const unlinkAbort = linkAbort(operationController, [activeLease?.signal, signal]);
    const signals = [activeLease?.signal, signal, operationController.signal].filter(Boolean);
    const executionSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
    let client;
    let entry;
    let transaction = false;
    try {
      entry = await this.#connect(this.pool, operationController);
      client = entry.client;
      await client.query("BEGIN READ ONLY");
      transaction = true;
      await this.#setDatabaseContext(client);
      await setLocalTimeouts(client, this.statementTimeoutMs, this.lockTimeoutMs);
      const result = await client.query(
        "SELECT state FROM molit_control_store.json_snapshot WHERE component = $1",
        [this.component],
      );
      assertRuntime(result.rowCount === 1, this.codes.missing, "PostgreSQL control-store snapshot row is missing");
      const state = this.#decode(result.rows[0].state);
      throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
      const projected = await operation(structuredClone(state));
      throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
      await client.query("COMMIT");
      transaction = false;
      return structuredClone(projected);
    } catch (error) {
      if (transaction) await this.#rollback(entry);
      throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
      if (this.preserveError(error)) throw error;
      throw mapPostgresError(postgresCause(error), this.codes);
    } finally {
      this.#release(entry);
      unlinkAbort();
    }
  }

  async transact(operation, { signal } = {}) {
    this.#assertUsable();
    const activeLease = this.leaseContext.getStore();
    const operationController = new AbortController();
    const unlinkAbort = linkAbort(operationController, [activeLease?.signal, signal]);
    const signals = [activeLease?.signal, signal, operationController.signal].filter(Boolean);
    const executionSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
    let client;
    let entry;
    let transaction = false;
    let commitStarted = false;
    try {
      entry = await this.#connect(this.pool, operationController);
      client = entry.client;
      await client.query("BEGIN");
      transaction = true;
      await this.#setDatabaseContext(client);
      await setLocalTimeouts(client, this.statementTimeoutMs, this.lockTimeoutMs);
      const selected = await client.query(
        "SELECT revision, state FROM molit_control_store.json_snapshot WHERE component = $1 FOR UPDATE",
        [this.component],
      );
      assertRuntime(selected.rowCount === 1, this.codes.missing, "PostgreSQL control-store snapshot row is missing");
      const state = this.#decode(selected.rows[0].state);
      const previousState = structuredClone(state);
      const result = await operation(state);
      throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
      if (activeLease) {
        const fence = await client.query(
          `SELECT fencing_token::text, holder_id, released_at
           FROM molit_control_store.resource_fence
           WHERE component = $1 AND resource_id = $2
           FOR SHARE`,
          [this.component, activeLease.resourceId],
        );
        assertRuntime(fence.rowCount === 1
          && fence.rows[0].fencing_token === activeLease.fencingToken
          && fence.rows[0].holder_id === activeLease.holderId
          && fence.rows[0].released_at === null,
        this.codes.fenceLost, "PostgreSQL resource fencing token is no longer current", { resourceId: activeLease.resourceId });
      }
      const committedAt = this.now();
      this.sealState(state, committedAt);
      const body = this.#encode(state);
      throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
      const updated = await client.query(
        `UPDATE molit_control_store.json_snapshot
         SET revision = revision + 1, state = $2::jsonb, updated_at = $3::timestamptz
         WHERE component = $1 AND revision = $4::bigint
         RETURNING revision`,
        [this.component, body, committedAt, selected.rows[0].revision],
      );
      assertRuntime(updated.rowCount === 1, this.codes.fenceLost, "PostgreSQL control-store snapshot revision fence was lost");
      if (this.projection) {
        await this.projection.apply({
          client,
          component: this.component,
          nextState: structuredClone(state),
          now: committedAt,
          previousState,
          snapshotRevision: String(updated.rows[0].revision),
        });
      }
      throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
      commitStarted = true;
      await client.query("COMMIT");
      transaction = false;
      commitStarted = false;
      return structuredClone(result);
    } catch (error) {
      if (transaction && !commitStarted) await this.#rollback(entry);
      if (!commitStarted) throwIfAborted(executionSignal, this.codes.aborted, this.preserveError);
      if (!commitStarted && this.preserveError(error)) throw error;
      throw mapPostgresError(postgresCause(error), this.codes, { commitStarted });
    } finally {
      this.#release(entry, commitStarted);
      unlinkAbort();
    }
  }

  async withResourceLock(resourceId, operation, { signal } = {}) {
    this.#assertUsable();
    assertRuntime(typeof resourceId === "string" && resourceId.length >= 3 && resourceId.length <= 1024, this.codes.invalid, "control-store resource identifier is invalid");
    assertRuntime(typeof operation === "function", this.codes.invalid, "control-store resource operation is invalid");
    throwIfAborted(signal, this.codes.aborted, this.preserveError);
    const lockName = JSON.stringify([this.component, resourceId]);
    let client;
    let entry;
    let acquired = false;
    let fencingToken = null;
    let connectionFailed = false;
    let leaseTransaction = false;
    let leaseCommitStarted = false;
    let result;
    let failure;
    const leaseController = new AbortController();
    const unlinkAbort = linkAbort(leaseController, [signal]);
    const leaseSignal = signal ? AbortSignal.any([signal, leaseController.signal]) : leaseController.signal;
    try {
      entry = await this.#connect(this.leasePool, leaseController, () => { connectionFailed = true; });
      client = entry.client;
      const lock = await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
        [lockName],
      );
      acquired = lock.rows[0]?.acquired === true;
      assertRuntime(acquired, this.codes.resourceLocked, "PostgreSQL resource lock is held by another control-plane instance", { resourceId });

      await client.query("BEGIN");
      leaseTransaction = true;
      try {
        await this.#setDatabaseContext(client);
        await setLocalTimeouts(client, this.statementTimeoutMs, this.lockTimeoutMs);
        const fence = await client.query(
          `INSERT INTO molit_control_store.resource_fence
             (component, resource_id, fencing_token, holder_id, acquired_at, released_at)
           VALUES ($1, $2, 1, $3, clock_timestamp(), NULL)
           ON CONFLICT (component, resource_id) DO UPDATE
             SET fencing_token = molit_control_store.resource_fence.fencing_token + 1,
                 holder_id = EXCLUDED.holder_id,
                 acquired_at = EXCLUDED.acquired_at,
                 released_at = NULL
           RETURNING fencing_token::text, holder_id, acquired_at`,
          [this.component, resourceId, this.holderId],
        );
        fencingToken = fence.rows[0].fencing_token;
        throwIfAborted(leaseSignal, this.codes.aborted, this.preserveError);
        leaseCommitStarted = true;
        await client.query("COMMIT");
        leaseTransaction = false;
        leaseCommitStarted = false;
        const lease = Object.freeze({
          resourceId,
          holderId: fence.rows[0].holder_id,
          fencingToken,
          acquiredAt: new Date(fence.rows[0].acquired_at).toISOString(),
          signal: leaseSignal,
        });
        result = await this.leaseContext.run(lease, () => operation(lease));
        throwIfAborted(leaseSignal, this.codes.fenceLost, this.preserveError);
      } catch (error) {
        if (leaseTransaction && !leaseCommitStarted) await this.#rollback(entry);
        if (leaseCommitStarted) {
          connectionFailed = true;
          throw mapPostgresError(error, this.codes, { commitStarted: true });
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof RuntimeError && error.code === this.codes.commitUnknown) {
        failure = error;
      } else if (this.preserveError(error)) {
        failure = error;
      } else if (leaseSignal.aborted) {
        try { throwIfAborted(leaseSignal, this.codes.aborted, this.preserveError); } catch (abortError) { failure = abortError; }
      } else {
        failure = mapPostgresError(postgresCause(error), this.codes);
      }
    }

    if (client && acquired && !connectionFailed) {
      const cleanupDeadline = Date.now() + this.cleanupTimeoutMs;
      let cleanupTransaction = false;
      try {
        const databaseContext = this.#databaseContextQuery();
        if (databaseContext) {
          await queryBeforeDeadline(client, "BEGIN", [], cleanupDeadline, this.codes);
          cleanupTransaction = true;
          await queryBeforeDeadline(client, databaseContext.text, databaseContext.values, cleanupDeadline, this.codes);
        }
        const released = await queryBeforeDeadline(client,
          `UPDATE molit_control_store.resource_fence
           SET released_at = clock_timestamp()
           WHERE component = $1 AND resource_id = $2 AND holder_id = $3
             AND fencing_token = $4::bigint AND released_at IS NULL`,
          [this.component, resourceId, this.holderId, fencingToken],
          cleanupDeadline,
          this.codes,
        );
        if (released.rowCount !== 1 && !failure) {
          failure = new RuntimeError(this.codes.fenceLost, "PostgreSQL resource fencing row changed before release", { resourceId });
        }
        if (cleanupTransaction) {
          await queryBeforeDeadline(client, "COMMIT", [], cleanupDeadline, this.codes);
          cleanupTransaction = false;
        }
        const unlocked = await queryBeforeDeadline(client,
          "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
          [lockName],
          cleanupDeadline,
          this.codes,
        );
        if (unlocked.rows[0]?.unlocked !== true) {
          connectionFailed = true;
          if (!failure) failure = new RuntimeError(this.codes.fenceLost, "PostgreSQL resource lock was lost before release", { resourceId });
        }
      } catch (error) {
        if (cleanupTransaction) {
          await queryBeforeDeadline(client, "ROLLBACK", [], cleanupDeadline, this.codes).catch(() => {});
        }
        connectionFailed = true;
        if (!failure) failure = mapPostgresError(error, this.codes);
      }
    }
    this.#release(entry, connectionFailed);
    unlinkAbort();
    if (failure) throw failure;
    return structuredClone(result);
  }

  async readiness({ signal } = {}) {
    if (this.closed) return Object.freeze({ ready: false, status: "CLOSED", failureCode: this.codes.closed });
    if (!this.initialized) return Object.freeze({ ready: false, status: "NOT_INITIALIZED", failureCode: this.codes.migration });
    throwIfAborted(signal, this.codes.aborted, this.preserveError);
    const healthGenerations = this.poolHealth.map(({ generation }) => generation);
    try {
      await this.read(() => null, { signal });
      const controller = new AbortController();
      const unlinkAbort = linkAbort(controller, [signal]);
      let entry;
      try {
        throwIfAborted(signal, this.codes.aborted, this.preserveError);
        entry = await this.#connect(this.leasePool, controller);
        await entry.client.query("SELECT 1 AS ready");
        throwIfAborted(signal, this.codes.aborted, this.preserveError);
      } finally {
        this.#release(entry);
        unlinkAbort();
      }
      if (this.poolHealth.some(({ generation }, index) => generation !== healthGenerations[index])) {
        return Object.freeze({ ready: false, status: "NOT_READY", failureCode: this.codes.unavailable });
      }
      for (const health of this.poolHealth) {
        health.failure = null;
        health.failedAt = null;
      }
      return Object.freeze({ ready: true, status: "READY", failureCode: null });
    } catch (error) {
      throwIfAborted(signal, this.codes.aborted, this.preserveError);
      if (this.preserveError(error)) throw error;
      const mapped = mapPostgresError(postgresCause(error), this.codes);
      return Object.freeze({ ready: false, status: "NOT_READY", failureCode: errorCode(mapped) ?? this.codes.unavailable });
    }
  }

  async close(options = {}) {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.leaseContext.disable();
    const deadline = closeDeadline(options, this.cleanupTimeoutMs);
    const closingReason = new RuntimeError(this.codes.closed, "PostgreSQL control-store is closing");
    this.#abortPendingConnects(closingReason);
    const endPool = (pool) => {
      const ending = Promise.resolve(pool.end());
      pool[ABORT_PENDING_CONNECTIONS]?.();
      return ending;
    };
    const poolEnd = Promise.allSettled([endPool(this.pool), endPool(this.leasePool)]);
    this.closePromise = (async () => {
      let outcome = await settleBeforeDeadline(poolEnd, deadline);
      if (outcome.timedOut) {
        const reason = new RuntimeError(this.codes.closed, "PostgreSQL control-store shutdown deadline expired");
        this.#forceReleaseActive(reason);
        outcome = await settleBeforeDeadline(poolEnd, deadline);
        if (outcome.timedOut) return;
      }
      const failure = outcome.value.find(({ status }) => status === "rejected");
      if (failure) throw mapPostgresError(failure.reason, this.codes);
    })();
    return this.closePromise;
  }
}

export const POSTGRES_JSON_STORE_MIGRATION = Object.freeze({
  component: MIGRATION_COMPONENT,
  version: MIGRATION_VERSION,
});
