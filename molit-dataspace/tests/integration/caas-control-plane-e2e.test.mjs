import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DryRunManifestProvisioner } from "../../src/caas/provisioner.mjs";
import { CaaSControlService } from "../../src/caas/service.mjs";
import { CaaSAuthorizer } from "../../src/caas/auth.mjs";
import { createCaaSHttpServer } from "../../src/caas/server.mjs";

function registration(tenantId, secretRef) {
  return {
    schemaVersion: "molit.caas-tenant-registration/1",
    tenantId,
    organizationId: `urn:organization:${tenantId}`,
    displayName: tenantId,
    adapterId: "dry",
    runtimeProfileRef: "urn:profile:edc-test",
    apiAccessSecretRef: secretRef,
    apiPrincipalId: `urn:test:principal:${tenantId}`,
    apiClientId: `${tenantId}-control-client`,
    apiKeyId: `${tenantId}-key-1`,
    deploymentSecretRefs: { vaultAccess: `vault://tenant/${tenantId}/edc` },
  };
}

async function call(origin, path, { method = "GET", token, key, value } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "idempotency-key": key } : {}),
      ...(value ? { "content-type": "application/json" } : {}),
    },
    ...(value ? { body: JSON.stringify(value) } : {}),
  });
  return { status: response.status, value: await response.json() };
}

