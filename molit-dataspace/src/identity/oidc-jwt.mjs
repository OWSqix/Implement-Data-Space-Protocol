import { constants, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { assertIdentity, IdentityError, unavailable } from "./errors.mjs";
import { bearerToken, mapIdentityPrincipal, assertNotRevoked, validateIdentityPolicy } from "./claims.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const ALGORITHMS = Object.freeze({
  RS256: { kty: "RSA", algorithm: "RSA-SHA256", options: {} },
  PS256: { kty: "RSA", algorithm: "RSA-SHA256", options: { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } },
  ES256: { kty: "EC", algorithm: "sha256", options: { dsaEncoding: "ieee-p1363" } },
});

function base64url(segment, label, maxBytes) {
  assertIdentity(typeof segment === "string" && segment.length > 0 && segment.length <= Math.ceil(maxBytes * 4 / 3) + 4 && /^[A-Za-z0-9_-]+$/u.test(segment), "IDENTITY_JWT_MALFORMED", `${label} JWT segment is malformed`);
  const bytes = Buffer.from(segment, "base64url");
  assertIdentity(bytes.length <= maxBytes && bytes.toString("base64url") === segment, "IDENTITY_JWT_MALFORMED", `${label} JWT segment is not canonical base64url`);
  return bytes;
}

function compactJwt(token) {
  const segments = token.split(".");
  assertIdentity(segments.length === 3, "IDENTITY_JWT_MALFORMED", "access token is not a compact signed JWT");
  const headerBytes = base64url(segments[0], "header", 8_192);
  const payloadBytes = base64url(segments[1], "payload", 131_072);
  const signature = base64url(segments[2], "signature", 2_048);
  let header;
  let claims;
  try {
    header = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(headerBytes), { maxCharacters: 8_192, maxDepth: 8 });
    claims = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes), { maxCharacters: 131_072, maxDepth: 24 });
  } catch (error) {
    if (error instanceof IdentityError) {
      error.status = 401;
      throw error;
    }
    throw new IdentityError("IDENTITY_JWT_MALFORMED", "JWT is not valid UTF-8 JSON", { cause: error });
  }
  assertIdentity(header && typeof header === "object" && !Array.isArray(header) && claims && typeof claims === "object" && !Array.isArray(claims), "IDENTITY_JWT_MALFORMED", "JWT header and claims must be JSON objects");
  return { header, claims, signature, signingInput: Buffer.from(`${segments[0]}.${segments[1]}`, "ascii") };
}

function jwkBytes(value, label, maxBytes) {
  try {
    return base64url(value, label, maxBytes);
  } catch (error) {
    throw new IdentityError("IDENTITY_JWKS_INVALID", `${label} is malformed`, { status: 503, cause: error });
  }
}

function validateJwk(jwk, algorithms) {
  assertIdentity(jwk && typeof jwk === "object" && !Array.isArray(jwk), "IDENTITY_JWKS_INVALID", "JWKS contains a malformed key", { status: 503 });
  assertIdentity(typeof jwk.kid === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(jwk.kid), "IDENTITY_JWKS_INVALID", "JWKS signing key has no bounded kid", { status: 503 });
  assertIdentity(jwk.use === undefined || jwk.use === "sig", "IDENTITY_JWKS_INVALID", `JWKS key ${jwk.kid} is not a signing key`, { status: 503 });
  assertIdentity(jwk.key_ops === undefined || (Array.isArray(jwk.key_ops) && jwk.key_ops.includes("verify") && !jwk.key_ops.some((item) => item === "sign")), "IDENTITY_JWKS_INVALID", `JWKS key ${jwk.kid} has invalid key operations`, { status: 503 });
  assertIdentity(typeof jwk.alg === "string" && algorithms.includes(jwk.alg), "IDENTITY_JWKS_INVALID", `JWKS key ${jwk.kid} uses a disallowed algorithm`, { status: 503 });
  const specification = ALGORITHMS[jwk.alg];
  assertIdentity(specification && jwk.kty === specification.kty, "IDENTITY_JWKS_INVALID", `JWKS key ${jwk.kid} type does not match its algorithm`, { status: 503 });
  for (const privateMember of ["d", "p", "q", "dp", "dq", "qi", "oth", "k"]) {
    assertIdentity(jwk[privateMember] === undefined, "IDENTITY_JWKS_INVALID", `JWKS key ${jwk.kid} exposes private key material`, { status: 503 });
  }
  if (jwk.kty === "RSA") {
    const modulus = jwkBytes(jwk.n, "RSA modulus", 2_048);
    assertIdentity(modulus.length >= 256 && typeof jwk.e === "string", "IDENTITY_JWKS_INVALID", `JWKS RSA key ${jwk.kid} is smaller than 2048 bits`, { status: 503 });
  } else {
    assertIdentity(jwk.crv === "P-256" && jwkBytes(jwk.x, "EC x", 66).length === 32 && jwkBytes(jwk.y, "EC y", 66).length === 32, "IDENTITY_JWKS_INVALID", `JWKS EC key ${jwk.kid} is not P-256`, { status: 503 });
  }
  let key;
  try {
    key = createPublicKey({ key: jwk, format: "jwk" });
  } catch (error) {
    throw unavailable("IDENTITY_JWKS_INVALID", `JWKS key ${jwk.kid} cannot be imported`, error);
  }
  const fingerprint = key.export({ type: "spki", format: "der" }).toString("base64url");
  return Object.freeze({ kid: jwk.kid, alg: jwk.alg, key, fingerprint });
}

