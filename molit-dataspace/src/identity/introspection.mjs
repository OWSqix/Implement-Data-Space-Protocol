import { assertIdentity, unavailable } from "./errors.mjs";
import { bearerToken, mapIdentityPrincipal, validateIdentityPolicy } from "./claims.mjs";

function basicComponent(value) {
  const encoded = new URLSearchParams([["value", value]]).toString();
  return encoded.slice("value=".length);
}

export class IntrospectionAuthenticator {
  constructor({ config, http, secretProvider, clock = () => new Date() }) {
    validateIdentityPolicy(config.policy);
    assertIdentity(typeof config.introspectionUrl === "string" && typeof config.clientId === "string" && config.clientId.length > 0, "IDENTITY_INTROSPECTION_CONFIGURATION_INVALID", "introspection endpoint and client ID are required", { status: 500 });
    assertIdentity(typeof config.clientSecretRef === "string" && config.clientSecretRef.length > 0, "IDENTITY_INTROSPECTION_CONFIGURATION_INVALID", "introspection client secret reference is required", { status: 500 });
    assertIdentity(http && typeof http.json === "function", "IDENTITY_INTROSPECTION_CONFIGURATION_INVALID", "a pinned JSON client is required", { status: 500 });
    assertIdentity(secretProvider && typeof secretProvider.get === "function", "IDENTITY_INTROSPECTION_CONFIGURATION_INVALID", "a secret provider is required", { status: 500 });
    assertIdentity(config.readinessMaxAgeMs === undefined || (Number.isSafeInteger(config.readinessMaxAgeMs) && config.readinessMaxAgeMs >= 1_000 && config.readinessMaxAgeMs <= 300_000), "IDENTITY_INTROSPECTION_CONFIGURATION_INVALID", "introspection readiness age is invalid", { status: 500 });
    Object.assign(this, { config, http, secretProvider, clock });
    this.readinessMaxAgeMs = config.readinessMaxAgeMs ?? 60_000;
    this.initialized = false;
    this.lastFailure = null;
    this.lastSuccessAt = null;
    this.probePromise = null;
    this.productionEligible = http.productionEligible === true;
  }

  #status() {
    const now = this.clock().getTime();
    const lastSuccessMs = this.lastSuccessAt ? Date.parse(this.lastSuccessAt) : Number.NaN;
    const ageMs = Number.isFinite(lastSuccessMs) ? Math.max(0, now - lastSuccessMs) : null;
    return Object.freeze({
      initialized: this.initialized,
      lastFailure: this.lastFailure,
      lastSuccessAt: this.lastSuccessAt,
      maxAgeMs: this.readinessMaxAgeMs,
      ageMs,
      productionEligible: this.productionEligible,
      ready: this.initialized && this.lastFailure === null && ageMs !== null && ageMs <= this.readinessMaxAgeMs,
    });
  }

  #failed(error) {
    this.lastFailure = Object.freeze({
      at: this.clock().toISOString(),
      code: typeof error?.code === "string" ? error.code : "IDENTITY_INTROSPECTION_UNAVAILABLE",
    });
  }

  async #introspect(token, { signal } = {}) {
    let secret;
    try {
      secret = await this.secretProvider.get(this.config.clientSecretRef, { signal });
    } catch (error) {
      if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
      const failure = unavailable("IDENTITY_SECRET_UNAVAILABLE", "introspection client credential is unavailable", error);
      this.#failed(failure);
      throw failure;
    }
    try {
      assertIdentity(typeof secret === "string" && secret.length >= 16 && secret.length <= 8_192, "IDENTITY_SECRET_UNAVAILABLE", "introspection client credential is unavailable", { status: 503 });
    } catch (error) {
      this.#failed(error);
      throw error;
    }
    const authorization = Buffer.from(`${basicComponent(this.config.clientId)}:${basicComponent(secret)}`, "utf8").toString("base64");
    try {
      const claims = await this.http.json(this.config.introspectionUrl, {
        method: "POST",
        headers: { accept: "application/json", authorization: `Basic ${authorization}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }).toString(),
        signal,
        label: "OAuth 2.0 introspection endpoint",
      });
      assertIdentity(claims && typeof claims === "object" && !Array.isArray(claims) && typeof claims.active === "boolean", "IDENTITY_INTROSPECTION_INVALID", "introspection response is malformed", { status: 503 });
      this.initialized = true;
      this.lastSuccessAt = this.clock().toISOString();
      this.lastFailure = null;
      return claims;
    } catch (error) {
      this.#failed(error);
      throw error;
    }
  }

  async initialize({ signal, force = false } = {}) {
    if (!force && this.#status().ready) return this.#status();
    if (this.probePromise) return this.probePromise;
    this.probePromise = (async () => {
      try {
        const claims = await this.#introspect("molit-readiness-probe-token-never-issued", { signal });
        assertIdentity(claims.active === false, "IDENTITY_INTROSPECTION_PROBE_INVALID", "introspection readiness probe was unexpectedly active", { status: 503 });
        return this.#status();
      } catch (error) {
        this.#failed(error);
        throw error;
      } finally {
        this.probePromise = null;
      }
    })();
    return this.probePromise;
  }

  async readiness({ signal, probe = true } = {}) {
    if (probe && !this.#status().ready) {
      try { await this.initialize({ signal, force: true }); } catch {}
    }
    return this.#status();
  }

  async authenticate(request, { signal, expectedTenantId, requiredRoles = [] } = {}) {
    const token = bearerToken(request);
    const claims = await this.#introspect(token, { signal });
    assertIdentity(claims.active === true, "IDENTITY_TOKEN_INACTIVE", "access token is inactive");
    return mapIdentityPrincipal(claims, this.config.policy, { request, expectedTenantId, requiredRoles, now: this.clock() });
  }
}
