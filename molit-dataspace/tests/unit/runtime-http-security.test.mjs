import test from "node:test";
import assert from "node:assert/strict";
import { enforceUrlPolicy, ResilientHttpClient } from "../../src/bridge-runtime/http-client.mjs";
import { authorizationHeaders, redact } from "../../src/bridge-runtime/telemetry.mjs";

test("HTTP policy rejects non-allowlisted origins and URL credentials", async () => {
  await assert.rejects(enforceUrlPolicy("https://evil.example/x", { allowedOrigins: ["https://good.example"] }), { code: "ORIGIN_NOT_ALLOWED" });
  await assert.rejects(enforceUrlPolicy("https://user:pass@good.example/x", { allowedOrigins: ["https://good.example"] }), { code: "URL_CREDENTIALS_FORBIDDEN" });
});

test("private origins require an exact exception while link-local remains forbidden", async () => {
  const privatePolicy = { allowedOrigins: ["https://10.1.2.3"], privateOrigins: ["https://10.1.2.3"] };
  assert.equal((await enforceUrlPolicy("https://10.1.2.3/path", privatePolicy)).origin, "https://10.1.2.3");
  await assert.rejects(enforceUrlPolicy("https://169.254.169.254/latest", { allowedOrigins: ["https://169.254.169.254"], privateOrigins: ["https://169.254.169.254"] }), { code: "PRIVATE_ADDRESS_FORBIDDEN" });
  await assert.rejects(enforceUrlPolicy("https://10.1.2.3/path", { allowedOrigins: ["https://10.1.2.3"] }), { code: "PRIVATE_ADDRESS_FORBIDDEN" });
});

test("IPv4-mapped IPv6 cannot bypass loopback and private-address policy", async () => {
  await assert.rejects(enforceUrlPolicy("https://[::ffff:7f00:1]/", {
    allowedOrigins: ["https://[::ffff:7f00:1]"],
  }), { code: "PRIVATE_ADDRESS_FORBIDDEN" });
  await assert.rejects(enforceUrlPolicy("https://[::ffff:c0a8:101]/", {
    allowedOrigins: ["https://[::ffff:c0a8:101]"],
  }), { code: "PRIVATE_ADDRESS_FORBIDDEN" });
});

test("HTTP client rejects redirects and bounded streams", async () => {
  const common = { policy: { allowedOrigins: ["http://127.0.0.1:1"], allowHttp: true, allowPrivate: true }, retries: 0 };
  const redirect = new ResilientHttpClient({ ...common, fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://evil.example" } }) });
  await assert.rejects(redirect.request("http://127.0.0.1:1/x"), { code: "REDIRECT_FORBIDDEN" });
  const oversized = new ResilientHttpClient({ ...common, maxResponseBytes: 2, fetchImpl: async () => new Response("long") });
  await assert.rejects(oversized.request("http://127.0.0.1:1/x"), { code: "RESPONSE_TOO_LARGE" });
});

test("credentials must come from environment and telemetry redacts them", () => {
  assert.deepEqual(authorizationHeaders({ type: "bearer", env: "TOKEN" }, { TOKEN: "secret" }), { authorization: "Bearer secret" });
  assert.throws(() => authorizationHeaders({ type: "bearer", value: "inline" }), /inline credentials/);
  assert.deepEqual(redact({ authorization: "Bearer secret", nested: { apiKey: "secret" } }), { authorization: "[REDACTED]", nested: { apiKey: "[REDACTED]" } });
});
