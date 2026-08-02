import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("collector defines trace, metric, and log pipelines with durable retry storage", async () => {
  const yaml = await readFile(new URL("deploy/observability/otel-collector.production.yaml", root), "utf8");
  for (const signal of ["traces", "metrics", "logs"]) assert.match(yaml, new RegExp(`    ${signal}:\\r?\\n[\\s\\S]*?receivers: \\[otlp\\]`, "u"));
  assert.match(yaml, /file_storage:[\s\S]*fsync: true/u);
  assert.match(yaml, /sending_queue:[\s\S]*storage: file_storage/u);
  assert.match(yaml, /block_on_overflow: true/u);
  assert.match(yaml, /max_elapsed_time: 0s/u);
  assert.doesNotMatch(yaml, /max_elapsed_time: 300s/u);
  assert.match(yaml, /check_collector_pipeline:[\s\S]*enabled: true/u);
  assert.match(yaml, /logs:\r?\n\s+receivers: \[otlp\]\r?\n\s+processors: \[memory_limiter, attributes\/security\]/u);
  assert.match(yaml, /metrics:[\s\S]*readers:[\s\S]*prometheus:[\s\S]*port: 8888/u);
  assert.match(yaml, /client_ca_file:/u);
  assert.match(yaml, /bearertokenauth\/upstream:/u);
  assert.match(yaml, /bearertokenauth\/ingress:[\s\S]*filename: \/run\/secrets\/ingress_token/u);
  assert.match(yaml, /http:[\s\S]*auth:[\s\S]*authenticator: bearertokenauth\/ingress/u);
  assert.match(yaml, /extensions: \[file_storage, health_check, bearertokenauth\/upstream, bearertokenauth\/ingress\]/u);
  const verifier = await readFile(new URL("deploy/observability/verify-collector-config.ps1", root), "utf8");
  assert.match(verifier, /opentelemetry-collector-contrib@sha256:[a-f0-9]{64}/u);
  assert.match(verifier, / validate --config=/u);
});

test("Prometheus rules cover thirty-day SLI values and multi-window budget alerts", async () => {
  const yaml = await readFile(new URL("deploy/observability/prometheus-rules.yaml", root), "utf8");
  for (const record of ["request_count", "server_error_count", "latency_eligible_count", "latency_good_count"]) assert.match(yaml, new RegExp(`record: molit:sli_${record}:30d`, "u"));
  for (const alert of ["MolitAvailabilityBudgetFastBurn", "MolitAvailabilityBudgetSlowBurn", "MolitLatencyBudgetFastBurn", "MolitLatencyBudgetSlowBurn", "MolitUsageMeterOutboxDeadLetter", "MolitOtlpExporterUnavailable", "MolitOtelCollectorQueueSaturation", "MolitOtelCollectorQueueEnqueueFailure"]) assert.match(yaml, new RegExp(`alert: ${alert}`, "u"));
  assert.match(yaml, /ratio_1h[\s\S]*ratio_5m/u);
  assert.match(yaml, /ratio_6h[\s\S]*ratio_30m/u);
  assert.match(yaml, /MolitUsageMeterOutboxDeadLetter[\s\S]*objective: usage-integrity/u);
  assert.doesNotMatch(yaml, /billing-integrity/u);
  const verifier = await readFile(new URL("deploy/observability/verify-prometheus-rules.ps1", root), "utf8");
  assert.match(verifier, /prom\/prometheus@sha256:[a-f0-9]{64}/u);
  assert.match(verifier, /\/bin\/promtool/u);
});

test("Grafana SLO dashboard is a provisionable JSON model without tenant identifiers", async () => {
  const text = await readFile(new URL("deploy/observability/grafana-molit-slo-dashboard.json", root), "utf8");
  const dashboard = JSON.parse(text);
  assert.equal(dashboard.uid, "molit-operational-slo-v1");
  assert.equal(dashboard.editable, false);
  assert.equal(dashboard.panels.length >= 6, true);
  assert.equal(text.includes("tenant_id"), false);
});

test("usage meter migration enforces tenant RLS and immutable event history", async () => {
  const sql = await readFile(new URL("deploy/control-store/postgres/003_usage_metering.sql", root), "utf8");
  for (const table of ["usage_meter_event", "usage_meter_rollup", "usage_meter_reprocess"]) {
    assert.match(sql, new RegExp(`ALTER TABLE molit_control_store\\.${table} FORCE ROW LEVEL SECURITY`, "u"));
  }
  assert.match(sql, /usage_meter_event_append_only/u);
  assert.match(sql, /tenant_row_visible\(tenant_id\)/u);
  assert.match(sql, /operational-non-billable/u);
});

test("usage delivery contracts fix the OTLP sink deduplication key and non-billable purpose", async () => {
  const [event, outbox, receipt, dispatcher] = await Promise.all([
    readFile(new URL("contracts/usage-meter-event.v1.schema.json", root), "utf8"),
    readFile(new URL("contracts/usage-meter-outbox.v1.schema.json", root), "utf8"),
    readFile(new URL("contracts/usage-delivery-receipt.v1.schema.json", root), "utf8"),
    readFile(new URL("src/observability/usage-outbox-dispatcher.mjs", root), "utf8"),
  ]);
  assert.match(event, /operational-non-billable/u);
  assert.match(outbox, /molit\.usage-meter-reprocess-outbox\/1/u);
  assert.match(receipt, /"idempotencyKey"/u);
  assert.match(receipt, /"deliveryPurpose": \{ "const": "usage-integrity" \}/u);
  assert.match(dispatcher, /eventId: event\.eventId/u);
});

test("trace, metric, log, and WORM clients share the rotating mTLS dispatcher", async () => {
  const [auditRuntime, signalRuntime, schema] = await Promise.all([
    readFile(new URL("src/observability/operational-runtime.mjs", root), "utf8"),
    readFile(new URL("src/observability/operational-telemetry-runtime.mjs", root), "utf8"),
    readFile(new URL("contracts/observability-config.v1.schema.json", root), "utf8"),
  ]);
  assert.equal((auditRuntime.match(/createRotatingMtlsDispatcher\(/gu) ?? []).length, 2);
  assert.equal((signalRuntime.match(/createRotatingMtlsDispatcher\(/gu) ?? []).length, 2);
  assert.match(schema, /"reloadIntervalMs": \{ "type": "integer", "minimum": 250, "maximum": 300000 \}/u);
});
