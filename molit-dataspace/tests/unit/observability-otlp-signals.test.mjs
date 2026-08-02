import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { OtlpLogExporter, OtlpMetricExporter } from "../../src/observability/index.mjs";

async function collector(t) {
  const received = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8")), path: request.url });
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, received };
}

test("OTLP metric and log exporters emit authenticated JSON signals", async (t) => {
  const { port, received } = await collector(t);
  const common = { serviceName: "molit-caas", environment: "test", allowInsecureLoopback: true, authorization: async () => "Bearer rotating-token" };
  const metrics = new OtlpMetricExporter({ ...common, endpoint: `http://127.0.0.1:${port}/v1/metrics` });
  const logs = new OtlpLogExporter({ ...common, endpoint: `http://127.0.0.1:${port}/v1/logs` });
  await metrics.export([{
    name: "molit.request.count",
    type: "sum",
    unit: "{request}",
    points: [{ attributes: { "molit.operation": "connector.ensure" }, timeUnixNano: "1784030400000000000", value: 1 }],
  }]);
  await logs.export([{
    eventName: "molit.request.completed",
    severity: "INFO",
    timeUnixNano: "1784030400000000000",
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    attributes: { "molit.correlation_id": "corr-12345678" },
  }]);
  assert.equal(received.length, 2);
  assert.equal(received[0].authorization, "Bearer rotating-token");
  assert.equal(received[0].body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asDouble, 1);
  assert.equal(received[1].body.resourceLogs[0].scopeLogs[0].logRecords[0].traceId, "a".repeat(32));
});

test("OTLP signal exporters require TLS and reject malformed histogram counts", async () => {
  assert.throws(() => new OtlpMetricExporter({ endpoint: "http://collector.example/v1/metrics", serviceName: "molit-caas" }), { code: "OBS_OTLP_TLS_REQUIRED" });
  const exporter = new OtlpMetricExporter({ endpoint: "https://collector.example/v1/metrics", serviceName: "molit-caas", fetchImpl: async () => new Response("{}") });
  await assert.rejects(exporter.export([{
    name: "molit.request.duration",
    type: "histogram",
    unit: "ms",
    points: [{ attributes: {}, timeUnixNano: "1784030400000000000", count: 2, sum: 10, explicitBounds: [5], bucketCounts: [1, 0] }],
  }]), { code: "OBS_METRIC_INVALID" });
});
