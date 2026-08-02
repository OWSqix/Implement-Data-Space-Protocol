import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  buildUsageMeterEvent,
  correlatedAuditEvent,
  createLocalTestSignalExporter,
  createLocalTestWormBackend,
  ObservabilityError,
  OperationalTelemetry,
  tenantBucket,
  WormAuditExporter,
} from "../../src/observability/index.mjs";

const SALT = "molit-tenant-cardinality-salt-2026";
const NOW = new Date("2026-07-14T12:00:00.000Z");
const TRACE_ID = "a".repeat(32);
const CORRELATION_ID = "corr-observability-001";

test("two tenants receive isolated metric buckets without exporting tenant identifiers", async () => {
  const metricExporter = createLocalTestSignalExporter({ environment: "test", signal: "metrics" });
  const logExporter = createLocalTestSignalExporter({ environment: "test", signal: "logs" });
  const telemetry = new OperationalTelemetry({ metricExporter, logExporter, tenantSalt: SALT, component: "molit-caas", environment: "test", tenantBucketCount: 256, clock: () => NOW });
  const tenants = ["tenant-seoul-01", "tenant-busan-01"];
  assert.notEqual(tenantBucket(tenants[0], { salt: SALT, bucketCount: 256 }), tenantBucket(tenants[1], { salt: SALT, bucketCount: 256 }));
  for (const [index, tenantId] of tenants.entries()) {
    await telemetry.recordRequest({ tenantId, operation: "connector.ensure", statusCode: index === 0 ? 201 : 503, durationMs: 20 + index, correlationId: `corr-request-000${index}`, traceId: String(index + 1).repeat(32), spanId: String(index + 3).repeat(16) });
  }
  const countMetrics = metricExporter.items.filter((item) => item.name === "molit.request.count");
  assert.equal(countMetrics.length, 2);
  assert.notEqual(countMetrics[0].points[0].attributes["molit.tenant_bucket"], countMetrics[1].points[0].attributes["molit.tenant_bucket"]);
  const serialized = JSON.stringify({ metrics: metricExporter.items, logs: logExporter.items });
  assert.equal(serialized.includes(tenants[0]), false);
  assert.equal(serialized.includes(tenants[1]), false);
  assert.equal(telemetry.readiness().ready, true);
  await telemetry.recordOutboxHealth({ tenantId: tenants[0], eventType: "usage.meter.recorded", pending: 3, deadLettered: 1, oldestPendingAgeSeconds: 12.5 });
  const deadLetter = metricExporter.items.find((item) => item.name === "molit.outbox.dead_lettered");
  assert.equal(deadLetter.points[0].value, 1);
  assert.equal(deadLetter.points[0].attributes["molit.event_type"], "usage.meter.recorded");
});

