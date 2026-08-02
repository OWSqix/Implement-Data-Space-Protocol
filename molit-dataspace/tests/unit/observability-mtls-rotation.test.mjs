import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createRotatingMtlsDispatcher } from "../../src/observability/index.mjs";

const FIXTURES = new URL("../fixtures/identity-tls/", import.meta.url);
const [ca, clientCert, clientKey, nextCert, nextKey] = await Promise.all([
  readFile(new URL("root.crt", FIXTURES), "utf8"),
  readFile(new URL("client.crt", FIXTURES), "utf8"),
  readFile(new URL("client.key", FIXTURES), "utf8"),
  readFile(new URL("server-one.crt", FIXTURES), "utf8"),
  readFile(new URL("server-one.key", FIXTURES), "utf8"),
]);

test("mTLS dispatcher atomically rotates validated agents without interrupting an in-flight request", async () => {
  const material = new Map([["ca", ca], ["cert", clientCert], ["key", clientKey]]);
  const agents = [];
  let releaseFirst;
  const firstDrained = new Promise((resolve) => { releaseFirst = resolve; });
  const dispatcher = await createRotatingMtlsDispatcher({
    tls: { caRef: "ca", certificateRef: "cert", privateKeyRef: "key", serverName: "collector.example", reloadIntervalMs: 300_000 },
    secretResolver: async (reference) => material.get(reference),
    clock: () => new Date("2026-07-14T12:00:00.000Z"),
    agentFactory(options) {
      const ordinal = agents.length;
      const agent = {
        options,
        dispatches: 0,
        closed: false,
        dispatch() { this.dispatches += 1; return true; },
        async close() { if (ordinal === 0) await firstDrained; this.closed = true; },
      };
      agents.push(agent);
      return agent;
    },
  });
  assert.equal(dispatcher.readiness().generation, 1);
  dispatcher.dispatch({}, {});
  material.set("cert", nextCert);
  material.set("key", nextKey);
  assert.equal(await dispatcher.reload(), true);
  assert.equal(dispatcher.readiness().generation, 2);
  dispatcher.dispatch({}, {});
  assert.equal(agents[0].dispatches, 1);
  assert.equal(agents[1].dispatches, 1);
  assert.equal(agents[0].closed, false, "retired agent must drain its in-flight request");
  releaseFirst();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(agents[0].closed, true);
  await dispatcher.close();
  assert.equal(agents[1].closed, true);
});

test("invalid replacement is never activated, marks readiness down, and recovery increments generation", async () => {
  const material = new Map([["ca", ca], ["cert", clientCert], ["key", clientKey]]);
  const agents = [];
  const dispatcher = await createRotatingMtlsDispatcher({
    tls: { caRef: "ca", certificateRef: "cert", privateKeyRef: "key", serverName: "collector.example", reloadIntervalMs: 300_000 },
    secretResolver: async (reference) => material.get(reference),
    clock: () => new Date("2026-07-14T12:00:00.000Z"),
    agentFactory(options) { const agent = { options, dispatches: 0, dispatch() { this.dispatches += 1; return true; }, async close() {} }; agents.push(agent); return agent; },
  });
  const activeDigest = dispatcher.readiness().activeDigest;
  material.set("cert", nextCert);
  material.set("key", clientKey);
  assert.equal(await dispatcher.reload(), false);
  assert.deepEqual(dispatcher.readiness(), {
    activeDigest,
    failureCode: "OBS_TLS_ROTATION_FAILED",
    generation: 1,
    lastSuccessAt: "2026-07-14T12:00:00.000Z",
    ready: false,
    status: "NOT_READY",
  });
  dispatcher.dispatch({}, {});
  assert.equal(agents.length, 1, "invalid material must not create or activate a candidate agent");
  assert.equal(agents[0].dispatches, 1, "the last validated agent remains available while readiness is failed");
  material.set("cert", clientCert);
  assert.equal(await dispatcher.reload(), true);
  assert.equal(dispatcher.readiness().generation, 2);
  assert.equal(dispatcher.readiness().ready, true);
  await dispatcher.close();
});

