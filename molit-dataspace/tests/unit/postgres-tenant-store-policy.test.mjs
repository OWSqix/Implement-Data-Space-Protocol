import assert from "node:assert/strict";
import test from "node:test";

import {
  bindTenantMetricLabels,
  tenantObjectKey,
  tenantSecretReference,
} from "../../src/control-store/postgres-tenant-store.mjs";

test("TENANT-POLICY-001: object keys are rooted in one tenant namespace", () => {
  assert.equal(
    tenantObjectKey("tenant-seoul-01", "exports/2026-07-14/catalog.json"),
    "tenants/tenant-seoul-01/exports/2026-07-14/catalog.json",
  );
  assert.throws(() => tenantObjectKey("tenant-seoul-01", "../tenant-busan-01/catalog.json"), {
    code: "TENANT_OBJECT_KEY_INVALID",
  });
  assert.throws(() => tenantObjectKey("tenant-seoul-01", "exports//catalog.json"), {
    code: "TENANT_OBJECT_KEY_INVALID",
  });
});

test("TENANT-POLICY-002: secret references carry the tenant namespace and no value", () => {
  assert.equal(
    tenantSecretReference("tenant-seoul-01", "vault://tenants/tenant-seoul-01/edc/control-plane"),
    "vault://tenants/tenant-seoul-01/edc/control-plane",
  );
  assert.equal(
    tenantSecretReference("tenant-seoul-01", "k8s-secret://molit-caas-tenant-seoul-01/edc-runtime#client-key"),
    "k8s-secret://molit-caas-tenant-seoul-01/edc-runtime#client-key",
  );
  assert.throws(
    () => tenantSecretReference("tenant-seoul-01", "vault://tenants/tenant-busan-01/edc/control-plane"),
    { code: "TENANT_SECRET_REF_INVALID" },
  );
  assert.throws(() => tenantSecretReference("tenant-seoul-01", "plain-text-secret"), {
    code: "TENANT_SECRET_REF_INVALID",
  });
});

test("TENANT-POLICY-003: metric labels cannot override the authorized tenant", () => {
  assert.deepEqual(bindTenantMetricLabels("tenant-seoul-01", { operation: "reconcile" }), {
    operation: "reconcile",
    "tenant.id": "tenant-seoul-01",
  });
  assert.throws(
    () => bindTenantMetricLabels("tenant-seoul-01", { "tenant.id": "tenant-busan-01" }),
    { code: "TENANT_METRIC_LABEL_MISMATCH" },
  );
});
