import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { digest } from "../../src/discovery/stable-json.mjs";
import {
  KubernetesApiError,
  KubernetesEdcProvisioner,
  kubernetesProvisionerContract,
} from "../../src/caas/kubernetes-provisioner.mjs";

class FakeKubernetesApi {
  constructor() {
    this.resources = new Map();
    this.revision = 0;
    this.failure = null;
    this.jobFailure = false;
    this.mutations = [];
    this.conflicts = new Map();
    this.seed({ apiVersion: "v1", kind: "Namespace", metadata: { name: "molit-caas-system", labels: {} } });
    this.resources.set("/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicies/molit-caas-fencing", { apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingAdmissionPolicy", metadata: { name: "molit-caas-fencing", resourceVersion: String(++this.revision), uid: `uid-${this.revision}`, annotations: { "caas.data.molit.go.kr/fencing-policy-version": "2" } }, spec: { failurePolicy: "Fail" } });
    this.resources.set("/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicybindings/molit-caas-fencing", { apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingAdmissionPolicyBinding", metadata: { name: "molit-caas-fencing", resourceVersion: String(++this.revision), uid: `uid-${this.revision}`, annotations: { "caas.data.molit.go.kr/fencing-policy-version": "2" } }, spec: { policyName: "molit-caas-fencing", validationActions: ["Deny", "Audit"] } });
    this.resources.set("/apis/admissionregistration.k8s.io/v1/validatingwebhookconfigurations/molit-caas-fencing", { apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingWebhookConfiguration", metadata: { name: "molit-caas-fencing", resourceVersion: String(++this.revision), uid: `uid-${this.revision}`, annotations: { "caas.data.molit.go.kr/fencing-policy-version": "3" } }, webhooks: [{ name: "fencing.caas.data.molit.go.kr", failurePolicy: "Fail", sideEffects: "None", clientConfig: { service: { namespace: "molit-caas-system" } }, rules: [{ apiGroups: [""], operations: ["CREATE", "UPDATE", "DELETE"], resources: ["namespaces"] }, { apiGroups: ["batch"], operations: ["CREATE", "UPDATE", "DELETE"], resources: ["jobs"] }] }] });
    this.resources.set("/apis/apps/v1/namespaces/molit-caas-system/deployments/molit-caas-fencing-webhook", { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "molit-caas-fencing-webhook", namespace: "molit-caas-system", resourceVersion: String(++this.revision), uid: `uid-${this.revision}` }, status: { availableReplicas: 2 } });
  }

  itemPath(collection, name) { return `${collection}/${encodeURIComponent(name)}`; }

  seed(body) {
    const collection = this.collectionFor(body);
    const path = this.itemPath(collection, body.metadata.name);
    const value = structuredClone(body);
    value.metadata.resourceVersion = String(++this.revision);
    value.metadata.uid ??= `uid-${this.revision}`;
    value.metadata.generation ??= 1;
    this.readyDeployment(value);
    this.readyRoute(value);
    this.readyJob(value);
    this.resources.set(path, value);
    return structuredClone(value);
  }

  collectionFor(body) {
    if (body.kind === "Namespace") return "/api/v1/namespaces";
    const namespace = encodeURIComponent(body.metadata.namespace);
    if (body.kind === "Deployment") return `/apis/apps/v1/namespaces/${namespace}/deployments`;
    if (body.kind === "Job") return `/apis/batch/v1/namespaces/${namespace}/jobs`;
    if (body.kind === "NetworkPolicy") return `/apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies`;
    if (body.kind === "PodDisruptionBudget") return `/apis/policy/v1/namespaces/${namespace}/poddisruptionbudgets`;
    if (body.kind === "HTTPRoute") return `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes`;
    const plural = { ConfigMap: "configmaps", LimitRange: "limitranges", ResourceQuota: "resourcequotas", Secret: "secrets", Service: "services", ServiceAccount: "serviceaccounts" }[body.kind];
    return `/api/v1/namespaces/${namespace}/${plural}`;
  }

  readyDeployment(value) {
    if (value.kind !== "Deployment") return;
    value.status = {
      observedGeneration: value.metadata.generation,
      replicas: value.spec.replicas,
      availableReplicas: value.spec.replicas,
    };
  }

  readyRoute(value) {
    if (value.kind !== "HTTPRoute") return;
    value.status = { parents: value.spec.parentRefs.map((parentRef) => ({ parentRef, conditions: [
      { type: "Accepted", status: "True", observedGeneration: value.metadata.generation },
      { type: "ResolvedRefs", status: "True", observedGeneration: value.metadata.generation },
    ] })) };
  }

  readyJob(value) {
    if (value.kind !== "Job") return;
    value.status = this.jobFailure
      ? { failed: 1, conditions: [{ type: "Failed", status: "True" }] }
      : { succeeded: 1, conditions: [{ type: "Complete", status: "True" }] };
  }

  conflictOnce(path) { this.conflicts.set(path, 1); }
  failOnce(kind, name) { this.failure = { kind, name }; }

  maybeConflict(path) {
    const count = this.conflicts.get(path) ?? 0;
    if (count === 0) return;
    this.conflicts.set(path, count - 1);
    throw new KubernetesApiError(409, "Conflict", "injected CAS conflict");
  }

  get(path, { query } = {}) {
    if (path === "/api/v1/namespaces") {
      let items = [...this.resources.entries()].filter(([key]) => /^\/api\/v1\/namespaces\/[^/]+$/u.test(key)).map(([, value]) => value);
      if (query?.labelSelector) {
        const selectors = query.labelSelector.split(",").map((value) => value.split("="));
        items = items.filter((item) => selectors.every(([key, value]) => item.metadata.labels?.[key] === value));
      }
      return Promise.resolve({ apiVersion: "v1", kind: "NamespaceList", items: structuredClone(items) });
    }
    const value = this.resources.get(path);
    if (!value) return Promise.reject(new KubernetesApiError(404, "NotFound"));
    return Promise.resolve(structuredClone(value));
  }

  create(collection, body) {
    const path = this.itemPath(collection, body.metadata.name);
    this.maybeConflict(path);
    if (this.resources.has(path)) return Promise.reject(new KubernetesApiError(409, "AlreadyExists"));
    if (this.failure?.kind === body.kind && this.failure?.name === body.metadata.name) {
      this.failure = null;
      return Promise.reject(new KubernetesApiError(500, "InjectedFailure"));
    }
    this.mutations.push(`create:${body.kind}:${body.metadata.name}`);
    return Promise.resolve(this.seed(body));
  }

  replace(path, body) {
    this.maybeConflict(path);
    const current = this.resources.get(path);
    if (!current) return Promise.reject(new KubernetesApiError(404, "NotFound"));
    if (body.metadata.resourceVersion !== current.metadata.resourceVersion) return Promise.reject(new KubernetesApiError(409, "Conflict"));
    if (this.failure?.kind === body.kind && this.failure?.name === body.metadata.name) {
      this.failure = null;
      return Promise.reject(new KubernetesApiError(500, "InjectedFailure"));
    }
    const value = structuredClone(body);
    value.metadata.resourceVersion = String(++this.revision);
    value.metadata.uid = current.metadata.uid;
    value.metadata.generation = ["Deployment", "HTTPRoute"].includes(body.kind) ? (current.metadata.generation ?? 1) + 1 : current.metadata.generation;
    this.readyDeployment(value);
    this.readyRoute(value);
    this.readyJob(value);
    this.resources.set(path, value);
    this.mutations.push(`replace:${body.kind}:${body.metadata.name}`);
    return Promise.resolve(structuredClone(value));
  }

  delete(path, body) {
    const current = this.resources.get(path);
    if (!current) return Promise.reject(new KubernetesApiError(404, "NotFound"));
    const preconditions = body?.preconditions;
    if (preconditions && (preconditions.uid !== current.metadata.uid || preconditions.resourceVersion !== current.metadata.resourceVersion)) {
      return Promise.reject(new KubernetesApiError(409, "Conflict"));
    }
    this.resources.delete(path);
    const namespaceMatch = path.match(/^\/api\/v1\/namespaces\/([^/]+)$/u);
    if (namespaceMatch) {
      const namespace = namespaceMatch[1];
      for (const key of this.resources.keys()) if (key.includes(`/namespaces/${namespace}/`)) this.resources.delete(key);
    }
    return Promise.resolve({ status: "Success" });
  }
}

const imageA = `registry.example/molit/edc-control@sha256:${"a".repeat(64)}`;
const imageB = `registry.example/molit/edc-control@sha256:${"b".repeat(64)}`;
const trustedReleaseKey = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEADm20dUMRwgH80zPpgXC7pNMl3oXv1/spc0/ZUUu972U=\n-----END PUBLIC KEY-----\n";
const trustedReleaseKeySha256 = createHash("sha256").update(trustedReleaseKey).digest("hex");
const runtimeIdentities = [
  ["caas", "caas-control-plane"], ["dsaas", "dsaas-control-plane"], ["fencing-webhook", "fencing-webhook"],
  ["edc-control-plane", "edc-control-plane"], ["edc-data-plane", "edc-data-plane"],
  ["edc-schema-migration", "schema-migration"], ["postgres-operand", "postgres-operand"], ["otel-collector", "otel-collector"],
];

function config(overrides = {}) {
  return {
    id: "kube-edc",
    type: "kubernetes-edc",
    apiServer: "https://kubernetes.default.svc/",
    authentication: { type: "service-account", tokenFile: "/token", caFile: "/ca" },
    controlNamespace: "molit-caas-system",
    admissionPolicyName: "molit-caas-fencing",
    namespacePrefix: "molit-edc-",
    instanceId: "caas-a",
    routing: { mode: "internal-test" },
    images: { controlPlane: imageA, dataPlane: `registry.example/molit/edc-data@sha256:${"c".repeat(64)}` },
    replicas: { controlPlane: 2, dataPlane: 2 },
    ports: { default: 8080, management: 8081, protocol: 8082, control: 8083, dataPlaneDefault: 8080, dataPlaneControl: 8083 },
    resources: {
      "control-plane": { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "2Gi" } },
      "data-plane": { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "2Gi" } },
    },
    quota: { "requests.cpu": "4", "requests.memory": "8Gi", "limits.cpu": "8", "limits.memory": "16Gi", pods: "20" },
    limitRange: { default: { cpu: "1", memory: "1Gi" }, defaultRequest: { cpu: "250m", memory: "512Mi" } },
    networkPolicy: { allowedIngressCidrs: ["10.10.0.0/16"], allowedEgressCidrs: ["10.20.0.0/16"] },
    secretBindings: {
      vaultAccess: { secretNameTemplate: "edc-{tenantId}-runtime", keys: [{ key: "management-api-key", environmentVariable: "WEB_HTTP_MANAGEMENT_AUTH_KEY", components: ["control-plane"] }] },
      databaseAccess: { secretNameTemplate: "edc-{tenantId}-database", keys: [
        { key: "control-url", environmentVariable: "EDC_DATASOURCE_DEFAULT_URL", components: ["control-plane"] },
        { key: "data-url", environmentVariable: "EDC_DATASOURCE_DEFAULT_URL", components: ["data-plane"] },
        { key: "username", environmentVariable: "EDC_DATASOURCE_DEFAULT_USER", components: ["control-plane", "data-plane"] },
        { key: "password", environmentVariable: "EDC_DATASOURCE_DEFAULT_PASSWORD", components: ["control-plane", "data-plane"] },
      ] },
    },
    deprovisionPolicy: "delete",
    revisionHistoryLimit: 5,
    terminationGracePeriodSeconds: 30,
    requestTimeoutMs: 5000,
    ...overrides,
  };
}

function tenant(tenantId = "road-provider", generation = 1) {
  const connectorPlanSnapshot = {
    adapterId: "kube-edc",
    runtimeProfileRef: "urn:molit:edc:runtime:v1",
    deploymentMode: "isolated",
    metadataProfile: { iri: "https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0", version: "1.0.0", sha256: "d".repeat(64) },
    protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" },
    requiredDeploymentSecretNames: ["vaultAccess"],
  };
  return {
    tenantId,
    generation,
    desiredState: "PROVISIONED",
    participantId: `did:web:connectors.example:${tenantId}`,
    namespace: `https://data.example/${tenantId}/`,
    endpoint: `https://connectors.example/${tenantId}/`,
    runtimeProfileRef: connectorPlanSnapshot.runtimeProfileRef,
    connectorPlanSnapshot,
    connectorPlanDigest: digest(connectorPlanSnapshot),
    deploymentSecretRefs: { vaultAccess: `vault://tenant/${tenantId}/edc` },
  };
}

function databaseSchemaContract() {
  return {
    requiredVersion: "edc-0.18.0-sql-v1",
    migrationArtifact: { iri: "https://data.molit.go.kr/artifacts/edc/database-schema/edc-0.18.0-sql-v1", version: "edc-0.18.0-sql-v1", sha256: "e".repeat(64) },
    migrationImage: `registry.example/molit/edc-schema@sha256:${"f".repeat(64)}`,
    migrationTimeoutMs: 10_000,
    pollIntervalMs: 100,
    connection: {
      secretBindingName: "databaseAccess",
      controlUrlKey: "control-url",
      dataUrlKey: "data-url",
      usernameKey: "username",
      passwordKey: "password",
      sslMode: "verify-full",
      caKey: "ca.crt",
      clientCertificateKey: "tls.crt",
      clientPrivateKeyKey: "tls.key",
      mountPath: "/var/run/secrets/edc-database",
    },
  };
}

function databaseTenant(tenantId = "road-provider", generation = 1) {
  const value = tenant(tenantId, generation);
  value.connectorPlanSnapshot.databaseSchema = databaseSchemaContract();
  value.connectorPlanSnapshot.requiredDeploymentSecretNames.push("databaseAccess");
  value.connectorPlanDigest = digest(value.connectorPlanSnapshot);
  value.deploymentSecretRefs.databaseAccess = `vault://tenant/${tenantId}/database`;
  return value;
}

function seedDatabaseSecret(api, tenantId, overrides = {}) {
  const mount = "/var/run/secrets/edc-database";
  const databasePrefix = tenantId.replaceAll("-", "_");
  const encode = (value) => Buffer.from(value).toString("base64");
  return api.seed({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: `edc-${tenantId}-database`, namespace: `molit-edc-${tenantId}` },
    immutable: true,
    type: "Opaque",
    data: {
      "control-url": encode(`jdbc:postgresql://postgres.example:5432/${databasePrefix}_cp?sslmode=verify-full&sslrootcert=${mount}/ca.crt&sslcert=${mount}/tls.crt&sslkey=${mount}/tls.key`),
      "data-url": encode(`jdbc:postgresql://postgres.example:5432/${databasePrefix}_dp?sslmode=verify-full&sslrootcert=${mount}/ca.crt&sslcert=${mount}/tls.crt&sslkey=${mount}/tls.key`),
      username: encode("edc_runtime"),
      password: encode("correct-horse-battery-staple"),
      "ca.crt": encode("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"),
      "tls.crt": encode("-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----\n"),
      "tls.key": encode("-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n"),
      ...overrides,
    },
  });
}

function key(value) { return value.padEnd(64, "0"); }

function gatewayRouting() {
  return {
    mode: "gateway-api",
    parentRef: { name: "molit-connectors", namespace: "molit-gateway-system" },
    protocolSectionName: "dsp-https",
    dataPlaneSectionName: "data-https",
    gatewayAccessLabelValue: "molit-connectors",
    protocolHostnameTemplate: "{tenantId}.connectors.example",
    dataPlaneHostnameTemplate: "{tenantId}.transfer.example",
  };
}

function seedReadyGateway(api, routing = gatewayRouting()) {
  api.resources.set(`/apis/gateway.networking.k8s.io/v1/namespaces/${routing.parentRef.namespace}/gateways/${routing.parentRef.name}`, {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "Gateway",
    metadata: { name: routing.parentRef.name, namespace: routing.parentRef.namespace, generation: 3 },
    spec: { listeners: [routing.protocolSectionName, routing.dataPlaneSectionName].map((name) => ({
      name,
      protocol: "HTTPS",
      allowedRoutes: { namespaces: { from: "Selector", selector: { matchLabels: { "caas.data.molit.go.kr/gateway-access": routing.gatewayAccessLabelValue } } } },
    })) },
    status: {
      conditions: [{ type: "Accepted", status: "True", observedGeneration: 3 }, { type: "Programmed", status: "True", observedGeneration: 3 }],
      listeners: [routing.protocolSectionName, routing.dataPlaneSectionName].map((name) => ({ name, conditions: [{ type: "Accepted", status: "True", observedGeneration: 3 }, { type: "Programmed", status: "True", observedGeneration: 3 }] })),
    },
  });
}

function imagePolicy(name, {
  key = trustedReleaseKey,
  required = true,
  omitIdentity,
  runtimeClassOverride,
  insecureIgnoreTlog = true,
  ctlogUrl = "https://rekor.invalid",
  duplicateCrypto = false,
} = {}) {
  const identityValidations = runtimeIdentities
    .filter(([service]) => service !== omitIdentity)
    .map(([service, runtimeClass]) => ({
      expression: `registry.example/molit/${service}@sha256:
payload.artifact.service == '${service}'
payload.artifact.runtimeClass == '${service === runtimeClassOverride?.service ? runtimeClassOverride.runtimeClass : runtimeClass}'`,
    }));
  const ctlog = { url: ctlogUrl, insecureIgnoreTlog };
  return {
    apiVersion: "policies.kyverno.io/v1",
    kind: "ImageValidatingPolicy",
    metadata: { name, generation: 1, annotations: { "supply-chain.data.molit.go.kr/trust-anchor-sha256": trustedReleaseKeySha256 } },
    spec: {
      failurePolicy: "Fail",
      validationActions: ["Deny"],
      matchConstraints: { resourceRules: [{ apiGroups: [""], apiVersions: ["v1"], operations: ["CREATE", "UPDATE"], resources: ["pods", "pods/ephemeralcontainers"] }] },
      matchConditions: [{ name: "managed-namespace", expression: "molit-caas-system observability supply-chain.data.molit.go.kr/enforcement required" }],
      validationConfigurations: { required, verifyDigest: true, mutateDigest: false },
      matchImageReferences: [{ glob: "registry.example/molit/*@sha256:*" }],
      attestors: [{ name: "releaseKey", cosign: { key: { data: key }, ctlog } }],
      attestations: [{ name: "releaseBundle", intoto: { type: "https://data.molit.go.kr/attestations/release-bundle/v1" } }],
      validations: [
        { expression: `verifyImageSignatures verifyAttestationSignatures${duplicateCrypto ? " verifyImageSignatures" : ""}` },
        { expression: "extractPayload images.initContainers images.ephemeralContainers payload.image.name payload.image.digest" },
        { expression: "artifact.productionEligible vulnerabilityGate.decision findingCount time.now() https://slsa.dev/provenance/v1" },
        ...identityValidations,
      ],
    },
    status: { conditions: [{ type: "Ready", status: "True", observedGeneration: 1 }] },
  };
}

function seedSupplyChainPolicy(api, options = {}) {
  api.resources.set("/apis/policies.kyverno.io/v1/validatingpolicies/molit-restrict-release-images", {
    apiVersion: "policies.kyverno.io/v1",
    kind: "ValidatingPolicy",
    metadata: { name: "molit-restrict-release-images", generation: 1 },
    spec: {
      failurePolicy: "Fail",
      validationActions: ["Deny"],
      variables: [
        { name: "enforcedNamespace", expression: "molit-caas-system observability supply-chain.data.molit.go.kr/enforcement required" },
        { name: "allContainers", expression: "containers initContainers ephemeralContainers" },
        { name: "allowedRepositories", expression: `[${runtimeIdentities.map(([service]) => `'registry.example/molit/${service}'`).join(", ")}]` },
      ],
      validations: [{ expression: "containsDigest() sha256:[0-9a-f]{64}" }],
      matchConstraints: { resourceRules: [{ apiGroups: [""], apiVersions: ["v1"], operations: ["CREATE", "UPDATE"], resources: ["pods", "pods/ephemeralcontainers"] }] },
    },
    status: { conditions: [{ type: "Ready", status: "True", observedGeneration: 1 }] },
  });
  api.resources.set("/apis/policies.kyverno.io/v1/imagevalidatingpolicies/molit-verify-release-images", imagePolicy("molit-verify-release-images", options));
}

test("Kubernetes provisioner creates an isolated EDC runtime and returns a target receipt", async () => {
  const api = new FakeKubernetesApi();
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  assert.equal(await provisioner.readiness(), true);
  const input = tenant();
  const result = await provisioner.provision(input, key("a"), { fencingToken: "1", holderId: "caas-a" });
  assert.equal(result.fencingAccepted, true);
  assert.equal(result.fencingToken, "1");
  assert.equal(result.converged, true);

  const namespace = await api.get("/api/v1/namespaces/molit-edc-road-provider");
  assert.equal(namespace.metadata.labels[kubernetesProvisionerContract.labels.tenant], "road-provider");
  assert.equal(namespace.metadata.labels["supply-chain.data.molit.go.kr/enforcement"], "required");
  assert.equal(namespace.metadata.annotations[kubernetesProvisionerContract.annotations.fencingToken], "1");
  const serviceAccount = await api.get("/api/v1/namespaces/molit-edc-road-provider/serviceaccounts/edc-runtime");
  assert.equal(serviceAccount.automountServiceAccountToken, false);
  const secret = await api.get("/api/v1/namespaces/molit-edc-road-provider/secrets/edc-secret-references");
  assert.equal(Buffer.from(secret.data.vaultAccess, "base64").toString(), "vault://tenant/road-provider/edc");
  assert.doesNotMatch(JSON.stringify([...api.resources.values()]), /inline-password|Bearer /u);
  assert.ok(await api.get("/api/v1/namespaces/molit-edc-road-provider/resourcequotas/edc-quota"));
  assert.ok(await api.get("/apis/networking.k8s.io/v1/namespaces/molit-edc-road-provider/networkpolicies/default-deny"));
  assert.ok(await api.get("/api/v1/namespaces/molit-edc-road-provider/services/edc-control-plane"));
  const controlPlane = await api.get("/apis/apps/v1/namespaces/molit-edc-road-provider/deployments/edc-control-plane");
  assert.equal(controlPlane.spec.template.spec.containers[0].env.find(({ name }) => name === "EDC_DSP_CALLBACK_ADDRESS").value, "http://edc-control-plane:8082/protocol");
  const budget = await api.get("/apis/policy/v1/namespaces/molit-edc-road-provider/poddisruptionbudgets/edc-control-plane");
  assert.equal(budget.spec.minAvailable, 1);

  const observation = await provisioner.observe(input, key("a"), { expectedLastAppliedFencingToken: "1" });
  assert.deepEqual({ exists: observation.exists, converged: observation.converged, generation: observation.generation, fencing: observation.lastAppliedFencingToken }, { exists: true, converged: true, generation: 1, fencing: "1" });
});

test("supply-chain readiness requires digest, signature, and release attestation enforcement", async () => {
  const api = new FakeKubernetesApi();
  const supplyChainAdmission = {
    policyName: "molit-verify-release-images",
    attestationPredicateType: "https://data.molit.go.kr/attestations/release-bundle/v1",
    trustAnchorSha256: trustedReleaseKeySha256,
  };
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config({ supplyChainAdmission }), api });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api);
  assert.equal(await provisioner.readiness(), true);
  seedSupplyChainPolicy(api, { required: false });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api, { key: trustedReleaseKey.replace("972U", "972V") });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api, { omitIdentity: "postgres-operand" });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api, { runtimeClassOverride: { service: "caas", runtimeClass: "dsaas-control-plane" } });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api, { insecureIgnoreTlog: false });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api, { ctlogUrl: "https://rekor.example" });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api, { duplicateCrypto: true });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api);
  delete api.resources.get("/apis/policies.kyverno.io/v1/imagevalidatingpolicies/molit-verify-release-images").status.conditions[0].observedGeneration;
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api);
  api.resources.get("/apis/policies.kyverno.io/v1/imagevalidatingpolicies/molit-verify-release-images").spec.matchConstraints.resourceRules[0].resources = ["services"];
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api);
  api.resources.get("/apis/policies.kyverno.io/v1/imagevalidatingpolicies/molit-verify-release-images").spec.matchConstraints.resourceRules[0].resources = ["pods"];
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
  seedSupplyChainPolicy(api);
  api.resources.get("/apis/policies.kyverno.io/v1/validatingpolicies/molit-restrict-release-images").spec.variables.find(({ name }) => name === "allowedRepositories").expression += ", 'registry.example/molit/caas-debug'";
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING" });
});

