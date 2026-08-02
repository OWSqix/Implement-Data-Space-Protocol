import { bearerToken, resolveEnvironmentSecret, secretEqual } from "./secrets.mjs";
import { CaaSError, assertCaas } from "./errors.mjs";

function authorization(value) {
  return typeof value === "string" ? value : value?.headers?.authorization;
}

function operationalActor(principal, role, extra = {}) {
  const keyId = principal.signingKeyId ?? principal.tokenId;
  for (const [name, value] of Object.entries({ principalId: principal.principalId, clientId: principal.clientId, keyId })) {
    assertCaas(typeof value === "string" && value.length > 0, "CAAS_IDENTITY_RESULT_INVALID", `operational identity ${name} is missing`, { status: 503 });
  }
  return Object.freeze({ role, principalId: principal.principalId, clientId: principal.clientId, keyId, ...extra });
}

export class CaaSAuthorizer {
  constructor({ config, store, env = process.env, authenticator = null }) {
    assertCaas(store && (typeof store.read === "function" || typeof store.readScope === "function"),
      "CAAS_STATE_STORE_INVALID", "CaaS authorizer requires a readable state store");
    this.config = config;
    this.store = store;
    this.env = env;
    this.authenticator = authenticator;
    this.operational = config.environment === "production";
    assertCaas(!this.operational || authenticator?.productionEligible === true,
      "CAAS_PRODUCTION_AUTH_REQUIRED", "production CaaS requires an operational identity authenticator", { status: 500 });
  }

  async #principal(request, { signal } = {}) {
    assertCaas(request && typeof request === "object", "CAAS_UNAUTHORIZED", "a complete TLS request is required", { status: 401 });
    try {
      return await this.authenticator.authenticate(request, { signal });
    } catch (error) {
      if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
      if (typeof error?.code === "string" && error.code.startsWith("IDENTITY_")) {
        throw new CaaSError(error.code, error.message, { status: error.status ?? 401 });
      }
      throw new CaaSError("CAAS_AUTH_UNAVAILABLE", "operational identity verification failed", { status: 503 });
    }
  }

  admin(request, options) {
    if (this.operational) return this.#adminOperational(request, options);
    const header = authorization(request);
    const token = bearerToken(header);
    if (this.config.controller && secretEqual(token, resolveEnvironmentSecret(this.config.controller.secretRef, this.env))) {
      throw new CaaSError("CAAS_FORBIDDEN", "controller credential is not authorized for this route", { status: 403 });
    }
    const expected = resolveEnvironmentSecret(this.config.adminSecretRef, this.env);
    if (!secretEqual(token, expected)) throw new CaaSError("CAAS_UNAUTHORIZED", "valid bearer authentication is required", { status: 401 });
    return { role: "admin", principalId: this.config.adminPrincipalId, clientId: this.config.adminClientId, keyId: this.config.adminKeyId };
  }

  async #adminOperational(request, options) {
    const principal = await this.#principal(request, options);
    assertCaas(principal.roles.includes("caas.admin"), "CAAS_FORBIDDEN", "caas.admin role is required", { status: 403 });
    return operationalActor(principal, "admin");
  }

  controller(request, { signal, tenantId } = {}) {
    if (this.operational) return this.#controllerOperational(request, { signal, tenantId });
    const header = authorization(request);
    const token = bearerToken(header);
    const admin = resolveEnvironmentSecret(this.config.adminSecretRef, this.env);
    if (secretEqual(token, admin)) return { role: "admin", principalId: this.config.adminPrincipalId, clientId: this.config.adminClientId, keyId: this.config.adminKeyId };
    const controller = this.config.controller;
    assertCaas(controller && secretEqual(token, resolveEnvironmentSecret(controller.secretRef, this.env)), "CAAS_UNAUTHORIZED", "valid bearer authentication is required", { status: 401 });
    return {
      role: "controller",
      principalId: controller.principalId,
      clientId: controller.clientId,
      keyId: controller.keyId,
      allowedDataspaceIds: controller.allowedDataspaceIds,
      allowedTenantIds: controller.allowedTenantIds,
      allowedConnectorPlanIds: controller.allowedConnectorPlanIds,
    };
  }

  async #controllerOperational(request, { signal, tenantId } = {}) {
    const principal = await this.#principal(request, { signal });
    if (principal.roles.includes("caas.admin")) return operationalActor(principal, "admin");
    assertCaas(principal.roles.includes("caas.controller"), "CAAS_FORBIDDEN", "caas.controller role is required", { status: 403 });
    assertCaas(typeof tenantId === "string" && principal.tenantIds.includes(tenantId),
      "CAAS_TENANT_MISMATCH", "controller token is not assigned to the requested tenant", { status: 403 });
    return operationalActor(principal, "controller", {
      allowedDataspaceIds: this.config.controller.allowedDataspaceIds,
      allowedTenantIds: this.config.controller.allowedTenantIds,
      allowedConnectorPlanIds: this.config.controller.allowedConnectorPlanIds,
    });
  }

  async tenant(request, tenantId, { signal } = {}) {
    if (this.operational) {
      const principal = await this.#principal(request, { signal });
      if (principal.roles.includes("caas.admin")) return operationalActor(principal, "admin");
      assertCaas(principal.roles.includes("caas.tenant"), "CAAS_FORBIDDEN", "caas.tenant role is required", { status: 403 });
      assertCaas(principal.tenantIds.includes(tenantId), "CAAS_TENANT_MISMATCH", "tenant token is not assigned to the requested tenant", { status: 403 });
      return operationalActor(principal, "tenant");
    }
    const header = authorization(request);
    const token = bearerToken(header);
    const admin = resolveEnvironmentSecret(this.config.adminSecretRef, this.env);
    if (secretEqual(token, admin)) return { role: "admin", principalId: this.config.adminPrincipalId, clientId: this.config.adminClientId, keyId: this.config.adminKeyId };
    if (this.config.controller && secretEqual(token, resolveEnvironmentSecret(this.config.controller.secretRef, this.env))) {
      throw new CaaSError("CAAS_FORBIDDEN", "controller credential is not authorized for tenant routes", { status: 403 });
    }
    const state = await this.store.read((value) => value, { signal });
    const matches = [];
    for (const tenant of Object.values(state.tenants)) {
      if (secretEqual(token, resolveEnvironmentSecret(tenant.apiAccessSecretRef, this.env))) matches.push(tenant.tenantId);
    }
    assertCaas(matches.length === 1 && matches[0] === tenantId, "CAAS_UNAUTHORIZED", "valid bearer authentication is required", { status: 401 });
    const tenant = state.tenants[tenantId];
    return { role: "tenant", principalId: tenant.apiPrincipalId, clientId: tenant.apiClientId, keyId: tenant.apiKeyId };
  }
}
