import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { calculateSloStatusSnapshot, PrometheusSloStatusGenerator } from "../../src/observability/index.mjs";

const NOW = new Date("2026-07-14T12:00:00.000Z");
const OBJECTIVES = { availabilityTarget: 0.999, latencyTarget: 0.95, latencyThresholdMs: 500 };

test("SLO snapshot reports availability and latency budgets independently", async () => {
  const snapshot = calculateSloStatusSnapshot({
    service: "molit-caas",
    generatedAt: NOW.toISOString(),
    window: { from: "2026-06-14T12:00:00.000Z", to: NOW.toISOString() },
    objectives: OBJECTIVES,
    measurements: { requestCount: 100_000, serverErrorCount: 50, latencyEligibleCount: 100_000, latencyGoodCount: 96_000 },
  });
  assert.equal(snapshot.status, "MET");
  assert.equal(snapshot.availability.sli, 0.9995);
  assert.equal(snapshot.availability.budgetRemainingRatio > 0.49, true);
  assert.equal(snapshot.latency.sli, 0.96);
  assert.match(snapshot.snapshotDigest, /^[a-f0-9]{64}$/u);
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const schema = JSON.parse(await readFile(new URL("../../contracts/slo-status-snapshot.v1.schema.json", import.meta.url), "utf8"));
  assert.equal(ajv.validate(schema, snapshot), true, JSON.stringify(ajv.errors));
});

test("SLO snapshot fails closed on no traffic and inconsistent counters", () => {
  const snapshot = calculateSloStatusSnapshot({ service: "molit-dsaas", generatedAt: NOW.toISOString(), window: { from: "2026-07-13T12:00:00.000Z", to: NOW.toISOString() }, objectives: OBJECTIVES, measurements: { requestCount: 0, serverErrorCount: 0, latencyEligibleCount: 0, latencyGoodCount: 0 } });
  assert.equal(snapshot.status, "INSUFFICIENT_DATA");
  assert.equal(snapshot.availability.sli, null);
  assert.throws(() => calculateSloStatusSnapshot({ service: "molit-dsaas", generatedAt: NOW.toISOString(), window: { from: "2026-07-13T12:00:00.000Z", to: NOW.toISOString() }, objectives: OBJECTIVES, measurements: { requestCount: 1, serverErrorCount: 2, latencyEligibleCount: 1, latencyGoodCount: 1 } }), { code: "OBS_SLO_MEASUREMENT_INVALID" });
});

test("Prometheus generator uses fixed recording rules and authenticated transport", async () => {
  const requests = [];
  const values = [100_000, 50, 100_000, 96_000];
  const generator = new PrometheusSloStatusGenerator({
    baseUrl: "https://prometheus.example/",
    authorization: async () => "Bearer status-token",
    dispatcher: { id: "mtls-agent" },
    objectives: OBJECTIVES,
    clock: () => NOW,
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      const value = values[requests.length - 1];
      return new Response(JSON.stringify({ status: "success", data: { resultType: "vector", result: [{ metric: {}, value: [NOW.valueOf() / 1000, String(value)] }] } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const snapshot = await generator.snapshot({ service: "molit-caas" });
  assert.equal(snapshot.status, "MET");
  assert.equal(requests.length, 4);
  assert.equal(requests.every(({ options }) => options.headers.authorization === "Bearer status-token" && options.dispatcher.id === "mtls-agent"), true);
  assert.equal(requests[0].url.searchParams.get("query"), "molit:sli_request_count:30d{service_name=\"molit-caas\"} or vector(0)");
  assert.throws(() => new PrometheusSloStatusGenerator({ baseUrl: "https://prometheus.example/", objectives: { ...OBJECTIVES, latencyThresholdMs: 250 } }), { code: "OBS_SLO_OBJECTIVE_INVALID" });
});
