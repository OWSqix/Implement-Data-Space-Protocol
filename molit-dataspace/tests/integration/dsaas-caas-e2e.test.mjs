import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CaaSAuthorizer } from "../../src/caas/auth.mjs";
import { loadCaasConfig } from "../../src/caas/config.mjs";
import { createCaasProvisioners } from "../../src/caas/provisioner.mjs";
import { createCaaSHttpServer } from "../../src/caas/server.mjs";
import { CaaSControlService } from "../../src/caas/service.mjs";
import { FileCaasStore } from "../../src/caas/store.mjs";
import { ResilientHttpClient } from "../../src/bridge-runtime/http-client.mjs";
import { HttpCaasClient } from "../../src/dsaas/caas-client.mjs";
import { DsaasControlPlane } from "../../src/dsaas/service.mjs";
import { FileDsaasStore } from "../../src/dsaas/store.mjs";

const PROFILE = { iri: "https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1", version: "1.0.0-rc.1", sha256: "0666b7c2ed74800264a9ac6c8292f819fc973a02057397faca3b3d5df3bacfe4" };
const GOVERNANCE = { iri: "https://data.molit.go.kr/governance/molit-dataspace/0.1.0", version: "0.1.0", sha256: "a".repeat(64) };
const PROTOCOL = { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" };

function serviceRegistry(status, actualSha256) {
  return {
    actualSha256,
    issuedAt: "2026-07-13T00:00:00Z",
    validUntil: "2026-07-14T00:00:00Z",
    maxAgeSeconds: 86_400,
    registry: { issuedAt: "2026-07-13T00:00:00Z", validUntil: "2026-07-14T00:00:00Z" },
    byId: new Map([["caas-primary", {
      serviceId: "caas-primary",
      status,
      evidence: { observedAt: "2026-07-13T00:00:00Z", sha256: "d".repeat(64) },
    }]]),
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server.address();
}

test("DSaaS approved membership converges through the authenticated CaaS API", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-dsaas-caas-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const caasConfig = await loadCaasConfig(fileURLToPath(new URL("../../fixtures/caas/config.example.json", import.meta.url)));
  caasConfig.stateStore.path = join(directory, "caas-state.json");
  caasConfig.listen = { host: "127.0.0.1", port: 0 };
  caasConfig.provisioners["edc-intent-v1"].manifestDirectory = join(directory, "intents");
  caasConfig.controller.allowedDataspaceIds = ["molit-live"];
  const env = {
    MOLIT_CAAS_ADMIN_TOKEN: "admin-token-at-least-16-characters",
    MOLIT_CAAS_DSAAS_CONTROLLER_TOKEN: "controller-token-at-least-16-characters",
    MOLIT_CAAS_ROAD_DATA_PROVIDER_TOKEN: "tenant-token-at-least-16-characters",
  };
  const provisioners = createCaasProvisioners(caasConfig);
  const fixedClock = () => new Date("2026-07-13T00:00:00Z");
  const caasStore = new FileCaasStore({
    path: caasConfig.stateStore.path,
    maxBytes: caasConfig.limits.maxStateBytes,
    maxAuditEvents: caasConfig.limits.maxAuditEvents,
    clock: fixedClock,
  });
  // The dry-run adapter cannot report ACTIVE. This test-only wrapper stands in
  // for an operational adapter after independent Connector health confirmation.
  const intentProvisioner = provisioners["edc-intent-v1"];
  let lastAdapterResult;
  provisioners["edc-intent-v1"] = {
    intentOnly: false,
    readiness: (options) => intentProvisioner.readiness(options),
    async provision(tenant, key, options) {
      lastAdapterResult = { ...await intentProvisioner.provision(tenant, key, options), converged: true };
      return lastAdapterResult;
    },
    async deprovision(tenant, key, options) {
      lastAdapterResult = { ...await intentProvisioner.deprovision(tenant, key, options), converged: true };
      return lastAdapterResult;
    },
    async suspend(tenant, key, options) {
      lastAdapterResult = { ...await intentProvisioner.suspend(tenant, key, options), converged: true };
      return lastAdapterResult;
    },
    async observe(tenant, key) {
      return {
        adapterResourceId: lastAdapterResult.adapterResourceId,
        intentDigest: lastAdapterResult.intentDigest,
        operationKey: key,
        generation: tenant.generation,
        desiredState: tenant.desiredState,
        exists: ["PROVISIONED", "SUSPENDED"].includes(tenant.desiredState),
        converged: true,
      };
    },
  };
  const caasService = new CaaSControlService({ config: caasConfig, provisioners, store: caasStore, env, now: fixedClock });
  const authorizer = new CaaSAuthorizer({ config: caasConfig, store: caasStore, env });
  const caasServer = createCaaSHttpServer({ config: caasConfig, service: caasService, authorizer });
  const address = await listen(caasServer);
  t.after(() => new Promise((resolve) => caasServer.close(resolve)));

  await caasService.register({
    schemaVersion: "molit.caas-tenant-registration/1",
    tenantId: "road-data-provider",
    organizationId: "urn:molit:organization:road-data-provider",
    displayName: "도로 데이터 제공기관 Connector",
    adapterId: "edc-intent-v1",
    runtimeProfileRef: "urn:molit:caas:runtime-profile:edc-connector-v1",
    apiAccessSecretRef: "env://MOLIT_CAAS_ROAD_DATA_PROVIDER_TOKEN",
    apiPrincipalId: "urn:molit:principal:road-data-provider-operator",
    apiClientId: "road-data-provider-control-client",
    apiKeyId: "road-data-provider-2026-01",
    deploymentSecretRefs: {
      vaultAccess: "vault://molit/caas/road-data-provider/edc-vault",
      databaseAccess: "vault://molit/caas/road-data-provider/source-db",
    },
  }, "register-road-provider-0001", authorizer.admin(`Bearer ${env.MOLIT_CAAS_ADMIN_TOKEN}`));

  const origin = `http://127.0.0.1:${address.port}`;
  const http = new ResilientHttpClient({
    policy: { allowedOrigins: [origin], privateOrigins: [origin], allowHttp: true, allowPrivate: true },
    retries: 0,
  });
  const caas = new HttpCaasClient({
    config: {
      baseUrl: `${origin}/`,
      ensurePath: "/v1/connectors/ensure",
      supportsIdempotencyKey: true,
      auth: { type: "bearer", env: "MOLIT_CAAS_DSAAS_CONTROLLER_TOKEN" },
    },
    http,
    env,
  });
  let currentServiceRegistry = serviceRegistry("READY", "1".repeat(64));
  const dsaas = new DsaasControlPlane({
    store: new FileDsaasStore({ path: join(directory, "dsaas-state.json"), clock: () => new Date("2026-07-13T00:00:00Z") }),
    caas,
    serviceRegistryProvider: () => currentServiceRegistry,
    approvalDecisionRegistry: {
      actualSha256: "e".repeat(64),
      status: "READY",
      issuedAt: "2026-07-13T00:00:00Z",
      validUntil: "2026-07-14T00:00:00Z",
      maxAgeSeconds: 86_400,
      registry: { status: "READY", issuedAt: "2026-07-13T00:00:00Z", validUntil: "2026-07-14T00:00:00Z" },
      byId: new Map([["decision:2026-001", {
        decisionId: "decision:2026-001",
        status: "APPROVED",
        dataspaceId: "molit-live",
        participantId: "road-membership",
        organizationId: "urn:molit:organization:road-data-provider",
        evidenceSha256: "c".repeat(64),
        authority: "urn:molit:organization:institutional-approval-board",
        decidedAt: "2026-07-13T00:00:00Z",
        validUntil: "2026-07-14T00:00:00Z",
        provenanceSha256: "f".repeat(64),
      }]]),
    },
    approvedMetadataProfiles: [PROFILE],
    approvedGovernanceBundles: [GOVERNANCE],
    connectorPlanIds: ["edc-isolated"],
    allowedNamespaceOrigins: ["https://data.molit.go.kr"],
    clock: () => new Date("2026-07-13T00:00:00Z"),
  });
  const operator = { subject: "operator", principalId: "operator", clientId: "operator-client", keyId: "operator-key-1", roles: ["dsaas.operator"], dataspaceIds: [] };
  const submitter = { subject: "submitter", principalId: "submitter", clientId: "submitter-client", keyId: "submitter-key-1", roles: ["dsaas.dataspace-admin"], dataspaceIds: ["molit-live"] };
  const approver = { subject: "approver", principalId: "approver", clientId: "approver-client", keyId: "approver-key-1", roles: ["dsaas.dataspace-admin"], dataspaceIds: ["molit-live"] };
  await dsaas.createDataspace({
    schemaVersion: "molit.dsaas-dataspace/1",
    dataspaceId: "molit-live",
    name: "국토교통 통합 시험",
    operatorOrganizationId: "urn:molit:organization:operator",
    namespaceBase: "https://data.molit.go.kr/id/",
    metadataProfile: PROFILE,
    governanceBundle: GOVERNANCE,
    protocolProfile: PROTOCOL,
    connectorPlanId: "edc-isolated",
    deploymentMode: "isolated",
    requiredServiceIds: ["caas-primary"],
    desiredState: "ACTIVE",
  }, operator, "create-dataspace-0001");
  await dsaas.submitParticipant("molit-live", {
    schemaVersion: "molit.dsaas-participant/1",
    participantId: "road-membership",
    organizationId: "urn:molit:organization:road-data-provider",
    legalName: "도로 데이터 제공기관",
    caasTenantId: "road-data-provider",
    connectorParticipantId: "did:web:connectors.data.molit.go.kr:road-data-provider",
    connectorNamespace: "https://data.molit.go.kr/tenants/road-data-provider/",
    requestedRoles: ["provider"],
    connectorPlanId: "edc-isolated",
    evidence: { uri: "urn:evidence:road-provider:1", sha256: "c".repeat(64) },
    desiredState: "ACTIVE",
  }, submitter, "submit-participant-0001");
  await dsaas.approveParticipant("molit-live", "road-membership", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, approver, "approve-participant-0001");
  const active = await dsaas.reconcile("molit-live", approver, "reconcile-active-0001");
  assert.equal(active.observedState, "ACTIVE");
  assert.equal(active.desiredGeneration, 2);
  assert.equal(active.participants["road-membership"].connector.connectorId, "road-data-provider");
  assert.equal((await caasService.getTenant("road-data-provider")).observedState, "PROVISIONED");

  const intent = await readFile(join(directory, "intents", "road-data-provider.intent.json"), "utf8");
  assert.equal(intent.includes(env.MOLIT_CAAS_ADMIN_TOKEN), false);
  assert.equal(intent.includes(env.MOLIT_CAAS_ROAD_DATA_PROVIDER_TOKEN), false);
  assert.match(intent, /vault:\/\/molit\/caas\/road-data-provider\/edc-vault/u);

  currentServiceRegistry = serviceRegistry("NOT_READY", "2".repeat(64));
  const serviceBlocked = await dsaas.reconcile("molit-live", approver, "reconcile-service-blocked-0001");
  assert.equal(serviceBlocked.observedState, "BLOCKED");
  assert.equal(serviceBlocked.desiredGeneration, active.desiredGeneration + 1);
  assert.equal(serviceBlocked.participants["road-membership"].connector.state, "SUSPENDED");
  assert.equal((await caasService.getTenant("road-data-provider")).observedState, "SUSPENDED");

  currentServiceRegistry = serviceRegistry("READY", "3".repeat(64));
  const serviceRecovered = await dsaas.reconcile("molit-live", approver, "reconcile-service-recovered-0001");
  assert.equal(serviceRecovered.observedState, "ACTIVE");
  assert.equal(serviceRecovered.desiredGeneration, serviceBlocked.desiredGeneration + 1);
  assert.equal(serviceRecovered.participants["road-membership"].connector.state, "ACTIVE");
  assert.equal((await caasService.getTenant("road-data-provider")).observedState, "PROVISIONED");

  const suspendedDesired = await dsaas.setDesiredState("molit-live", "SUSPENDED", serviceRecovered.revision, approver, "suspend-dataspace-0001");
  assert.equal(suspendedDesired.spec.desiredState, "SUSPENDED");
  const suspended = await dsaas.reconcile("molit-live", approver, "reconcile-suspended-0001");
  assert.equal(suspended.observedState, "SUSPENDED");
  assert.equal((await caasService.getTenant("road-data-provider")).observedState, "SUSPENDED");
});