test("database schema migration and immutable verify-full evidence gate EDC rollout", async () => {
  const api = new FakeKubernetesApi();
  seedDatabaseSecret(api, "road-provider");
  api.mutations.length = 0;
  const input = databaseTenant();
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  const result = await provisioner.provision(input, key("d"), { fencingToken: "1", holderId: "caas-a" });
  assert.equal(result.converged, true);
  const jobIndex = api.mutations.findIndex((entry) => entry.startsWith("create:Job:edc-schema-"));
  const controlDeploymentIndex = api.mutations.findIndex((entry) => entry === "create:Deployment:edc-control-plane");
  const dataDeploymentIndex = api.mutations.findIndex((entry) => entry === "create:Deployment:edc-data-plane");
  assert.ok(jobIndex >= 0 && controlDeploymentIndex > jobIndex && dataDeploymentIndex > jobIndex);
  const receipt = await api.get("/api/v1/namespaces/molit-edc-road-provider/configmaps/edc-schema-ready");
  assert.equal(receipt.data.requiredVersion, "edc-0.18.0-sql-v1");
  assert.equal(receipt.data.migrationArtifactSha256, "e".repeat(64));
  const control = await api.get("/apis/apps/v1/namespaces/molit-edc-road-provider/deployments/edc-control-plane");
  assert.equal(control.spec.template.spec.volumes.find(({ name }) => name === "database-trust").secret.secretName, "edc-road-provider-database");
  assert.equal(control.spec.template.spec.containers[0].volumeMounts.find(({ name }) => name === "database-trust").readOnly, true);
  assert.equal(control.spec.template.spec.containers[0].env.find(({ name }) => name === "PGSSLROOTCERT").value, "/var/run/secrets/edc-database/ca.crt");
});

