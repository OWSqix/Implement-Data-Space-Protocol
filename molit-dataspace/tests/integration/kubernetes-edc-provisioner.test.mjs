import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { digest } from "../../src/discovery/stable-json.mjs";
import { KubernetesApiClient, KubernetesApiError, KubernetesEdcProvisioner } from "../../src/caas/kubernetes-provisioner.mjs";

const enabled = process.env.MOLIT_KUBERNETES_INTEGRATION === "1";
const group = "caas.data.molit.go.kr";

function required(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is required for Kubernetes integration`);
  return value;
}

function fixture(tenantId, generation, desiredState, images) {
  const connectorPlanSnapshot = {
    adapterId: "kube-edc",
    runtimeProfileRef: "urn:molit:test:edc-runtime",
    deploymentMode: "isolated",
    metadataProfile: { iri: "https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1", version: "1.0.0-rc.1", sha256: "a".repeat(64) },
    protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" },
    requiredDeploymentSecretNames: ["vaultAccess"],
    ...(images ? { images } : {}),
  };
  return {
    tenantId,
    generation,
    desiredState,
    participantId: `did:web:integration.invalid:${tenantId}`,
    namespace: `https://integration.invalid/${tenantId}/`,
    endpoint: `https://connector.integration.invalid/${tenantId}/`,
    runtimeProfileRef: connectorPlanSnapshot.runtimeProfileRef,
    connectorPlanSnapshot,
    connectorPlanDigest: digest(connectorPlanSnapshot),
    deploymentSecretRefs: { vaultAccess: `vault://integration/${tenantId}/edc` },
  };
}

function configuration(apiServer, tokenFile, caFile, images) {
  return {
    type: "kubernetes-edc",
    apiServer,
    authentication: { type: "service-account", tokenFile, caFile },
    controlNamespace: "molit-caas-system",
    admissionPolicyName: "molit-caas-fencing",
    namespacePrefix: "molit-edc-",
    instanceId: "caas-integration",
    routing: { mode: "internal-test" },
    images,
    replicas: { controlPlane: 1, dataPlane: 1 },
    ports: { default: 8080, management: 8081, protocol: 8082, control: 8083, dataPlaneDefault: 8080, dataPlaneControl: 8083 },
    resources: {
      "control-plane": { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "256Mi" } },
      "data-plane": { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "256Mi" } },
    },
    quota: { "requests.cpu": "2", "requests.memory": "2Gi", pods: "10" },
    limitRange: { default: { cpu: "250m", memory: "256Mi" }, defaultRequest: { cpu: "25m", memory: "64Mi" } },
    networkPolicy: { allowedIngressCidrs: [], allowedEgressCidrs: [] },
    secretBindings: {
      vaultAccess: { secretNameTemplate: "edc-{tenantId}-runtime", keys: [{ key: "management-api-key", environmentVariable: "WEB_HTTP_MANAGEMENT_AUTH_KEY", components: ["control-plane"] }] },
    },
    deprovisionPolicy: "delete",
    revisionHistoryLimit: 2,
    terminationGracePeriodSeconds: 5,
    requestTimeoutMs: 15_000,
  };
}

async function waitForConvergence(provisioner, tenant, operationKey, fencingToken, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await provisioner.observe(tenant, operationKey, { expectedLastAppliedFencingToken: fencingToken });
    if (last.converged) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail(`Kubernetes operation did not converge: ${JSON.stringify(last)}`);
}

async function createRuntimeSecret(api, tenantId) {
  return api.create(`/api/v1/namespaces/molit-edc-${tenantId}/secrets`, {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: `edc-${tenantId}-runtime`, namespace: `molit-edc-${tenantId}` },
    type: "Opaque",
    immutable: true,
    data: { "management-api-key": Buffer.from("kind-only-secret").toString("base64") },
  });
}