test("CaaS HTTP API enforces tenant boundaries and reconciles a connector intent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-caas-e2e-"));
  const config = {
    statePath: join(directory, "state.json"),
    adminSecretRef: "env://ADMIN_TOKEN",
    adminPrincipalId: "urn:test:principal:caas-admin",
    adminClientId: "test-caas-admin-client",
    adminKeyId: "test-caas-admin-key-1",
    controller: {
      secretRef: "env://CONTROLLER_TOKEN",
      principalId: "urn:test:principal:dsaas-controller",
      clientId: "test-dsaas-controller-client",
      keyId: "test-dsaas-controller-key-1",
      allowedDataspaceIds: ["molit-road-space"],
      allowedTenantIds: ["alpha-tenant"],
      allowedConnectorPlanIds: ["standard"],
    },
    identityPolicy: { participantIdTemplate: "did:web:example:{tenantId}", namespaceTemplate: "https://data.example/{tenantId}/", endpointTemplate: "https://connector.example/{tenantId}/" },
    limits: { maxRequestBytes: 8192, maxStateBytes: 1048576, maxAuditEvents: 100, maxAuditResponseEvents: 50, requestTimeoutMs: 2000 },
    connectorPlans: { standard: { adapterId: "dry", runtimeProfileRef: "urn:profile:edc-test", deploymentMode: "isolated", metadataProfile: { iri: "https://profiles.example/metadata", version: "1", sha256: "a".repeat(64) }, protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" }, requiredDeploymentSecretNames: ["vaultAccess"] } },
    provisioners: {},
  };
  const env = { ADMIN_TOKEN: "admin-token-000000", CONTROLLER_TOKEN: "controller-token-000000", ALPHA_TOKEN: "alpha-token-000000", BETA_TOKEN: "beta-token-0000000" };
  const provisioner = new DryRunManifestProvisioner({ id: "dry", manifestDirectory: join(directory, "manifests") });
  const service = new CaaSControlService({ config, provisioners: { dry: provisioner }, env });
  const authorizer = new CaaSAuthorizer({ config, env });
  const server = createCaaSHttpServer({ config, service, authorizer });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await call(origin, "/healthz")).status, 200);
  assert.equal((await call(origin, "/readyz")).status, 200);
  assert.equal((await call(origin, "/v1/tenants", { method: "POST", token: env.ADMIN_TOKEN, key: "register-alpha", value: registration("alpha-tenant", "env://ALPHA_TOKEN") })).status, 201);
  assert.equal((await call(origin, "/v1/tenants", { method: "POST", token: env.ADMIN_TOKEN, key: "register-beta", value: registration("beta-tenant", "env://BETA_TOKEN") })).status, 201);

  assert.equal((await call(origin, "/v1/tenants/beta-tenant", { token: env.ALPHA_TOKEN })).status, 401);
  assert.equal((await call(origin, "/v1/tenants/alpha-tenant", { token: env.ALPHA_TOKEN })).status, 200);
  const desired = { schemaVersion: "molit.caas-desired-state/1", desiredState: "PROVISIONED" };
  assert.equal((await call(origin, "/v1/tenants/alpha-tenant/desired-state", { method: "PUT", token: env.ALPHA_TOKEN, key: "desired-alpha-1", value: desired })).status, 200);
  const conflict = await call(origin, "/v1/tenants/alpha-tenant/desired-state", { method: "PUT", token: env.ALPHA_TOKEN, key: "desired-alpha-1", value: { ...desired, desiredState: "DEPROVISIONED" } });
  assert.equal(conflict.status, 409);
  const reconciled = await call(origin, "/v1/tenants/alpha-tenant/reconcile", { method: "POST", token: env.ALPHA_TOKEN, key: "reconcile-alpha-1" });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.value.observedState, "INTENT_READY");

  const ensure = {
    schemaVersion: "molit.dsaas-caas-request/1",
    dataspaceId: "molit-road-space",
    caasTenantId: "alpha-tenant",
    participantId: "did:web:example:alpha-tenant",
    organizationId: "urn:organization:alpha-tenant",
    connectorPlanId: "standard",
    deploymentMode: "isolated",
    connectorNamespace: "https://data.example/alpha-tenant/",
    metadataProfile: { iri: "https://profiles.example/metadata", version: "1", sha256: "a".repeat(64) },
    protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" },
    desiredGeneration: 1,
    desiredState: "ACTIVE",
  };
  assert.equal((await call(origin, "/v1/tenants", { method: "POST", token: env.CONTROLLER_TOKEN, key: "controller-register-forbidden", value: registration("gamma-tenant", "env://GAMMA_TOKEN") })).status, 403);
  assert.equal((await call(origin, "/v1/audit", { token: env.CONTROLLER_TOKEN })).status, 403);
  assert.equal((await call(origin, "/v1/tenants/alpha-tenant/desired-state", { method: "PUT", token: env.CONTROLLER_TOKEN, key: "controller-desired-forbidden", value: desired })).status, 403);
  const ensured = await call(origin, "/v1/connectors/ensure", { method: "POST", token: env.CONTROLLER_TOKEN, key: "ensure-alpha-1", value: ensure });
  assert.equal(ensured.status, 200);
  assert.deepEqual(ensured.value, {
    connectorId: "alpha-tenant",
    dataspaceId: "molit-road-space",
    participantId: "did:web:example:alpha-tenant",
    state: "PROVISIONING",
    endpoints: { connectorBase: "https://connector.example/alpha-tenant/" },
  });
  assert.deepEqual((await call(origin, "/v1/connectors/ensure", { method: "POST", token: env.CONTROLLER_TOKEN, key: "ensure-alpha-1", value: ensure })).value, ensured.value);
  const generationConflict = await call(origin, "/v1/connectors/ensure", {
    method: "POST",
    token: env.CONTROLLER_TOKEN,
    key: "ensure-alpha-generation-conflict",
    value: { ...ensure, desiredState: "SUSPENDED" },
  });
  assert.equal(generationConflict.status, 409);
  assert.equal(generationConflict.value.error.code, "CAAS_DSAAS_GENERATION_CONFLICT");
  assert.equal((await call(origin, "/v1/connectors/ensure", { method: "POST", token: env.CONTROLLER_TOKEN, key: "ensure-out-of-scope", value: { ...ensure, dataspaceId: "other-space" } })).status, 403);
  const badIdentity = await call(origin, "/v1/connectors/ensure", { method: "POST", token: env.CONTROLLER_TOKEN, key: "ensure-alpha-bad", value: { ...ensure, connectorNamespace: "https://attacker.example/" } });
  assert.equal(badIdentity.status, 409);
  assert.equal((await call(origin, "/v1/connectors/ensure", { method: "POST", token: env.CONTROLLER_TOKEN, key: "ensure-alpha-org", value: { ...ensure, organizationId: "urn:organization:other" } })).status, 409);
  assert.equal((await call(origin, "/v1/connectors/ensure", { method: "POST", token: env.CONTROLLER_TOKEN, key: "ensure-alpha-profile", value: { ...ensure, metadataProfile: { ...ensure.metadataProfile, sha256: "b".repeat(64) } } })).status, 409);

  const manifest = await readFile(join(directory, "manifests", "alpha-tenant.intent.json"), "utf8");
  assert.doesNotMatch(manifest, /alpha-token-000000|admin-token-000000/u);
  const tenantAudit = await call(origin, "/v1/tenants/alpha-tenant/audit", { token: env.ALPHA_TOKEN });
  assert.equal(tenantAudit.status, 200);
  assert.ok(tenantAudit.value.events.length >= 3);
  const registrationAudit = tenantAudit.value.events.find(({ action }) => action === "TENANT_REGISTERED");
  assert.deepEqual({
    actorRole: registrationAudit.actorRole,
    actorPrincipalId: registrationAudit.actorPrincipalId,
    actorClientId: registrationAudit.actorClientId,
    actorKeyId: registrationAudit.actorKeyId,
  }, {
    actorRole: "admin",
    actorPrincipalId: config.adminPrincipalId,
    actorClientId: config.adminClientId,
    actorKeyId: config.adminKeyId,
  });
  const desiredAudit = tenantAudit.value.events.find(({ action }) => action === "DESIRED_STATE_CHANGED");
  assert.deepEqual({
    actorRole: desiredAudit.actorRole,
    actorPrincipalId: desiredAudit.actorPrincipalId,
    actorClientId: desiredAudit.actorClientId,
    actorKeyId: desiredAudit.actorKeyId,
  }, {
    actorRole: "tenant",
    actorPrincipalId: "urn:test:principal:alpha-tenant",
    actorClientId: "alpha-tenant-control-client",
    actorKeyId: "alpha-tenant-key-1",
  });
  const serializedAudit = JSON.stringify(tenantAudit.value);
  assert.doesNotMatch(serializedAudit, /admin-token-000000|alpha-token-000000/u);
  assert.equal((await call(origin, "/v1/audit", { token: env.ALPHA_TOKEN })).status, 401);
  assert.equal((await call(origin, "/v1/audit", { token: env.ADMIN_TOKEN })).status, 200);

  const suspended = await call(origin, "/v1/connectors/ensure", { method: "POST", token: env.CONTROLLER_TOKEN, key: "ensure-alpha-2", value: { ...ensure, desiredGeneration: 2, desiredState: "SUSPENDED" } });
  assert.equal(suspended.value.state, "PROVISIONING");
  const tenantReactivation = await call(origin, "/v1/tenants/alpha-tenant/desired-state", {
    method: "PUT",
    token: env.ALPHA_TOKEN,
    key: "tenant-reactivation-after-dsaas-revocation",
    value: desired,
  });
  assert.equal(tenantReactivation.status, 403);
  assert.equal(tenantReactivation.value.error.code, "CAAS_DSAAS_LIFECYCLE_LOCKED");
  const tenantReconcile = await call(origin, "/v1/tenants/alpha-tenant/reconcile", {
    method: "POST",
    token: env.ALPHA_TOKEN,
    key: "tenant-reconcile-after-dsaas-revocation",
  });
  assert.equal(tenantReconcile.status, 200);
  assert.equal(tenantReconcile.value.desiredState, "DEPROVISIONED");
  assert.equal((await call(origin, "/v1/tenants/alpha-tenant", { token: env.ALPHA_TOKEN })).value.desiredState, "DEPROVISIONED");
  const activeAgain = await call(origin, "/v1/connectors/ensure", { method: "POST", token: env.CONTROLLER_TOKEN, key: "ensure-alpha-1", value: ensure });
  assert.deepEqual(activeAgain.value, ensured.value, "an exact old key replay returns its immutable original response");
  assert.equal((await call(origin, "/v1/tenants/alpha-tenant", { token: env.ALPHA_TOKEN })).value.desiredState, "DEPROVISIONED", "an old replay cannot reactivate a newer suspension");
  const staleGeneration = await call(origin, "/v1/connectors/ensure", { method: "POST", token: env.CONTROLLER_TOKEN, key: "ensure-alpha-stale", value: ensure });
  assert.equal(staleGeneration.status, 409);
  assert.equal(staleGeneration.value.error.code, "CAAS_DSAAS_GENERATION_STALE");
});