function validateConfig(config) {
  validateIdentityPolicy(config.policy);
  assertIdentity(typeof config.discoveryUrl === "string", "IDENTITY_OIDC_CONFIGURATION_INVALID", "OIDC discovery URL is required", { status: 500 });
  assertIdentity(Array.isArray(config.allowedAlgorithms) && config.allowedAlgorithms.length > 0 && config.allowedAlgorithms.every((item) => ALGORITHMS[item]), "IDENTITY_OIDC_CONFIGURATION_INVALID", "OIDC signing algorithms are invalid", { status: 500 });
  assertIdentity(Array.isArray(config.allowedTokenTypes) && config.allowedTokenTypes.length > 0, "IDENTITY_OIDC_CONFIGURATION_INVALID", "accepted JWT typ values are required", { status: 500 });
  for (const [name, minimum, maximum] of [["cacheTtlMs", 1_000, 86_400_000], ["rotationOverlapMs", 0, 86_400_000], ["minimumRefreshIntervalMs", 100, 300_000]]) {
    assertIdentity(Number.isSafeInteger(config[name]) && config[name] >= minimum && config[name] <= maximum, "IDENTITY_OIDC_CONFIGURATION_INVALID", `${name} is invalid`, { status: 500 });
  }
  assertIdentity(Number.isSafeInteger(config.maxKeys) && config.maxKeys >= 1 && config.maxKeys <= 64, "IDENTITY_OIDC_CONFIGURATION_INVALID", "JWKS key limit is invalid", { status: 500 });
  return config;
}

export class OidcJwtAuthenticator {
  constructor({ config, http, revocationChecker, clock = () => new Date() }) {
    validateConfig(config);
    assertIdentity(http && typeof http.json === "function" && typeof http.url === "function", "IDENTITY_OIDC_CONFIGURATION_INVALID", "a pinned JSON client is required", { status: 500 });
    assertIdentity(revocationChecker && typeof revocationChecker.isRevoked === "function", "IDENTITY_REVOCATION_CONFIGURATION_INVALID", "OIDC JWT authentication requires a revocation checker", { status: 500 });
    Object.assign(this, { config, http, revocationChecker, clock });
    this.activeKeys = new Map();
    this.retiredKeys = new Map();
    this.expiresAt = 0;
    this.lastRefreshAt = 0;
    this.refreshSequence = 0;
    this.appliedRefreshSequence = 0;
    this.productionEligible = http.productionEligible === true;
  }

