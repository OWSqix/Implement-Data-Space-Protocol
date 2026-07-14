import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CaaSAuthorizer } from "../../src/caas/auth.mjs";
import { DryRunManifestProvisioner } from "../../src/caas/provisioner.mjs";
import { CaaSControlService } from "../../src/caas/service.mjs";
import { FileCaasStore } from "../../src/caas/store.mjs";

test("static bearer authentication maps secrets to stable non-secret audit actors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-actor-"));
  const config = {
    adminSecretRef: "env://ADMIN_TOKEN",
    adminPrincipalId: "urn:test:principal:caas-admin",
    adminClientId: "test-caas-admin-client",
    adminKeyId: "test-caas-admin-key-1",
    controller: {
      secretRef: "env://CONTROLLER_TOKEN",
      principalId: "urn:test:principal:dsaas-controller",
      clientId: "test-dsaas-controller-client",
      keyId: "test-dsaas-controller-key-1",
      allowedDataspaceIds: ["road-space"],
      allowedTenantIds: ["road-operator"],
      allowedConnectorPlanIds: ["standard"],
    },
    identityPolicy: {
      participantIdTemplate: "did:web:example:{tenantId}",
      namespaceTemplate: "https://data.example/{tenantId}/",
      endpointTemplate: "https://connector.example/{tenantId}/",
    },
    limits: { maxStateBytes: 1048576, maxAuditEvents: 100, maxAuditResponseEvents: 50 },
    connectorPlans: {
      standard: {
        adapterId: "dry",
        runtimeProfileRef: "urn:profile:edc",
        deploymentMode: "isolated",
        metadataProfile: { iri: "https://profiles.example/metadata", version: "1", sha256: "a".repeat(64) },
        protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" },
        requiredDeploymentSecretNames: ["vaultAccess"],
      },
    },
  };
  const env = {
    ADMIN_TOKEN: "admin-token-at-least-16-characters",
    CONTROLLER_TOKEN: "controller-token-at-least-16-characters",
    TENANT_TOKEN: "tenant-token-at-least-16-characters",
  };
  const provisioner = new DryRunManifestProvisioner({ id: "dry", manifestDirectory: join(directory, "manifests") });
  const store = new FileCaasStore({ path: join(directory, "state.json"), maxBytes: config.limits.maxStateBytes, maxAuditEvents: config.limits.maxAuditEvents });
  const service = new CaaSControlService({ config, provisioners: { dry: provisioner }, store, env });
  const authorizer = new CaaSAuthorizer({ config, store, env });
  const admin = authorizer.admin(`Bearer ${env.ADMIN_TOKEN}`);
  assert.deepEqual(admin, {
    role: "admin",
    principalId: config.adminPrincipalId,
    clientId: config.adminClientId,
    keyId: config.adminKeyId,
  });
  assert.deepEqual(authorizer.controller(`Bearer ${env.CONTROLLER_TOKEN}`), {
    role: "controller",
    principalId: config.controller.principalId,
    clientId: config.controller.clientId,
    keyId: config.controller.keyId,
    allowedDataspaceIds: ["road-space"],
    allowedTenantIds: ["road-operator"],
    allowedConnectorPlanIds: ["standard"],
  });
  assert.throws(() => authorizer.admin(`Bearer ${env.CONTROLLER_TOKEN}`), { code: "CAAS_FORBIDDEN" });

  await service.register({
    schemaVersion: "molit.caas-tenant-registration/1",
    tenantId: "road-operator",
    organizationId: "urn:organization:road-operator",
    displayName: "Road operator",
    adapterId: "dry",
    runtimeProfileRef: "urn:profile:edc",
    apiAccessSecretRef: "env://TENANT_TOKEN",
    apiPrincipalId: "urn:test:principal:road-operator",
    apiClientId: "test-road-operator-client",
    apiKeyId: "test-road-operator-key-1",
    deploymentSecretRefs: { vaultAccess: "vault://tenant/road/vault" },
  }, "register-1", admin);

  const tenant = await authorizer.tenant(`Bearer ${env.TENANT_TOKEN}`, "road-operator");
  assert.deepEqual(tenant, {
    role: "tenant",
    principalId: "urn:test:principal:road-operator",
    clientId: "test-road-operator-client",
    keyId: "test-road-operator-key-1",
  });
  await assert.rejects(
    authorizer.tenant(`Bearer ${env.TENANT_TOKEN}`, "rail-operator"),
    { code: "CAAS_UNAUTHORIZED" },
  );
  await service.setDesiredState("road-operator", {
    schemaVersion: "molit.caas-desired-state/1",
    desiredState: "PROVISIONED",
  }, "desired-1", tenant);

  const { events } = await service.audit("road-operator");
  assert.deepEqual(events.map(({ actorRole, actorPrincipalId, actorClientId, actorKeyId }) => ({
    actorRole,
    actorPrincipalId,
    actorClientId,
    actorKeyId,
  })), [
    {
      actorRole: "admin",
      actorPrincipalId: config.adminPrincipalId,
      actorClientId: config.adminClientId,
      actorKeyId: config.adminKeyId,
    },
    {
      actorRole: "tenant",
      actorPrincipalId: "urn:test:principal:road-operator",
      actorClientId: "test-road-operator-client",
      actorKeyId: "test-road-operator-key-1",
    },
  ]);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes(env.ADMIN_TOKEN), false);
  assert.equal(serialized.includes(env.TENANT_TOKEN), false);
  await assert.rejects(service.reconcile("road-operator", "reconcile-role-only", { role: "tenant" }), { code: "CAAS_ACTOR_INVALID" });
});