test("database migration failure leaves CP and DP absent", async () => {
  const api = new FakeKubernetesApi();
  api.jobFailure = true;
  seedDatabaseSecret(api, "road-provider");
  api.mutations.length = 0;
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  await assert.rejects(
    provisioner.provision(databaseTenant(), key("f"), { fencingToken: "1", holderId: "caas-a" }),
    { code: "CAAS_KUBERNETES_SCHEMA_MIGRATION_FAILED" },
  );
  assert.equal(api.mutations.some((entry) => entry.includes("Deployment:edc-control-plane") || entry.includes("Deployment:edc-data-plane")), false);
});

test("database Secret preflight rejects plaintext, verify-ca, userinfo, query overrides, and absent CA", async (t) => {
  const mount = "/var/run/secrets/edc-database";
  const encode = (value) => Buffer.from(value).toString("base64");
  const invalid = [
    ["plaintext", `jdbc:postgresql://postgres.example:5432/road_cp`],
    ["verify-ca", `jdbc:postgresql://postgres.example:5432/road_cp?sslmode=verify-ca&sslrootcert=${mount}/ca.crt&sslcert=${mount}/tls.crt&sslkey=${mount}/tls.key`],
    ["userinfo", `jdbc:postgresql://user:password@postgres.example:5432/road_cp?sslmode=verify-full&sslrootcert=${mount}/ca.crt&sslcert=${mount}/tls.crt&sslkey=${mount}/tls.key`],
    ["duplicate-query", `jdbc:postgresql://postgres.example:5432/road_cp?sslmode=verify-full&sslmode=disable&sslrootcert=${mount}/ca.crt&sslcert=${mount}/tls.crt&sslkey=${mount}/tls.key`],
  ];
  for (const [name, url] of invalid) await t.test(name, async () => {
    const api = new FakeKubernetesApi();
    seedDatabaseSecret(api, "road-provider", { "control-url": encode(url) });
    const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
    await assert.rejects(
      provisioner.provision(databaseTenant(), digest(name), { fencingToken: "1", holderId: "caas-a" }),
      { code: "CAAS_KUBERNETES_DATABASE_TLS_INVALID" },
    );
    assert.equal(api.mutations.some((entry) => entry.includes("Deployment:edc-")), false);
  });
  await t.test("absent-ca", async () => {
    const api = new FakeKubernetesApi();
    seedDatabaseSecret(api, "road-provider", { "ca.crt": undefined });
    const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
    await assert.rejects(
      provisioner.provision(databaseTenant(), digest("missing-ca"), { fencingToken: "1", holderId: "caas-a" }),
      { code: "CAAS_KUBERNETES_DATABASE_SECRET_INVALID" },
    );
  });
});

