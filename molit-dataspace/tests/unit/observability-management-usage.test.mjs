import assert from "node:assert/strict";
import test from "node:test";

import { ManagementUsageRecorder, managementAccountingTenant, managementOperation, managementUsageMeterOptions, ObservabilityError } from "../../src/observability/index.mjs";

const CONFIG = Object.freeze({
  purpose: "operational-non-billable",
  meterName: "management.api.request",
  unit: "{request}",
  dimensionKeys: ["operation", "outcome"],
  maximumEventAgeDays: 400,
  maximumFutureSkewMs: 300_000,
  maxAttempts: 3,
  retryBaseMs: 10,
  outbox: { maxAttempts: 12, batchSize: 50, leaseMs: 30_000, pollIntervalMs: 1_000, retryBaseMs: 1_000, retryMaxMs: 300_000, healthIntervalMs: 30_000 },
});

test("management usage policy maps only authenticated tenant business operations", () => {
  assert.equal(managementOperation("caas", "POST", "/v1/tenants"), "tenant.register");
  assert.equal(managementOperation("caas", "POST", "/v1/connectors/ensure"), "connector.ensure");
  assert.equal(managementOperation("dsaas", "POST", "/v1/dataspaces"), "dataspace.create");
  assert.equal(managementOperation("dsaas", "POST", "/v1/dataspaces/road-space/participants/road-provider/approval"), "participant.approve");
  assert.equal(managementOperation("caas", "GET", "/healthz"), null);
  assert.equal(managementOperation("dsaas", "GET", "/readyz"), null);
  assert.equal(managementOperation("caas", "GET", "/unknown"), null);
  assert.equal(managementAccountingTenant({ authenticated: true, requestedTenantId: "tenant-seoul-01", statusCode: 200 }), "tenant-seoul-01");
  assert.equal(managementAccountingTenant({ authenticated: true, requestedTenantId: "tenant-missing-01", statusCode: 404 }), "molit-platform");
  assert.equal(managementAccountingTenant({ authenticated: true, requestedTenantId: "tenant-forbidden-01", statusCode: 403 }), "molit-platform");
  assert.equal(managementAccountingTenant({ authenticated: true, requestedTenantId: "not valid", statusCode: 201 }), "molit-platform");
  assert.equal(managementAccountingTenant({ authenticated: false, requestedTenantId: "tenant-seoul-01", statusCode: 401 }), null);
  assert.deepEqual(managementUsageMeterOptions(CONFIG).meterDefinitions["management.api.request"], {
    purpose: "operational-non-billable", unit: "{request}", dimensionKeys: ["operation", "outcome"],
  });
});

test("management usage recorder retries a durable ledger write and retains request, trace, and span correlation", async () => {
  const calls = [];
  const telemetryCalls = [];
  const sleeps = [];
  const meter = {
    attempts: 0,
    async record(context, input) {
      calls.push({ context, input });
      this.attempts += 1;
      if (this.attempts === 1) throw new ObservabilityError("OBS_USAGE_RECORD_FAILED", "temporary database failure");
      return { eventId: "e".repeat(64), replayed: false };
    },
    async readiness() { return { ready: true, status: "READY" }; },
  };
  const recorder = new ManagementUsageRecorder({
    meter,
    telemetry: { async recordMeterCommit(value) { telemetryCalls.push(value); } },
    component: "caas",
    config: CONFIG,
    clock: () => new Date("2026-07-14T12:00:00.000Z"),
    sleeper: async (ms) => { sleeps.push(ms); },
  });
  const result = await recorder.record({
    tenantId: "tenant-seoul-01",
    operation: "connector.ensure",
    statusCode: 503,
    requestId: "request-correlation-001",
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [10]);
  assert.equal(calls[0].input.sourceEventId.length, 64);
  assert.equal(calls[0].input.sourceEventId, calls[1].input.sourceEventId);
  assert.equal(calls[0].input.dimensions.outcome, "failure");
  assert.equal(result.completionFact.purpose, "operational-non-billable");
  assert.equal(result.completionFact.spanId, "b".repeat(16));
  assert.deepEqual(telemetryCalls[0], {
    tenantId: "tenant-seoul-01",
    meterName: "management.api.request",
    unit: "{request}",
    purpose: "operational-non-billable",
    eventId: "e".repeat(64),
    result: "committed",
    correlationId: "request-correlation-001",
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
  });
  assert.equal((await recorder.readiness()).ready, true);
  await recorder.close();
});
