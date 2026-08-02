import assert from "node:assert/strict";
import test from "node:test";

import { createLocalTestSpanSink, extractTraceContext, injectTraceContext, MolitTracer, parseTraceparent, parseTracestate, redact, tenantBucket } from "../../src/observability/index.mjs";

const SALT = "0123456789abcdef-observability-test";

test("W3C trace context rejects ambiguous or malformed input", () => {
  const value = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  assert.deepEqual(parseTraceparent(value), { version: "00", traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7", traceFlags: "01", sampled: true });
  assert.throws(() => parseTraceparent(value.toUpperCase()), { code: "OBS_TRACEPARENT_INVALID" });
  assert.throws(() => parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"), { code: "OBS_TRACEPARENT_INVALID" });
  assert.throws(() => extractTraceContext({ traceparent: [value, value] }), { code: "OBS_TRACE_HEADER_DUPLICATE" });
  assert.throws(() => extractTraceContext({ tracestate: "vendor=value" }), { code: "OBS_TRACEPARENT_REQUIRED" });
});

test("tracestate validates member count and duplicate vendors", () => {
  assert.equal(parseTracestate("vendor=value,second=two"), "vendor=value,second=two");
  assert.throws(() => parseTracestate("vendor=one,vendor=two"), { code: "OBS_TRACESTATE_DUPLICATE" });
  assert.throws(() => parseTracestate(Array.from({ length: 33 }, (_, index) => `v${index}=x`).join(",")), { code: "OBS_TRACESTATE_INVALID" });
});

test("CaaS to DSaaS to EDC spans retain one trace and unique parent links", async () => {
  const caasSink = createLocalTestSpanSink({ environment: "test" });
  const dsaasSink = createLocalTestSpanSink({ environment: "test" });
  const edcSink = createLocalTestSpanSink({ environment: "test" });
  const caas = new MolitTracer({ sink: caasSink, component: "caas", tenantSalt: SALT });
  const dsaas = new MolitTracer({ sink: dsaasSink, component: "dsaas", tenantSalt: SALT });
  const edc = new MolitTracer({ sink: edcSink, component: "edc", tenantSalt: SALT });

  const first = caas.startIncomingSpan("caas.ensure", {}, { tenantId: "road-data-provider", attributes: { "molit.operation": "ensure", "molit.tenant_id": "road-data-provider", authorization: "Bearer must-not-leak" } });
  const second = dsaas.startIncomingSpan("dsaas.reconcile", first.outboundHeaders(), { tenantId: "road-data-provider" });
  const third = edc.startIncomingSpan("edc.management", second.outboundHeaders(), { tenantId: "road-data-provider" });
  await third.end();
  await second.end();
  await first.end();

  const [caasSpan] = caasSink.spans;
  const [dsaasSpan] = dsaasSink.spans;
  const [edcSpan] = edcSink.spans;
  assert.equal(caasSpan.traceId, dsaasSpan.traceId);
  assert.equal(dsaasSpan.traceId, edcSpan.traceId);
  assert.equal(dsaasSpan.parentSpanId, caasSpan.spanId);
  assert.equal(edcSpan.parentSpanId, dsaasSpan.spanId);
  assert.equal(caasSpan.attributes["molit.tenant_bucket"], tenantBucket("road-data-provider", { salt: SALT }));
  assert.equal(JSON.stringify(caasSpan).includes("road-data-provider"), false);
  assert.equal(JSON.stringify(caasSpan).includes("must-not-leak"), false);
  assert.match(injectTraceContext({}, third.context).traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u);
});

test("redaction covers structured and embedded credentials", () => {
  const result = redact({ password: "value", note: "Authorization: Bearer abc.def", nested: { client_secret: "x" } });
  assert.equal(result.password, "[REDACTED]");
  assert.equal(result.nested.client_secret, "[REDACTED]");
  assert.doesNotMatch(result.note, /abc\.def/u);
});

test("local span sink cannot be selected outside tests", () => {
  assert.throws(() => createLocalTestSpanSink({ environment: "production" }), { code: "OBS_LOCAL_SINK_FORBIDDEN" });
});