test("Gateway API route profile gates external DSP convergence on programmed parent and accepted routes", async () => {
  const api = new FakeKubernetesApi();
  const routing = gatewayRouting();
  seedReadyGateway(api, routing);
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config({ routing }), api });
  assert.equal(await provisioner.readiness(), true);
  const input = tenant("road-provider", 1);
  input.endpoint = "https://road-provider.connectors.example/";
  const result = await provisioner.provision(input, key("e"), { fencingToken: "1", holderId: "gateway-controller" });
  assert.equal(result.converged, true);
  const namespace = await api.get("/api/v1/namespaces/molit-edc-road-provider");
  assert.equal(namespace.metadata.labels["caas.data.molit.go.kr/gateway-access"], "molit-connectors");
  const dspRoute = await api.get("/apis/gateway.networking.k8s.io/v1/namespaces/molit-edc-road-provider/httproutes/edc-dsp");
  assert.deepEqual(dspRoute.spec.hostnames, ["road-provider.connectors.example"]);
  assert.equal(dspRoute.spec.rules[0].backendRefs[0].name, "edc-control-plane");
  assert.equal(dspRoute.spec.rules[0].backendRefs[0].port, 8082);
  const controlPlane = await api.get("/apis/apps/v1/namespaces/molit-edc-road-provider/deployments/edc-control-plane");
  assert.equal(controlPlane.spec.template.spec.containers[0].env.find(({ name }) => name === "EDC_DSP_CALLBACK_ADDRESS").value, "https://road-provider.connectors.example/protocol");
  dspRoute.status.parents[0].conditions.find((condition) => condition.type === "Accepted").status = "False";
  api.resources.set("/apis/gateway.networking.k8s.io/v1/namespaces/molit-edc-road-provider/httproutes/edc-dsp", dspRoute);
  const observation = await provisioner.observe(input, key("e"), { expectedLastAppliedFencingToken: "1" });
  assert.equal(observation.converged, false);
});

