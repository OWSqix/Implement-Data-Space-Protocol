import assert from "node:assert/strict";
import test from "node:test";

import { PinnedJsonClient, validatePinnedUrl } from "../../src/identity/http-json.mjs";
import { parseStrictJson } from "../../src/identity/strict-json.mjs";

test("strict JSON parser rejects duplicate nested members and prototype mutation", () => {
  assert.deepEqual(parseStrictJson('{"outer":{"value":1},"safe":true}'), { outer: { value: 1 }, safe: true });
  assert.throws(() => parseStrictJson('{"outer":{"value":1,"value":2}}'), { code: "IDENTITY_JSON_DUPLICATE_KEY" });
  const parsed = parseStrictJson('{"__proto__":{"polluted":true}}');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(parsed, "__proto__"), true);
});

test("pinned URL policy permits explicit loopback development but rejects userinfo and unlisted origins", () => {
  assert.equal(validatePinnedUrl("http://127.0.0.1:8080/realms/test", { allowedOrigins: ["http://127.0.0.1:8080"], allowInsecureLoopback: true }).origin, "http://127.0.0.1:8080");
  assert.throws(() => validatePinnedUrl("http://keycloak:8080/", { allowedOrigins: ["http://keycloak:8080"], allowInsecureLoopback: true }), { code: "IDENTITY_ENDPOINT_INVALID" });
  assert.throws(() => validatePinnedUrl("https://user:pass@idp.example/", { allowedOrigins: ["https://idp.example"] }), { code: "IDENTITY_ENDPOINT_INVALID" });
  assert.throws(() => validatePinnedUrl("https://attacker.example/", { allowedOrigins: ["https://idp.example"] }), { code: "IDENTITY_ENDPOINT_NOT_ALLOWED" });
});

test("JSON client rejects redirects, oversized bodies and duplicate response members", async () => {
  const responses = [
    new Response("", { status: 302, headers: { location: "https://attacker.example/" } }),
    new Response("x".repeat(2_048), { headers: { "content-type": "application/json", "content-length": "2048" } }),
    new Response('{"keys":[],"keys":[]}', { headers: { "content-type": "application/json" } }),
  ];
  const client = new PinnedJsonClient({ allowedOrigins: ["https://idp.example"], maxResponseBytes: 1_024, fetchImpl: async () => responses.shift() });
  await assert.rejects(client.json("https://idp.example/discovery", { label: "test endpoint" }), { code: "IDENTITY_UPSTREAM_UNAVAILABLE" });
  await assert.rejects(client.json("https://idp.example/discovery", { label: "test endpoint" }), { code: "IDENTITY_UPSTREAM_RESPONSE_TOO_LARGE" });
  await assert.rejects(client.json("https://idp.example/discovery", { label: "test endpoint" }), { code: "IDENTITY_JSON_DUPLICATE_KEY" });
});
