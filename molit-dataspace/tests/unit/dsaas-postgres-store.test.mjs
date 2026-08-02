import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import pg from "pg";

import { PostgresJsonStore, createPostgresPool } from "../../src/control-store/postgres-json-store.mjs";
import { createDsaasStateStore } from "../../src/dsaas/runtime.mjs";

class FakeClient extends EventEmitter {
  constructor(pool, owner = pool) {
    super();
    this.pool = pool;
    this.owner = owner;
    this.id = ++pool.clientSequence;
    this.inTransaction = false;
    this.transactionSnapshots = null;
    this.released = false;
    this.pendingQueryRejects = [];
  }

  async query(text, values = []) {
    const sql = text.replace(/\s+/gu, " ").trim();
    this.pool.queries.push({ clientId: this.id, sql, values: structuredClone(values) });
    if (sql === "BEGIN" || sql === "BEGIN READ ONLY") {
      this.inTransaction = true;
      this.transactionSnapshots = structuredClone([...this.pool.snapshots]);
      return { rowCount: null, rows: [] };
    }
    if (sql === "COMMIT") {
      if (this.pool.failNextCommit) {
        this.pool.failNextCommit = false;
        throw Object.assign(new Error("connection lost during commit"), { code: "08006" });
      }
      this.inTransaction = false;
      this.transactionSnapshots = null;
      return { rowCount: null, rows: [] };
    }
    if (sql === "ROLLBACK") {
      if (this.pool.failNextRollback) {
        this.pool.failNextRollback = false;
        throw Object.assign(new Error("connection lost during rollback"), { code: "08006" });
      }
      if (this.transactionSnapshots) this.pool.snapshots = new Map(this.transactionSnapshots);
      this.inTransaction = false;
      this.transactionSnapshots = null;
      return { rowCount: null, rows: [] };
    }
    if (sql === "SELECT 1 AS ready") {
      if (this.pool.hangNextReady) {
        this.pool.hangNextReady = false;
        this.pool.hungReadyStarted?.();
        return new Promise((_resolve, reject) => this.pendingQueryRejects.push(reject));
      }
      return { rowCount: 1, rows: [{ ready: 1 }] };
    }
    if (sql.startsWith("SELECT set_config")) return { rowCount: 1, rows: [{ set_config: values[0] }] };
    if (sql.includes("FROM molit_control_store.schema_migration")) {
      if (this.pool.migrationMissing) throw Object.assign(new Error("missing relation"), { code: "42P01" });
      return this.pool.migrationVersion === null
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ version: this.pool.migrationVersion }] };
    }
    if (sql.endsWith("WHERE false")) return { rowCount: 0, rows: [] };
    if (sql.startsWith("INSERT INTO molit_control_store.json_snapshot")) {
      if (!this.pool.snapshots.has(values[0])) {
        this.pool.snapshots.set(values[0], { revision: "1", state: JSON.parse(values[1]), updatedAt: values[2] });
      }
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith("SELECT state FROM molit_control_store.json_snapshot") || sql.startsWith("SELECT revision, state FROM molit_control_store.json_snapshot")) {
      const record = this.pool.snapshots.get(values[0]);
      if (!record) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ revision: record.revision, state: structuredClone(record.state) }] };
    }
    if (sql.startsWith("UPDATE molit_control_store.json_snapshot")) {
      const record = this.pool.snapshots.get(values[0]);
      if (!record || record.revision !== String(values[3])) return { rowCount: 0, rows: [] };
      record.revision = String(BigInt(record.revision) + 1n);
      record.state = JSON.parse(values[1]);
      record.updatedAt = values[2];
      return { rowCount: 1, rows: [{ revision: record.revision }] };
    }
    if (sql.startsWith("SELECT pg_try_advisory_lock")) {
      const current = this.pool.locks.get(values[0]);
      if (current !== undefined && current !== this.id) return { rowCount: 1, rows: [{ acquired: false }] };
      this.pool.locks.set(values[0], this.id);
      return { rowCount: 1, rows: [{ acquired: true }] };
    }
    if (sql.startsWith("SELECT fencing_token::text, holder_id, released_at")) {
      const record = this.pool.fences.get(`${values[0]}\0${values[1]}`);
      return record
        ? { rowCount: 1, rows: [{ fencing_token: record.fencingToken, holder_id: record.holderId, released_at: record.releasedAt }] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("INSERT INTO molit_control_store.resource_fence")) {
      const key = `${values[0]}\0${values[1]}`;
      const prior = this.pool.fences.get(key);
      const token = prior ? String(BigInt(prior.fencingToken) + 1n) : "1";
      const record = { fencingToken: token, holderId: values[2], acquiredAt: new Date().toISOString(), releasedAt: null };
      this.pool.fences.set(key, record);
      return { rowCount: 1, rows: [{ fencing_token: token, holder_id: values[2], acquired_at: record.acquiredAt }] };
    }
    if (sql.startsWith("UPDATE molit_control_store.resource_fence")) {
      if (this.pool.hangCleanupUpdate) return new Promise(() => {});
      if (this.pool.failCleanupUpdate) throw Object.assign(new Error("connection lost during cleanup"), { code: "08006" });
      const record = this.pool.fences.get(`${values[0]}\0${values[1]}`);
      const updated = record && record.holderId === values[2] && record.fencingToken === values[3] && record.releasedAt === null;
      if (updated) record.releasedAt = new Date().toISOString();
      return { rowCount: updated ? 1 : 0, rows: [] };
    }
    if (sql.startsWith("SELECT pg_advisory_unlock")) {
      const unlocked = this.pool.locks.get(values[0]) === this.id;
      if (unlocked) this.pool.locks.delete(values[0]);
      return { rowCount: 1, rows: [{ unlocked }] };
    }
    throw new Error(`unexpected fake PostgreSQL query: ${sql}`);
  }

  release(destroy = false) {
    if (this.released) return;
    this.released = true;
    if (destroy) {
      this.pool.destroyedReleases += 1;
      for (const [name, clientId] of this.pool.locks) if (clientId === this.id) this.pool.locks.delete(name);
      for (const reject of this.pendingQueryRejects.splice(0)) {
        reject(Object.assign(new Error("connection destroyed"), { code: "08006" }));
      }
    }
    this.owner.releaseClient();
  }
}