test("Gateway API readiness rejects an unprogrammed or broadly attached parent listener", async () => {
  const api = new FakeKubernetesApi();
  const routing = gatewayRouting();
  seedReadyGateway(api, routing);
  const path = "/apis/gateway.networking.k8s.io/v1/namespaces/molit-gateway-system/gateways/molit-connectors";
  api.resources.get(path).spec.listeners[0].allowedRoutes.namespaces.from = "All";
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config({ routing }), api });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_GATEWAY_LISTENER_NOT_READY" });
});

test("Gateway API readiness rejects stale status conditions without an observed generation", async () => {
  const api = new FakeKubernetesApi();
  const routing = gatewayRouting();
  seedReadyGateway(api, routing);
  const path = "/apis/gateway.networking.k8s.io/v1/namespaces/molit-gateway-system/gateways/molit-connectors";
  delete api.resources.get(path).status.conditions[0].observedGeneration;
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config({ routing }), api });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_GATEWAY_NOT_READY" });
});

test("readiness fails closed when the fencing admission binding is not in deny mode", async () => {
  const api = new FakeKubernetesApi();
  const path = "/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicybindings/molit-caas-fencing";
  api.resources.get(path).spec.validationActions = ["Audit"];
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  await assert.rejects(provisioner.readiness(), { code: "CAAS_KUBERNETES_FENCING_POLICY_MISSING" });
});

