import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

import { PostgresJsonStore, createPostgresPool } from "../../src/control-store/postgres-json-store.mjs";

const { Pool } = pg;
const connectionString = process.env.MOLIT_POSTGRES_INTEGRATION_URL;

function validate(state) {
  assert.equal(state?.schemaVersion, "test.postgres-control-state/1");
  assert.equal(Number.isSafeInteger(state.counter), true);
  return state;
}

function createStore(pool, leasePool, component, holderId) {
  return new PostgresJsonStore({
    pool,
    leasePool,
    component,
    holderId,
    initialState: () => ({ schemaVersion: "test.postgres-control-state/1", counter: 0 }),
    validateState: validate,
    sealState: (state) => state,
    statementTimeoutMs: 10_000,
    lockTimeoutMs: 5_000,
  });
}

function createRuntimePools(holderId, applicationName) {
  return createPostgresPool({
    config: {
      connectionStringEnv: "POSTGRES_URL",
      holderIdEnv: "POSTGRES_HOLDER_ID",
      applicationName,
      tls: { mode: "disable" },
      maxPoolSize: 1,
      maxLeasePoolSize: 2,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 5_000,
      statementTimeoutMs: 10_000,
      lockTimeoutMs: 5_000,
    },
    env: {
      POSTGRES_URL: connectionString,
      POSTGRES_HOLDER_ID: holderId,
    },
  });
}

test("Docker PostgreSQL serializes snapshots and fences competing instances", { skip: !connectionString, timeout: 30_000 }, async (t) => {
  const admin = new Pool({ connectionString, max: 2, ssl: false });
  const firstPools = createRuntimePools("dsaas-it-instance-01", "molit-dsaas-postgres-it-first");
  const secondPools = createRuntimePools("dsaas-it-instance-02", "molit-dsaas-postgres-it-second");
  const component = `dsaas-it-${randomUUID()}`;
  const first = createStore(firstPools.pool, firstPools.leasePool, component, firstPools.holderId);
  const second = createStore(secondPools.pool, secondPools.leasePool, component, secondPools.holderId);
  t.after(async () => {
    await first.close().catch(() => {});
    await second.close().catch(() => {});
    await admin.query("DELETE FROM molit_control_store.resource_fence WHERE component = $1", [component]).catch(() => {});
    await admin.query("DELETE FROM molit_control_store.json_snapshot WHERE component = $1", [component]).catch(() => {});
    await admin.end().catch(() => {});
  });
  const migration = await readFile(new URL("../../deploy/control-store/postgres/001_control_store.sql", import.meta.url), "utf8");
  await admin.query(migration);
  await first.initialize();
  await second.initialize();

  const firstStateSession = await firstPools.pool.query(
    "SELECT current_setting('application_name') AS application_name, current_setting('synchronous_commit') AS synchronous_commit, current_setting('client_encoding') AS client_encoding",
  );
  const firstLeaseSession = await firstPools.leasePool.query(
    "SELECT current_setting('application_name') AS application_name, current_setting('synchronous_commit') AS synchronous_commit",
  );
  assert.deepEqual(firstStateSession.rows[0], {
    application_name: "molit-dsaas-postgres-it-first",
    synchronous_commit: "on",
    client_encoding: "UTF8",
  });
  assert.deepEqual(firstLeaseSession.rows[0], {
    application_name: "molit-dsaas-postgres-it-first-lease",
    synchronous_commit: "on",
  });
  assert.equal(firstPools.holderId, "dsaas-it-instance-01");
  assert.equal(secondPools.holderId, "dsaas-it-instance-02");

  let firstEntered;
  const selected = new Promise((resolve) => { firstEntered = resolve; });
  const firstWrite = first.transact(async (state) => {
    firstEntered();
    await new Promise((resolve) => setTimeout(resolve, 75));
    state.counter += 1;
  });
  await selected;
  const secondWrite = second.transact((state) => { state.counter += 1; });
  await Promise.all([firstWrite, secondWrite]);
  assert.equal(await first.read((state) => state.counter), 2);

  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  let lockEntered;
  const locked = new Promise((resolve) => { lockEntered = resolve; });
  const holder = first.withResourceLock("dataspace:molit-it", async (lease) => {
    assert.equal(lease.fencingToken, "1");
    assert.equal(lease.holderId, "dsaas-it-instance-01");
    await first.transact((state) => { state.counter += 1; });
    lockEntered();
    await hold;
  });
  await locked;
  await assert.rejects(
    second.withResourceLock("dataspace:molit-it", async () => {}),
    { code: "CONTROL_STORE_RESOURCE_LOCKED" },
  );
  release();
  await holder;
  assert.equal(await second.read((state) => state.counter), 3);
  const nextFence = await second.withResourceLock("dataspace:molit-it", async (lease) => ({
    fencingToken: lease.fencingToken,
    holderId: lease.holderId,
  }));
  assert.deepEqual(nextFence, { fencingToken: "2", holderId: "dsaas-it-instance-02" });

  let enteredCount = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const concurrentLease = (resourceId) => first.withResourceLock(resourceId, async () => {
    enteredCount += 1;
    if (enteredCount === 2) releaseBarrier();
    await barrier;
    await first.transact((state) => { state.counter += 1; });
  }, { signal: AbortSignal.timeout(5_000) });
  await Promise.all([
    concurrentLease("dataspace:parallel-a"),
    concurrentLease("dataspace:parallel-b"),
  ]);
  assert.equal(await first.read((state) => state.counter), 5);
});
