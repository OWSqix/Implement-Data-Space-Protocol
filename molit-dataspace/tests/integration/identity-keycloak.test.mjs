import assert from "node:assert/strict";
import test from "node:test";

import { IntrospectionAuthenticator } from "../../src/identity/introspection.mjs";
import { PinnedJsonClient } from "../../src/identity/http-json.mjs";
import { OidcJwtAuthenticator } from "../../src/identity/oidc-jwt.mjs";

const baseUrl = process.env.MOLIT_IDENTITY_TEST_BASE_URL;
const enabled = Boolean(baseUrl && process.env.MOLIT_IDENTITY_TEST_USERNAME && process.env.MOLIT_IDENTITY_TEST_PASSWORD && process.env.MOLIT_IDENTITY_TEST_RESOURCE_SECRET);

function incoming(token) {
  return { rawHeaders: ["Authorization", `Bearer ${token}`] };
}

test("pinned Keycloak issues a token accepted by JWKS and RFC 7662 paths", { skip: enabled ? false : "run deploy/identity/keycloak/run-integration.ps1" }, async () => {
  const issuer = `${baseUrl}/realms/molit-identity-test`;
  const tokenEndpoint = `${issuer}/protocol/openid-connect/token`;
  const tokenResponse = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "identity-test-client",
      username: process.env.MOLIT_IDENTITY_TEST_USERNAME,
      password: process.env.MOLIT_IDENTITY_TEST_PASSWORD,
    }),
  });
  const issued = await tokenResponse.json();
  assert.equal(tokenResponse.status, 200, JSON.stringify(issued));
  assert.equal(typeof issued.access_token, "string");

  const policy = {
    issuer,
    audiences: ["molit-control-plane"],
    clientIdClaim: "azp",
    tokenIdClaim: "jti",
    actorTypeClaim: "actor_type",
    rolesClaim: "molit_roles",
    tenantIdsClaim: "tenant_ids",
    actorTypes: { human: "human", service: "service" },
    allowedClientIds: ["identity-test-client"],
    allowedRoles: ["identity.operator"],
    clockSkewSeconds: 30,
    maxTokenLifetimeSeconds: 600,
    humanMfa: { acceptedAcrValues: ["1"], requiredAmrAny: ["pwd"] },
  };
  const http = new PinnedJsonClient({ allowedOrigins: [baseUrl], allowInsecureLoopback: true });
  const jwtAuthenticator = new OidcJwtAuthenticator({
    config: {
      policy,
      discoveryUrl: `${issuer}/.well-known/openid-configuration`,
      allowedAlgorithms: ["RS256"],
      allowedTokenTypes: ["JWT", "at+jwt"],
      cacheTtlMs: 30_000,
      rotationOverlapMs: 30_000,
      minimumRefreshIntervalMs: 500,
      maxKeys: 8,
    },
    http,
    revocationChecker: { async isRevoked() { return { revoked: false }; } },
  });
  const jwtPrincipal = await jwtAuthenticator.authenticate(incoming(issued.access_token), { expectedTenantId: "tenant-a", requiredRoles: ["identity.operator"] });
  assert.equal(jwtPrincipal.clientId, "identity-test-client");
  assert.equal(jwtPrincipal.signingKeyId.length > 0, true);

  const introspectionAuthenticator = new IntrospectionAuthenticator({
    config: {
      policy: { ...policy, clientIdClaim: "client_id" },
      introspectionUrl: `${issuer}/protocol/openid-connect/token/introspect`,
      clientId: "identity-resource-server",
      clientSecretRef: "runtime://keycloak/resource-secret",
      readinessMaxAgeMs: 60_000,
    },
    http,
    secretProvider: { async get(reference) { assert.equal(reference, "runtime://keycloak/resource-secret"); return process.env.MOLIT_IDENTITY_TEST_RESOURCE_SECRET; } },
  });
  await introspectionAuthenticator.initialize();
  assert.equal((await introspectionAuthenticator.readiness({ probe: false })).ready, true);
  const introspected = await introspectionAuthenticator.authenticate(incoming(issued.access_token), { expectedTenantId: "tenant-a" });
  assert.equal(introspected.tokenId, jwtPrincipal.tokenId);

  const revokeResponse = await fetch(`${issuer}/protocol/openid-connect/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: issued.access_token, token_type_hint: "access_token", client_id: "identity-test-client" }),
  });
  assert.equal(revokeResponse.status, 200, await revokeResponse.text());
  await assert.rejects(introspectionAuthenticator.authenticate(incoming(issued.access_token)), { code: "IDENTITY_TOKEN_INACTIVE" });
});