class FakePool extends EventEmitter {
  constructor({ migrationMissing = false, migrationVersion = 1, max = Infinity } = {}) {
    super();
    this.migrationMissing = migrationMissing;
    this.migrationVersion = migrationVersion;
    this.snapshots = new Map();
    this.fences = new Map();
    this.locks = new Map();
    this.queries = [];
    this.clientSequence = 0;
    this.ended = false;
    this.connectCount = 0;
    this.max = max;
    this.active = 0;
    this.waiters = [];
    this.destroyedReleases = 0;
    this.hangCleanupUpdate = false;
    this.failCleanupUpdate = false;
    this.failNextCommit = false;
    this.failNextConnect = false;
    this.failNextRollback = false;
    this.endResolvers = [];
    this.hangNextReady = false;
    this.hungReadyStarted = null;
  }

  async connect() {
    if (this.ended) throw Object.assign(new Error("pool is closed"), { code: "POOL_CLOSED" });
    if (this.failNextConnect) {
      this.failNextConnect = false;
      throw Object.assign(new Error("connection failed"), { code: "08006" });
    }
    if (this.active >= this.max) await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
    this.connectCount += 1;
    this.lastClient = new FakeClient(this);
    return this.lastClient;
  }

  releaseClient() {
    this.active -= 1;
    this.waiters.shift()?.();
    if (this.ended && this.active === 0) this.endResolvers.splice(0).forEach((resolve) => resolve());
  }

  async end() {
    this.ended = true;
    if (this.active === 0) return;
    await new Promise((resolve) => this.endResolvers.push(resolve));
  }
}

class FakeLeasePool extends EventEmitter {
  constructor(pool, { max = Infinity } = {}) {
    super();
    this.pool = pool;
    this.connectCount = 0;
    this.ended = false;
    this.max = max;
    this.active = 0;
    this.waiters = [];
    this.endResolvers = [];
  }

  async connect() {
    if (this.ended) throw Object.assign(new Error("lease pool is closed"), { code: "POOL_CLOSED" });
    if (this.active >= this.max) await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
    this.connectCount += 1;
    this.lastClient = new FakeClient(this.pool, this);
    return this.lastClient;
  }

  releaseClient() {
    this.active -= 1;
    this.waiters.shift()?.();
    if (this.ended && this.active === 0) this.endResolvers.splice(0).forEach((resolve) => resolve());
  }

  async end() {
    this.ended = true;
    if (this.active === 0) return;
    await new Promise((resolve) => this.endResolvers.push(resolve));
  }
}

