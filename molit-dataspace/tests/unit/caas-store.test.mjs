import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileCaasStore, appendAudit, idempotencyReplay, loadCaasState, recordIdempotency, withCaasState } from "../../src/caas/store.mjs";
import { digest } from "../../src/discovery/stable-json.mjs";

test("state persists an audit hash chain and detects tampering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-store-"));
  const path = join(directory, "state.json");
  await withCaasState(path, (state) => {
    appendAudit(state, {
      tenantId: "road-operator",
      action: "TEST",
      actorRole: "admin",
      actorPrincipalId: "urn:test:principal:admin",
      actorClientId: "test-admin-client",
      actorKeyId: "test-admin-key-1",
    }, { maxAuditEvents: 100 });
  });
  const committed = await loadCaasState(path);
  assert.equal(committed.audit.length, 2);
  assert.equal(committed.audit.at(-1).action, "STATE_COMMITTED");
  assert.equal(committed.audit.at(-1).stateSnapshotDigest, committed.integrity.snapshotDigest);
  const raw = JSON.parse(await readFile(path, "utf8"));
  raw.audit[0].action = "TAMPERED";
  await writeFile(path, JSON.stringify(raw));
  await assert.rejects(loadCaasState(path), { code: "CAAS_AUDIT_CHAIN_INVALID" });
});

test("idempotency ledger replays identical input and rejects key reuse", () => {
  const state = { requests: {} };
  const first = idempotencyReplay(state, "tenant:x", "request-1", { value: 1 });
  recordIdempotency(state, first, { status: "ok" });
  assert.deepEqual(idempotencyReplay(state, "tenant:x", "request-1", { value: 1 }).result, { status: "ok" });
  assert.throws(() => idempotencyReplay(state, "tenant:x", "request-1", { value: 2 }), { code: "CAAS_IDEMPOTENCY_CONFLICT" });
});

test("state persistence rejects audit events without a complete authenticated actor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-store-actor-"));
  const path = join(directory, "state.json");
  await assert.rejects(withCaasState(path, (state) => {
    appendAudit(state, { tenantId: "road-operator", action: "TEST", actorRole: "admin" }, { maxAuditEvents: 100 });
  }), { code: "CAAS_AUDIT_ACTOR_INVALID" });
});

test("state snapshot integrity detects direct request-ledger mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-store-snapshot-"));
  const path = join(directory, "state.json");
  await withCaasState(path, (state) => {
    const replay = idempotencyReplay(state, "tenant:road-operator", "request-1", { value: 1 });
    recordIdempotency(state, replay, { status: "ok" });
  });
  const raw = JSON.parse(await readFile(path, "utf8"));
  Object.values(raw.requests)[0].result.status = "tampered";
  await writeFile(path, JSON.stringify(raw));
  await assert.rejects(loadCaasState(path), { code: "CAAS_STATE_SNAPSHOT_INVALID" });
});

test("non-empty state rejects a stripped audit log even with a recomputed binding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-store-stripped-audit-"));
  const path = join(directory, "state.json");
  await withCaasState(path, (state) => {
    const replay = idempotencyReplay(state, "tenant:road-operator", "request-1", { value: 1 });
    recordIdempotency(state, replay, { status: "ok" });
  });
  const raw = JSON.parse(await readFile(path, "utf8"));
  raw.audit = [];
  raw.integrity.auditHead = null;
  raw.integrity.bindingDigest = digest({ auditHead: null, snapshotDigest: raw.integrity.snapshotDigest });
  await writeFile(path, JSON.stringify(raw));
  await assert.rejects(loadCaasState(path), { code: "CAAS_STATE_SNAPSHOT_INVALID" });
});

test("an abort before the atomic replace leaves the committed state unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-store-abort-"));
  const path = join(directory, "state.json");
  await withCaasState(path, (state) => {
    const replay = idempotencyReplay(state, "tenant:road-operator", "request-1", { value: 1 });
    recordIdempotency(state, replay, { status: "committed" });
  });
  const before = await readFile(path, "utf8");
  const controller = new AbortController();
  const reason = new Error("shutdown deadline expired");
  await assert.rejects(withCaasState(path, (state) => {
    const replay = idempotencyReplay(state, "tenant:road-operator", "request-2", { value: 2 });
    recordIdempotency(state, replay, { status: "must-not-commit" });
    controller.abort(reason);
  }, { signal: controller.signal }), (error) => error === reason);
  assert.equal(await readFile(path, "utf8"), before);
  assert.equal(Object.keys((await loadCaasState(path)).requests).length, 1);
});

test("file store implements the runtime store interface with an explicit non-distributed lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-file-store-interface-"));
  const store = new FileCaasStore({ path: join(directory, "state.json"), maxBytes: 1_048_576, maxAuditEvents: 100 });
  await store.initialize();
  const lease = await store.withResourceLock("tenant:road-operator", (value) => ({
    resourceId: value.resourceId,
    holderId: value.holderId,
    fencingToken: value.fencingToken,
    acquiredAt: value.acquiredAt,
  }));
  assert.equal(lease.resourceId, "tenant:road-operator");
  assert.match(lease.holderId, /^file:/u);
  assert.equal(lease.fencingToken, null);
  assert.equal(Number.isNaN(Date.parse(lease.acquiredAt)), false);
  assert.deepEqual(await store.readiness(), { ready: true, status: "READY", failureCode: null });
  await store.close();
  assert.deepEqual(await store.readiness(), { ready: false, status: "CLOSED", failureCode: "CAAS_STATE_CLOSED" });
});
