import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { CaaSAuthorizer } from "../../src/caas/auth.mjs";
import { OperationalDsaasAuthenticatorAdapter } from "../../src/dsaas/auth.mjs";
import { BoundedFileSecretProvider, loadOperationalIdentityConfig } from "../../src/identity/operational-config.mjs";

function principal(overrides = {}) {
  return {
    schemaVersion: "molit.identity-principal/1",
    issuer: "https://identity.example/",
    subject: "operator-1",
    principalId: "operator-1",
    clientId: "operations-client",
    tokenId: "token-id-1",
    signingKeyId: "signing-key-1",
    actorType: "human",
    roles: ["caas.admin"],
    tenantIds: [],
    certificateThumbprint: null,
    issuedAt: "2026-07-14T00:00:00.000Z",
    expiresAt: "2026-07-14T00:10:00.000Z",
    ...overrides,
  };
}

function productionCaasConfig() {
  return {
    environment: "production",
    controller: {
      allowedDataspaceIds: ["road-space"],
      allowedTenantIds: ["road-operator"],
      allowedConnectorPlanIds: ["standard"],
    },
  };
}

test("production CaaS maps operational roles and requires the controller tenant claim", async () => {
  let current = principal();
  const authenticator = { productionEligible: true, async authenticate(request) { assert.equal(request.socket.encrypted, true); return current; } };
  const authorizer = new CaaSAuthorizer({ config: productionCaasConfig(), store: { async read() { return { tenants: {} }; } }, authenticator });
  const request = { socket: { encrypted: true } };
  assert.deepEqual(await authorizer.admin(request), {
    role: "admin", principalId: "operator-1", clientId: "operations-client", keyId: "signing-key-1",
  });

  current = principal({ actorType: "service", roles: ["caas.controller"], tenantIds: ["road-operator"], signingKeyId: null });
  assert.deepEqual(await authorizer.controller(request, { tenantId: "road-operator" }), {
    role: "controller",
    principalId: "operator-1",
    clientId: "operations-client",
    keyId: "token-id-1",
    allowedDataspaceIds: ["road-space"],
    allowedTenantIds: ["road-operator"],
    allowedConnectorPlanIds: ["standard"],
  });
  await assert.rejects(authorizer.controller(request, { tenantId: "rail-operator" }), { code: "CAAS_TENANT_MISMATCH", status: 403 });

  current = principal({ roles: ["caas.tenant"], tenantIds: ["road-operator"] });
  assert.equal((await authorizer.tenant(request, "road-operator")).role, "tenant");
  await assert.rejects(authorizer.tenant(request, "rail-operator"), { code: "CAAS_TENANT_MISMATCH", status: 403 });
});

test("DSaaS adapter preserves the verified actor contract without token material", async () => {
  const adapter = new OperationalDsaasAuthenticatorAdapter({
    authenticator: {
      productionEligible: true,
      async initialize() {},
      async readiness() { return { ready: true }; },
      async authenticate() {
        return principal({
          roles: ["dsaas.dataspace-admin"],
          tenantIds: ["road-space"],
          signingKeyId: null,
        });
      },
    },
  });
  assert.deepEqual(await adapter.authenticate({}), {
    subject: "operator-1",
    principalId: "operator-1",
    clientId: "operations-client",
    keyId: "token-id-1",
    roles: ["dsaas.dataspace-admin"],
    dataspaceIds: ["road-space"],
  });
  assert.equal(adapter.productionEligible, true);
});

test("file secret provider reopens a rotated CSI-style file for every lookup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-identity-secret-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "client-secret");
  const provider = new BoundedFileSecretProvider({ maxBytes: 128 });
  await writeFile(path, "first-secret-value\n", { mode: 0o600 });
  assert.equal(await provider.get(pathToFileURL(path).href), "first-secret-value");
  await writeFile(path, "second-secret-value\n", { mode: 0o600 });
  assert.equal(await provider.get(pathToFileURL(path).href), "second-secret-value");
  await writeFile(path, "x".repeat(129));
  await assert.rejects(provider.get(pathToFileURL(path).href), { code: "IDENTITY_SECRET_UNAVAILABLE", status: 503 });
});

test("production identity configuration rejects insecure endpoints and non-file introspection secrets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-identity-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = {
    schemaVersion: "molit.identity-runtime-config/1",
    mode: "rfc7662-introspection",
    network: { allowedOrigins: ["https://identity.example"], allowInsecureLoopback: false, timeoutMs: 1000, maxResponseBytes: 4096 },
    policy: {
      issuer: "https://identity.example/", audiences: ["molit-api"], clientIdClaim: "client_id", tokenIdClaim: "jti",
      actorTypeClaim: "actor_type", rolesClaim: "roles", tenantIdsClaim: "tenant_ids", actorTypes: { human: "human", service: "service" },
      allowedClientIds: ["operations-client"], allowedRoles: ["caas.admin"], clockSkewSeconds: 0, maxTokenLifetimeSeconds: 600,
      humanMfa: { acceptedAcrValues: ["mfa"], requiredAmrAny: ["otp"] },
    },
    introspection: { introspectionUrl: "https://identity.example/introspect", clientId: "resource", clientSecretRef: "file:///run/secrets/introspection", readinessMaxAgeMs: 60_000 },
  };
  const path = join(directory, "identity.json");
  await writeFile(path, JSON.stringify(source));
  assert.equal((await loadOperationalIdentityConfig(path)).mode, "rfc7662-introspection");
  const jwtSource = {
    ...source,
    mode: "oidc-jwt",
    oidcJwt: {
      discoveryUrl: "https://identity.example/.well-known/openid-configuration",
      allowedAlgorithms: ["RS256"],
      allowedTokenTypes: ["at+jwt"],
      cacheTtlMs: 60_000,
      rotationOverlapMs: 60_000,
      minimumRefreshIntervalMs: 1_000,
      maxKeys: 8,
    },
  };
  delete jwtSource.introspection;
  await writeFile(path, JSON.stringify(jwtSource));
  await assert.rejects(loadOperationalIdentityConfig(path), { code: "IDENTITY_RUNTIME_CONFIGURATION_INVALID" });
  assert.equal((await loadOperationalIdentityConfig(path, { production: false })).mode, "oidc-jwt");
  await writeFile(path, JSON.stringify({ ...source, introspection: { ...source.introspection, clientSecretRef: "vault://identity/secret" } }));
  await assert.rejects(loadOperationalIdentityConfig(path), { code: "IDENTITY_RUNTIME_CONFIGURATION_INVALID" });
  await writeFile(path, JSON.stringify({ ...source, network: { ...source.network, allowedOrigins: ["http://127.0.0.1:8080"], allowInsecureLoopback: true }, introspection: { ...source.introspection, introspectionUrl: "http://127.0.0.1:8080/introspect" } }));
  await assert.rejects(loadOperationalIdentityConfig(path), { code: "IDENTITY_RUNTIME_CONFIGURATION_INVALID" });
});