class PgPoolCapacityClient extends EventEmitter {
  constructor(config) {
    super();
    this.database = config.testDatabase;
    this._ending = false;
    this._queryable = true;
  }

  connect(callback) {
    setImmediate(() => callback());
  }

  isConnected() { return true; }

  async query(text, values = []) {
    const sql = text.replace(/\s+/gu, " ").trim();
    if (["BEGIN", "BEGIN READ ONLY", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: null, rows: [] };
    if (sql === "SELECT 1 AS ready") return { rowCount: 1, rows: [{ ready: 1 }] };
    if (sql.startsWith("SELECT set_config")) return { rowCount: 1, rows: [{ set_config: values[0] }] };
    if (sql.includes("FROM molit_control_store.schema_migration")) return { rowCount: 1, rows: [{ version: 1 }] };
    if (sql.endsWith("WHERE false")) return { rowCount: 0, rows: [] };
    if (sql.startsWith("INSERT INTO molit_control_store.json_snapshot")) {
      this.database.snapshot ??= { revision: "1", state: JSON.parse(values[1]) };
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith("SELECT state FROM molit_control_store.json_snapshot")) {
      return { rowCount: 1, rows: [{ state: structuredClone(this.database.snapshot.state) }] };
    }
    throw new Error(`unexpected capacity-pool query: ${sql}`);
  }

  end(callback) {
    this._ending = true;
    if (callback) {
      setImmediate(() => {
        this.emit("end");
        callback();
      });
      return;
    }
    return new Promise((resolve) => setImmediate(() => {
      this.emit("end");
      resolve();
    }));
  }
}

function validateState(state) {
  assert.equal(state?.schemaVersion, "test.control-state/1");
  assert.equal(Number.isSafeInteger(state.value), true);
  return state;
}

function storeFor(pool, holderId = "dsaas-instance-01", leasePool = new FakeLeasePool(pool), options = {}) {
  return new PostgresJsonStore({
    pool,
    leasePool,
    component: "dsaas-test",
    holderId,
    initialState: () => ({ schemaVersion: "test.control-state/1", value: 0 }),
    validateState,
    sealState: (state) => state,
    statementTimeoutMs: 5_000,
    lockTimeoutMs: 1_000,
    ...options,
  });
}

test("PostgreSQL store fails closed when the migration is absent", async () => {
  const pool = new FakePool({ migrationMissing: true });
  const store = storeFor(pool);
  await assert.rejects(store.initialize(), { code: "CONTROL_STORE_MIGRATION_REQUIRED" });
  assert.equal(pool.queries.some(({ sql }) => sql === "ROLLBACK"), true);
});

test("PostgreSQL transaction locks the JSONB snapshot and commits a lossless update", async () => {
  const pool = new FakePool();
  const store = storeFor(pool);
  await store.initialize();
  const result = await store.transact((state) => {
    state.value += 1;
    return { accepted: true };
  });
  assert.deepEqual(result, { accepted: true });
  assert.equal((await store.read((state) => state.value)), 1);
  assert.equal(pool.queries.some(({ sql }) => sql.includes("FOR UPDATE")), true);
  assert.equal(pool.queries.some(({ sql }) => sql.includes("state = $2::jsonb")), true);
  assert.equal(pool.queries.some(({ sql, values }) => sql.startsWith("SELECT set_config('statement_timeout'") && values[0] === "5000ms"), true);
  assert.equal(pool.queries.some(({ sql, values }) => sql.startsWith("SELECT set_config('lock_timeout'") && values[0] === "1000ms"), true);
});

test("an aborted PostgreSQL transaction destroys its client before snapshot replacement", async () => {
  const pool = new FakePool();
  const store = storeFor(pool);
  await store.initialize();
  const controller = new AbortController();
  await assert.rejects(
    store.transact((state) => {
      state.value = 9;
      controller.abort();
    }, { signal: controller.signal }),
    { code: "CONTROL_STORE_ABORTED" },
  );
  assert.equal(await store.read((state) => state.value), 0);
  const updateIndex = pool.queries.findIndex(({ sql }) => sql.startsWith("UPDATE molit_control_store.json_snapshot"));
  assert.equal(updateIndex, -1);
  assert.equal(pool.queries.some(({ sql }) => sql === "ROLLBACK"), false);
  assert.ok(pool.destroyedReleases >= 1);
});

test("a client is destroyed when transaction rollback fails", async () => {
  const pool = new FakePool();
  const store = storeFor(pool);
  await store.initialize();
  pool.failNextRollback = true;
  await assert.rejects(
    store.transact(() => { throw new Error("projection failed"); }),
    { code: "CONTROL_STORE_UNAVAILABLE" },
  );
  assert.ok(pool.destroyedReleases >= 1);
  assert.equal(pool.active, 0);
  await store.close();
});

test("session advisory locks are exclusive and fencing tokens increase monotonically", async () => {
  const pool = new FakePool();
  const firstLeasePool = new FakeLeasePool(pool);
  const secondLeasePool = new FakeLeasePool(pool);
  const first = storeFor(pool, "dsaas-instance-01", firstLeasePool);
  const second = storeFor(pool, "dsaas-instance-02", secondLeasePool);
  await first.initialize();
  await second.initialize();
  let releaseFirst;
  const held = new Promise((resolve) => { releaseFirst = resolve; });
  let entered;
  const firstStarted = new Promise((resolve) => { entered = resolve; });
  const firstRun = first.withResourceLock("dataspace:molit-test", async (lease) => {
    assert.equal(lease.fencingToken, "1");
    assert.equal(lease.holderId, "dsaas-instance-01");
    await first.transact((state) => { state.value += 1; });
    entered();
    await held;
    return "first";
  });
  await firstStarted;
  await assert.rejects(
    second.withResourceLock("dataspace:molit-test", async () => "second"),
    { code: "CONTROL_STORE_RESOURCE_LOCKED" },
  );
  releaseFirst();
  assert.equal(await firstRun, "first");
  const secondLease = await second.withResourceLock("dataspace:molit-test", async (lease) => ({
    fencingToken: lease.fencingToken,
    holderId: lease.holderId,
    signalSeen: lease.signal instanceof AbortSignal,
  }));
  assert.equal(secondLease.fencingToken, "2");
  assert.equal(secondLease.holderId, "dsaas-instance-02");
  assert.equal(secondLease.signalSeen, true);
  assert.equal(pool.fences.get("dsaas-test\0dataspace:molit-test").releasedAt !== null, true);
  assert.equal(await first.read((state) => state.value), 1);
  assert.equal(firstLeasePool.connectCount >= 2, true);
  assert.equal(secondLeasePool.connectCount >= 2, true);
});

test("concurrent leases do not starve a capacity-one state transaction pool", async () => {
  const pool = new FakePool({ max: 1 });
  const leasePool = new FakeLeasePool(pool, { max: 2 });
  const store = storeFor(pool, "dsaas-instance-01", leasePool);
  await store.initialize();
  let enteredCount = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const operation = (resourceId) => store.withResourceLock(resourceId, async () => {
    enteredCount += 1;
    if (enteredCount === 2) releaseBarrier();
    await barrier;
    await store.transact((state) => { state.value += 1; });
  }, { signal: AbortSignal.timeout(2_000) });
  await Promise.all([operation("dataspace:first"), operation("dataspace:second")]);
  assert.equal(await store.read((state) => state.value), 2);
  assert.equal(pool.max, 1);
  assert.equal(pool.active, 0);
  assert.equal(leasePool.active, 0);
});

test("a superseded resource fencing token cannot commit a snapshot", async () => {
  const pool = new FakePool();
  const leasePool = new FakeLeasePool(pool);
  const store = storeFor(pool, "dsaas-instance-01", leasePool);
  await store.initialize();
  await assert.rejects(
    store.withResourceLock("dataspace:molit-test", async () => {
      const fence = pool.fences.get("dsaas-test\0dataspace:molit-test");
      fence.fencingToken = "2";
      fence.holderId = "dsaas-instance-02";
      await store.transact((state) => { state.value = 7; });
    }),
    { code: "CONTROL_STORE_FENCE_LOST" },
  );
  assert.equal(await store.read((state) => state.value), 0);
});

test("an advisory connection error aborts the lease operation and prevents a late state commit", async () => {
  const pool = new FakePool();
  const leasePool = new FakeLeasePool(pool);
  const store = storeFor(pool, "dsaas-instance-01", leasePool);
  await store.initialize();
  const entered = Promise.withResolvers();
  const run = store.withResourceLock("dataspace:molit-test", async ({ signal }) => {
    entered.resolve();
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    await store.transact((state) => { state.value = 7; });
  });
  await entered.promise;
  leasePool.lastClient.emit("error", Object.assign(new Error("lease connection lost"), { code: "08006" }));
  await assert.rejects(run, { code: "CONTROL_STORE_UNAVAILABLE" });
  assert.equal(await store.read((state) => state.value), 0);
  assert.equal(pool.destroyedReleases, 1);
});

test("resource cleanup fails when the holder fencing row changed", async () => {
  const pool = new FakePool();
  const store = storeFor(pool);
  await store.initialize();
  await assert.rejects(
    store.withResourceLock("dataspace:molit-test", async () => {
      const fence = pool.fences.get("dsaas-test\0dataspace:molit-test");
      fence.holderId = "dsaas-instance-02";
      fence.fencingToken = "2";
    }),
    { code: "CONTROL_STORE_FENCE_LOST" },
  );
  assert.equal(pool.locks.size, 0);
});

test("resource cleanup timeout destroys the advisory-lock connection", async () => {
  const pool = new FakePool();
  const leasePool = new FakeLeasePool(pool);
  const store = storeFor(pool, "dsaas-instance-01", leasePool, { cleanupTimeoutMs: 25 });
  await store.initialize();
  pool.hangCleanupUpdate = true;
  await assert.rejects(
    store.withResourceLock("dataspace:molit-test", async () => {}),
    { code: "CONTROL_STORE_TIMEOUT" },
  );
  assert.equal(pool.destroyedReleases, 1);
  assert.equal(pool.locks.size, 0);
});

test("resource cleanup connection failure destroys the advisory-lock connection", async () => {
  const pool = new FakePool();
  const store = storeFor(pool);
  await store.initialize();
  pool.failCleanupUpdate = true;
  await assert.rejects(
    store.withResourceLock("dataspace:molit-test", async () => {}),
    { code: "CONTROL_STORE_UNAVAILABLE" },
  );
  assert.equal(pool.destroyedReleases, 1);
  assert.equal(pool.locks.size, 0);
});

test("resource fence COMMIT ambiguity destroys the session and reports unknown outcome", async () => {
  const pool = new FakePool();
  const store = storeFor(pool);
  await store.initialize();
  pool.failNextCommit = true;
  await assert.rejects(
    store.withResourceLock("dataspace:molit-test", async () => {}),
    { code: "CONTROL_STORE_COMMIT_UNKNOWN" },
  );
  assert.equal(pool.destroyedReleases, 1);
  assert.equal(pool.locks.size, 0);
});

test("pool creation requires explicit PostgreSQL TLS inputs and close drains the pool", async () => {
  assert.throws(
    () => createPostgresPool({
      config: {
        connectionStringEnv: "PG_URL",
        holderIdEnv: "INSTANCE_ID",
        applicationName: "dsaas-test",
        tls: { mode: "verify-full", caEnv: "PG_CA" },
        maxPoolSize: 2,
        maxLeasePoolSize: 2,
        connectionTimeoutMs: 1000,
        idleTimeoutMs: 1000,
        statementTimeoutMs: 5000,
        lockTimeoutMs: 1000,
      },
      env: { PG_URL: "postgresql://test:secret@localhost:5432/test", INSTANCE_ID: "instance-01" },
    }),
    { code: "CONTROL_STORE_SECRET_ENV_MISSING" },
  );
  assert.throws(
    () => createPostgresPool({
      config: {
        connectionStringEnv: "PG_URL",
        holderIdEnv: "INSTANCE_ID",
        applicationName: "dsaas-test",
        tls: { mode: "disable" },
        maxPoolSize: 1,
        maxLeasePoolSize: 1,
        connectionTimeoutMs: 1000,
        idleTimeoutMs: 1000,
        statementTimeoutMs: 5000,
        lockTimeoutMs: 1000,
      },
      env: {
        PG_URL: "postgresql://test:secret@localhost:5432/test?sslnegotiation=direct",
        INSTANCE_ID: "instance-01",
      },
    }),
    (error) => error.code === "CONTROL_STORE_CONFIG_INVALID" && error.details?.parameter === "sslnegotiation",
  );
  assert.throws(
    () => createPostgresPool({
      config: {
        connectionStringEnv: "PG_URL",
        holderIdEnv: "INSTANCE_ID",
        applicationName: "dsaas-test",
        tls: { mode: "disable" },
        maxPoolSize: 1,
        maxLeasePoolSize: 1,
        connectionTimeoutMs: 1000,
        idleTimeoutMs: 1000,
        statementTimeoutMs: 5000,
        lockTimeoutMs: 1000,
      },
      env: { PG_URL: "postgresql://test:secret@localhost:0/test", INSTANCE_ID: "instance-01" },
    }),
    { code: "CONTROL_STORE_CONFIG_INVALID" },
  );
  const created = createPostgresPool({
    config: {
      connectionStringEnv: "PG_URL",
      holderIdEnv: "INSTANCE_ID",
      applicationName: "dsaas-test",
      tls: { mode: "disable" },
      maxPoolSize: 1,
      maxLeasePoolSize: 3,
      connectionTimeoutMs: 1000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 5000,
      lockTimeoutMs: 1000,
    },
    env: { PG_URL: "postgresql://test:secret@localhost:5432/test", INSTANCE_ID: "instance-01" },
  });
  assert.notEqual(created.pool, created.leasePool);
  assert.equal(created.pool.options.max, 1);
  assert.equal(created.leasePool.options.max, 3);
  assert.equal(created.pool.options.sslnegotiation, "postgres");
  assert.equal(created.leasePool.options.sslnegotiation, "postgres");
  assert.equal(created.pool.options.options, "-c synchronous_commit=on");
  const priorOptions = process.env.PGOPTIONS;
  const priorBinary = process.env.PGBINARY;
  process.env.PGOPTIONS = "-c synchronous_commit=off";
  process.env.PGBINARY = "1";
  try {
    const client = new created.pool.Client(created.pool.options);
    assert.equal(client.connectionParameters.options, "-c synchronous_commit=on");
    assert.equal(client.connectionParameters.host, "localhost");
    assert.equal(client.connectionParameters.port, 5432);
    assert.equal(client.connectionParameters.user, "test");
    assert.equal(client.connectionParameters.database, "test");
    assert.equal(client.connectionParameters.sslnegotiation, "postgres");
    assert.equal(client.connectionParameters.binary, false);
    assert.equal(client.binary, false);
    await client.end();
  } finally {
    if (priorOptions === undefined) delete process.env.PGOPTIONS;
    else process.env.PGOPTIONS = priorOptions;
    if (priorBinary === undefined) delete process.env.PGBINARY;
    else process.env.PGBINARY = priorBinary;
  }
  for (const candidate of [created.pool, created.leasePool]) {
    assert.equal(candidate.options.query_timeout, 5000);
    assert.equal(candidate.options.statement_timeout, 5000);
    assert.equal(candidate.options.lock_timeout, 1000);
    assert.equal(candidate.options.idle_in_transaction_session_timeout, 5000);
  }
  await Promise.all([created.pool.end(), created.leasePool.end()]);
  const ipv6 = createPostgresPool({
    config: {
      connectionStringEnv: "PG_URL",
      holderIdEnv: "INSTANCE_ID",
      applicationName: "dsaas-ipv6-test",
      tls: { mode: "disable" },
      maxPoolSize: 1,
      maxLeasePoolSize: 1,
      connectionTimeoutMs: 1000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 5000,
      lockTimeoutMs: 1000,
    },
    env: { PG_URL: "postgresql://test:secret@[::1]:5432/test", INSTANCE_ID: "instance-01" },
  });
  assert.equal(ipv6.pool.options.host, "::1");
  await Promise.all([ipv6.pool.end(), ipv6.leasePool.end()]);
  const pool = new FakePool();
  const leasePool = new FakeLeasePool(pool);
  const store = storeFor(pool, "dsaas-instance-01", leasePool);
  await store.initialize();
  assert.deepEqual(await store.readiness(), { ready: true, status: "READY", failureCode: null });
  await store.close();
  assert.equal(pool.ended, true);
  assert.equal(leasePool.ended, true);
  assert.deepEqual(await store.readiness(), { ready: false, status: "CLOSED", failureCode: "CONTROL_STORE_CLOSED" });
});

test("store close destroys a PostgreSQL startup handshake before its deadline", async (t) => {
  const sockets = new Set();
  const listener = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    if (listener.listening) await new Promise((resolve) => listener.close(resolve));
  });
  const port = listener.address().port;
  const created = createPostgresPool({
    config: {
      connectionStringEnv: "PG_URL",
      holderIdEnv: "INSTANCE_ID",
      applicationName: "dsaas-handshake-test",
      tls: { mode: "disable" },
      maxPoolSize: 1,
      maxLeasePoolSize: 1,
      connectionTimeoutMs: 10_000,
      idleTimeoutMs: 10_000,
      statementTimeoutMs: 5_000,
      lockTimeoutMs: 1_000,
    },
    env: {
      PG_URL: `postgresql://test:test@127.0.0.1:${port}/test`,
      INSTANCE_ID: "instance-01",
    },
  });
  const store = storeFor(created.pool, "dsaas-instance-01", created.leasePool);
  const initialization = store.initialize().then(
    () => ({ initialized: true }),
    (error) => ({ error }),
  );
  await once(listener, "connection");
  const startedAt = Date.now();
  await store.close({ timeoutMs: 100 });
  assert.ok(Date.now() - startedAt < 500);
  const outcome = await Promise.race([
    initialization,
    new Promise((resolve) => setTimeout(() => resolve("timed-out"), 500)),
  ]);
  assert.notEqual(outcome, "timed-out");
  assert.ok(outcome.error instanceof Error);
  const socketDeadline = Date.now() + 100;
  while (sockets.size > 0 && Date.now() < socketDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(sockets.size, 0);
});