test("trace, structured log, WORM audit, and usage event retain one correlation", async () => {
  const metricExporter = createLocalTestSignalExporter({ environment: "test", signal: "metrics" });
  const logExporter = createLocalTestSignalExporter({ environment: "test", signal: "logs" });
  const telemetry = new OperationalTelemetry({ metricExporter, logExporter, tenantSalt: SALT, component: "molit-caas", environment: "test", clock: () => NOW });
  const meter = buildUsageMeterEvent({
    component: "molit-caas",
    context: { accessMode: "service", actorId: "service:caas", correlationId: CORRELATION_ID, tenantId: "tenant-seoul-01", traceId: TRACE_ID },
    input: { meterName: "api.request", quantity: "1.000", occurredAt: NOW.toISOString(), sourceEventId: "source-event-001", sourceEventDigest: "c".repeat(64), dimensions: { operation: "connector.ensure" } },
    meterDefinitions: { "api.request": { purpose: "operational-non-billable", unit: "request", dimensionKeys: ["operation"] } },
  });
  await telemetry.recordMeterCommit({ tenantId: meter.tenantId, meterName: meter.meterName, unit: meter.unit, eventId: meter.eventId, correlationId: meter.correlationId, traceId: meter.traceId });
  const backend = createLocalTestWormBackend({ environment: "test" });
  const audit = new WormAuditExporter({ backend, environment: "test", retentionDays: 90, clock: () => NOW });
  await audit.initialize();
  const auditResult = await audit.append(correlatedAuditEvent({ type: "usage.meter.recorded", eventId: "audit-event-001", traceId: TRACE_ID, correlationId: CORRELATION_ID, actor: { id: "service:caas" }, subject: { eventId: meter.eventId }, data: { meterName: meter.meterName } }));
  const log = logExporter.items[0];
  assert.equal(log.traceId, meter.traceId);
  assert.equal(log.attributes["molit.correlation_id"], meter.correlationId);
  assert.equal(auditResult.record.traceId, meter.traceId);
  assert.equal(auditResult.record.actor.correlationId, meter.correlationId);
  assert.equal(auditResult.record.subject.eventId, meter.eventId);
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const schema = JSON.parse(await readFile(new URL("../../contracts/usage-meter-event.v1.schema.json", import.meta.url), "utf8"));
  assert.equal(ajv.validate(schema, meter), true, JSON.stringify(ajv.errors));
});

test("usage event builder rejects cross-tenant and unregistered dimensions", () => {
  const base = {
    component: "molit-caas",
    context: { accessMode: "service", actorId: "service:caas", correlationId: CORRELATION_ID, tenantId: "tenant-seoul-01", traceId: TRACE_ID },
    meterDefinitions: { "api.request": { purpose: "operational-non-billable", unit: "request", dimensionKeys: ["operation"] } },
  };
  assert.throws(() => buildUsageMeterEvent({ ...base, input: { tenantId: "tenant-busan-01", meterName: "api.request", quantity: "1", occurredAt: NOW.toISOString(), sourceEventId: "source-event-001", sourceEventDigest: "c".repeat(64), dimensions: {} } }), { code: "OBS_USAGE_TENANT_MISMATCH" });
  assert.throws(() => buildUsageMeterEvent({ ...base, input: { meterName: "api.request", quantity: "1", occurredAt: NOW.toISOString(), sourceEventId: "source-event-001", sourceEventDigest: "c".repeat(64), dimensions: { tenant: "leak" } } }), { code: "OBS_USAGE_DIMENSIONS_INVALID" });
});

test("a log-only success cannot hide a failed metrics pipeline", async () => {
  let failMetrics = false;
  const metricExporter = {
    mode: "local-test",
    async export() {
      if (failMetrics) throw new ObservabilityError("OBS_METRICS_UNAVAILABLE", "metrics unavailable");
      return { accepted: 1 };
    },
  };
  const logExporter = { mode: "local-test", async export() { return { accepted: 1 }; } };
  const telemetry = new OperationalTelemetry({ metricExporter, logExporter, tenantSalt: SALT, component: "molit-caas", environment: "test", clock: () => NOW });
  await telemetry.initialize();
  failMetrics = true;
  await assert.rejects(telemetry.recordRequest({ tenantId: "tenant-seoul-01", operation: "connector.ensure", statusCode: 200, durationMs: 1, correlationId: "corr-pipeline-0001", traceId: TRACE_ID }), { code: "OBS_METRICS_UNAVAILABLE" });
  await telemetry.recordMeterCommit({ tenantId: "tenant-seoul-01", meterName: "management.api.request", unit: "{request}", eventId: "pipeline-event-0001", correlationId: "corr-pipeline-0002", traceId: TRACE_ID });
  const failed = telemetry.readiness();
  assert.equal(failed.ready, false);
  assert.equal(failed.signals.metrics.lastFailure.code, "OBS_METRICS_UNAVAILABLE");
  assert.equal(failed.signals.logs.ready, true);
  failMetrics = false;
  assert.equal((await telemetry.probeReadiness()).ready, true);
});
