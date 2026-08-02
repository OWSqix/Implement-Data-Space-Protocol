import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CaaSAuthorizer } from "../../src/caas/auth.mjs";
import { createCaaSHttpServer } from "../../src/caas/server.mjs";
import { OperationalDsaasAuthenticatorAdapter } from "../../src/dsaas/auth.mjs";
import { createDsaasServer } from "../../src/dsaas/server.mjs";
import { IntrospectionAuthenticator } from "../../src/identity/introspection.mjs";
import { ReloadingTlsContext } from "../../src/identity/tls-runtime.mjs";

const FIXTURES = new URL("../fixtures/identity-tls/", import.meta.url);
const NOW = new Date("2026-07-14T12:00:00Z");

async function fixture(name) {
  return readFile(new URL(name, FIXTURES));
}

async function prepareTlsDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "molit-identity-tls-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [source, target] of [["server-one.crt", "server.crt"], ["server-one.key", "server.key"], ["root.crt", "client-ca.crt"]]) {
    await copyFile(new URL(source, FIXTURES), join(directory, target));
  }
  return directory;
}

function thumbprint(certificate) {
  return createHash("sha256").update(new X509Certificate(certificate).raw).digest("base64url");
}

function claims({ token, audience, roles, tenantIds, actorType = "service", certificate }) {
  return {
    active: true,
    iss: "https://identity.example/",
    aud: audience,
    sub: `${actorType}-${token.slice(0, 8)}`,
    client_id: `${actorType}-client`,
    jti: `jti-${token.slice(0, 12)}`,
    actor_type: actorType,
    roles,
    tenant_ids: tenantIds,
    iat: Math.floor(NOW.getTime() / 1_000),
    exp: Math.floor(NOW.getTime() / 1_000) + 600,
    ...(actorType === "human" ? { acr: "mfa", amr: ["otp"] } : { cnf: { "x5t#S256": thumbprint(certificate) } }),
  };
}

function introspectionAuthenticator({ audience, allowedRoles, responses }) {
  const policy = {
    issuer: "https://identity.example/",
    audiences: [audience],
    clientIdClaim: "client_id",
    tokenIdClaim: "jti",
    actorTypeClaim: "actor_type",
    rolesClaim: "roles",
    tenantIdsClaim: "tenant_ids",
    actorTypes: { human: "human", service: "service" },
    allowedClientIds: ["human-client", "service-client"],
    allowedRoles,
    clockSkewSeconds: 0,
    maxTokenLifetimeSeconds: 600,
    humanMfa: { acceptedAcrValues: ["mfa"], requiredAmrAny: ["otp"] },
  };
  return new IntrospectionAuthenticator({
    config: { policy, introspectionUrl: "https://identity.example/introspect", clientId: "resource-server", clientSecretRef: "file:///run/secrets/introspection" },
    http: {
      productionEligible: true,
      async json(_url, options) {
        const token = new URLSearchParams(options.body).get("token");
        return responses[token] ?? { active: false };
      },
    },
    secretProvider: { async get() { return "test-introspection-secret"; } },
    clock: () => NOW,
  });
}

