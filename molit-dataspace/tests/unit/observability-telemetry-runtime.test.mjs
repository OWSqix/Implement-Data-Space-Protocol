import assert from "node:assert/strict";
import test from "node:test";

import { createOperationalTelemetryFromConfig, operationalTelemetryConfigFromObservability } from "../../src/observability/index.mjs";
import { identityTlsFixtures } from "../fixtures/identity-tls/generate.mjs";

// Generated for this process only; VALIDATION_CLOCK comes from the notBefore the
// generator encoded, so the transport's certificate validity check always holds.
const TLS = identityTlsFixtures();
const VALIDATION_CLOCK = TLS.validationClock;
const [CA_CERTIFICATE, CERTIFICATE, PRIVATE_KEY] = [TLS.root, TLS.client, TLS.clientKey];

function config() {
  const tls = { caRef: "file://ca.pem", certificateRef: "file://client.pem", privateKeyRef: "file://client-key.pem", serverName: "collector.example", reloadIntervalMs: 300_000 };
  return {
    schemaVersion: "molit.operational-telemetry-config/1",
    service: { name: "molit-caas", version: "1.0.0", environment: "production" },
    tenantCardinality: { bucketCount: 64, saltRef: "env://TENANT_SALT" },
    metrics: { mode: "operational", endpoint: "https://collector.example/v1/metrics", authorizationRef: "env://METRICS_TOKEN", tls, timeoutMs: 1000 },
    logs: { mode: "operational", endpoint: "https://collector.example/v1/logs", authorizationRef: "env://LOGS_TOKEN", tls, timeoutMs: 1000 },
  };
}

test("operational metrics and logs use separate mTLS agents and rotating bearer secrets", async () => {
  const secrets = new Map([
    ["file://ca.pem", CA_CERTIFICATE],
    ["file://client.pem", CERTIFICATE],
    ["file://client-key.pem", PRIVATE_KEY],
    ["env://TENANT_SALT", "0123456789abcdef-tenant-salt"],
    ["env://METRICS_TOKEN", "metrics-token-one"],
    ["env://LOGS_TOKEN", "logs-token-one"],
  ]);
  const agents = [];
  const requests = [];
  const agentFactory = (options) => {
    const agent = { options, closed: false, dispatch() { return true; }, async close() { this.closed = true; } };
    agents.push(agent);
    return agent;
  };
  const telemetry = await createOperationalTelemetryFromConfig({
    config: config(),
    secretResolver: async (reference) => secrets.get(reference),
    agentFactory,
    clock: () => VALIDATION_CLOCK,
    fetchImpl: async (url, options) => {
      requests.push({ authorization: options.headers.authorization, dispatcher: options.dispatcher, path: new URL(url).pathname });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await telemetry.recordRequest({ tenantId: "tenant-seoul-01", operation: "connector.ensure", statusCode: 201, durationMs: 25, correlationId: "corr-runtime-001", traceId: "a".repeat(32), spanId: "b".repeat(16) });
  assert.equal(agents.length, 2);
  assert.equal(agents.every((agent) => agent.options.connect.rejectUnauthorized), true);
  assert.equal(requests.find(({ path }) => path.endsWith("/metrics")).authorization, "Bearer metrics-token-one");
  assert.equal(requests.find(({ path }) => path.endsWith("/logs")).authorization, "Bearer logs-token-one");
  assert.notEqual(requests[0].dispatcher, requests[1].dispatcher);
  secrets.set("env://METRICS_TOKEN", "metrics-token-two");
  await telemetry.recordRequest({ tenantId: "tenant-seoul-01", operation: "connector.ensure", statusCode: 200, durationMs: 20, correlationId: "corr-runtime-002", traceId: "c".repeat(32) });
  assert.equal(requests.filter(({ path }) => path.endsWith("/metrics")).at(-1).authorization, "Bearer metrics-token-two");
  assert.equal(telemetry.readiness().tls.metrics.generation, 1);
  assert.equal(telemetry.readiness().tls.logs.generation, 1);
  await telemetry.close();
  assert.equal(agents.every((agent) => agent.closed), true);
});

test("telemetry transport setup closes an already-created agent after later TLS failure", async () => {
  const agents = [];
  let calls = 0;
  await assert.rejects(createOperationalTelemetryFromConfig({
    config: config(),
    secretResolver: async (reference) => {
      if (reference === "env://TENANT_SALT") return "0123456789abcdef-tenant-salt";
      calls += 1;
      if (calls <= 3) return reference.endsWith("key.pem") ? PRIVATE_KEY : reference.endsWith("ca.pem") ? CA_CERTIFICATE : CERTIFICATE;
      return "not-pem";
    },
    agentFactory: (options) => {
      const agent = { options, closed: false, dispatch() { return true; }, async close() { this.closed = true; } };
      agents.push(agent);
      return agent;
    },
  }), { code: "OBS_TLS_MATERIAL_INVALID" });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].closed, true);
});

test("unified observability config maps trace tenant controls into metric and log transport", () => {
  const standalone = config();
  const adapted = operationalTelemetryConfigFromObservability({
    schemaVersion: "molit.observability-config/1",
    service: standalone.service,
    tracing: { tenantBucketCount: standalone.tenantCardinality.bucketCount, tenantSaltRef: standalone.tenantCardinality.saltRef },
    metrics: standalone.metrics,
    logs: standalone.logs,
  });
  assert.deepEqual(adapted, standalone);
});
