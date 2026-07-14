import test from "node:test";
import assert from "node:assert/strict";
import { ack, claim, emptyRuntimeState, enqueue, nack, recoverExpiredLeases, withRuntimeLock } from "../../src/bridge-runtime/durable-store.mjs";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { hostname } from "node:os";
import { join } from "node:path";

test("durable queue deduplicates, leases and acknowledges", () => {
  const state = emptyRuntimeState();
  const now = new Date("2026-07-13T00:00:00Z");
  assert.equal(enqueue(state, { idempotencyKey: "provider:a:1", payload: { a: 1 } }, now), true);
  assert.equal(enqueue(state, { idempotencyKey: "provider:a:1", payload: { a: 2 } }, now), false);
  const [item] = claim(state, { owner: "w1", now, leaseMs: 1_000 });
  assert.equal(item.status, "leased");
  ack(state, item.id, "w1", { ok: true }, now);
  assert.equal(state.queue[item.id], undefined);
  assert.equal(state.completed[item.id].result.ok, true);
  assert.equal(enqueue(state, { idempotencyKey: item.id, payload: {} }, now), false);
});

test("stale runtime lock fails closed until an operator removes it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-lock-"));
  const path = join(directory, "state.json");
  await writeFile(`${path}.lock`, JSON.stringify({ pid: 99999999, host: hostname(), acquiredAt: "2026-01-01T00:00:00Z" }));
  try {
    await assert.rejects(withRuntimeLock(path, (state) => { state.checkpoints.test = { unsafe: true }; }), /runtime state is locked/u);
    await unlink(`${path}.lock`);
    await withRuntimeLock(path, (state) => { state.checkpoints.test = { ok: true }; });
    const state = JSON.parse(await readFile(path, "utf8"));
    assert.equal(state.checkpoints.test.ok, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("expired lease is recovered and repeated nack enters dead-letter", () => {
  const state = emptyRuntimeState();
  const t0 = new Date("2026-07-13T00:00:00Z");
  enqueue(state, { idempotencyKey: "p:b:1", payload: {} }, t0);
  claim(state, { owner: "crashed", now: t0, leaseMs: 1_000 });
  const t1 = new Date("2026-07-13T00:00:02Z");
  assert.equal(recoverExpiredLeases(state, t1), 1);
  claim(state, { owner: "w2", now: t1, leaseMs: 1_000 });
  assert.equal(nack(state, "p:b:1", "w2", new Error("bad"), { maxAttempts: 1, now: t1 }), "dead");
  assert.equal(state.deadLetters["p:b:1"].lastError.message, "bad");
});