test("idle pool errors fail readiness without becoming unhandled process errors", async () => {
  const pool = new FakePool();
  const leasePool = new FakeLeasePool(pool);
  const store = storeFor(pool, "dsaas-instance-01", leasePool);
  await store.initialize();
  pool.emit("error", Object.assign(new Error("idle connection failed"), { code: "08006" }));
  pool.failNextConnect = true;
  assert.deepEqual(await store.readiness(), { ready: false, status: "NOT_READY", failureCode: "CONTROL_STORE_UNAVAILABLE" });
  assert.deepEqual(await store.readiness(), { ready: true, status: "READY", failureCode: null });
  await store.close();
});

test("an aborted readiness lease probe destroys its checked-out client", async () => {
  const pool = new FakePool();
  const leasePool = new FakeLeasePool(pool);
  const store = storeFor(pool, "dsaas-instance-01", leasePool);
  await store.initialize();
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  pool.hangNextReady = true;
  pool.hungReadyStarted = markStarted;
  const controller = new AbortController();
  const readiness = store.readiness({ signal: controller.signal });
  await started;
  controller.abort(new Error("request deadline expired"));
  const outcome = await Promise.race([
    readiness.then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve("timed-out"), 250)),
  ]);
  assert.notEqual(outcome, "timed-out");
  assert.equal(outcome.error.code, "CONTROL_STORE_ABORTED");
  assert.equal(leasePool.active, 0);
  assert.ok(pool.destroyedReleases >= 1);
  await store.close();
});

