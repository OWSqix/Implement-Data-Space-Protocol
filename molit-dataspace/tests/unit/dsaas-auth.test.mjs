import assert from "node:assert/strict";
import test from "node:test";

import { OAuth2IntrospectionAuthenticator } from "../../src/dsaas/auth.mjs";

function request(authorization = "Bearer 1234567890abcdef") {
  return { rawHeaders: ["Authorization", authorization] };
}

function config() {
  return {
    introspectionUrl: "https://idp.example.test/oauth2/introspect",
    clientIdEnv: "DSAAS_CLIENT_ID",
    clientSecretEnv: "DSAAS_CLIENT_SECRET",
    issuer: "https://idp.example.test/",
    audience: "molit-dsaas",
    clientIdClaim: "client_id",
    keyIdClaim: "jti",
    rolesClaim: "realm.roles",
    dataspaceIdsClaim: "dataspace_ids",
  };
}

test("introspection binds issuer, audience, expiry, roles and dataspace IDs", async () => {
  let captured;
  const http = {
    async json(url, options) {
      captured = { url, options };
      return {
        status: 200,
        value: {
          active: true,
          iss: "https://idp.example.test/",
          aud: ["molit-dsaas"],
          exp: 1_800_000_000,
          sub: "operator-1",
          client_id: "molit-operator-cli",
          jti: "access-token-key-2026-01",
          realm: { roles: ["dsaas.operator"] },
          dataspace_ids: ["molit-test"],
        },
      };
    },
  };
  const auth = new OAuth2IntrospectionAuthenticator({
    config: config(),
    http,
    env: { DSAAS_CLIENT_ID: "client", DSAAS_CLIENT_SECRET: "secret" },
    clock: () => new Date("2026-07-13T00:00:00Z"),
  });
  const actor = await auth.authenticate(request());
  assert.deepEqual(actor, {
    subject: "operator-1",
    principalId: "operator-1",
    clientId: "molit-operator-cli",
    keyId: "access-token-key-2026-01",
    roles: ["dsaas.operator"],
    dataspaceIds: ["molit-test"],
  });
  assert.equal(captured.url, "https://idp.example.test/oauth2/introspect");
  assert.equal(captured.options.body, "token=1234567890abcdef&token_type_hint=access_token");
  assert.equal(captured.options.headers.authorization, `Basic ${Buffer.from("client:secret").toString("base64")}`);
});

test("inactive, expired and incorrectly scoped tokens fail closed", async () => {
  const base = {
    active: true,
    iss: "https://idp.example.test/",
    aud: "molit-dsaas",
    exp: 1_800_000_000,
    sub: "operator-1",
    client_id: "molit-operator-cli",
    jti: "access-token-key-2026-01",
    realm: { roles: ["dsaas.operator"] },
  };
  for (const [mutate, code] of [
    [(value) => ({ ...value, active: false }), "DSAAS_UNAUTHENTICATED"],
    [(value) => ({ ...value, exp: 1 }), "DSAAS_TOKEN_INVALID"],
    [(value) => ({ ...value, aud: "another-service" }), "DSAAS_TOKEN_INVALID"],
    [(value) => ({ ...value, iss: "https://attacker.example/" }), "DSAAS_TOKEN_INVALID"],
    [(value) => ({ ...value, client_id: undefined }), "DSAAS_TOKEN_INVALID"],
    [(value) => ({ ...value, jti: "contains whitespace" }), "DSAAS_TOKEN_INVALID"],
  ]) {
    const auth = new OAuth2IntrospectionAuthenticator({
      config: config(),
      http: { async json() { return { status: 200, value: mutate(base) }; } },
      env: { DSAAS_CLIENT_ID: "client", DSAAS_CLIENT_SECRET: "secret" },
      clock: () => new Date("2026-07-13T00:00:00Z"),
    });
    await assert.rejects(auth.authenticate(request()), { code });
  }
});

test("configured azp and nested key-id claims produce stable actor attribution", async () => {
  const value = {
    active: true,
    iss: "https://idp.example.test/",
    aud: "molit-dsaas",
    exp: 1_800_000_000,
    sub: "operator-1",
    azp: "molit-browser-client",
    cnf: { kid: "proof-key-2026-01" },
    realm: { roles: ["dsaas.operator"] },
  };
  const auth = new OAuth2IntrospectionAuthenticator({
    config: { ...config(), clientIdClaim: "azp", keyIdClaim: "cnf.kid" },
    http: { async json() { return { status: 200, value }; } },
    env: { DSAAS_CLIENT_ID: "client", DSAAS_CLIENT_SECRET: "secret" },
    clock: () => new Date("2026-07-13T00:00:00Z"),
  });
  const actor = await auth.authenticate(request());
  assert.equal(actor.clientId, "molit-browser-client");
  assert.equal(actor.keyId, "proof-key-2026-01");
});

test("introspection Basic credentials use form-encoded client components", async () => {
  let authorization;
  const auth = new OAuth2IntrospectionAuthenticator({
    config: config(),
    http: {
      async json(_url, options) {
        authorization = options.headers.authorization;
        return {
          status: 200,
          value: {
            active: true,
            iss: "https://idp.example.test/",
            aud: "molit-dsaas",
            exp: 1_800_000_000,
            sub: "operator-1",
            client_id: "molit-operator-cli",
            jti: "access-token-key-2026-01",
            realm: { roles: ["dsaas.operator"] },
          },
        };
      },
    },
    env: {
      DSAAS_CLIENT_ID: "client id:+%한",
      DSAAS_CLIENT_SECRET: "s e:c+r%비",
    },
    clock: () => new Date("2026-07-13T00:00:00Z"),
  });
  await auth.authenticate(request());
  const encoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  assert.equal(encoded, "client+id%3A%2B%25%ED%95%9C:s+e%3Ac%2Br%25%EB%B9%84");
});

test("duplicate authorization headers are rejected before introspection", async () => {
  let called = false;
  const auth = new OAuth2IntrospectionAuthenticator({
    config: config(),
    http: { async json() { called = true; } },
    env: { DSAAS_CLIENT_ID: "client", DSAAS_CLIENT_SECRET: "secret" },
  });
  await assert.rejects(auth.authenticate({ rawHeaders: ["Authorization", "Bearer 1234567890abcdef", "Authorization", "Bearer fedcba0987654321"] }), { code: "DSAAS_UNAUTHENTICATED" });
  assert.equal(called, false);
});
