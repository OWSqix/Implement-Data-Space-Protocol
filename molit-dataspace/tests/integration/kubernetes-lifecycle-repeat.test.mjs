import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { digest } from "../../src/discovery/stable-json.mjs";
import { KubernetesApiClient, KubernetesEdcProvisioner } from "../../src/caas/kubernetes-provisioner.mjs";

const enabled = process.env.MOLIT_KUBERNETES_REPEAT === "1";
const group = "caas.data.molit.go.kr";

function required(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is required for Kubernetes repeat integration`);
  return value;
}

function operationKey(tenantId, sequence, state) {
  return createHash("sha256").update(`${tenantId}\0${sequence}\0${state}`).digest("hex");
}

function fixture(tenantId, generation, desiredState, images) {
  const connectorPlanSnapshot = {
    adapterId: "kube-edc",
    runtimeProfileRef: "urn:molit:test:edc-runtime",
    deploymentMode: "isolated",
    metadataProfile: { iri: "https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1", version: "1.0.0-rc.1", sha256: "a".repeat(64) },
    protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" },
    requiredDeploymentSecretNames: ["vaultAccess"],
    images,
  };
  return {
    tenantId,
    generation,
    desiredState,
    participantId: `did:web:repeat.invalid:${tenantId}`,
    namespace: `https://repeat.invalid/${tenantId}/`,
    endpoint: `https://connector.repeat.invalid/${tenantId}/`,
    runtimeProfileRef: connectorPlanSnapshot.runtimeProfileRef,
    connectorPlanSnapshot,
    connectorPlanDigest: digest(connectorPlanSnapshot),
    deploymentSecretRefs: { vaultAccess: `vault://repeat/${tenantId}/edc` },
  };
}

function configuration(apiServer, tokenFile, caFile, images, instanceId) {
  return {
    type: "kubernetes-edc",
    apiServer,
    authentication: { type: "service-account", tokenFile, caFile },
    controlNamespace: "molit-caas-system",
    admissionPolicyName: "molit-caas-fencing",
    namespacePrefix: "molit-edc-",
    instanceId,
    routing: { mode: "internal-test" },
    images,
    replicas: { controlPlane: 1, dataPlane: 1 },
    ports: { default: 8080, management: 8081, protocol: 8082, control: 8083, dataPlaneDefault: 8080, dataPlaneControl: 8083 },
    resources: {
      "control-plane": { requests: { cpu: "20m", memory: "48Mi" }, limits: { cpu: "200m", memory: "192Mi" } },
      "data-plane": { requests: { cpu: "20m", memory: "48Mi" }, limits: { cpu: "200m", memory: "192Mi" } },
    },
    quota: { "requests.cpu": "1", "requests.memory": "1Gi", pods: "10" },
    limitRange: { default: { cpu: "200m", memory: "192Mi" }, defaultRequest: { cpu: "20m", memory: "48Mi" } },
    networkPolicy: { allowedIngressCidrs: [], allowedEgressCidrs: [] },
    secretBindings: {
      vaultAccess: { secretNameTemplate: "edc-{tenantId}-runtime", keys: [{ key: "management-api-key", environmentVariable: "WEB_HTTP_MANAGEMENT_AUTH_KEY", components: ["control-plane"] }] },
    },
    deprovisionPolicy: "delete",
    revisionHistoryLimit: 2,
    terminationGracePeriodSeconds: 3,
    requestTimeoutMs: 15_000,
  };
}

