import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCaaSRuntime, createCaasStateStore } from "../../src/caas/runtime.mjs";
import { CaaSError } from "../../src/caas/errors.mjs";
import { appendAudit } from "../../src/caas/store.mjs";

class FakeDatabase {
  constructor({ migrationVersion = 1 } = {}) {
    this.migrationVersion = migrationVersion;
    this.snapshots = new Map();
    this.fences = new Map();
    this.locks = new Map();
    this.clientSequence = 0;
    this.queries = [];
  }
}

class FakeClient extends EventEmitter {
  constructor(database, owner) {
    super();
    this.database = database;
    this.owner = owner;
    this.id = ++database.clientSequence;
    this.released = false;
  }

  async query(text, values = []) {
    const sql = text.replace(/\s+/gu, " ").trim();
    this.database.queries.push({ clientId: this.id, pool: this.owner.name, sql, values: structuredClone(values) });
    if (["BEGIN", "BEGIN READ ONLY", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: null, rows: [] };
    if (sql === "SELECT 1 AS ready") return { rowCount: 1, rows: [{ ready: 1 }] };
    if (sql.startsWith("SELECT set_config")) return { rowCount: 1, rows: [{ set_config: values[0] }] };
    if (sql.includes("FROM molit_control_store.schema_migration")) {
      return this.database.migrationVersion === null
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ version: this.database.migrationVersion }] };
    }
    if (sql.endsWith("WHERE false")) return { rowCount: 0, rows: [] };
    if (sql.startsWith("INSERT INTO molit_control_store.json_snapshot")) {
      if (!this.database.snapshots.has(values[0])) {
        this.database.snapshots.set(values[0], { revision: "1", state: JSON.parse(values[1]), updatedAt: values[2] });
      }
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith("SELECT state FROM molit_control_store.json_snapshot")
      || sql.startsWith("SELECT revision, state FROM molit_control_store.json_snapshot")) {
      const record = this.database.snapshots.get(values[0]);
      return record
        ? { rowCount: 1, rows: [{ revision: record.revision, state: structuredClone(record.state) }] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("UPDATE molit_control_store.json_snapshot")) {
      const record = this.database.snapshots.get(values[0]);
      if (!record || record.revision !== String(values[3])) return { rowCount: 0, rows: [] };
      record.revision = String(BigInt(record.revision) + 1n);
      record.state = JSON.parse(values[1]);
      record.updatedAt = values[2];
      return { rowCount: 1, rows: [{ revision: record.revision }] };
    }
    if (sql.startsWith("SELECT pg_try_advisory_lock")) {
      const owner = this.database.locks.get(values[0]);
      if (owner !== undefined && owner !== this.id) return { rowCount: 1, rows: [{ acquired: false }] };
      this.database.locks.set(values[0], this.id);
      return { rowCount: 1, rows: [{ acquired: true }] };
    }
    if (sql.startsWith("INSERT INTO molit_control_store.resource_fence")) {
      const key = `${values[0]}\0${values[1]}`;
      const prior = this.database.fences.get(key);
      const fencingToken = prior ? String(BigInt(prior.fencingToken) + 1n) : "1";
      const record = { fencingToken, holderId: values[2], acquiredAt: new Date().toISOString(), releasedAt: null };
      this.database.fences.set(key, record);
      return { rowCount: 1, rows: [{ fencing_token: fencingToken, holder_id: record.holderId, acquired_at: record.acquiredAt }] };
    }
    if (sql.startsWith("SELECT fencing_token::text, holder_id, released_at")) {
      const record = this.database.fences.get(`${values[0]}\0${values[1]}`);
      return record
        ? { rowCount: 1, rows: [{ fencing_token: record.fencingToken, holder_id: record.holderId, released_at: record.releasedAt }] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("UPDATE molit_control_store.resource_fence")) {
      const record = this.database.fences.get(`${values[0]}\0${values[1]}`);
      const updated = record && record.holderId === values[2] && record.fencingToken === values[3] && record.releasedAt === null;
      if (updated) record.releasedAt = new Date().toISOString();
      return { rowCount: updated ? 1 : 0, rows: [] };
    }
    if (sql.startsWith("SELECT pg_advisory_unlock")) {
      const unlocked = this.database.locks.get(values[0]) === this.id;
      if (unlocked) this.database.locks.delete(values[0]);
      return { rowCount: 1, rows: [{ unlocked }] };
    }
    throw new Error(`unexpected fake PostgreSQL query: ${sql}`);
  }

  release(destroy = false) {
    if (this.released) return;
    this.released = true;
    if (destroy) {
      this.owner.destroyedReleases += 1;
      for (const [name, owner] of this.database.locks) if (owner === this.id) this.database.locks.delete(name);
    }
    this.owner.releaseClient();
  }
}

