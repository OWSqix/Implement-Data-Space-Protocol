import assert from "node:assert/strict";
import test from "node:test";

import { OAuth2MtlsClientCredentials } from "../../src/identity/outbound-oauth2-mtls.mjs";
import { HttpCaasClient } from "../../src/dsaas/caas-client.mjs";

test("OAuth2 mTLS token cache is bound to the rotating certificate material", async () => {
  let materialVersion = 1;
  let tokenRequests = 0;
  const snapshots = {
    1: Object.freeze({ materialDigest: "a".repeat(64), certificateSha256: "1".repeat(64), ca: "ca", cert: "cert-1", key: "key-1", serverName: "caas.example" }),
    2: Object.freeze({ materialDigest: "b".repeat(64), certificateSha256: "2".repeat(64), ca: "ca", cert: "cert-2", key: "key-2", serverName: "caas.example" }),
  };
  const material = {
    secretProvider: { async get() { return "client-secret"; } },
    async snapshot() { return snapshots[materialVersion]; },
  };
  const provider = new OAuth2MtlsClientCredentials({
    config: {
      tokenUrl: "https://identity.example/oauth2/token",
      clientId: "dsaas-controller",
      clientSecretRef: "file:///run/client-secret",
      scope: "caas.controller",
      refreshSkewSeconds: 30,
    },
    material,
    clock: () => 1_000_000,
    http: {
      async json(_url, options) {
        tokenRequests += 1;
        assert.equal(options.dispatcherContext.mtls, snapshots[materialVersion]);
        assert.match(options.headers.authorization, /^Basic /u);
        return { status: 200, value: { access_token: `access-${materialVersion}`, token_type: "Bearer", expires_in: 300 } };
      },
    },
  });

  assert.equal((await provider.get()).accessToken, "access-1");
  assert.equal((await provider.get()).accessToken, "access-1");
  assert.equal(tokenRequests, 1);
  materialVersion = 2;
  assert.equal((await provider.get()).accessToken, "access-2");
  assert.equal(tokenRequests, 2);
  provider.revoke();
  await provider.get();
  assert.equal(tokenRequests, 3);
});

test("DSaaS sends the token and the exact certificate snapshot as one CaaS request", async () => {
  const mtls = Object.freeze({ materialDigest: "a".repeat(64) });
  let observed;
  const client = new HttpCaasClient({
    config: {
      auth: { type: "oauth2-client-credentials-mtls" },
      baseUrl: "https://caas.example/",
      ensurePath: "/v1/connectors/ensure",
      supportsIdempotencyKey: true,
    },
    tokenProvider: { async get() { return { accessToken: "bound-token", mtls }; } },
    http: {
      async json(_url, options) {
        observed = options;
        return { status: 202, value: { accepted: true } };
      },
    },
  });
  await client.ensureConnector({ caasTenantId: "tenant-a", desiredState: "ACTIVE" }, "key-1");
  assert.equal(observed.headers.authorization, "Bearer bound-token");
  assert.equal(observed.dispatcherContext.mtls, mtls);
});