test("target ConfigMap rejects token N after N+1 and binds equal tokens to one command", async () => {
  const api = new FakeKubernetesApi();
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  await provisioner.provision(tenant("road-provider", 2), key("b"), { fencingToken: "2", holderId: "new-holder" });
  await assert.rejects(
    provisioner.provision(tenant("road-provider", 1), key("a"), { fencingToken: "1", holderId: "stale-holder" }),
    { code: "CAAS_RECONCILE_FENCE_LOST" },
  );
  await assert.rejects(
    provisioner.provision(tenant("road-provider", 3), key("c"), { fencingToken: "2", holderId: "other-holder" }),
    { code: "CAAS_KUBERNETES_FENCE_CONFLICT" },
  );
  const deployment = await api.get("/apis/apps/v1/namespaces/molit-edc-road-provider/deployments/edc-control-plane");
  assert.equal(deployment.metadata.annotations[kubernetesProvisionerContract.annotations.fencingToken], "2");
  assert.equal(deployment.metadata.annotations[kubernetesProvisionerContract.annotations.generation], "2");
});

test("fencing tokens outside the admission CEL integer range are rejected before target mutation", async () => {
  const api = new FakeKubernetesApi();
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  await assert.rejects(
    provisioner.provision(tenant(), key("a"), { fencingToken: "9223372036854775808", holderId: "invalid-holder" }),
    { code: "CAAS_PROVISIONER_FENCING_REQUIRED" },
  );
  await assert.rejects(api.get("/api/v1/namespaces/molit-caas-system/configmaps/tenant-fence-road-provider"), { status: 404 });
});

