import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createCaaSHttpServer } from "../../src/caas/server.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function response(origin, path, options = {}) {
  const result = await fetch(`${origin}${path}`, { redirect: "manual", ...options });
  return { status: result.status, value: await result.json() };
}

test("graceful shutdown drops readiness, rejects new writes, and aborts an in-flight adapter path at one deadline", async () => {
  const entered = deferred();
  const release = deferred();
  let requestSignal;
  const config = {
    limits: {
      maxRequestBytes: 8192,
      requestTimeoutMs: 5000,
      gracefulShutdownMs: 40,
    },
  };
  const service = {
    async readiness() { return { ready: true, scope: "CONNECTOR_RUNTIME", productionEligible: true, tenantCount: 1 }; },
    async reconcile(_tenantId, _key, _actor, { signal }) {
      requestSignal = signal;
      entered.resolve();
      return release.promise;
    },
  };
  const authorizer = {
    async tenant() {
      return { role: "tenant", principalId: "urn:test:principal:road", clientId: "test-road-client", keyId: "test-road-key-1" };
    },
  };
  const server = createCaaSHttpServer({ config, service, authorizer });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await response(origin, "/readyz")).status, 200);

  const inFlight = fetch(`${origin}/v1/tenants/road-operator/reconcile`, {
    method: "POST",
    headers: { authorization: "Bearer tenant-token", "idempotency-key": "shutdown-reconcile-1" },
  }).then(async (value) => ({ status: value.status, value: await value.json() })).catch((error) => ({ error }));
  await entered.promise;

  server.caasBeginDrain();
  assert.equal((await response(origin, "/readyz")).status, 503);
  const rejected = await response(origin, "/v1/tenants", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "shutdown-register-1" },
    body: "{}",
  });
  assert.equal(rejected.status, 503);
  assert.equal(rejected.value.error.code, "CAAS_SHUTTING_DOWN");

  const startedAt = Date.now();
  await server.closeGracefully({ timeoutMs: 40 });
  assert.ok(Date.now() - startedAt < 1000, "shutdown is bounded by one deadline");
  assert.equal(requestSignal.aborted, true);
  assert.equal(requestSignal.reason.code, "CAAS_SHUTTING_DOWN");
  const outcome = await inFlight;
  assert.ok(outcome.error || outcome.status === 503);

  release.resolve({ tenantId: "road-operator", observedState: "PROVISIONED" });
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
});

test("the write deadline is propagated as an AbortSignal", async () => {
  let requestSignal;
  const config = {
    limits: {
      maxRequestBytes: 8192,
      requestTimeoutMs: 30,
      gracefulShutdownMs: 100,
    },
  };
  const service = {
    async readiness() { return { ready: true }; },
    async reconcile(_tenantId, _key, _actor, { signal }) {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  };
  const authorizer = {
    async tenant() {
      return { role: "tenant", principalId: "urn:test:principal:road", clientId: "test-road-client", keyId: "test-road-key-1" };
    },
  };
  const server = createCaaSHttpServer({ config, service, authorizer });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const timedOut = await response(origin, "/v1/tenants/road-operator/reconcile", {
    method: "POST",
    headers: { authorization: "Bearer tenant-token", "idempotency-key": "timeout-reconcile-1" },
  });
  assert.equal(timedOut.status, 408);
  assert.equal(timedOut.value.error.code, "CAAS_REQUEST_TIMEOUT");
  assert.equal(requestSignal.aborted, true);
  assert.equal(requestSignal.reason.code, "CAAS_REQUEST_TIMEOUT");
  await server.closeGracefully();
});

test("readiness, tenant reads, and audit reads receive the request deadline signal", async () => {
  const received = [];
  const waitForDeadline = (route, signal) => {
    received.push({ route, signal });
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const config = {
    limits: {
      maxRequestBytes: 8192,
      requestTimeoutMs: 30,
      gracefulShutdownMs: 100,
    },
  };
  const service = {
    readiness({ signal }) { return waitForDeadline("ready", signal); },
    getTenant(_tenantId, { signal }) { return waitForDeadline("tenant", signal); },
    audit(tenantId, { signal }) { return waitForDeadline(tenantId ? "tenant-audit" : "audit", signal); },
  };
  const authorizer = {
    admin() { return { role: "admin" }; },
    async tenant() {
      return { role: "tenant", principalId: "urn:test:principal:road", clientId: "test-road-client", keyId: "test-road-key-1" };
    },
  };
  const server = createCaaSHttpServer({ config, service, authorizer });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, headers = {}) => fetch(`${origin}${path}`, { headers })
    .then((value) => value.arrayBuffer())
    .catch(() => null);

  await request("/readyz");
  await request("/v1/audit", { authorization: "Bearer admin-token" });
  await request("/v1/tenants/road-operator", { authorization: "Bearer tenant-token" });
  await request("/v1/tenants/road-operator/audit", { authorization: "Bearer tenant-token" });

  assert.deepEqual(received.map(({ route }) => route), ["ready", "audit", "tenant", "tenant-audit"]);
  for (const { signal } of received) {
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason.code, "CAAS_REQUEST_TIMEOUT");
  }
  await server.closeGracefully();
});

test("PostgreSQL CAAS_* failures retain a stable HTTP status and code", async () => {
  const config = { limits: { maxRequestBytes: 8192, requestTimeoutMs: 1000, gracefulShutdownMs: 100 } };
  const service = {
    readiness: async () => ({ ready: true }),
    async register() {
      throw Object.assign(new Error("PostgreSQL control-store request failed"), { code: "CAAS_STATE_UNAVAILABLE" });
    },
  };
  const authorizer = { admin: () => ({ role: "admin" }) };
  const server = createCaaSHttpServer({ config, service, authorizer });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const unavailable = await response(origin, "/v1/tenants", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "postgres-unavailable-1" },
    body: "{}",
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.value.error.code, "CAAS_STATE_UNAVAILABLE");
  await server.closeGracefully();
});

test("graceful shutdown drains request finalizers after the HTTP response has ended", async (t) => {
  const finalizerEntered = deferred();
  const releaseFinalizer = deferred();
  const config = { limits: { maxRequestBytes: 8192, requestTimeoutMs: 1_000, gracefulShutdownMs: 1_000 } };
  const service = {
    async readiness() { return { ready: true }; },
    async getTenant(tenantId) { return { tenantId, observedState: "PROVISIONED" }; },
  };
  const authorizer = {
    async tenant() {
      return { role: "tenant", principalId: "urn:test:principal:road", clientId: "test-road-client", keyId: "test-road-key-1" };
    },
  };
  const tracer = {
    startIncomingSpan() {
      const context = { traceId: "a".repeat(32), spanId: "b".repeat(16) };
      return {
        context,
        outboundHeaders(headers) { return { ...headers, traceparent: `00-${context.traceId}-${context.spanId}-01` }; },
        async end() {
          finalizerEntered.resolve();
          await releaseFinalizer.promise;
        },
      };
    },
  };
  const server = createCaaSHttpServer({ config, service, authorizer, tracer });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    releaseFinalizer.resolve();
    await server.closeGracefully();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const completed = await response(origin, "/v1/tenants/road-operator", {
    headers: { authorization: "Bearer tenant-token" },
  });
  assert.equal(completed.status, 200);
  await finalizerEntered.promise;

  let closed = false;
  const closing = server.closeGracefully({ timeoutMs: 1_000 }).then(() => { closed = true; });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  assert.equal(closed, false, "response completion must not hide an unfinished request finalizer");
  releaseFinalizer.resolve();
  await closing;
  assert.equal(closed, true);
});
