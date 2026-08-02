import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { MolitTracer, OtlpHttpJsonExporter } from "../../src/observability/index.mjs";

test("OTLP HTTP exporter emits a correlated, bounded JSON span batch", async (context) => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = { headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const exporter = new OtlpHttpJsonExporter({ endpoint: `http://127.0.0.1:${port}/v1/traces`, serviceName: "molit-caas", environment: "test", allowInsecureLoopback: true, authorization: async () => "Bearer collector-test" });
  const tracer = new MolitTracer({ sink: exporter, component: "caas", tenantSalt: "0123456789abcdef" });
  await tracer.startSpan("caas.request", { kind: "server", attributes: { "http.request.method": "POST" } }).end();
  assert.equal(received.headers.authorization, "Bearer collector-test");
  assert.equal(received.body.resourceSpans[0].resource.attributes.find((item) => item.key === "service.name").value.stringValue, "molit-caas");
  const [span] = received.body.resourceSpans[0].scopeSpans[0].spans;
  assert.match(span.traceId, /^[0-9a-f]{32}$/u);
  assert.equal(span.name, "caas.request");
  assert.equal(span.kind, 2);
});

test("operational OTLP exporter rejects plaintext and credentialed endpoints", () => {
  assert.throws(() => new OtlpHttpJsonExporter({ endpoint: "http://collector.example/v1/traces", serviceName: "x" }), { code: "OBS_OTLP_TLS_REQUIRED" });
  assert.throws(() => new OtlpHttpJsonExporter({ endpoint: "https://user:pass@collector.example/v1/traces", serviceName: "x" }), { code: "OBS_OTLP_ENDPOINT_INVALID" });
});

test("OTLP trace readiness stays down after an outage and recovers only after a successful probe", async () => {
  let available = true;
  let now = new Date("2026-07-14T00:00:00.000Z");
  const exporter = new OtlpHttpJsonExporter({
    endpoint: "http://127.0.0.1:4318/v1/traces",
    serviceName: "molit-caas",
    allowInsecureLoopback: true,
    readinessMaxAgeMs: 1_000,
    clock: () => new Date(now),
    fetchImpl: async () => new Response("{}", { status: available ? 200 : 503 }),
  });

  assert.equal((await exporter.initialize()).ready, true);
  available = false;
  now = new Date("2026-07-14T00:00:00.100Z");
  await assert.rejects(exporter.export([{
    traceId: "3".repeat(32),
    spanId: "4".repeat(16),
    traceFlags: "01",
    tracestate: "",
    name: "caas.runtime",
    kind: 1,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    status: "ERROR",
    attributes: {},
  }]), { code: "OBS_OTLP_REJECTED" });
  assert.equal(exporter.readiness().ready, false);
  assert.equal((await exporter.probeReadiness()).ready, false);

  available = true;
  now = new Date("2026-07-14T00:00:00.200Z");
  const recovered = await exporter.probeReadiness();
  assert.equal(recovered.ready, true);
  assert.equal(recovered.lastFailure, null);
});
