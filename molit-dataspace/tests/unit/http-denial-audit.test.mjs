import assert from "node:assert/strict";
import test from "node:test";

import { recordHttpDenial } from "../../src/control-store/http-denial-audit.mjs";

test("HTTP-DENIAL-AUDIT-001: tenant denial preserves actor, requested tenant, and trace attribution", async () => {
  const calls = [];
  const store = {
    async recordDenial(context, event) {
      calls.push({ context, event });
      return { eventId: "audit-1" };
    },
  };
  const result = await recordHttpDenial({
    actor: { principalId: "urn:principal:tenant-a", role: "tenant" },
    component: "caas",
    error: { code: "CAAS_TENANT_FORBIDDEN", details: { tenantId: "tenant-b" } },
    method: "GET",
    path: "/v1/tenants/tenant-b",
    requestId: "request-123",
    store,
    tenantId: "tenant-b",
    traceId: "a".repeat(32),
  });

  assert.deepEqual(result, { eventId: "audit-1" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].context, {
    accessMode: "service",
    actorId: "urn:principal:tenant-a",
    actorKind: "user",
    correlationId: "request-123",
    tenantId: "molit-platform",
    traceId: "a".repeat(32),
  });
  assert.equal(calls[0].event.reasonCode, "CAAS_TENANT_FORBIDDEN");
  assert.equal(calls[0].event.reportedAccessMode, "tenant");
  assert.equal(calls[0].event.requestedTenantId, "tenant-b");
  assert.equal(calls[0].event.resourceKind, "caas-http-request");
  assert.match(calls[0].event.resourceId, /^http:get:[a-f0-9]{32}$/u);
});

test("HTTP-DENIAL-AUDIT-002: anonymous malformed requests use bounded platform attribution", async () => {
  let captured;
  const store = {
    async recordDenial(context, event) {
      captured = { context, event };
      return { eventId: "audit-2" };
    },
  };

  await recordHttpDenial({
    actor: null,
    component: "dsaas",
    error: { code: "bad code with spaces", details: { tenantId: "../tenant-b" } },
    method: "POST",
    path: "/v1/dataspaces",
    requestId: "request-456",
    store,
    tenantId: null,
  });

  assert.equal(captured.context.actorId, "anonymous:request-456");
  assert.equal(captured.context.tenantId, "molit-platform");
  assert.match(captured.context.traceId, /^[a-f0-9]{32}$/u);
  assert.equal(captured.event.requestedTenantId, "molit-platform");
  assert.equal(captured.event.reasonCode, "BAD_CODE_WITH_SPACES");
  assert.equal(captured.event.reportedAccessMode, "service");
});

test("HTTP-DENIAL-AUDIT-003: an unconfigured audit store is a no-op", async () => {
  assert.equal(await recordHttpDenial({ store: null }), null);
});
