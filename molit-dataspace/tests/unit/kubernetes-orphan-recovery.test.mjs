import test from "node:test";
import assert from "node:assert/strict";
import { recoverKubernetesOrphans } from "../../src/caas/orphan-recovery.mjs";

function fixture() {
  const state = {
    tenants: { active: { tenantId: "active", adapterId: "kube-edc" } },
    audit: [],
  };
  let token = 0;
  const store = {
    supportsDistributedFencing: true,
    read(operation) { return Promise.resolve(operation(structuredClone(state))); },
    transact(operation) { return Promise.resolve(operation(state)); },
    withResourceLock(_resource, operation) {
      token += 1;
      return operation({ fencingToken: String(token), holderId: "recovery-worker", signal: undefined });
    },
  };
  const calls = [];
  const provisioner = {
    async listOrphans(activeTenantIds) {
      assert.deepEqual(activeTenantIds, ["active"]);
      return ["orphan-one", "orphan-two"];
    },
    async reclaimOrphan(tenantId, options) {
      calls.push({ tenantId, ...options });
      return { tenantId, fencingToken: options.fencingToken, reclaimed: true };
    },
  };
  const config = {
    adminPrincipalId: "urn:test:caas-admin",
    adminClientId: "test-caas-admin",
    adminKeyId: "test-caas-admin-key",
    limits: { maxAuditEvents: 100, maxTenants: 10 },
  };
  return { calls, config, provisioner, state, store };
}

test("orphan recovery acquires a fresh resource fence for each namespace and writes audit evidence", async () => {
  const value = fixture();
  const result = await recoverKubernetesOrphans({ config: value.config, store: value.store, provisioners: { "kube-edc": value.provisioner } });
  assert.deepEqual(result.receipts, [
    { tenantId: "orphan-one", reclaimed: true, fencingToken: "1" },
    { tenantId: "orphan-two", reclaimed: true, fencingToken: "2" },
  ]);
  assert.deepEqual(value.calls.map(({ tenantId, fencingToken, holderId }) => ({ tenantId, fencingToken, holderId })), [
    { tenantId: "orphan-one", fencingToken: "1", holderId: "recovery-worker" },
    { tenantId: "orphan-two", fencingToken: "2", holderId: "recovery-worker" },
  ]);
  assert.deepEqual(value.state.audit.map(({ tenantId, action, fencingToken }) => ({ tenantId, action, fencingToken })), [
    { tenantId: "orphan-one", action: "KUBERNETES_ORPHAN_RECLAIMED", fencingToken: "1" },
    { tenantId: "orphan-two", action: "KUBERNETES_ORPHAN_RECLAIMED", fencingToken: "2" },
  ]);
});

test("orphan recovery skips a namespace that becomes registered after the scan", async () => {
  const value = fixture();
  let reads = 0;
  value.store.read = (operation) => {
    reads += 1;
    if (reads === 2) value.state.tenants["orphan-one"] = { tenantId: "orphan-one", adapterId: "kube-edc" };
    return Promise.resolve(operation(structuredClone(value.state)));
  };
  const result = await recoverKubernetesOrphans({ config: value.config, store: value.store, provisioners: { "kube-edc": value.provisioner } });
  assert.deepEqual(result.receipts[0], { tenantId: "orphan-one", reclaimed: false, reason: "REGISTERED_DURING_SCAN" });
  assert.deepEqual(value.calls.map(({ tenantId }) => tenantId), ["orphan-two"]);
});

test("scoped orphan recovery scans bounded scopes and writes platform audit evidence", async () => {
  const value = fixture();
  const platformEvents = [];
  let page = 0;
  value.store.kind = "postgres-scoped";
  delete value.store.read;
  delete value.store.transact;
  value.store.listScopeIds = async ({ after, limit }) => {
    assert.equal(limit, 11);
    assert.equal(after, "");
    page += 1;
    return ["active", "other"];
  };
  value.store.readScope = async (tenantId, operation) => operation({
    tenants: { [tenantId]: { tenantId, adapterId: tenantId === "active" ? "kube-edc" : "other-adapter" } },
    requests: {},
    audit: [],
  });
  value.store.scopeExists = async () => false;
  value.store.appendPlatformAudit = async (operation, options) => {
    assert.match(options.absentScopeId, /^orphan-/u);
    const state = { tenants: {}, requests: {}, audit: [] };
    await operation(state);
    platformEvents.push(...state.audit);
  };
  const result = await recoverKubernetesOrphans({
    config: value.config,
    store: value.store,
    provisioners: { "kube-edc": value.provisioner },
  });
  assert.equal(page, 1);
  assert.deepEqual(result.receipts.map(({ tenantId, reclaimed }) => ({ tenantId, reclaimed })), [
    { tenantId: "orphan-one", reclaimed: true },
    { tenantId: "orphan-two", reclaimed: true },
  ]);
  assert.deepEqual(platformEvents.map(({ tenantId, orphanTenantId, action }) => ({ tenantId, orphanTenantId, action })), [
    { tenantId: "molit-platform", orphanTenantId: "orphan-one", action: "KUBERNETES_ORPHAN_RECLAIMED" },
    { tenantId: "molit-platform", orphanTenantId: "orphan-two", action: "KUBERNETES_ORPHAN_RECLAIMED" },
  ]);
});

test("orphan recovery refuses a state store without distributed fencing", async () => {
  const value = fixture();
  value.store.supportsDistributedFencing = false;
  await assert.rejects(
    recoverKubernetesOrphans({ config: value.config, store: value.store, provisioners: { "kube-edc": value.provisioner } }),
    { code: "CAAS_STATE_STORE_FENCING_REQUIRED" },
  );
});