  async #refresh(signal) {
    const sequence = this.refreshSequence + 1;
    this.refreshSequence = sequence;
    await (async () => {
      const metadata = await this.http.json(this.config.discoveryUrl, { signal, label: "OIDC discovery endpoint" });
      assertIdentity(metadata && typeof metadata === "object" && !Array.isArray(metadata), "IDENTITY_DISCOVERY_INVALID", "OIDC discovery document is malformed", { status: 503 });
      assertIdentity(metadata.issuer === this.config.policy.issuer, "IDENTITY_DISCOVERY_INVALID", "OIDC discovery issuer does not match the configured issuer", { status: 503 });
      assertIdentity(typeof metadata.jwks_uri === "string", "IDENTITY_DISCOVERY_INVALID", "OIDC discovery document has no jwks_uri", { status: 503 });
      this.http.url(metadata.jwks_uri, "OIDC JWKS endpoint");
      assertIdentity(Array.isArray(metadata.id_token_signing_alg_values_supported) && this.config.allowedAlgorithms.every((algorithm) => metadata.id_token_signing_alg_values_supported.includes(algorithm)), "IDENTITY_DISCOVERY_INVALID", "OIDC provider does not advertise the configured signing algorithms", { status: 503 });
      const document = await this.http.json(metadata.jwks_uri, { signal, label: "OIDC JWKS endpoint" });
      assertIdentity(document && Array.isArray(document.keys) && document.keys.length > 0 && document.keys.length <= this.config.maxKeys, "IDENTITY_JWKS_INVALID", "JWKS key count is invalid", { status: 503 });
      const next = new Map();
      const allKeyIds = new Set();
      for (const jwk of document.keys) {
        assertIdentity(jwk && typeof jwk === "object" && !Array.isArray(jwk) && typeof jwk.kid === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(jwk.kid), "IDENTITY_JWKS_INVALID", "JWKS contains a malformed or unbounded kid", { status: 503 });
        assertIdentity(!allKeyIds.has(jwk.kid), "IDENTITY_JWKS_INVALID", `JWKS contains duplicate kid ${jwk.kid}`, { status: 503 });
        allKeyIds.add(jwk.kid);
        if ((jwk.use !== undefined && jwk.use !== "sig") || !this.config.allowedAlgorithms.includes(jwk.alg)) continue;
        const candidate = validateJwk(jwk, this.config.allowedAlgorithms);
        const previous = this.activeKeys.get(candidate.kid) ?? this.retiredKeys.get(candidate.kid)?.entry;
        assertIdentity(!previous || previous.fingerprint === candidate.fingerprint, "IDENTITY_JWKS_KID_COLLISION", `JWKS changed key material without changing kid ${candidate.kid}`, { status: 503 });
        next.set(candidate.kid, candidate);
      }
      assertIdentity(next.size > 0, "IDENTITY_JWKS_INVALID", "JWKS contains no allowed signing key", { status: 503 });
      const now = this.clock().getTime();
      const retired = new Map([...this.retiredKeys].filter(([, value]) => value.expiresAt > now));
      for (const [kid, entry] of this.activeKeys) {
        if (!next.has(kid) && this.config.rotationOverlapMs > 0) retired.set(kid, { entry, retiredAt: now, expiresAt: now + this.config.rotationOverlapMs });
      }
      for (const kid of next.keys()) retired.delete(kid);
      if (sequence >= this.appliedRefreshSequence) {
        this.activeKeys = next;
        this.retiredKeys = retired;
        this.lastRefreshAt = now;
        this.expiresAt = now + this.config.cacheTtlMs;
        this.appliedRefreshSequence = sequence;
      }
    })();
  }

  async #key(kid, signal) {
    const now = this.clock().getTime();
    if (this.activeKeys.size === 0 || now >= this.expiresAt) await this.#refresh(signal);
    let selected = this.activeKeys.has(kid) ? { entry: this.activeKeys.get(kid), retiredAt: null } : null;
    if (!selected) {
      const retired = this.retiredKeys.get(kid);
      if (retired?.expiresAt > now) selected = { entry: retired.entry, retiredAt: retired.retiredAt };
    }
    if (!selected && now - this.lastRefreshAt >= this.config.minimumRefreshIntervalMs) {
      await this.#refresh(signal);
      const refreshedNow = this.clock().getTime();
      const active = this.activeKeys.get(kid);
      const retired = this.retiredKeys.get(kid);
      selected = active ? { entry: active, retiredAt: null } : retired?.expiresAt > refreshedNow ? { entry: retired.entry, retiredAt: retired.retiredAt } : null;
    }
    assertIdentity(selected, "IDENTITY_SIGNING_KEY_UNKNOWN", "JWT signing key is not trusted");
    return selected;
  }

  async authenticate(request, { signal, expectedTenantId, requiredRoles = [] } = {}) {
    const token = bearerToken(request);
    const { header, claims, signature, signingInput } = compactJwt(token);
    assertIdentity(typeof header.alg === "string" && this.config.allowedAlgorithms.includes(header.alg), "IDENTITY_JWT_ALGORITHM_REJECTED", "JWT algorithm is not allowed");
    assertIdentity(typeof header.kid === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(header.kid), "IDENTITY_JWT_MALFORMED", "JWT kid is missing or malformed");
    assertIdentity(this.config.allowedTokenTypes.includes(header.typ), "IDENTITY_JWT_TYPE_REJECTED", "JWT typ is not accepted");
    assertIdentity(header.crit === undefined && header.jku === undefined && header.jwk === undefined && header.x5u === undefined && header.b64 === undefined, "IDENTITY_JWT_HEADER_REJECTED", "JWT contains an unsupported key or critical header");
    const { entry, retiredAt } = await this.#key(header.kid, signal);
    assertIdentity(entry.alg === header.alg, "IDENTITY_JWT_ALGORITHM_REJECTED", "JWT algorithm does not match the trusted key");
    const specification = ALGORITHMS[header.alg];
    let valid = false;
    try {
      valid = cryptoVerify(specification.algorithm, signingInput, { key: entry.key, ...specification.options }, signature);
    } catch {}
    assertIdentity(valid, "IDENTITY_JWT_SIGNATURE_INVALID", "JWT signature is invalid");
    if (retiredAt !== null) {
      assertIdentity(Number.isSafeInteger(claims.iat) && claims.iat <= Math.floor(retiredAt / 1_000) + this.config.policy.clockSkewSeconds, "IDENTITY_RETIRED_KEY_NEW_TOKEN", "a retired signing key was used to issue a new token");
    }
    const principal = mapIdentityPrincipal(claims, this.config.policy, { request, expectedTenantId, requiredRoles, now: this.clock(), signingKeyId: header.kid });
    await assertNotRevoked(principal, this.revocationChecker, { signal });
    return principal;
  }
}