function httpsRequest(port, path, { method = "GET", token, body, cert, key, host = `localhost:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = https.request({
      hostname: "127.0.0.1",
      servername: "localhost",
      port,
      path,
      method,
      ca: [fixtureCache.root],
      cert,
      key,
      rejectUnauthorized: true,
      agent: false,
      headers: {
        host,
        connection: "close",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(bytes ? { "content-type": "application/json", "content-length": bytes.length, "idempotency-key": "identity-tls-test-key" } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        let value = null;
        const text = Buffer.concat(chunks).toString("utf8");
        if (text) value = JSON.parse(text);
        const peer = response.socket.getPeerCertificate(true);
        resolve({ status: response.statusCode, value, peerDigest: Buffer.isBuffer(peer?.raw) ? createHash("sha256").update(peer.raw).digest("hex") : null });
      });
    });
    request.once("error", reject);
    if (bytes) request.write(bytes);
    request.end();
  });
}

const fixtureCache = {};

test.before(async () => {
  for (const name of ["root", "client", "clientKey", "untrusted", "untrustedKey", "serverTwo", "serverTwoKey"]) {
    const file = {
      root: "root.crt",
      client: "client.crt",
      clientKey: "client.key",
      untrusted: "untrusted.crt",
      untrustedKey: "untrusted.key",
      serverTwo: "server-two.crt",
      serverTwoKey: "server-two.key",
    }[name];
    fixtureCache[name] = await fixture(file);
  }
});

test("CaaS terminates TLS, enforces service mTLS, permits MFA human tokens, and rotates without downtime", async (t) => {
  const directory = await prepareTlsDirectory(t);
  const tlsRuntime = await new ReloadingTlsContext({
    certFile: join(directory, "server.crt"),
    keyFile: join(directory, "server.key"),
    clientCaFile: join(directory, "client-ca.crt"),
    reloadIntervalMs: 250,
  }).initialize();
  const humanToken = "human-token-value-0001";
  const serviceToken = "service-token-value-001";
  const responses = {
    [humanToken]: claims({ token: humanToken, audience: "molit-caas", roles: ["caas.admin"], tenantIds: ["global-admin"], actorType: "human" }),
    [serviceToken]: claims({ token: serviceToken, audience: "molit-caas", roles: ["caas.controller"], tenantIds: ["road-operator"], certificate: fixtureCache.client }),
  };
  const authenticator = introspectionAuthenticator({ audience: "molit-caas", allowedRoles: ["caas.admin", "caas.controller", "caas.tenant"], responses });
  const config = {
    environment: "production",
    controller: { allowedDataspaceIds: ["road-space"], allowedTenantIds: ["road-operator"], allowedConnectorPlanIds: ["standard"] },
    limits: { maxRequestBytes: 16_384, requestTimeoutMs: 5_000, gracefulShutdownMs: 2_000 },
  };
  const authorizer = new CaaSAuthorizer({ config, store: { async read() { return { tenants: {} }; } }, authenticator });
  let controllerActor;
  const service = {
    async readiness() { return { ready: true }; },
    async audit() { return { events: [], total: 0, truncated: false }; },
    async ensureConnector(_body, _key, actor) { controllerActor = actor; return { accepted: true }; },
  };
  const server = createCaaSHttpServer({ config, service, authorizer, tlsRuntime });
  t.after(() => server.closeGracefully({ timeoutMs: 2_000 }));
  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = server.address().port;

  const human = await httpsRequest(port, "/v1/audit", { token: humanToken });
  assert.equal(human.status, 200, JSON.stringify(human.value));
  const accepted = await httpsRequest(port, "/v1/connectors/ensure", {
    method: "POST",
    token: serviceToken,
    cert: fixtureCache.client,
    key: fixtureCache.clientKey,
    body: { caasTenantId: "road-operator" },
  });
  assert.equal(accepted.status, 200);
  assert.equal(controllerActor.role, "controller");
  assert.equal((await httpsRequest(port, "/v1/connectors/ensure", { method: "POST", token: serviceToken, body: { caasTenantId: "road-operator" } })).status, 401);
  assert.equal((await httpsRequest(port, "/v1/audit", { token: humanToken, cert: fixtureCache.untrusted, key: fixtureCache.untrustedKey })).status, 401);

  await writeFile(join(directory, "client-ca.crt"), fixtureCache.untrusted);
  assert.equal(await tlsRuntime.reload(), true);
  assert.equal((await httpsRequest(port, "/v1/connectors/ensure", {
    method: "POST", token: serviceToken, cert: fixtureCache.client, key: fixtureCache.clientKey, body: { caasTenantId: "road-operator" },
  })).status, 401);
  await writeFile(join(directory, "client-ca.crt"), fixtureCache.root);
  assert.equal(await tlsRuntime.reload(), true);
  assert.equal((await httpsRequest(port, "/v1/connectors/ensure", {
    method: "POST", token: serviceToken, cert: fixtureCache.client, key: fixtureCache.clientKey, body: { caasTenantId: "road-operator" },
  })).status, 200);

  const before = await httpsRequest(port, "/healthz");
  await writeFile(join(directory, "server.key"), "not-a-private-key\n");
  assert.equal(await tlsRuntime.reload(), false);
  assert.equal(tlsRuntime.readiness().ready, false);
  const degraded = await httpsRequest(port, "/readyz");
  assert.equal(degraded.status, 503);
  assert.equal(degraded.peerDigest, before.peerDigest, "invalid rotation must retain the active secure context");

  await writeFile(join(directory, "server.crt"), fixtureCache.serverTwo);
  await writeFile(join(directory, "server.key"), fixtureCache.serverTwoKey, { mode: 0o600 });
  const deadline = Date.now() + 3_000;
  while (tlsRuntime.readiness().generation < 4 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(tlsRuntime.readiness().ready, true);
  assert.equal(tlsRuntime.readiness().generation, 4);
  const after = await httpsRequest(port, "/healthz");
  assert.notEqual(after.peerDigest, before.peerDigest);
});

test("DSaaS production request path receives the verified mTLS principal", async (t) => {
  const directory = await prepareTlsDirectory(t);
  const tlsRuntime = await new ReloadingTlsContext({
    certFile: join(directory, "server.crt"), keyFile: join(directory, "server.key"), clientCaFile: join(directory, "client-ca.crt"), reloadIntervalMs: 1000,
  }).initialize();
  const token = "dsaas-service-token-001";
  const operational = introspectionAuthenticator({
    audience: "molit-dsaas",
    allowedRoles: ["dsaas.operator", "dsaas.dataspace-admin", "dsaas.dataspace-reader"],
    responses: { [token]: claims({ token, audience: "molit-dsaas", roles: ["dsaas.operator"], tenantIds: ["road-space"], certificate: fixtureCache.client }) },
  });
  const authenticator = new OperationalDsaasAuthenticatorAdapter({ authenticator: operational });
  let actor;
  const controlPlane = {
    async readiness() { return { ready: true, failureCodes: [], checks: {} }; },
    async createDataspace(_body, value) { actor = value; return { dataspaceId: "road-space", revision: 1 }; },
  };
  const scheduler = { async start() {}, async stop() {}, readiness() { return { ready: true, status: "ready" }; } };
  const config = {
    environment: "production", listenHost: "127.0.0.1", port: 0, publicOrigin: "https://dsaas.test", allowedHosts: ["dsaas.test"],
    limits: { maxRequestBytes: 16_384, headerTimeoutMs: 5_000, requestTimeoutMs: 5_000, keepAliveTimeoutMs: 1_000, gracefulShutdownMs: 2_000 },
  };
  const runtime = createDsaasServer({
    config,
    controlPlane,
    authenticator,
    scheduler,
    tlsRuntime,
    observabilityReadiness: async () => ({ ready: true, failureCodes: [], checks: {} }),
  });
  t.after(() => runtime.close({ timeoutMs: 2_000 }));
  const address = await runtime.start();
  const accepted = await httpsRequest(address.port, "/v1/dataspaces", {
    method: "POST", token, cert: fixtureCache.client, key: fixtureCache.clientKey, host: "dsaas.test", body: { dataspaceId: "road-space" },
  });
  assert.equal(accepted.status, 201);
  assert.deepEqual(actor.dataspaceIds, ["road-space"]);
  assert.equal((await httpsRequest(address.port, "/v1/dataspaces", { method: "POST", token, host: "dsaas.test", body: { dataspaceId: "road-space" } })).status, 401);
});

test("invalid TLS material fails closed before a production listener is created", async (t) => {
  const directory = await prepareTlsDirectory(t);
  await writeFile(join(directory, "server.key"), "invalid-key\n");
  const runtime = new ReloadingTlsContext({
    certFile: join(directory, "server.crt"), keyFile: join(directory, "server.key"), clientCaFile: join(directory, "client-ca.crt"), reloadIntervalMs: 1000,
  });
  await assert.rejects(runtime.initialize(), { code: "IDENTITY_TLS_MATERIAL_INVALID", status: 500 });
});
