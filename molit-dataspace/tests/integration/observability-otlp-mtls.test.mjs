import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import https from "node:https";
import test from "node:test";

import { createOperationalTelemetryFromConfig } from "../../src/observability/index.mjs";

const FIXTURES = new URL("../fixtures/identity-tls/", import.meta.url);

test("COM-OBS-001: OTLP metrics and logs require a trusted client certificate and bearer token", async (t) => {
  const [serverCert, serverKey, clientCa, clientCert, clientKey] = await Promise.all([
    readFile(new URL("server-one.crt", FIXTURES), "utf8"),
    readFile(new URL("server-one.key", FIXTURES), "utf8"),
    readFile(new URL("root.crt", FIXTURES), "utf8"),
    readFile(new URL("client.crt", FIXTURES), "utf8"),
    readFile(new URL("client.key", FIXTURES), "utf8"),
  ]);
  const received = [];
  const server = https.createServer({ cert: serverCert, key: serverKey, ca: clientCa, requestCert: true, rejectUnauthorized: true }, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ authorized: request.client.authorized, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8")), path: request.url });
    const expectedToken = request.url === "/v1/metrics" ? "Bearer metrics-integration-token" : "Bearer logs-integration-token";
    if (request.headers.authorization !== expectedToken) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const tls = { caRef: "file://ca.pem", certificateRef: "file://client.pem", privateKeyRef: "file://client-key.pem", serverName: "localhost", reloadIntervalMs: 300_000 };
  const secrets = new Map([
    ["file://ca.pem", clientCa],
    ["file://client.pem", clientCert],
    ["file://client-key.pem", clientKey],
    ["env://TENANT_SALT", "molit-operational-cardinality-salt"],
    ["env://METRICS_TOKEN", "metrics-integration-token"],
    ["env://LOGS_TOKEN", "logs-integration-token"],
  ]);
  const config = {
      schemaVersion: "molit.operational-telemetry-config/1",
      service: { name: "molit-caas", version: "1.0.0", environment: "production" },
      tenantCardinality: { bucketCount: 64, saltRef: "env://TENANT_SALT" },
      metrics: { mode: "operational", endpoint: `https://localhost:${port}/v1/metrics`, authorizationRef: "env://METRICS_TOKEN", tls, timeoutMs: 2000 },
      logs: { mode: "operational", endpoint: `https://localhost:${port}/v1/logs`, authorizationRef: "env://LOGS_TOKEN", tls, timeoutMs: 2000 },
  };
  await assert.rejects(createOperationalTelemetryFromConfig({
    config,
    secretResolver: async (reference) => reference === "env://METRICS_TOKEN" ? "wrong-token" : secrets.get(reference),
    clock: () => new Date("2026-07-14T12:00:00.000Z"),
  }), { code: "OBS_OTLP_REJECTED" });
  received.length = 0;
  const telemetry = await createOperationalTelemetryFromConfig({
    config,
    secretResolver: async (reference) => secrets.get(reference),
    clock: () => new Date("2026-07-14T12:00:00.000Z"),
  });
  t.after(() => telemetry.close());
  await telemetry.recordRequest({ tenantId: "tenant-seoul-01", operation: "connector.ensure", statusCode: 201, durationMs: 25, correlationId: "corr-mtls-otlp-001", traceId: "a".repeat(32), spanId: "b".repeat(16) });
  assert.equal(received.length, 4);
  assert.equal(received.every(({ authorized }) => authorized), true);
  assert.equal(received.find(({ path }) => path === "/v1/metrics").authorization, "Bearer metrics-integration-token");
  assert.equal(received.find(({ path }) => path === "/v1/logs").authorization, "Bearer logs-integration-token");
  assert.equal(JSON.stringify(received).includes("tenant-seoul-01"), false);
});
