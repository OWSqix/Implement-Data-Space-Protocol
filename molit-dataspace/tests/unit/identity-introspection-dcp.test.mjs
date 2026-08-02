import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { DcpCredentialVerifierAdapter, UnavailableDcpCredentialVerifier } from "../../src/identity/dcp-adapter.mjs";
import { IntrospectionAuthenticator } from "../../src/identity/introspection.mjs";
import { DurableRevocationRegistryChecker } from "../../src/identity/revocation-registry.mjs";

const policy = {
  issuer: "https://idp.example.test/",
  audiences: ["molit-api"],
  clientIdClaim: "client_id",
  tokenIdClaim: "jti",
  actorTypeClaim: "actor_type",
  rolesClaim: "roles",
  tenantIdsClaim: "tenant_ids",
  actorTypes: { human: "human", service: "service" },
  allowedClientIds: ["service-client"],
  allowedRoles: ["identity.service"],
  clockSkewSeconds: 0,
  maxTokenLifetimeSeconds: 600,
  humanMfa: { acceptedAcrValues: ["mfa"], requiredAmrAny: ["otp"] },
};

function request(raw, certificate = Buffer.from("service-certificate")) {
  return {
    rawHeaders: ["Authorization", `Bearer ${raw}`],
    socket: { authorized: true, getPeerCertificate: () => ({ raw: certificate }) },
  };
}

function active(certificate = Buffer.from("service-certificate")) {
  return {
    active: true,
    iss: policy.issuer,
    aud: "molit-api",
    sub: "service-1",
    client_id: "service-client",
    jti: "opaque-token-1",
    actor_type: "service",
    roles: ["identity.service"],
    tenant_ids: ["tenant-a"],
    iat: Date.parse("2026-07-14T00:00:00Z") / 1_000,
    exp: Date.parse("2026-07-14T00:05:00Z") / 1_000,
    cnf: { "x5t#S256": createHash("sha256").update(certificate).digest("base64url") },
  };
}

test("RFC 7662 introspection uses a secret reference and binds an active token to mTLS", async () => {
  let call;
  const auth = new IntrospectionAuthenticator({
    config: { policy, introspectionUrl: "https://idp.example.test/introspect", clientId: "resource server", clientSecretRef: "vault://identity/introspection" },
    http: { async json(url, options) { call = { url, options }; return active(); } },
    secretProvider: { async get(reference) { assert.equal(reference, "vault://identity/introspection"); return "not-persisted-secret"; } },
    clock: () => new Date("2026-07-14T00:00:00Z"),
  });
  const principal = await auth.authenticate(request("opaque-token-value"), { expectedTenantId: "tenant-a" });
  assert.equal(principal.actorType, "service");
  assert.equal(call.options.body, "token=opaque-token-value&token_type_hint=access_token");
  assert.equal(Buffer.from(call.options.headers.authorization.slice(6), "base64").toString(), "resource+server:not-persisted-secret");
});

test("inactive introspection response and mTLS mismatch are rejected", async () => {
  const make = (claims) => new IntrospectionAuthenticator({
    config: { policy, introspectionUrl: "https://idp.example.test/introspect", clientId: "resource", clientSecretRef: "vault://secret" },
    http: { async json() { return claims; } },
    secretProvider: { async get() { return "not-persisted-secret"; } },
    clock: () => new Date("2026-07-14T00:00:00Z"),
  });
  await assert.rejects(make({ active: false }).authenticate(request("inactive-token-value")), { code: "IDENTITY_TOKEN_INACTIVE" });
  await assert.rejects(make(active()).authenticate(request("opaque-token-value", Buffer.from("wrong-certificate"))), { code: "IDENTITY_CERTIFICATE_BINDING_MISMATCH" });
});

