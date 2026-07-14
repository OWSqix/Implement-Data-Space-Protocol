import { loadCaasState } from "./store.mjs";
import { bearerToken, resolveEnvironmentSecret, secretEqual } from "./secrets.mjs";
import { CaaSError, assertCaas } from "./errors.mjs";

export class CaaSAuthorizer {
  constructor({ config, env = process.env }) {
    this.config = config;
    this.env = env;
  }

  admin(header) {
    const token = bearerToken(header);
    if (this.config.controller && secretEqual(token, resolveEnvironmentSecret(this.config.controller.secretRef, this.env))) {
      throw new CaaSError("CAAS_FORBIDDEN", "controller credential is not authorized for this route", { status: 403 });
    }
    const expected = resolveEnvironmentSecret(this.config.adminSecretRef, this.env);
    if (!secretEqual(token, expected)) throw new CaaSError("CAAS_UNAUTHORIZED", "valid bearer authentication is required", { status: 401 });
    return { role: "admin", principalId: this.config.adminPrincipalId, clientId: this.config.adminClientId, keyId: this.config.adminKeyId };
  }

  controller(header) {
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

  async tenant(header, tenantId) {
    const token = bearerToken(header);
    const admin = resolveEnvironmentSecret(this.config.adminSecretRef, this.env);
    if (secretEqual(token, admin)) return { role: "admin", principalId: this.config.adminPrincipalId, clientId: this.config.adminClientId, keyId: this.config.adminKeyId };
    if (this.config.controller && secretEqual(token, resolveEnvironmentSecret(this.config.controller.secretRef, this.env))) {
      throw new CaaSError("CAAS_FORBIDDEN", "controller credential is not authorized for tenant routes", { status: 403 });
    }
    const state = await loadCaasState(this.config.statePath, this.config.limits.maxStateBytes);
    const matches = [];
    for (const tenant of Object.values(state.tenants)) {
      if (secretEqual(token, resolveEnvironmentSecret(tenant.apiAccessSecretRef, this.env))) matches.push(tenant.tenantId);
    }
    assertCaas(matches.length === 1 && matches[0] === tenantId, "CAAS_UNAUTHORIZED", "valid bearer authentication is required", { status: 401 });
    const tenant = state.tenants[tenantId];
    return { role: "tenant", principalId: tenant.apiPrincipalId, clientId: tenant.apiClientId, keyId: tenant.apiKeyId };
  }
}