class FakePool extends EventEmitter {
  constructor(database, name) {
    super();
    this.database = database;
    this.name = name;
    this.active = 0;
    this.ended = false;
    this.destroyedReleases = 0;
    this.endResolvers = [];
  }

  async connect() {
    if (this.ended) throw Object.assign(new Error("pool is closed"), { code: "POOL_CLOSED" });
    this.active += 1;
    return new FakeClient(this.database, this);
  }

  releaseClient() {
    this.active -= 1;
    if (this.ended && this.active === 0) this.endResolvers.splice(0).forEach((resolve) => resolve());
  }

  async end() {
    this.ended = true;
    if (this.active > 0) await new Promise((resolve) => this.endResolvers.push(resolve));
  }
}

function stateConfig() {
  return {
    stateStore: {
      type: "postgres",
      connectionStringEnv: "CAAS_DATABASE_URL",
      holderIdEnv: "CAAS_HOLDER_ID",
      applicationName: "molit-caas-test",
      tls: { mode: "disable" },
      maxPoolSize: 4,
      maxLeasePoolSize: 2,
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 10_000,
      statementTimeoutMs: 5_000,
      lockTimeoutMs: 1_000,
    },
    limits: { maxStateBytes: 1_048_576, maxAuditEvents: 100 },
  };
}

function poolFactory(database, holderId, pools) {
  return async () => {
    const pool = new FakePool(database, `${holderId}-data`);
    const leasePool = new FakePool(database, `${holderId}-lease`);
    pools.push(pool, leasePool);
    return { holderId, pool, leasePool };
  };
}

function addTestAudit(state, action) {
  appendAudit(state, {
    action,
    actorRole: "admin",
    actorPrincipalId: "urn:test:principal:caas-admin",
    actorClientId: "test-caas-admin-client",
    actorKeyId: "test-caas-admin-key-1",
  }, { maxAuditEvents: 100, now: new Date() });
}

test("CaaS PostgreSQL store initializes and commits a validated snapshot", async () => {
  const database = new FakeDatabase();
  const pools = [];
  const store = await createCaasStateStore({
    config: stateConfig(),
    poolFactory: poolFactory(database, "caas-instance-01", pools),
  });
  await store.transact((state) => addTestAudit(state, "TEST_SNAPSHOT_UPDATED"));
  const state = await store.read();
  assert.equal(state.schemaVersion, "molit.caas-state/1");
  assert.equal(state.audit.some(({ action }) => action === "TEST_SNAPSHOT_UPDATED"), true);
  assert.equal(database.queries.some(({ sql }) => sql.includes("FOR UPDATE")), true);
  assert.equal(database.queries.some(({ pool }) => pool.endsWith("-lease")), true);
  await store.close();
  assert.equal(pools.every(({ ended }) => ended), true);
});

test("CaaS PostgreSQL tenant leases reject overlap and advance fencing tokens", async () => {
  const database = new FakeDatabase();
  const first = await createCaasStateStore({ config: stateConfig(), poolFactory: poolFactory(database, "caas-instance-01", []) });
  const second = await createCaasStateStore({ config: stateConfig(), poolFactory: poolFactory(database, "caas-instance-02", []) });
  let releaseFirst;
  const hold = new Promise((resolve) => { releaseFirst = resolve; });
  let firstLease;
  const running = first.withResourceLock("tenant:road-operator", async (lease) => {
    firstLease = lease;
    await first.transact((state) => addTestAudit(state, "TEST_FENCED_UPDATE"), { signal: lease.signal });
    await hold;
  });
  while (!firstLease) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    second.withResourceLock("tenant:road-operator", () => null),
    { code: "CAAS_TENANT_BUSY" },
  );
  releaseFirst();
  await running;
  const secondLease = await second.withResourceLock("tenant:road-operator", (lease) => ({
    fencingToken: lease.fencingToken,
    holderId: lease.holderId,
  }));
  assert.equal(firstLease.fencingToken, "1");
  assert.deepEqual(secondLease, { fencingToken: "2", holderId: "caas-instance-02" });
  await Promise.all([first.close(), second.close()]);
});

