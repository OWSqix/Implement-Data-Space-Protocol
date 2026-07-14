import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createPinnedLookup, enforceUrlPolicy, ResilientHttpClient } from "../../src/bridge-runtime/http-client.mjs";
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

test("IANA non-global ranges remain forbidden even when listed as private origins", async () => {
  for (const address of ["100.64.0.1", "198.18.0.1", "192.0.2.1"]) {
    const origin = `https://${address}`;
    await assert.rejects(enforceUrlPolicy(`${origin}/path`, {
      allowedOrigins: [origin],
      privateOrigins: [origin],
    }), { code: "PRIVATE_ADDRESS_FORBIDDEN" });
  }
  await assert.rejects(enforceUrlPolicy("https://[2001:db8::1]/path", {
    allowedOrigins: ["https://[2001:db8::1]"],
    privateOrigins: ["https://[2001:db8::1]"],
  }), { code: "PRIVATE_ADDRESS_FORBIDDEN" });
  assert.equal((await enforceUrlPolicy("https://192.0.0.9/path", {
    allowedOrigins: ["https://192.0.0.9"],
  })).origin, "https://192.0.0.9");
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
  const common = {
    policy: { allowedOrigins: ["http://127.0.0.1:1"], allowHttp: true, allowPrivate: true },
    retries: 0,
    dispatcherFactory: () => ({ close: async () => {} }),
  };
  const redirect = new ResilientHttpClient({ ...common, fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://evil.example" } }) });
  await assert.rejects(redirect.request("http://127.0.0.1:1/x"), { code: "REDIRECT_FORBIDDEN" });
  const oversized = new ResilientHttpClient({ ...common, maxResponseBytes: 2, fetchImpl: async () => new Response("long") });
  await assert.rejects(oversized.request("http://127.0.0.1:1/x"), { code: "RESPONSE_TOO_LARGE" });
});

test("custom fetch adapters cannot silently disable socket address pinning", () => {
  assert.throws(() => new ResilientHttpClient({
    policy: { allowedOrigins: ["https://service.example"] },
    fetchImpl: async () => new Response("unused"),
  }), { code: "HTTP_DISPATCHER_CAPABILITY_REQUIRED" });
});

test("HTTP retries revalidate DNS and pin the accepted answer into the dispatcher", async () => {
  let lookups = 0;
  let requests = 0;
  const pinned = [];
  const client = new ResilientHttpClient({
    policy: { allowedOrigins: ["https://service.example"] },
    retries: 1,
    sleep: async () => {},
    lookupImpl: async () => {
      lookups += 1;
      return [{ address: lookups === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
    },
    dispatcherFactory: (_url, addresses) => {
      pinned.push(structuredClone(addresses));
      return { close: async () => {} };
    },
    fetchImpl: async (_url, options) => {
      requests += 1;
      assert.ok(options.dispatcher);
      return new Response("temporary", { status: 503 });
    },
  });
  await assert.rejects(client.request("https://service.example/data"), { code: "PRIVATE_ADDRESS_FORBIDDEN" });
  assert.equal(requests, 1, "the rebound private address must be rejected before a second connection");
  assert.equal(lookups, 2);
  assert.deepEqual(pinned, [[{ address: "93.184.216.34", family: 4 }]]);
});

test("pinned lookup never performs a second hostname resolution", async () => {
  const pinnedLookup = createPinnedLookup([{ address: "93.184.216.34", family: 4 }]);
  const single = await new Promise((resolve, reject) => pinnedLookup("service.example", {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  const all = await new Promise((resolve, reject) => pinnedLookup("service.example", { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
  assert.deepEqual(single, { address: "93.184.216.34", family: 4 });
  assert.deepEqual(all, [{ address: "93.184.216.34", family: 4 }]);
});

test("the validated address reaches the socket while the original Host is preserved", async (t) => {
  let observedHost;
  const server = http.createServer((request, response) => {
    observedHost = request.headers.host;
    response.end("pinned");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  let lookups = 0;
  const client = new ResilientHttpClient({
    policy: { allowedOrigins: [`http://pinned.test:${port}`], allowHttp: true, allowPrivate: true },
    lookupImpl: async () => {
      lookups += 1;
      return [{ address: "127.0.0.1", family: 4 }];
    },
    retries: 0,
  });
  const result = await client.request(`http://pinned.test:${port}/resource`);
  assert.equal(result.body.toString("utf8"), "pinned");
  assert.equal(observedHost, `pinned.test:${port}`);
  assert.equal(lookups, 1);
});

test("one timeout bounds DNS resolution before a socket is opened", async () => {
  let requests = 0;
  const client = new ResilientHttpClient({
    policy: { allowedOrigins: ["https://service.example"] },
    timeoutMs: 20,
    retries: 3,
    lookupImpl: async () => new Promise(() => {}),
    dispatcherFactory: () => ({ close: async () => {} }),
    fetchImpl: async () => {
      requests += 1;
      return new Response("unexpected");
    },
  });
  await assert.rejects(client.request("https://service.example/data"), { code: "HTTP_TIMEOUT" });
  assert.equal(requests, 0);
});

test("dispatcher closes before retry backoff and caller abort stops the wait", async () => {
  const order = [];
  const controller = new AbortController();
  const client = new ResilientHttpClient({
    policy: { allowedOrigins: ["https://service.example"] },
    retries: 1,
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    dispatcherFactory: () => ({ close: async () => { order.push("close"); } }),
    fetchImpl: async () => {
      order.push("fetch");
      return new Response("temporary", { status: 503 });
    },
    sleep: async () => {
      order.push("sleep");
      controller.abort();
    },
  });
  await assert.rejects(client.request("https://service.example/data", { signal: controller.signal }), { code: "HTTP_ABORTED" });
  assert.deepEqual(order, ["fetch", "close", "sleep"]);
});

test("credentials must come from environment and telemetry redacts them", () => {
  assert.deepEqual(authorizationHeaders({ type: "bearer", env: "TOKEN" }, { TOKEN: "secret" }), { authorization: "Bearer secret" });
  assert.throws(() => authorizationHeaders({ type: "bearer", value: "inline" }), /inline credentials/);
  assert.throws(() => authorizationHeaders({ type: "bearer", env: "TOKEN", header: "x-api-key" }, { TOKEN: "secret" }), /does not accept auth.header/);
  for (const header of ["api-key", "ocp-apim-subscription-key", "x-api-key", "x-auth-token"]) {
    assert.deepEqual(authorizationHeaders({ type: "api-key", env: "TOKEN", header }, { TOKEN: "secret" }), { [header]: "secret" });
  }
  for (const header of ["authorization", "content-type", "cookie", "host", "idempotency-key", "proxy-authorization", "transfer-encoding", "X-API-Key"]) {
    assert.throws(() => authorizationHeaders({ type: "api-key", env: "TOKEN", header }, { TOKEN: "secret" }), /unsupported api-key header/);
  }
  assert.throws(() => authorizationHeaders({ type: "api-key", env: "TOKEN" }, { TOKEN: "secret\r\nx-injected: yes" }), /valid HTTP header value/);
  assert.deepEqual(redact({ authorization: "Bearer secret", nested: { apiKey: "secret" } }), { authorization: "[REDACTED]", nested: { apiKey: "[REDACTED]" } });
});
