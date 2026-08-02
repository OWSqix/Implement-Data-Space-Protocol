import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { createOperationalAuthenticator } from "../../src/identity/runtime.mjs";

const policy = {
  issuer: "https://idp.example.test/",
  audiences: ["molit-api"],
  clientIdClaim: "azp",
  tokenIdClaim: "jti",
  actorTypeClaim: "actor_type",
  rolesClaim: "roles",
  tenantIdsClaim: "tenant_ids",
  actorTypes: { human: "human", service: "service" },
  allowedClientIds: ["operator-client"],
  allowedRoles: ["identity.operator"],
  clockSkewSeconds: 30,
  maxTokenLifetimeSeconds: 600,
  humanMfa: { acceptedAcrValues: ["loa2"], requiredAmrAny: ["otp"] },
};

async function validator(name) {
  const schema = JSON.parse(await readFile(new URL(`../../contracts/${name}`, import.meta.url), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

test("identity runtime and principal schemas compile and enforce exclusive authentication modes", async () => {
  const validate = await validator("identity-runtime-config.v1.schema.json");
  const config = {
    schemaVersion: "molit.identity-runtime-config/1",
    mode: "oidc-jwt",
    network: { allowedOrigins: ["https://idp.example.test"], allowInsecureLoopback: false, timeoutMs: 3_000, maxResponseBytes: 262_144 },
    policy,
    oidcJwt: {
      discoveryUrl: "https://idp.example.test/.well-known/openid-configuration",
      allowedAlgorithms: ["RS256"],
      allowedTokenTypes: ["at+jwt"],
      cacheTtlMs: 60_000,
      rotationOverlapMs: 300_000,
      minimumRefreshIntervalMs: 1_000,
      maxKeys: 8,
    },
  };
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...config, introspection: { introspectionUrl: "https://idp.example.test/introspect", clientId: "resource", clientSecretRef: "vault://secret" } }), false);
  const authenticator = createOperationalAuthenticator({ config, revocationChecker: { async isRevoked() { return { revoked: false }; } } });
  assert.equal(authenticator.productionEligible, true);
  const development = structuredClone(config);
  development.network.allowedOrigins = ["http://127.0.0.1:8080"];
  development.network.allowInsecureLoopback = true;
  development.oidcJwt.discoveryUrl = "http://127.0.0.1:8080/.well-known/openid-configuration";
  assert.equal(createOperationalAuthenticator({ config: development, revocationChecker: { async isRevoked() { return { revoked: false }; } } }).productionEligible, false);
});

test("identity principal schema accepts the runtime attribution contract and rejects unknown fields", async () => {
  const validate = await validator("identity-principal.v1.schema.json");
  const principal = {
    schemaVersion: "molit.identity-principal/1",
    issuer: "https://idp.example.test/",
    subject: "operator-1",
    principalId: "operator-1",
    clientId: "operator-client",
    tokenId: "token-1",
    signingKeyId: "signing-key-1",
    actorType: "human",
    roles: ["identity.operator"],
    tenantIds: ["tenant-a"],
    certificateThumbprint: null,
    issuedAt: "2026-07-14T00:00:00Z",
    expiresAt: "2026-07-14T00:10:00Z"
  };
  assert.equal(validate(principal), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...principal, rawToken: "must-not-enter-audit" }), false);
});