test("kind enforces tenant lifecycle, isolation, image rollback, and stale DELETE fencing", { skip: !enabled, timeout: 180_000 }, async (t) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const tenantId = `it-${suffix}`;
  const apiServer = required("MOLIT_KUBERNETES_API_SERVER");
  const tokenFile = required("MOLIT_KUBERNETES_TOKEN_FILE");
  const caFile = required("MOLIT_KUBERNETES_CA_FILE");
  const baselineImages = {
    controlPlane: required("MOLIT_EDC_CONTROL_PLANE_IMAGE"),
    dataPlane: required("MOLIT_EDC_DATA_PLANE_IMAGE"),
  };
  const upgradeImages = {
    controlPlane: required("MOLIT_EDC_UPGRADE_CONTROL_PLANE_IMAGE"),
    dataPlane: required("MOLIT_EDC_UPGRADE_DATA_PLANE_IMAGE"),
  };
  assert.notEqual(baselineImages.controlPlane, upgradeImages.controlPlane);
  const api = new KubernetesApiClient({ apiServer, tokenFile, caFile, requestTimeoutMs: 15_000 });
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: configuration(apiServer, tokenFile, caFile, baselineImages), api });
  t.after(async () => {
    await provisioner.delete(fixture(tenantId, 99, "DELETED", baselineImages), "f".repeat(64), { fencingToken: "99", holderId: "integration-cleanup" }).catch(() => {});
    const fencePath = `/api/v1/namespaces/molit-caas-system/configmaps/tenant-fence-${tenantId}`;
    const fence = await api.get(fencePath).catch(() => null);
    if (fence) await api.delete(fencePath, { apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid: fence.metadata.uid, resourceVersion: fence.metadata.resourceVersion } }).catch(() => {});
  });

  await provisioner.readiness();
  const provisioned = fixture(tenantId, 1, "PROVISIONED", baselineImages);
  await provisioner.provision(provisioned, "a".repeat(64), { fencingToken: "1", holderId: "integration-a" });
  await createRuntimeSecret(api, tenantId);
  await waitForConvergence(provisioner, provisioned, "a".repeat(64), "1");

  const namespacePath = `/api/v1/namespaces/molit-edc-${tenantId}`;
  const namespace = await api.get(namespacePath);
  assert.equal(namespace.metadata.labels[`${group}/tenant-id`], tenantId);
  const secretReference = await api.get(`/api/v1/namespaces/molit-edc-${tenantId}/secrets/edc-secret-references`);
  assert.equal(Buffer.from(secretReference.data.vaultAccess, "base64").toString(), `vault://integration/${tenantId}/edc`);
  const denyPolicy = await api.get(`/apis/networking.k8s.io/v1/namespaces/molit-edc-${tenantId}/networkpolicies/default-deny`);
  assert.deepEqual(denyPolicy.spec, { podSelector: {}, policyTypes: ["Ingress", "Egress"] });

  const suspended = fixture(tenantId, 2, "SUSPENDED", baselineImages);
  await provisioner.suspend(suspended, "b".repeat(64), { fencingToken: "2", holderId: "integration-b" });
  await waitForConvergence(provisioner, suspended, "b".repeat(64), "2");

  const upgraded = fixture(tenantId, 3, "PROVISIONED", upgradeImages);
  await provisioner.provision(upgraded, "c".repeat(64), { fencingToken: "3", holderId: "integration-c" });
  await waitForConvergence(provisioner, upgraded, "c".repeat(64), "3");
  let deployment = await api.get(`/apis/apps/v1/namespaces/molit-edc-${tenantId}/deployments/edc-control-plane`);
  assert.equal(deployment.spec.template.spec.containers[0].image, upgradeImages.controlPlane);

  const rolledBack = fixture(tenantId, 4, "PROVISIONED", baselineImages);
  await provisioner.provision(rolledBack, "d".repeat(64), { fencingToken: "4", holderId: "integration-d" });
  await waitForConvergence(provisioner, rolledBack, "d".repeat(64), "4");
  deployment = await api.get(`/apis/apps/v1/namespaces/molit-edc-${tenantId}/deployments/edc-control-plane`);
  assert.equal(deployment.spec.template.spec.containers[0].image, baselineImages.controlPlane);

  const staleNamespace = await api.get(namespacePath);
  const fencePath = `/api/v1/namespaces/molit-caas-system/configmaps/tenant-fence-${tenantId}`;
  const advancedFence = await api.get(fencePath);
  advancedFence.metadata.annotations = {
    ...advancedFence.metadata.annotations,
    [`${group}/fencing-token`]: "5",
    [`${group}/operation-key`]: "e".repeat(64),
    [`${group}/generation`]: "5",
    [`${group}/intent-digest`]: "5".repeat(64),
    [`${group}/desired-state`]: "DELETED",
  };
  advancedFence.data = {
    ...advancedFence.data,
    fencingToken: "5",
    holderId: "new-controller",
    operationKey: "e".repeat(64),
    generation: "5",
    desiredState: "DELETED",
    intentDigest: "5".repeat(64),
    phase: "CLAIMED",
  };
  await api.replace(fencePath, advancedFence);
  await assert.rejects(
    api.delete(namespacePath, { apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid: staleNamespace.metadata.uid, resourceVersion: staleNamespace.metadata.resourceVersion } }),
    (error) => error instanceof KubernetesApiError && error.status === 403 && /central fencing record/u.test(error.message),
  );
  assert.ok(await api.get(namespacePath));

  const deleted = fixture(tenantId, 6, "DELETED", baselineImages);
  await provisioner.delete(deleted, "6".repeat(64), { fencingToken: "6", holderId: "integration-delete" });
  await waitForConvergence(provisioner, deleted, "6".repeat(64), "6");
  await assert.rejects(api.get(namespacePath), { status: 404 });
  assert.deepEqual(await provisioner.listOrphans([]), []);
});