test("introspection startup probe fails closed on client authentication errors and recovers", async () => {
  let now = new Date("2026-07-14T00:00:00Z");
  let unavailable = false;
  const auth = new IntrospectionAuthenticator({
    config: { policy, introspectionUrl: "https://idp.example.test/introspect", clientId: "resource", clientSecretRef: "vault://secret", readinessMaxAgeMs: 1_000 },
    http: {
      productionEligible: true,
      async json() {
        if (unavailable) throw Object.assign(new Error("unauthorized"), { code: "IDENTITY_HTTP_STATUS_INVALID" });
        return { active: false };
      },
    },
    secretProvider: { async get() { return "not-persisted-secret"; } },
    clock: () => now,
  });
  assert.equal((await auth.readiness({ probe: false })).ready, false);
  await auth.initialize();
  assert.equal((await auth.readiness({ probe: false })).ready, true);
  now = new Date("2026-07-14T00:00:02Z");
  unavailable = true;
  const failed = await auth.readiness();
  assert.equal(failed.ready, false);
  assert.equal(failed.lastFailure.code, "IDENTITY_HTTP_STATUS_INVALID");
  unavailable = false;
  const recovered = await auth.readiness();
  assert.equal(recovered.ready, true);
  assert.equal(recovered.lastFailure, null);
});

test("DCP adapter accepts only status-checked credentials from a pinned issuer", async () => {
  const result = {
    verified: true,
    audience: "did:web:consumer.example",
    issuer: "did:web:authority.example",
    participantId: "did:web:provider.example",
    proofKeyId: "did:web:provider.example#key-1",
    statusChecked: true,
    credentialTypes: ["MembershipCredential"],
    credentialIds: ["urn:uuid:credential-1"],
    expiresAt: "2026-07-15T00:00:00Z",
  };
  const adapter = new DcpCredentialVerifierAdapter({
    verifier: { async verifyPresentation() { return result; } },
    trustedIssuers: ["did:web:authority.example"],
    requiredCredentialTypes: ["MembershipCredential"],
    clock: () => new Date("2026-07-14T00:00:00Z"),
  });
  const identity = await adapter.verify({ presentationToken: "presentation-token-value", audience: "did:web:consumer.example" });
  assert.equal(identity.participantId, "did:web:provider.example");
  const unchecked = new DcpCredentialVerifierAdapter({
    verifier: { async verifyPresentation() { return { ...result, statusChecked: false }; } },
    trustedIssuers: [result.issuer],
    requiredCredentialTypes: ["MembershipCredential"],
  });
  await assert.rejects(unchecked.verify({ presentationToken: "presentation-token-value", audience: result.audience }), { code: "IDENTITY_DCP_STATUS_UNVERIFIED" });
});

test("undeployed DCP trust chain remains an explicit external blocker", async () => {
  const adapter = new DcpCredentialVerifierAdapter({
    verifier: new UnavailableDcpCredentialVerifier(),
    trustedIssuers: ["did:web:authority.example"],
    requiredCredentialTypes: ["MembershipCredential"],
  });
  await assert.rejects(adapter.verify({ presentationToken: "presentation-token-value", audience: "did:web:consumer.example" }), { code: "IDENTITY_DCP_ISSUANCE_TRUST_CHAIN_NOT_DEPLOYED", status: 503 });
});

test("durable revocation records must be fresh and bound to issuer and token ID", async () => {
  const checker = new DurableRevocationRegistryChecker({
    registry: { async lookup({ issuer, subject, tokenId }) { return { issuer, subject, tokenId, status: "REVOKED", observedAt: "2026-07-14T00:00:00Z" }; } },
    maxRecordAgeMs: 30_000,
    clock: () => new Date("2026-07-14T00:00:10Z"),
  });
  assert.deepEqual(await checker.isRevoked({ issuer: policy.issuer, subject: "service-1", tokenId: "token-1", issuedAt: "2026-07-14T00:00:00Z" }), { revoked: true });
  const stale = new DurableRevocationRegistryChecker({
    registry: { async lookup({ issuer, subject, tokenId }) { return { issuer, subject, tokenId, status: "VALID", observedAt: "2026-07-13T23:00:00Z" }; } },
    maxRecordAgeMs: 30_000,
    clock: () => new Date("2026-07-14T00:00:10Z"),
  });
  await assert.rejects(stale.isRevoked({ issuer: policy.issuer, subject: "service-1", tokenId: "token-1", issuedAt: "2026-07-13T23:59:00Z" }), { code: "IDENTITY_REVOCATION_STALE", status: 503 });
});
