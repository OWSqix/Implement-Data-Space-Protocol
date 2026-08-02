import assert from "node:assert/strict";
import test from "node:test";

import { createOperationalObservabilityBundle } from "../../src/observability/index.mjs";

test("observability bundle gives audit close only the budget remaining after usage drain", async () => {
  let auditCloseBudget;
  let markClaimStarted;
  const claimStarted = new Promise((resolve) => { markClaimStarted = resolve; });
  const telemetry = {
    async recordUsageOutboxDelivery() {},
    async recordOutboxHealth() {},
    readiness() { return { ready: true }; },
    async close() {},
  };
  const audit = {
    tracer: {},
    auditExporter: {},
    createAuditDispatcher() { throw new Error("not used"); },
    async readiness() { return { ready: true }; },
    async close({ timeoutMs }) {
      auditCloseBudget = timeoutMs;
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    },
  };
  const bundle = await createOperationalObservabilityBundle({
    config: { service: {}, tracing: { tenantBucketCount: 64, tenantSaltRef: "salt" }, metrics: {}, logs: {} },
    secretResolver: async () => "unused",
    auditFactory: async () => audit,
    telemetryFactory: async () => telemetry,
  });
  const outbox = {
    async claim() { markClaimStarted(); await new Promise((resolve) => setTimeout(resolve, 50)); return []; },
    async acknowledge() {},
    async reject() {},
    async readiness() { return { deadLettered: 0, oldestPendingAt: null, pending: 0, ready: true }; },
  };
  const dispatcher = bundle.createUsageDispatcher({ outbox, pollIntervalMs: 1_000 });
  await dispatcher.start();
  await claimStarted;
  const timeoutMs = 80;
  const startedAt = Date.now();
  await bundle.close({ timeoutMs });
  const elapsedMs = Date.now() - startedAt;
  assert.ok(auditCloseBudget <= 40, `audit received ${auditCloseBudget} ms after usage drain`);
  assert.ok(elapsedMs <= 110, `bundle close exceeded one ${timeoutMs} ms budget: ${elapsedMs} ms`);
});