test("CaaS PostgreSQL operations preserve the request timeout reason", async () => {
  const store = await createCaasStateStore({
    config: stateConfig(),
    poolFactory: poolFactory(new FakeDatabase(), "caas-instance-01", []),
  });
  let markStarted;
  let releaseOperation;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const operation = new Promise((resolve) => { releaseOperation = resolve; });
  const controller = new AbortController();
  const reading = store.read(async () => {
    markStarted();
    await operation;
  }, { signal: controller.signal });
  await started;
  const reason = new CaaSError("CAAS_REQUEST_TIMEOUT", "request timed out", { status: 408 });
  controller.abort(reason);
  releaseOperation();
  await assert.rejects(reading, (error) => error === reason && error.status === 408);
  const domainError = new CaaSError("CAAS_TENANT_NOT_FOUND", "tenant was not found", { status: 404 });
  await assert.rejects(
    store.transact(() => { throw domainError; }),
    (error) => error === domainError && error.status === 404,
  );
  await store.close();
});

test("CaaS PostgreSQL initialization failure closes data and lease pools", async () => {
  const database = new FakeDatabase({ migrationVersion: null });
  const pools = [];
  await assert.rejects(createCaasStateStore({
    config: stateConfig(),
    poolFactory: poolFactory(database, "caas-instance-01", pools),
  }), { code: "CAAS_STATE_MIGRATION_REQUIRED" });
  assert.equal(pools.length, 2);
  assert.equal(pools.every(({ ended }) => ended), true);
});

test("CaaS runtime gives server drain and store close one absolute deadline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-runtime-deadline-"));
  const fixturePath = new URL("../../fixtures/caas/config.example.json", import.meta.url);
  const config = JSON.parse(await readFile(fixturePath, "utf8"));
  config.listen.port = 0;
  config.stateStore = stateConfig().stateStore;
  config.provisioners["edc-intent-v1"].manifestDirectory = join(directory, "intents");
  const configPath = join(directory, "caas-config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const database = new FakeDatabase();
  const pools = [];
  const closeCalls = [];
  const runtime = await createCaaSRuntime({
    configPath,
    env: {
      MOLIT_CAAS_ADMIN_TOKEN: "caas-runtime-admin-secret",
      MOLIT_CAAS_DSAAS_CONTROLLER_TOKEN: "caas-runtime-controller-secret",
      CAAS_DATABASE_URL: "postgresql://test:secret@unused:5432/test",
      CAAS_HOLDER_ID: "caas-runtime-01",
    },
    poolFactory: poolFactory(database, "caas-runtime-01", pools),
    serverFactory: () => ({
      listening: false,
      caasSetReady() {},
      async closeGracefully(options) {
        closeCalls.push({ component: "server", ...options });
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, options.deadline - Date.now())));
      },
    }),
  });
  const originalStoreClose = runtime.store.close.bind(runtime.store);
  runtime.store.close = (options) => {
    closeCalls.push({ component: "store", ...options });
    return originalStoreClose(options);
  };
  let leaseSignal;
  let markLeaseStarted;
  const leaseStarted = new Promise((resolve) => { markLeaseStarted = resolve; });
  const never = new Promise(() => {});
  void runtime.store.withResourceLock("tenant:held-at-shutdown", async (lease) => {
    leaseSignal = lease.signal;
    markLeaseStarted();
    await never;
  });
  await leaseStarted;

  const deadline = Date.now() + 40;
  const startedAt = Date.now();
  await runtime.close({ deadline, timeoutMs: 5_000 });
  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(closeCalls.map(({ component, deadline: value }) => ({ component, deadline: value })), [
    { component: "server", deadline },
    { component: "store", deadline },
  ]);
  assert.equal(leaseSignal.aborted, true);
  assert.equal(pools.every(({ active }) => active === 0), true);
  assert.ok(pools.reduce((total, pool) => total + pool.destroyedReleases, 0) >= 1);
});