test("concurrent token claims converge on the larger token without stale resource writes", async () => {
  const api = new FakeKubernetesApi();
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  const [older, newer] = await Promise.allSettled([
    provisioner.provision(tenant("rail-provider", 1), key("a"), { fencingToken: "1", holderId: "older-holder" }),
    provisioner.provision(tenant("rail-provider", 2), key("b"), { fencingToken: "2", holderId: "newer-holder" }),
  ]);
  assert.equal(newer.status, "fulfilled");
  assert.equal(older.status, "rejected");
  assert.equal(older.reason.code, "CAAS_RECONCILE_FENCE_LOST");
  const fence = await api.get("/api/v1/namespaces/molit-caas-system/configmaps/tenant-fence-rail-provider");
  assert.equal(fence.data.fencingToken, "2");
  const deployment = await api.get("/apis/apps/v1/namespaces/molit-edc-rail-provider/deployments/edc-control-plane");
  assert.equal(deployment.metadata.annotations[kubernetesProvisionerContract.annotations.fencingToken], "2");
  assert.equal(deployment.metadata.annotations[kubernetesProvisionerContract.annotations.generation], "2");
});

test("an existing namespace without matching tenant ownership is never adopted", async () => {
  const api = new FakeKubernetesApi();
  api.seed({ apiVersion: "v1", kind: "Namespace", metadata: { name: "molit-edc-road-provider", labels: { "app.kubernetes.io/managed-by": "another-controller" } } });
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  await assert.rejects(
    provisioner.provision(tenant(), key("a"), { fencingToken: "1", holderId: "holder-a" }),
    { code: "CAAS_KUBERNETES_OWNERSHIP_CONFLICT" },
  );
  const namespace = await api.get("/api/v1/namespaces/molit-edc-road-provider");
  assert.equal(namespace.metadata.labels["app.kubernetes.io/managed-by"], "another-controller");
});

test("resourceVersion conflicts are retried without losing monotonic fencing", async () => {
  const api = new FakeKubernetesApi();
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  api.conflictOnce("/api/v1/namespaces/molit-caas-system/configmaps/tenant-fence-road-provider");
  api.conflictOnce("/api/v1/namespaces/molit-edc-road-provider/serviceaccounts/edc-runtime");
  const result = await provisioner.provision(tenant(), key("a"), { fencingToken: "1", holderId: "holder-a" });
  assert.equal(result.fencingAccepted, true);
});

test("failed upgrade restores the previous runtime and leaves an explicit failed receipt", async () => {
  const api = new FakeKubernetesApi();
  const first = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  await first.provision(tenant("road-provider", 1), key("a"), { fencingToken: "1", holderId: "holder-a" });

  const upgraded = new KubernetesEdcProvisioner({
    id: "kube-edc",
    config: config({ images: { ...config().images, controlPlane: imageB } }),
    api,
  });
  api.failOnce("Deployment", "edc-data-plane");
  await assert.rejects(
    upgraded.provision(tenant("road-provider", 2), key("b"), { fencingToken: "2", holderId: "holder-b" }),
    { code: "CAAS_KUBERNETES_API_ERROR" },
  );
  const deployment = await api.get("/apis/apps/v1/namespaces/molit-edc-road-provider/deployments/edc-control-plane");
  assert.equal(deployment.spec.template.spec.containers[0].image, imageA);
  assert.equal(deployment.metadata.annotations[kubernetesProvisionerContract.annotations.fencingToken], "2");
  const fence = await api.get("/api/v1/namespaces/molit-caas-system/configmaps/tenant-fence-road-provider");
  assert.equal(fence.data.fencingToken, "2");
  assert.equal(fence.data.phase, "FAILED");
});

