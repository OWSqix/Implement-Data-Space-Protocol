import { appendAudit } from "./store.mjs";
import { assertCaas } from "./errors.mjs";

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("Kubernetes orphan recovery was aborted");
  error.name = "AbortError";
  throw error;
}

function isScopedStore(store) {
  return store?.kind === "postgres-scoped"
    && ["appendPlatformAudit", "listScopeIds", "readScope", "scopeExists"].every((method) => typeof store[method] === "function");
}

async function scopedActiveTenants({ config, store, adapterId, signal }) {
  const activeTenantIds = [];
  let after = "";
  let scanned = 0;
  while (true) {
    throwIfAborted(signal);
    const remaining = config.limits.maxTenants - scanned;
    const limit = Math.min(1_000, Math.max(1, remaining + 1));
    const tenantIds = await store.listScopeIds({ after, limit, signal });
    assertCaas(scanned + tenantIds.length <= config.limits.maxTenants,
      "CAAS_CAPACITY", "scope registry exceeds the configured tenant bound");
    assertCaas(tenantIds.every((tenantId, index) => tenantId > (index === 0 ? after : tenantIds[index - 1])),
      "CAAS_STATE_INVALID", "scope registry page is not strictly ordered");
    for (const tenantId of tenantIds) {
      const tenant = await store.readScope(tenantId, (state) => state.tenants[tenantId], { signal });
      if (tenant?.adapterId === adapterId) activeTenantIds.push(tenantId);
    }
    scanned += tenantIds.length;
    if (tenantIds.length < limit) break;
    after = tenantIds.at(-1);
  }
  return activeTenantIds;
}

export async function recoverKubernetesOrphans({ config, store, provisioners, signal, now = () => new Date() }) {
  throwIfAborted(signal);
  assertCaas(store?.supportsDistributedFencing === true,
    "CAAS_STATE_STORE_FENCING_REQUIRED", "orphan recovery requires the distributed PostgreSQL fencing store");
  const scoped = isScopedStore(store);
  const state = scoped ? null : await store.read((value) => value, { signal });
  const receipts = [];
  for (const [adapterId, provisioner] of Object.entries(provisioners)) {
    if (typeof provisioner.listOrphans !== "function" || typeof provisioner.reclaimOrphan !== "function") continue;
    const activeTenantIds = scoped
      ? await scopedActiveTenants({ config, store, adapterId, signal })
      : Object.values(state.tenants).filter((tenant) => tenant.adapterId === adapterId).map((tenant) => tenant.tenantId);
    const orphans = await provisioner.listOrphans(activeTenantIds, { signal });
    for (const tenantId of orphans) {
      throwIfAborted(signal);
      const receipt = await store.withResourceLock(`tenant:${tenantId}`, async (lease) => {
        assertCaas(/^[1-9][0-9]*$/u.test(lease.fencingToken ?? ""),
          "CAAS_PROVISIONER_FENCING_REQUIRED", "orphan recovery did not receive a PostgreSQL fencing token");
        const registered = scoped
          ? await store.scopeExists(tenantId, { signal: lease.signal })
          : await store.read((current) => Boolean(current.tenants[tenantId]), { signal: lease.signal });
        if (registered) return { tenantId, reclaimed: false, reason: "REGISTERED_DURING_SCAN" };
        const result = await provisioner.reclaimOrphan(tenantId, {
          fencingToken: lease.fencingToken,
          holderId: lease.holderId,
          signal: lease.signal,
        });
        if (scoped) {
          await store.appendPlatformAudit((current) => {
            appendAudit(current, {
              tenantId: "molit-platform",
              action: "KUBERNETES_ORPHAN_RECLAIMED",
              actorRole: "admin",
              actorPrincipalId: "urn:molit:principal:caas-orphan-controller",
              actorClientId: "molit-caas-orphan-controller",
              actorKeyId: "molit-caas-workload-identity",
              adapterId,
              orphanTenantId: tenantId,
              fencingToken: lease.fencingToken,
            }, { maxAuditEvents: config.limits.maxAuditEvents, now: now() });
          }, { absentScopeId: tenantId, signal: lease.signal });
        } else {
          await store.transact((current) => {
            assertCaas(!current.tenants[tenantId], "CAAS_RECONCILE_FENCE_VIOLATION", "tenant was registered while orphan recovery held its resource lock");
            appendAudit(current, {
              tenantId,
              action: "KUBERNETES_ORPHAN_RECLAIMED",
              actorRole: "admin",
              actorPrincipalId: "urn:molit:principal:caas-orphan-controller",
              actorClientId: "molit-caas-orphan-controller",
              actorKeyId: "molit-caas-workload-identity",
              adapterId,
              fencingToken: lease.fencingToken,
            }, { maxAuditEvents: config.limits.maxAuditEvents, now: now() });
          }, { signal: lease.signal });
        }
        return { tenantId, reclaimed: true, fencingToken: result.fencingToken };
      }, { signal });
      receipts.push(receipt);
    }
  }
  return { scannedProvisioners: Object.values(provisioners).filter((value) => typeof value.listOrphans === "function").length, receipts };
}
