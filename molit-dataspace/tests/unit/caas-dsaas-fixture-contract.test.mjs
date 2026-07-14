import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCaasConfig, tenantIdentity } from "../../src/caas/config.mjs";
import { validateCaasContract } from "../../src/caas/contracts.mjs";

async function json(path) { return JSON.parse(await readFile(resolve(path), "utf8")); }

test("CaaS and DSaaS examples share one exact connector convergence contract", async () => {
  const config = await loadCaasConfig("fixtures/caas/config.example.json");
  const registration = validateCaasContract("registration", await json("fixtures/caas/tenant-registration.example.json"));
  const dataspace = await json("fixtures/dsaas/dataspace.example.json");
  const participant = await json("fixtures/dsaas/participant.example.json");
  const identity = tenantIdentity(config.identityPolicy, registration.tenantId);
  assert.equal(participant.caasTenantId, registration.tenantId);
  assert.equal(participant.organizationId, registration.organizationId);
  assert.equal(participant.connectorParticipantId, identity.participantId);
  assert.equal(participant.connectorNamespace, identity.namespace);
  assert.equal(participant.connectorPlanId, dataspace.connectorPlanId);
  const plan = config.connectorPlans[participant.connectorPlanId];
  assert.equal(plan.adapterId, registration.adapterId);
  assert.equal(plan.runtimeProfileRef, registration.runtimeProfileRef);
  assert.deepEqual(Object.keys(registration.deploymentSecretRefs).sort(), [...plan.requiredDeploymentSecretNames].sort());
  const ensure = {
    schemaVersion: "molit.dsaas-caas-request/1",
    dataspaceId: dataspace.dataspaceId,
    caasTenantId: participant.caasTenantId,
    participantId: participant.connectorParticipantId,
    organizationId: participant.organizationId,
    connectorPlanId: participant.connectorPlanId,
    deploymentMode: dataspace.deploymentMode,
    connectorNamespace: participant.connectorNamespace,
    metadataProfile: dataspace.metadataProfile,
    protocolProfile: dataspace.protocolProfile,
    desiredGeneration: 1,
    desiredState: participant.desiredState,
  };
  validateCaasContract("ensure", ensure);
  const { desiredGeneration, ...withoutGeneration } = ensure;
  assert.equal(desiredGeneration, 1);
  assert.throws(() => validateCaasContract("ensure", withoutGeneration), { code: "CAAS_CONTRACT_INVALID" });
  assert.deepEqual(plan.metadataProfile, dataspace.metadataProfile);
  assert.deepEqual(plan.protocolProfile, dataspace.protocolProfile);
});