async function waitForConvergence(provisioner, tenant, key, token, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let observation;
  while (Date.now() < deadline) {
    observation = await provisioner.observe(tenant, key, { expectedLastAppliedFencingToken: token });
    if (observation.converged) return observation;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  assert.fail(`repeat lifecycle did not converge: ${JSON.stringify(observation)}`);
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

test("kind completes repeated isolated tenant lifecycle cycles", { skip: !enabled, timeout: 1_200_000 }, async (t) => {
  const cycles = Number(required("MOLIT_KUBERNETES_REPEAT_CYCLES"));
  assert.ok(Number.isSafeInteger(cycles) && cycles >= 1 && cycles <= 100);
  const apiServer = required("MOLIT_KUBERNETES_API_SERVER");
  const tokenFile = required("MOLIT_KUBERNETES_TOKEN_FILE");
  const caFile = required("MOLIT_KUBERNETES_CA_FILE");
  const evidencePath = required("MOLIT_KUBERNETES_EVIDENCE_PATH");
  const baselineImages = { controlPlane: required("MOLIT_EDC_CONTROL_PLANE_IMAGE"), dataPlane: required("MOLIT_EDC_DATA_PLANE_IMAGE") };
  const upgradeImages = { controlPlane: required("MOLIT_EDC_UPGRADE_CONTROL_PLANE_IMAGE"), dataPlane: required("MOLIT_EDC_UPGRADE_DATA_PLANE_IMAGE") };
  assert.notEqual(baselineImages.controlPlane, upgradeImages.controlPlane);
  const runId = randomUUID().replaceAll("-", "").slice(0, 8);
  const instanceId = `caas-repeat-${runId}`;
  const api = new KubernetesApiClient({ apiServer, tokenFile, caFile, requestTimeoutMs: 15_000 });
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: configuration(apiServer, tokenFile, caFile, baselineImages, instanceId), api });
  const tenantIds = [];
  const events = [];

  t.after(async () => {
    for (const tenantId of tenantIds) {
      await provisioner.delete(fixture(tenantId, 99, "DELETED", baselineImages), operationKey(tenantId, 99, "DELETED"), { fencingToken: "99", holderId: "repeat-cleanup" }).catch(() => {});
      const fencePath = `/api/v1/namespaces/molit-caas-system/configmaps/tenant-fence-${tenantId}`;
      const fence = await api.get(fencePath).catch(() => null);
      if (fence) await api.delete(fencePath, { apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid: fence.metadata.uid, resourceVersion: fence.metadata.resourceVersion } }).catch(() => {});
    }
  });

  await provisioner.readiness();
  const startedAt = new Date().toISOString();
  const runCycle = async (cycle) => {
    const tenantId = `rp-${runId}-${String(cycle).padStart(3, "0")}`;
    tenantIds.push(tenantId);
    const steps = [
      { state: "PROVISIONED", images: baselineImages, method: "provision", token: "1" },
      { state: "SUSPENDED", images: baselineImages, method: "suspend", token: "2" },
      { state: "PROVISIONED", images: upgradeImages, method: "provision", token: "3", transition: "UPGRADE" },
      { state: "PROVISIONED", images: baselineImages, method: "provision", token: "4", transition: "ROLLBACK" },
      { state: "DELETED", images: baselineImages, method: "delete", token: "5" },
    ];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const generation = index + 1;
      const tenant = fixture(tenantId, generation, step.state, step.images);
      const key = operationKey(tenantId, generation, step.state + (step.transition ?? ""));
      const began = performance.now();
      await provisioner[step.method](tenant, key, { fencingToken: step.token, holderId: `repeat-${runId}` });
      if (index === 0) {
        await api.create(`/api/v1/namespaces/molit-edc-${tenantId}/secrets`, {
          apiVersion: "v1",
          kind: "Secret",
          metadata: { name: `edc-${tenantId}-runtime`, namespace: `molit-edc-${tenantId}` },
          type: "Opaque",
          immutable: true,
          data: { "management-api-key": Buffer.from("kind-repeat-secret").toString("base64") },
        });
      }
      const observation = await waitForConvergence(provisioner, tenant, key, step.token);
      const durationMs = Number((performance.now() - began).toFixed(3));
      events.push({ cycle, sequence: generation, tenantId, state: step.state, transition: step.transition ?? null, fencingToken: step.token, durationMs, exists: observation.exists, planDigest: tenant.connectorPlanDigest, controlPlaneImage: step.images.controlPlane });
    }
  };
  let nextCycle = 1;
  const worker = async () => {
    while (nextCycle <= cycles) {
      const cycle = nextCycle;
      nextCycle += 1;
      await runCycle(cycle);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, cycles) }, () => worker()));
  events.sort((left, right) => left.cycle - right.cycle || left.sequence - right.sequence);

  const namespaces = await api.get("/api/v1/namespaces", { query: { labelSelector: `app.kubernetes.io/managed-by=molit-caas,${group}/instance-id=${instanceId}` } });
  const fences = await api.get("/api/v1/namespaces/molit-caas-system/configmaps", { query: { labelSelector: `app.kubernetes.io/managed-by=molit-caas,${group}/instance-id=${instanceId}` } });
  const orphans = await provisioner.listOrphans([]);
  assert.equal(namespaces.items.length, 0);
  assert.equal(fences.items.length, cycles);
  assert.deepEqual(orphans, []);
  const durations = events.map((event) => event.durationMs);
  const kubernetesVersion = await api.get("/version");
  const report = {
    schemaVersion: "molit.kubernetes-lifecycle-evidence/1",
    startedAt,
    completedAt: new Date().toISOString(),
    cyclesRequested: cycles,
    cyclesCompleted: events.filter((event) => event.state === "DELETED").length,
    operationsCompleted: events.length,
    cluster: { gitVersion: kubernetesVersion.gitVersion, platform: kubernetesVersion.platform },
    images: { baseline: baselineImages, upgrade: upgradeImages },
    latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: Math.max(...durations) },
    inventory: { managedNamespaces: namespaces.items.length, retainedFenceRecords: fences.items.length, orphanNamespaces: orphans.length },
    eventJournal: events,
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  assert.equal(report.cyclesCompleted, cycles);
  process.stdout.write(`${JSON.stringify({ cyclesCompleted: report.cyclesCompleted, p95Ms: report.latencyMs.p95, inventory: report.inventory })}\n`);
});