test("an aborted resource operation destroys the advisory-lock client even when the callback ignores abort", async () => {
  const pool = new FakePool();
  const leasePool = new FakeLeasePool(pool);
  const store = storeFor(pool, "dsaas-instance-01", leasePool);
  await store.initialize();
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const controller = new AbortController();
  const never = new Promise(() => {});
  void store.withResourceLock("dataspace:ignored-abort", async () => {
    markStarted();
    await never;
  }, { signal: controller.signal });
  await started;
  controller.abort(new Error("request deadline expired"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(leasePool.active, 0);
  assert.ok(pool.destroyedReleases >= 1);
  await store.close({ timeoutMs: 30 });
});

test("an aborted pool wait returns immediately and destroys a late client", async () => {
  const pool = new FakePool({ max: 1 });
  const leasePool = new FakeLeasePool(pool);
  const store = storeFor(pool, "dsaas-instance-01", leasePool);
  await store.initialize();
  let markFirstStarted;
  let releaseFirst;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = store.read(async () => {
    markFirstStarted();
    await firstGate;
  });
  await firstStarted;
  const controller = new AbortController();
  const waiting = store.read(() => null, { signal: controller.signal });
  while (pool.waiters.length === 0) await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error("request deadline expired"));
  const outcome = await Promise.race([
    waiting.then(
      () => ({ completed: true }),
      (error) => ({ error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve("timed-out"), 100)),
  ]);
  assert.notEqual(outcome, "timed-out");
  assert.equal(outcome.error.code, "CONTROL_STORE_ABORTED");
  releaseFirst();
  await first;
  while (pool.active > 0) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(pool.destroyedReleases >= 1);
  await store.close();
});

test("store close aborts an actual pg-pool capacity waiter", async () => {
  const database = {};
  const pool = new pg.Pool({
    Client: PgPoolCapacityClient,
    connectionTimeoutMillis: 800,
    idleTimeoutMillis: 10_000,
    max: 1,
    testDatabase: database,
  });
  const leasePool = new pg.Pool({
    Client: PgPoolCapacityClient,
    connectionTimeoutMillis: 800,
    idleTimeoutMillis: 10_000,
    max: 1,
    testDatabase: database,
  });
  const store = storeFor(pool, "dsaas-instance-01", leasePool, { cleanupTimeoutMs: 30 });
  await store.initialize();
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const never = new Promise(() => {});
  void store.read(async () => {
    markFirstStarted();
    await never;
  });
  await firstStarted;
  const waiting = store.read(() => null);
  while (pool.waitingCount === 0) await new Promise((resolve) => setImmediate(resolve));

  const startedAt = Date.now();
  const waitingOutcome = waiting.then(
    () => ({ completed: true }),
    (error) => ({ error }),
  );
  await store.close({ timeoutMs: 30 });
  const outcome = await Promise.race([
    waitingOutcome,
    new Promise((resolve) => setTimeout(() => resolve("timed-out"), 200)),
  ]);
  assert.notEqual(outcome, "timed-out");
  assert.equal(outcome.error.code, "CONTROL_STORE_CLOSED");
  assert.ok(Date.now() - startedAt < 300);
});

test("checked-out main client errors abort delayed callbacks and destroy the connection", async () => {
  const pool = new FakePool();
  const leasePool = new FakeLeasePool(pool);
  const store = storeFor(pool, "dsaas-instance-01", leasePool);
  await store.initialize();
  let releaseOperation;
  let markStarted;
  const gate = new Promise((resolve) => { releaseOperation = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const transaction = store.transact(async (state) => {
    markStarted();
    await gate;
    state.value += 1;
  });
  await started;
  pool.lastClient.emit("error", Object.assign(new Error("checked-out socket failed"), { code: "08006" }));
  releaseOperation();
  await assert.rejects(transaction, { code: "CONTROL_STORE_UNAVAILABLE" });
  assert.equal(pool.destroyedReleases >= 1, true);
  pool.failNextConnect = true;
  assert.equal((await store.readiness()).ready, false);
  assert.equal((await store.readiness()).ready, true);
  await store.close();
});

test("store close destroys held lease and main clients at one deadline", async () => {
  const pool = new FakePool();
  const leasePool = new FakeLeasePool(pool);
  const store = storeFor(pool, "dsaas-instance-01", leasePool);
  await store.initialize();
  let leaseSignal;
  let markLeaseStarted;
  let markMainStarted;
  const leaseStarted = new Promise((resolve) => { markLeaseStarted = resolve; });
  const mainStarted = new Promise((resolve) => { markMainStarted = resolve; });
  const never = new Promise(() => {});
  void store.withResourceLock("dataspace:road-space", async (lease) => {
    leaseSignal = lease.signal;
    markLeaseStarted();
    await never;
  });
  void store.read(async () => {
    markMainStarted();
    await never;
  });
  await Promise.all([leaseStarted, mainStarted]);

  const startedAt = Date.now();
  await store.close({ timeoutMs: 30 });
  assert.ok(Date.now() - startedAt < 500, "control-store close must honor its deadline");
  assert.equal(leaseSignal.aborted, true);
  assert.equal(pool.active, 0);
  assert.equal(leasePool.active, 0);
  assert.ok(pool.destroyedReleases >= 2);
});

test("DSaaS runtime initializes the PostgreSQL adapter before returning it", async () => {
  const pool = new FakePool();
  const leasePool = new FakeLeasePool(pool);
  const store = await createDsaasStateStore({
    config: {
      stateStore: {
        type: "postgres",
        statementTimeoutMs: 5_000,
        lockTimeoutMs: 1_000,
      },
      limits: { maxStateBytes: 1024 * 1024 },
    },
    env: {},
    projectionFactory: () => null,
    poolFactory: async ({ errorCodes }) => {
      assert.deepEqual(errorCodes, {
        configInvalid: "DSAAS_CONFIG_INVALID",
        secretMissing: "DSAAS_SECRET_ENV_MISSING",
      });
      return { holderId: "dsaas-instance-01", pool, leasePool };
    },
  });
  assert.equal((await store.read()).schemaVersion, "molit.dsaas-state/1");
  assert.equal(store.initialized, true);
  await store.close();
  assert.equal(pool.ended, true);
  assert.equal(leasePool.ended, true);
});
