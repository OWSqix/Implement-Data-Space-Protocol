import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createOperationalObservability } from "../../src/observability/index.mjs";

const FIXTURES = new URL("../fixtures/identity-tls/", import.meta.url);
const [CA_CERTIFICATE, CERTIFICATE, PRIVATE_KEY] = await Promise.all([
  readFile(new URL("root.crt", FIXTURES), "utf8"),
  readFile(new URL("client.crt", FIXTURES), "utf8"),
  readFile(new URL("client.key", FIXTURES), "utf8"),
]);

function config() {
  const tls = { caRef: "file://ca.pem", certificateRef: "file://client.pem", privateKeyRef: "file://client-key.pem", serverName: "collector.example", reloadIntervalMs: 300_000 };
  return {
    schemaVersion: "molit.observability-config/1",
    service: { name: "molit-caas", version: "1.0.0", environment: "test" },
    tracing: { mode: "operational", endpoint: "https://collector.example/v1/traces", authorizationRef: "env://OTLP_TOKEN", tls, tenantBucketCount: 64, tenantSaltRef: "env://TENANT_SALT", timeoutMs: 1000 },
    metrics: { mode: "operational", endpoint: "https://collector.example/v1/metrics", authorizationRef: "env://OTLP_TOKEN", tls, timeoutMs: 1000 },
    logs: { mode: "operational", endpoint: "https://collector.example/v1/logs", authorizationRef: "env://OTLP_TOKEN", tls, timeoutMs: 1000 },
    audit: { mode: "operational-worm", baseUrl: "https://worm.example/", authorizationRef: "env://WORM_TOKEN", tls: { ...tls, serverName: "worm.example" }, retentionDays: 365, timeoutMs: 1000 },
    usageMeter: { purpose: "operational-non-billable", meterName: "management.api.request", unit: "{request}", dimensionKeys: ["operation", "outcome"], maximumEventAgeDays: 400, maximumFutureSkewMs: 300000, maxAttempts: 3, retryBaseMs: 50, outbox: { maxAttempts: 12, batchSize: 50, leaseMs: 30000, pollIntervalMs: 1000, retryBaseMs: 1000, retryMaxMs: 300000, healthIntervalMs: 30000 } },
  };
}

test("operational runtime resolves rotating tokens and injects separate mTLS agents", async () => {
  const secrets = new Map([
    ["file://ca.pem", CA_CERTIFICATE],
    ["file://client.pem", CERTIFICATE],
    ["file://client-key.pem", PRIVATE_KEY],
    ["env://TENANT_SALT", "0123456789abcdef-tenant-salt"],
    ["env://OTLP_TOKEN", "otlp-token"],
    ["env://WORM_TOKEN", "worm-token"],
  ]);
  const agents = [];
  const requests = [];
  const agentFactory = (options) => {
    const agent = { options, closed: false, dispatch() { return true; }, async close() { this.closed = true; } };
    agents.push(agent);
    return agent;
  };
  const fetchImpl = async (url, options) => {
    const target = new URL(url);
    requests.push({ authorization: options.headers.authorization, dispatcher: options.dispatcher, path: target.pathname });
    if (target.hostname === "worm.example" && target.pathname === "/v1/capabilities") return new Response(JSON.stringify({ backendId: "worm-prod", appendOnly: true, conditionalAppend: true, immutableUntilRetention: true, readAfterWrite: true, retentionEnforced: true }), { status: 200, headers: { "content-type": "application/json" } });
    if (target.hostname === "collector.example") return new Response("{}", { status: 200 });
    throw new Error(`unexpected URL ${target.href}`);
  };
  const runtime = await createOperationalObservability({ config: config(), secretResolver: async (reference) => secrets.get(reference), fetchImpl, agentFactory });
  assert.equal(runtime.mode, "operational");
  assert.equal(agents.length, 2);
  assert.equal(agents[0].options.connect.rejectUnauthorized, true);
  assert.equal(agents[0].options.connect.servername, "collector.example");
  await runtime.tracer.startSpan("caas.ensure").end();
  assert.equal(requests.find((item) => item.path === "/v1/traces").authorization, "Bearer otlp-token");
  assert.notEqual(requests.find((item) => item.path === "/v1/traces").dispatcher, agents[0]);
  assert.equal(runtime.readiness instanceof Function, true);
  assert.equal(requests.find((item) => item.path === "/v1/capabilities").authorization, "Bearer worm-token");
  const readiness = await runtime.readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.tls.tracing.generation, 1);
  assert.equal(readiness.tls.audit.generation, 1);
  assert.equal(JSON.stringify(runtime).includes("otlp-token"), false);
  assert.equal(JSON.stringify(runtime).includes("fake-private"), false);
  await runtime.close();
  assert.equal(agents.every((agent) => agent.closed), true);
});

test("operational config fails before creating transport when mTLS references are absent", async () => {
  const value = config();
  delete value.audit.tls;
  await assert.rejects(() => createOperationalObservability({ config: value, secretResolver: async () => "x" }), { code: "OBS_CONFIG_INVALID" });
});

test("an invalid trace bearer token blocks startup before readiness", async () => {
  const secrets = new Map([
    ["file://ca.pem", CA_CERTIFICATE],
    ["file://client.pem", CERTIFICATE],
    ["file://client-key.pem", PRIVATE_KEY],
    ["env://TENANT_SALT", "0123456789abcdef-tenant-salt"],
    ["env://OTLP_TOKEN", "wrong-token"],
    ["env://WORM_TOKEN", "worm-token"],
  ]);
  const agents = [];
  await assert.rejects(createOperationalObservability({
    config: config(),
    secretResolver: async (reference) => secrets.get(reference),
    agentFactory(options) {
      const agent = { options, closed: false, dispatch() { return true; }, async close() { this.closed = true; } };
      agents.push(agent);
      return agent;
    },
    async fetchImpl(url, options) {
      const target = new URL(url);
      if (target.hostname === "worm.example") return new Response(JSON.stringify({ backendId: "worm-prod", appendOnly: true, conditionalAppend: true, immutableUntilRetention: true, readAfterWrite: true, retentionEnforced: true }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: options.headers.authorization === "Bearer otlp-token" ? 200 : 401 });
    },
  }), { code: "OBS_OTLP_REJECTED" });
  assert.equal(agents.every(({ closed }) => closed), true);
});
