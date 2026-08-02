import assert from "node:assert/strict";
import { constants, createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { OidcJwtAuthenticator } from "../../src/identity/oidc-jwt.mjs";
import { PinnedJsonClient } from "../../src/identity/http-json.mjs";

function policy() {
  return {
    issuer: "https://idp.example.test/realms/molit",
    audiences: ["molit-control-plane"],
    clientIdClaim: "azp",
    tokenIdClaim: "jti",
    actorTypeClaim: "actor_type",
    rolesClaim: "molit_roles",
    tenantIdsClaim: "tenant_ids",
    actorTypes: { human: "human", service: "service" },
    allowedClientIds: ["operator-cli", "dsaas-worker"],
    allowedRoles: ["identity.operator", "identity.service"],
    clockSkewSeconds: 30,
    maxTokenLifetimeSeconds: 900,
    humanMfa: { acceptedAcrValues: ["urn:molit:loa:2"], requiredAmrAny: ["otp", "webauthn"] },
  };
}

function config(overrides = {}) {
  return {
    policy: policy(),
    discoveryUrl: "https://idp.example.test/realms/molit/.well-known/openid-configuration",
    allowedAlgorithms: ["RS256"],
    allowedTokenTypes: ["at+jwt", "JWT"],
    cacheTtlMs: 1_000,
    rotationOverlapMs: 1_000,
    minimumRefreshIntervalMs: 100,
    maxKeys: 8,
    ...overrides,
  };
}

function key(kid) {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey: pair.privateKey, jwk: { ...pair.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
}

function encode(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function jwt(keyPair, claims, header = { alg: "RS256", kid: keyPair.kid, typ: "at+jwt" }) {
  const input = `${encode(header)}.${encode(claims)}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), keyPair.privateKey).toString("base64url")}`;
}

function humanClaims(overrides = {}) {
  return {
    iss: policy().issuer,
    aud: "molit-control-plane",
    sub: "operator-1",
    azp: "operator-cli",
    jti: "token-1",
    actor_type: "human",
    molit_roles: ["identity.operator"],
    tenant_ids: ["tenant-a"],
    acr: "urn:molit:loa:2",
    amr: ["pwd", "otp"],
    iat: Date.parse("2026-07-14T00:00:00Z") / 1_000,
    exp: Date.parse("2026-07-14T00:10:00Z") / 1_000,
    ...overrides,
  };
}

function request(token, rawCertificate) {
  return {
    rawHeaders: ["Authorization", `Bearer ${token}`],
    socket: rawCertificate ? { authorized: true, getPeerCertificate: () => ({ raw: rawCertificate }) } : undefined,
  };
}

function clientFor(jwks, { discovery = {}, fetchHook } = {}) {
  const base = policy().issuer.slice(0, -1);
  return new PinnedJsonClient({
    allowedOrigins: ["https://idp.example.test"],
    fetchImpl: async (url, options) => {
      fetchHook?.(url, options);
      if (url.pathname.endsWith("openid-configuration")) {
        return Response.json({ issuer: policy().issuer, jwks_uri: `${base}/protocol/openid-connect/certs`, id_token_signing_alg_values_supported: ["RS256"], ...discovery });
      }
      return Response.json({ keys: typeof jwks === "function" ? jwks() : jwks });
    },
  });
}

function authenticator(signingKeys, options = {}) {
  return new OidcJwtAuthenticator({
    config: config(options.config),
    http: clientFor(signingKeys, options),
    revocationChecker: options.revocationChecker ?? { async isRevoked() { return { revoked: false }; } },
    clock: options.clock ?? (() => new Date("2026-07-14T00:00:00Z")),
  });
}

test("OIDC JWT authentication binds issuer, audience, client, tenant, role, MFA and revocation", async () => {
  const signingKey = key("key-1");
  let revocationInput;
  const auth = authenticator([signingKey.jwk], {
    revocationChecker: { async isRevoked(value) { revocationInput = value; return { revoked: false }; } },
  });
  const principal = await auth.authenticate(request(jwt(signingKey, humanClaims())), { expectedTenantId: "tenant-a", requiredRoles: ["identity.operator"] });
  assert.deepEqual(principal, {
    schemaVersion: "molit.identity-principal/1",
    issuer: policy().issuer,
    subject: "operator-1",
    principalId: "operator-1",
    clientId: "operator-cli",
    tokenId: "token-1",
    signingKeyId: "key-1",
    actorType: "human",
    roles: ["identity.operator"],
    tenantIds: ["tenant-a"],
    certificateThumbprint: null,
    issuedAt: "2026-07-14T00:00:00.000Z",
    expiresAt: "2026-07-14T00:10:00.000Z",
  });
  assert.equal(revocationInput.tokenId, "token-1");
});

test("PS256 and ES256 use algorithm-specific verification without key-type confusion", async () => {
  const cases = [
    {
      algorithm: "PS256",
      pair: generateKeyPairSync("rsa", { modulusLength: 2048 }),
      signOptions: (privateKey) => ({ key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }),
      nodeAlgorithm: "RSA-SHA256",
    },
    {
      algorithm: "ES256",
      pair: generateKeyPairSync("ec", { namedCurve: "P-256" }),
      signOptions: (privateKey) => ({ key: privateKey, dsaEncoding: "ieee-p1363" }),
      nodeAlgorithm: "sha256",
    },
  ];
  for (const item of cases) {
    const kid = `${item.algorithm.toLowerCase()}-key`;
    const jwk = { ...item.pair.publicKey.export({ format: "jwk" }), kid, alg: item.algorithm, use: "sig" };
    const header = { alg: item.algorithm, kid, typ: "at+jwt" };
    const input = `${encode(header)}.${encode(humanClaims({ jti: `${item.algorithm.toLowerCase()}-token` }))}`;
    const token = `${input}.${sign(item.nodeAlgorithm, Buffer.from(input), item.signOptions(item.pair.privateKey)).toString("base64url")}`;
    const auth = new OidcJwtAuthenticator({
      config: config({ allowedAlgorithms: [item.algorithm] }),
      http: clientFor([jwk], { discovery: { id_token_signing_alg_values_supported: [item.algorithm] } }),
      revocationChecker: { async isRevoked() { return { revoked: false }; } },
      clock: () => new Date("2026-07-14T00:00:00Z"),
    });
    assert.equal((await auth.authenticate(request(token))).signingKeyId, kid);
  }
});

test("service account requires an authorized certificate bound through cnf x5t#S256", async () => {
  const signingKey = key("key-service");
  const raw = Buffer.from("bounded-test-client-certificate");
  const thumbprint = createHash("sha256").update(raw).digest("base64url");
  const claims = humanClaims({
    sub: "dsaas-worker",
    azp: "dsaas-worker",
    jti: "service-token-1",
    actor_type: "service",
    molit_roles: ["identity.service"],
    acr: undefined,
    amr: undefined,
    cnf: { "x5t#S256": thumbprint },
  });
  const auth = authenticator([signingKey.jwk]);
  const principal = await auth.authenticate(request(jwt(signingKey, claims), raw));
  assert.equal(principal.certificateThumbprint, thumbprint);
  await assert.rejects(auth.authenticate(request(jwt(signingKey, claims), Buffer.from("another-certificate"))), { code: "IDENTITY_CERTIFICATE_BINDING_MISMATCH" });
  await assert.rejects(auth.authenticate(request(jwt(signingKey, { ...claims, cnf: undefined }), raw)), { code: "IDENTITY_CERTIFICATE_BINDING_INVALID" });
});

test("duplicate authorization and duplicate JWT members are rejected before trust", async () => {
  const signingKey = key("key-duplicate");
  const auth = authenticator([signingKey.jwk]);
  const token = jwt(signingKey, humanClaims());
  await assert.rejects(auth.authenticate({ rawHeaders: ["Authorization", `Bearer ${token}`, "Authorization", `Bearer ${token}`] }), { code: "IDENTITY_UNAUTHENTICATED" });

  const duplicateHeader = `{"alg":"RS256","kid":"${signingKey.kid}","kid":"attacker","typ":"at+jwt"}`;
  const input = `${encode(duplicateHeader)}.${encode(humanClaims())}`;
  const duplicateToken = `${input}.${sign("RSA-SHA256", Buffer.from(input), signingKey.privateKey).toString("base64url")}`;
  await assert.rejects(auth.authenticate(request(duplicateToken)), { code: "IDENTITY_JSON_DUPLICATE_KEY" });
});

test("algorithm confusion, embedded key references and wrong tenant fail closed", async () => {
  const signingKey = key("key-policy");
  const auth = authenticator([signingKey.jwk]);
  await assert.rejects(auth.authenticate(request(jwt(signingKey, humanClaims(), { alg: "none", kid: signingKey.kid, typ: "at+jwt" }))), { code: "IDENTITY_JWT_ALGORITHM_REJECTED" });
  await assert.rejects(auth.authenticate(request(jwt(signingKey, humanClaims(), { alg: "RS256", kid: signingKey.kid, typ: "at+jwt", jku: "https://attacker.example/jwks" }))), { code: "IDENTITY_JWT_HEADER_REJECTED" });
  await assert.rejects(auth.authenticate(request(jwt(signingKey, humanClaims())), { expectedTenantId: "tenant-b" }), { code: "IDENTITY_TENANT_MISMATCH" });
  await assert.rejects(auth.authenticate(request(jwt(signingKey, humanClaims({ acr: "1", amr: ["pwd"] })))), { code: "IDENTITY_MFA_REQUIRED" });
});

test("discovery cannot redirect JWKS loading to an origin outside the pin set", async () => {
  const signingKey = key("key-ssrf");
  const auth = new OidcJwtAuthenticator({
    config: config(),
    http: clientFor([signingKey.jwk], { discovery: { jwks_uri: "https://169.254.169.254/latest/meta-data" } }),
    revocationChecker: { async isRevoked() { return { revoked: false }; } },
    clock: () => new Date("2026-07-14T00:00:00Z"),
  });
  await assert.rejects(auth.authenticate(request(jwt(signingKey, humanClaims()))), { code: "IDENTITY_ENDPOINT_NOT_ALLOWED" });
});

test("JWKS rotation keeps a removed key only for the configured overlap window", async () => {
  const oldKey = key("old-key");
  const newKey = key("new-key");
  let keys = [oldKey.jwk];
  let now = Date.parse("2026-07-14T00:00:00Z");
  const auth = authenticator(() => keys, { clock: () => new Date(now) });
  await auth.authenticate(request(jwt(oldKey, humanClaims())));
  keys = [newKey.jwk];
  now += 1_100;
  await auth.authenticate(request(jwt(newKey, humanClaims({ jti: "token-2" }))));
  await auth.authenticate(request(jwt(oldKey, humanClaims())));
  await assert.rejects(auth.authenticate(request(jwt(oldKey, humanClaims({ jti: "late-old-key-token", iat: Math.floor(now / 1_000) + 31, exp: Math.floor(now / 1_000) + 331 })))), { code: "IDENTITY_RETIRED_KEY_NEW_TOKEN" });
  now += 1_100;
  await assert.rejects(auth.authenticate(request(jwt(oldKey, humanClaims()))), { code: "IDENTITY_SIGNING_KEY_UNKNOWN" });
});

test("same kid with different key material poisons no previously trusted cache", async () => {
  const first = key("reused-kid");
  const attacker = key("reused-kid");
  let keys = [first.jwk];
  let now = Date.parse("2026-07-14T00:00:00Z");
  const auth = authenticator(() => keys, { clock: () => new Date(now) });
  await auth.authenticate(request(jwt(first, humanClaims())));
  keys = [attacker.jwk];
  now += 1_100;
  await assert.rejects(auth.authenticate(request(jwt(attacker, humanClaims({ jti: "attacker-token" })))), { code: "IDENTITY_JWKS_KID_COLLISION" });
  now -= 200;
  await auth.authenticate(request(jwt(first, humanClaims())));
});

test("revoked token and unavailable revocation source fail closed", async () => {
  const signingKey = key("key-revocation");
  const revoked = authenticator([signingKey.jwk], { revocationChecker: { async isRevoked() { return { revoked: true }; } } });
  await assert.rejects(revoked.authenticate(request(jwt(signingKey, humanClaims()))), { code: "IDENTITY_TOKEN_REVOKED" });
  const unavailable = authenticator([signingKey.jwk], { revocationChecker: { async isRevoked() { throw new Error("registry offline"); } } });
  await assert.rejects(unavailable.authenticate(request(jwt(signingKey, humanClaims()))), { code: "IDENTITY_REVOCATION_UNAVAILABLE", status: 503 });
});

test("request cancellation reaches discovery without being wrapped", async () => {
  const signingKey = key("key-cancel");
  let observedSignal;
  const http = new PinnedJsonClient({
    allowedOrigins: ["https://idp.example.test"],
    fetchImpl: async (_url, { signal }) => {
      observedSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    },
  });
  const auth = new OidcJwtAuthenticator({ config: config(), http, revocationChecker: { async isRevoked() { return { revoked: false }; } } });
  const controller = new AbortController();
  const reason = new Error("request deadline reached");
  const authenticating = auth.authenticate(request(jwt(signingKey, humanClaims())), { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(authenticating, (error) => error === reason);
  assert.equal(observedSignal.aborted, true);
});