test("connector plan image digests drive upgrade and explicit rollback", async () => {
  const api = new FakeKubernetesApi();
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  const initial = tenant("versioned-provider", 1);
  await provisioner.provision(initial, key("a1"), { fencingToken: "1", holderId: "holder-v1" });
  const upgraded = structuredClone(initial);
  upgraded.generation = 2;
  upgraded.connectorPlanSnapshot.images = {
    controlPlane: imageB,
    dataPlane: `registry.example/molit/edc-data@sha256:${"d".repeat(64)}`,
  };
  upgraded.connectorPlanDigest = digest(upgraded.connectorPlanSnapshot);
  await provisioner.provision(upgraded, key("b2"), { fencingToken: "2", holderId: "holder-v2" });
  let deployment = await api.get("/apis/apps/v1/namespaces/molit-edc-versioned-provider/deployments/edc-control-plane");
  assert.equal(deployment.spec.template.spec.containers[0].image, imageB);
  const rollback = structuredClone(initial);
  rollback.generation = 3;
  await provisioner.provision(rollback, key("c3"), { fencingToken: "3", holderId: "holder-v3" });
  deployment = await api.get("/apis/apps/v1/namespaces/molit-edc-versioned-provider/deployments/edc-control-plane");
  assert.equal(deployment.spec.template.spec.containers[0].image, imageA);
});

test("delete deprovision and orphan recovery retain the central fencing record", async () => {
  const api = new FakeKubernetesApi();
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  const input = tenant();
  await provisioner.provision(input, key("a"), { fencingToken: "1", holderId: "holder-a" });
  input.generation = 2;
  input.desiredState = "DEPROVISIONED";
  const result = await provisioner.deprovision(input, key("b"), { fencingToken: "2", holderId: "holder-b" });
  assert.equal(result.converged, true);
  await assert.rejects(api.get("/api/v1/namespaces/molit-edc-road-provider"), { status: 404 });
  const observation = await provisioner.observe(input, key("b"), { expectedLastAppliedFencingToken: "2" });
  assert.deepEqual({ exists: observation.exists, converged: observation.converged, token: observation.lastAppliedFencingToken }, { exists: false, converged: true, token: "2" });

  api.seed({ apiVersion: "v1", kind: "Namespace", metadata: { name: "molit-edc-orphan-tenant", labels: { "app.kubernetes.io/managed-by": "molit-caas", [kubernetesProvisionerContract.labels.instance]: "caas-a", [kubernetesProvisionerContract.labels.tenant]: "orphan-tenant" }, annotations: { [kubernetesProvisionerContract.annotations.fencingToken]: "4" } } });
  assert.deepEqual(await provisioner.listOrphans(["road-provider"]), ["orphan-tenant"]);
  await provisioner.reclaimOrphan("orphan-tenant", { fencingToken: "5", holderId: "orphan-controller" });
  await assert.rejects(api.get("/api/v1/namespaces/molit-edc-orphan-tenant"), { status: 404 });
  const orphanFence = await api.get("/api/v1/namespaces/molit-caas-system/configmaps/tenant-fence-orphan-tenant");
  assert.equal(orphanFence.data.phase, "APPLIED");
});

test("suspend policy retains isolated resources with both EDC workloads scaled to zero", async () => {
  const api = new FakeKubernetesApi();
  const suspendConfig = config({ deprovisionPolicy: "suspend" });
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: suspendConfig, api });
  const input = tenant("aviation-provider", 1);
  await provisioner.provision(input, key("a"), { fencingToken: "1", holderId: "holder-a" });
  input.generation = 2;
  input.desiredState = "DEPROVISIONED";
  const result = await provisioner.deprovision(input, key("b"), { fencingToken: "2", holderId: "holder-b" });
  assert.equal(result.converged, true);
  assert.ok(await api.get("/api/v1/namespaces/molit-edc-aviation-provider"));
  const control = await api.get("/apis/apps/v1/namespaces/molit-edc-aviation-provider/deployments/edc-control-plane");
  const data = await api.get("/apis/apps/v1/namespaces/molit-edc-aviation-provider/deployments/edc-data-plane");
  assert.equal(control.spec.replicas, 0);
  assert.equal(data.spec.replicas, 0);
  const observation = await provisioner.observe(input, key("b"), { expectedLastAppliedFencingToken: "2" });
  assert.deepEqual({ exists: observation.exists, converged: observation.converged }, { exists: true, converged: true });
});

test("an aborted command does not claim a target fencing token", async () => {
  const api = new FakeKubernetesApi();
  const provisioner = new KubernetesEdcProvisioner({ id: "kube-edc", config: config(), api });
  const controller = new AbortController();
  controller.abort(new Error("deadline exceeded"));
  await assert.rejects(provisioner.provision(tenant(), key("a"), { fencingToken: "1", holderId: "holder-a", signal: controller.signal }), /deadline exceeded/u);
  await assert.rejects(api.get("/api/v1/namespaces/molit-caas-system/configmaps/tenant-fence-road-provider"), { status: 404 });
});
