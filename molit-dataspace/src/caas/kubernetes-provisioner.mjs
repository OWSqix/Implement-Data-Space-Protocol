import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { setTimeout as sleep } from "node:timers/promises";
import { digest } from "../discovery/stable-json.mjs";
import { CaaSError, assertCaas } from "./errors.mjs";

const API_GROUP = "caas.data.molit.go.kr";
const MANAGED_BY = "molit-caas";
const FENCE_ANNOTATION = `${API_GROUP}/fencing-token`;
const TENANT_LABEL = `${API_GROUP}/tenant-id`;
const INSTANCE_LABEL = `${API_GROUP}/instance-id`;
const GATEWAY_ACCESS_LABEL = `${API_GROUP}/gateway-access`;
const OPERATION_ANNOTATION = `${API_GROUP}/operation-key`;
const GENERATION_ANNOTATION = `${API_GROUP}/generation`;
const DIGEST_ANNOTATION = `${API_GROUP}/intent-digest`;
const DESIRED_ANNOTATION = `${API_GROUP}/desired-state`;
const SCHEMA_VERSION_ANNOTATION = `${API_GROUP}/database-schema-version`;
const SCHEMA_ARTIFACT_ANNOTATION = `${API_GROUP}/database-schema-artifact-sha256`;
const DATABASE_SECRET_ANNOTATION = `${API_GROUP}/database-secret-sha256`;
const MAX_API_RESPONSE_BYTES = 8 * 1024 * 1024;
const RETRY_LIMIT = 8;
const MAX_CEL_FENCING_TOKEN = 9_223_372_036_854_775_807n;
const TENANT_ID = /^[a-z][a-z0-9-]{2,62}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SUPPLY_CHAIN_REFERENCE_POLICY = "molit-restrict-release-images";
const SUPPLY_CHAIN_REKOR_SENTINEL = "https://rekor.invalid";
const SUPPLY_CHAIN_RUNTIME_IDENTITIES = Object.freeze([
  Object.freeze({ service: "caas", runtimeClass: "caas-control-plane" }),
  Object.freeze({ service: "dsaas", runtimeClass: "dsaas-control-plane" }),
  Object.freeze({ service: "fencing-webhook", runtimeClass: "fencing-webhook" }),
  Object.freeze({ service: "edc-control-plane", runtimeClass: "edc-control-plane" }),
  Object.freeze({ service: "edc-data-plane", runtimeClass: "edc-data-plane" }),
  Object.freeze({ service: "edc-schema-migration", runtimeClass: "schema-migration" }),
  Object.freeze({ service: "postgres-operand", runtimeClass: "postgres-operand" }),
  Object.freeze({ service: "otel-collector", runtimeClass: "otel-collector" }),
]);

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("Kubernetes operation was aborted");
  error.name = "AbortError";
  throw error;
}

function requiredFencingToken(value) {
  assertCaas(/^[1-9][0-9]*$/u.test(value ?? ""), "CAAS_PROVISIONER_FENCING_REQUIRED", "Kubernetes provisioner requires a positive fencing token");
  const token = BigInt(value);
  assertCaas(token <= MAX_CEL_FENCING_TOKEN, "CAAS_PROVISIONER_FENCING_REQUIRED", "Kubernetes fencing token exceeds the admission policy integer range");
  return token;
}

function validateTenantId(value) {
  assertCaas(TENANT_ID.test(value ?? ""), "CAAS_KUBERNETES_TENANT_INVALID", "Kubernetes tenant ID is invalid");
  return value;
}

function resourceToken(resource) {
  const value = resource?.metadata?.annotations?.[FENCE_ANNOTATION];
  return /^[1-9][0-9]*$/u.test(value ?? "") ? BigInt(value) : 0n;
}

function ownedBy(resource, config, tenantId) {
  return resource?.metadata?.labels?.["app.kubernetes.io/managed-by"] === MANAGED_BY
    && resource.metadata.labels[TENANT_LABEL] === tenantId
    && resource.metadata.labels[INSTANCE_LABEL] === config.instanceId;
}

function kubeName(prefix, tenantId) {
  const value = `${prefix}${tenantId}`;
  if (value.length <= 63) return value;
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${value.slice(0, 50).replace(/-+$/u, "")}-${suffix}`;
}

function encodePath(value) { return encodeURIComponent(value); }

function canonicalPemSha256(value) {
  const canonical = `${String(value ?? "").replace(/\r\n?/gu, "\n").trim()}\n`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function policyReady(policy) {
  const generation = policy?.metadata?.generation;
  return Number.isInteger(generation) && (policy?.status?.conditions ?? []).some((condition) => condition.type === "Ready"
    && condition.status === "True"
    && condition.observedGeneration === generation);
}

function policyExpressions(policy) {
  return (policy?.spec?.validations ?? []).map(({ expression }) => expression ?? "").join("\n");
}

function releaseAttestor(policy) {
  return policy?.spec?.attestors?.find(({ name }) => name === "releaseKey")?.cosign;
}

function releaseAttestation(policy, predicateType) {
  return policy?.spec?.attestations?.find(({ name, intoto }) => name === "releaseBundle" && intoto?.type === predicateType);
}

function podAdmissionScope(policy, scopeExpression) {
  const rules = policy?.spec?.matchConstraints?.resourceRules ?? [];
  const podRule = rules.some((rule) => rule.apiGroups?.length === 1 && rule.apiGroups[0] === ""
    && rule.apiVersions?.length === 1 && rule.apiVersions[0] === "v1"
    && ["CREATE", "UPDATE"].every((operation) => rule.operations?.includes(operation))
    && rule.resources?.length === 2
    && new Set(rule.resources).size === 2
    && rule.resources.includes("pods")
    && rule.resources.includes("pods/ephemeralcontainers"));
  return podRule && ["molit-caas-system", "observability", "supply-chain.data.molit.go.kr/enforcement", "required"]
    .every((term) => scopeExpression?.includes(term));
}

function exactRuntimeRepositories(expression) {
  const repositories = [...String(expression).matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  if (repositories.length !== SUPPLY_CHAIN_RUNTIME_IDENTITIES.length || new Set(repositories).size !== repositories.length) return null;
  const structure = String(expression).replace(/'[^']+'/gu, "''").replace(/\s/gu, "");
  if (structure !== `[${repositories.map(() => "''").join(",")}]`) return null;
  const prefix = repositories.find((value) => value.endsWith("/caas"))?.slice(0, -"/caas".length);
  if (!prefix) return null;
  const expected = SUPPLY_CHAIN_RUNTIME_IDENTITIES.map(({ service }) => `${prefix}/${service}`).sort();
  return repositories.toSorted().join("\n") === expected.join("\n") ? { prefix, repositories } : null;
}

function conditionTrue(conditions, type, generation) {
  return (conditions ?? []).some((condition) => condition.type === type
    && condition.status === "True"
    && condition.observedGeneration === generation);
}

function routeHostname(template, tenantId) { return template.replace("{tenantId}", tenantId); }

function dspCallbackAddress(config, tenant) {
  if (config.routing.mode === "gateway-api") {
    return `https://${routeHostname(config.routing.protocolHostnameTemplate, tenant.tenantId)}/protocol`;
  }
  return `http://edc-control-plane:${config.ports.protocol}/protocol`;
}

function routeAccepted(route, routing) {
  const generation = route?.metadata?.generation;
  const expectedSection = route?.metadata?.name === "edc-dsp" ? routing.protocolSectionName : routing.dataPlaneSectionName;
  return (route?.status?.parents ?? []).some((parent) => parent.parentRef?.name === routing.parentRef.name
    && (parent.parentRef?.namespace ?? route.metadata.namespace) === routing.parentRef.namespace
    && parent.parentRef?.sectionName === expectedSection
    && conditionTrue(parent.conditions, "Accepted", generation)
    && conditionTrue(parent.conditions, "ResolvedRefs", generation));
}

function apiPath(resource) {
  const namespace = resource.metadata.namespace;
  const collection = resource.apiVersion === "batch/v1"
    ? `/apis/batch/v1/namespaces/${encodePath(namespace)}/jobs`
    : resource.apiVersion === "apps/v1"
    ? `/apis/apps/v1/namespaces/${encodePath(namespace)}/deployments`
    : resource.kind === "Namespace"
      ? "/api/v1/namespaces"
      : `/api/v1/namespaces/${encodePath(namespace)}/${({
        ConfigMap: "configmaps",
        LimitRange: "limitranges",
        NetworkPolicy: "networkpolicies",
        ResourceQuota: "resourcequotas",
        Secret: "secrets",
        Service: "services",
        ServiceAccount: "serviceaccounts",
      })[resource.kind]}`;
  return { collection, item: `${collection}/${encodePath(resource.metadata.name)}` };
}

function withoutServerFields(resource) {
  const copy = structuredClone(resource);
  delete copy.metadata?.creationTimestamp;
  delete copy.metadata?.generation;
  delete copy.metadata?.managedFields;
  delete copy.metadata?.resourceVersion;
  delete copy.metadata?.selfLink;
  delete copy.metadata?.uid;
  delete copy.status;
  return copy;
}

function replacementBody(current, desired) {
  const body = structuredClone(desired);
  body.metadata.resourceVersion = current.metadata.resourceVersion;
  body.metadata.labels = { ...current.metadata.labels, ...desired.metadata.labels };
  body.metadata.annotations = { ...current.metadata.annotations, ...desired.metadata.annotations };
  if (desired.kind === "Namespace") body.spec = structuredClone(current.spec ?? {});
  if (desired.kind === "Service") {
    for (const field of ["clusterIP", "clusterIPs", "healthCheckNodePort", "ipFamilies", "ipFamilyPolicy"]) {
      if (current.spec?.[field] !== undefined) body.spec[field] = structuredClone(current.spec[field]);
    }
  }
  return body;
}

function boundedErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_:-]{1,64}$/u.test(error.code)
    ? error.code
    : "CAAS_KUBERNETES_APPLY_FAILED";
}

export class KubernetesApiError extends Error {
  constructor(status, reason, message = "Kubernetes API request failed") {
    super(message);
    this.name = "KubernetesApiError";
    this.code = "CAAS_KUBERNETES_API_ERROR";
    this.status = status;
    this.reason = reason;
  }
}

export class KubernetesApiClient {
  constructor({ apiServer, tokenFile, caFile, requestTimeoutMs = 15_000 }) {
    this.base = new URL(apiServer);
    assertCaas(["https:", "http:"].includes(this.base.protocol) && this.base.pathname === "/" && !this.base.search && !this.base.hash,
      "CAAS_CONFIG_INVALID", "Kubernetes apiServer must be an origin URL");
    this.tokenFile = tokenFile;
    this.caFile = caFile;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async request(method, path, { body, query, signal } = {}) {
    throwIfAborted(signal);
    const [token, ca] = await Promise.all([
      readFile(this.tokenFile, "utf8"),
      this.base.protocol === "https:" ? readFile(this.caFile) : Promise.resolve(undefined),
    ]);
    throwIfAborted(signal);
    const bearerToken = token.trim();
    assertCaas(bearerToken.length >= 16 && bearerToken.length <= 16_384 && !/[\s\u0000-\u001f\u007f]/u.test(bearerToken),
      "CAAS_KUBERNETES_CREDENTIAL_INVALID", "Kubernetes service-account token is empty or malformed");
    const url = new URL(path, this.base);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const transport = this.base.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        callback(value);
      };
      const request = transport(url, {
        method,
        ca,
        rejectUnauthorized: this.base.protocol === "https:",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${bearerToken}`,
          ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        },
      }, (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_API_RESPONSE_BYTES) request.destroy(new Error("Kubernetes API response exceeded the configured bound"));
          else chunks.push(chunk);
        });
        response.on("end", () => {
          let value = null;
          const raw = Buffer.concat(chunks).toString("utf8");
          try { if (raw) value = JSON.parse(raw); } catch { return finish(reject, new KubernetesApiError(response.statusCode, "InvalidResponse", "Kubernetes API returned invalid JSON")); }
          if ((response.statusCode ?? 500) >= 400) {
            return finish(reject, new KubernetesApiError(response.statusCode, value?.reason ?? value?.status ?? "Unknown", value?.message));
          }
          finish(resolve, value);
        });
      });
      const onAbort = () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error("Kubernetes request aborted"));
      signal?.addEventListener("abort", onAbort, { once: true });
      request.setTimeout(this.requestTimeoutMs, () => request.destroy(new CaaSError("CAAS_KUBERNETES_TIMEOUT", "Kubernetes API request timed out")));
      request.on("error", (error) => finish(reject, error));
      if (payload) request.write(payload);
      request.end();
    });
  }

  get(path, options) { return this.request("GET", path, options); }
  create(path, body, options) { return this.request("POST", path, { ...options, body }); }
  replace(path, body, options) { return this.request("PUT", path, { ...options, body }); }
  delete(path, body, options) { return this.request("DELETE", path, { ...options, body }); }
}

function labels(config, tenantId, component) {
  return {
    "app.kubernetes.io/managed-by": MANAGED_BY,
    "app.kubernetes.io/name": "molit-edc",
    "app.kubernetes.io/component": component,
    [TENANT_LABEL]: tenantId,
    [INSTANCE_LABEL]: config.instanceId,
  };
}

function metadata(config, tenant, name, component, annotations, namespace) {
  return {
    name,
    ...(namespace ? { namespace } : {}),
    labels: labels(config, tenant.tenantId, component),
    annotations,
  };
}

function podSecurityContext() {
  return { runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } };
}

function containerSecurityContext() {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
  };
}

function boundSecretEnvironment(config, tenant, component) {
  const entries = [];
  for (const name of Object.keys(tenant.deploymentSecretRefs).sort()) {
    const binding = config.secretBindings[name];
    assertCaas(binding, "CAAS_KUBERNETES_SECRET_BINDING_MISSING", `deployment secret ${name} has no Kubernetes binding`);
    const secretName = binding.secretNameTemplate.replace("{tenantId}", tenant.tenantId);
    for (const key of binding.keys) {
      if (!key.components.includes(component)) continue;
      entries.push({
        name: key.environmentVariable,
        valueFrom: { secretKeyRef: { name: secretName, key: key.key } },
      });
    }
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function databaseDescriptor(config, tenant) {
  const schema = tenant.connectorPlanSnapshot?.databaseSchema;
  if (!schema) return null;
  const connection = schema.connection;
  const binding = config.secretBindings[connection.secretBindingName];
  assertCaas(binding && tenant.deploymentSecretRefs?.[connection.secretBindingName],
    "CAAS_KUBERNETES_DATABASE_BINDING_MISSING", "EDC database schema contract is not backed by the tenant Secret binding");
  return {
    schema,
    connection,
    secretName: binding.secretNameTemplate.replace("{tenantId}", tenant.tenantId),
    caPath: `${connection.mountPath}/ca.crt`,
    ...(connection.clientCertificateKey ? { certificatePath: `${connection.mountPath}/tls.crt`, privateKeyPath: `${connection.mountPath}/tls.key` } : {}),
  };
}

function databaseSecretVolume(descriptor) {
  if (!descriptor) return null;
  const items = [{ key: descriptor.connection.caKey, path: "ca.crt", mode: 288 }];
  if (descriptor.connection.clientCertificateKey) {
    items.push(
      { key: descriptor.connection.clientCertificateKey, path: "tls.crt", mode: 288 },
      { key: descriptor.connection.clientPrivateKeyKey, path: "tls.key", mode: 288 },
    );
  }
  return {
    name: "database-trust",
    secret: { secretName: descriptor.secretName, defaultMode: 288, items },
  };
}

function schemaMigrationJob(config, tenant, namespace, annotations, intentDigest) {
  const descriptor = databaseDescriptor(config, tenant);
  if (!descriptor) return null;
  const { schema, connection, secretName } = descriptor;
  const container = (component, urlKey) => ({
    name: component,
    image: schema.migrationImage,
    imagePullPolicy: "IfNotPresent",
    args: ["migrate-and-verify"],
    env: [
      { name: "EDC_DATASOURCE_DEFAULT_URL", valueFrom: { secretKeyRef: { name: secretName, key: urlKey } } },
      { name: "EDC_DATASOURCE_DEFAULT_USER", valueFrom: { secretKeyRef: { name: secretName, key: connection.usernameKey } } },
      { name: "EDC_DATASOURCE_DEFAULT_PASSWORD", valueFrom: { secretKeyRef: { name: secretName, key: connection.passwordKey } } },
      { name: "MOLIT_EDC_SCHEMA_COMPONENT", value: component },
      { name: "MOLIT_EDC_REQUIRED_SCHEMA_VERSION", value: schema.requiredVersion },
      { name: "MOLIT_EDC_MIGRATION_ARTIFACT_SHA256", value: schema.migrationArtifact.sha256 },
      { name: "MOLIT_EDC_DATABASE_TLS_MODE", value: connection.sslMode },
      { name: "PGSSLROOTCERT", value: descriptor.caPath },
      ...(descriptor.certificatePath ? [
        { name: "PGSSLCERT", value: descriptor.certificatePath },
        { name: "PGSSLKEY", value: descriptor.privateKeyPath },
      ] : []),
    ],
    resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "512Mi" } },
    securityContext: containerSecurityContext(),
    volumeMounts: [
      { name: "database-trust", mountPath: connection.mountPath, readOnly: true },
      { name: "tmp", mountPath: "/tmp" },
    ],
  });
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: metadata(config, tenant, kubeName("edc-schema-", intentDigest.slice(0, 16)), "schema-migration", {
      ...annotations,
      [SCHEMA_VERSION_ANNOTATION]: schema.requiredVersion,
      [SCHEMA_ARTIFACT_ANNOTATION]: schema.migrationArtifact.sha256,
    }, namespace),
    spec: {
      backoffLimit: 1,
      activeDeadlineSeconds: Math.ceil(schema.migrationTimeoutMs / 1000),
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels: labels(config, tenant.tenantId, "schema-migration"), annotations: { [DIGEST_ANNOTATION]: annotations[DIGEST_ANNOTATION] } },
        spec: {
          automountServiceAccountToken: false,
          serviceAccountName: "edc-runtime",
          restartPolicy: "Never",
          securityContext: { ...podSecurityContext(), fsGroup: 10001 },
          containers: [container("control-plane", connection.controlUrlKey), container("data-plane", connection.dataUrlKey)],
          volumes: [databaseSecretVolume(descriptor), { name: "tmp", emptyDir: { sizeLimit: "64Mi" } }],
        },
      },
    },
  };
}

function schemaReadyReceipt(config, tenant, namespace, annotations, secretEvidence, migration) {
  const schema = tenant.connectorPlanSnapshot.databaseSchema;
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: metadata(config, tenant, "edc-schema-ready", "schema-readiness", {
      ...annotations,
      [SCHEMA_VERSION_ANNOTATION]: schema.requiredVersion,
      [SCHEMA_ARTIFACT_ANNOTATION]: schema.migrationArtifact.sha256,
      [DATABASE_SECRET_ANNOTATION]: secretEvidence.sha256,
    }, namespace),
    data: {
      requiredVersion: schema.requiredVersion,
      migrationArtifactSha256: schema.migrationArtifact.sha256,
      databaseSecretName: secretEvidence.name,
      databaseSecretUid: secretEvidence.uid,
      databaseSecretResourceVersion: secretEvidence.resourceVersion,
      databaseSecretSha256: secretEvidence.sha256,
      migrationJobName: migration.metadata.name,
      migrationJobUid: migration.metadata.uid,
    },
  };
}

function decodeSecretValue(secret, key, label, { maxBytes = 65_536 } = {}) {
  const encoded = secret?.data?.[key];
  assertCaas(typeof encoded === "string" && encoded.length > 0 && encoded.length <= Math.ceil(maxBytes / 3) * 4
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded),
  "CAAS_KUBERNETES_DATABASE_SECRET_INVALID", `${label} is absent or is not canonical base64`);
  const bytes = Buffer.from(encoded, "base64");
  assertCaas(bytes.length > 0 && bytes.length <= maxBytes && bytes.toString("base64") === encoded,
    "CAAS_KUBERNETES_DATABASE_SECRET_INVALID", `${label} is outside the bounded Secret contract`);
  let value;
  try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { value = null; }
  assertCaas(typeof value === "string" && !value.includes("\0"),
    "CAAS_KUBERNETES_DATABASE_SECRET_INVALID", `${label} is not valid UTF-8 text`);
  return value;
}

function validateJdbcUrl(value, descriptor, label) {
  assertCaas(value.startsWith("jdbc:postgresql://") && value.length <= 4096
    && !/[\u0000-\u001f\u007f\s]/u.test(value),
  "CAAS_KUBERNETES_DATABASE_TLS_INVALID", `${label} must be a bounded PostgreSQL JDBC URL`);
  let url;
  try { url = new URL(value.slice("jdbc:".length)); } catch { url = null; }
  assertCaas(url?.protocol === "postgresql:" && url.hostname && !url.username && !url.password && !url.hash
    && /^\/[A-Za-z0-9_]{1,63}$/u.test(url.pathname),
  "CAAS_KUBERNETES_DATABASE_TLS_INVALID", `${label} must not contain userinfo, fragments, or an ambiguous database name`);
  const entries = [...url.searchParams.entries()];
  const keys = entries.map(([key]) => key);
  const expected = new Map([
    ["sslmode", "verify-full"],
    ["sslrootcert", descriptor.caPath],
    ...(descriptor.certificatePath ? [["sslcert", descriptor.certificatePath], ["sslkey", descriptor.privateKeyPath]] : []),
  ]);
  assertCaas(entries.length === expected.size && new Set(keys).size === keys.length
    && entries.every(([key, entry]) => expected.get(key) === entry),
  "CAAS_KUBERNETES_DATABASE_TLS_INVALID", `${label} must use only the exact verify-full JDBC TLS parameters`);
}

function validateDatabaseSecret(secret, descriptor) {
  assertCaas(secret?.metadata?.name === descriptor.secretName && secret?.immutable === true,
    "CAAS_KUBERNETES_DATABASE_SECRET_INVALID", "EDC database Secret must exist and be immutable");
  const selectedKeys = [descriptor.connection.controlUrlKey, descriptor.connection.dataUrlKey,
    descriptor.connection.usernameKey, descriptor.connection.passwordKey, descriptor.connection.caKey,
    descriptor.connection.clientCertificateKey, descriptor.connection.clientPrivateKeyKey].filter(Boolean);
  const values = Object.fromEntries(selectedKeys.map((key) => [key, decodeSecretValue(secret, key, `database Secret key ${key}`)]));
  validateJdbcUrl(values[descriptor.connection.controlUrlKey], descriptor, "control-plane database URL");
  validateJdbcUrl(values[descriptor.connection.dataUrlKey], descriptor, "data-plane database URL");
  assertCaas(values[descriptor.connection.controlUrlKey] !== values[descriptor.connection.dataUrlKey],
    "CAAS_KUBERNETES_DATABASE_TLS_INVALID", "control-plane and data-plane must not share one database URL");
  const username = values[descriptor.connection.usernameKey];
  const password = values[descriptor.connection.passwordKey];
  assertCaas(/^[^:\s\u0000-\u001f\u007f]{1,128}$/u.test(username) && password.length >= 20 && password.length <= 1024
    && !/[\u0000-\u001f\u007f]/u.test(password),
  "CAAS_KUBERNETES_DATABASE_SECRET_INVALID", "EDC database credentials are outside the bounded contract");
  const ca = values[descriptor.connection.caKey];
  assertCaas(ca.includes("-----BEGIN CERTIFICATE-----") && ca.includes("-----END CERTIFICATE-----"),
    "CAAS_KUBERNETES_DATABASE_SECRET_INVALID", "EDC database CA key does not contain a PEM certificate");
  if (descriptor.connection.clientCertificateKey) {
    const certificate = values[descriptor.connection.clientCertificateKey];
    const privateKey = values[descriptor.connection.clientPrivateKeyKey];
    assertCaas(certificate.includes("-----BEGIN CERTIFICATE-----") && certificate.includes("-----END CERTIFICATE-----")
      && /-----BEGIN (?:RSA )?PRIVATE KEY-----/u.test(privateKey) && /-----END (?:RSA )?PRIVATE KEY-----/u.test(privateKey),
    "CAAS_KUBERNETES_DATABASE_SECRET_INVALID", "EDC database client certificate or private key is not PEM material");
  }
  const data = Object.fromEntries(selectedKeys.sort().map((key) => [key, secret.data[key]]));
  return {
    name: descriptor.secretName,
    uid: secret.metadata.uid,
    resourceVersion: secret.metadata.resourceVersion,
    sha256: digest(data),
  };
}

function deployment(config, tenant, namespace, component, image, replicas, annotations) {
  const componentLabels = labels(config, tenant.tenantId, component);
  const database = databaseDescriptor(config, tenant);
  const secretEnv = Object.keys(tenant.deploymentSecretRefs).sort().map((name) => ({
    name: `MOLIT_SECRET_REF_${name.replace(/[^A-Za-z0-9]/gu, "_").toUpperCase()}`,
    valueFrom: { secretKeyRef: { name: "edc-secret-references", key: name } },
  }));
  const controlPlane = component === "control-plane";
  const ports = controlPlane
    ? [
      { name: "default", containerPort: config.ports.default, protocol: "TCP" },
      { name: "management", containerPort: config.ports.management, protocol: "TCP" },
      { name: "protocol", containerPort: config.ports.protocol, protocol: "TCP" },
      { name: "control", containerPort: config.ports.control, protocol: "TCP" },
    ]
    : [
      { name: "default", containerPort: config.ports.dataPlaneDefault, protocol: "TCP" },
      { name: "control", containerPort: config.ports.dataPlaneControl, protocol: "TCP" },
    ];
  const webEnvironment = controlPlane ? [
    { name: "WEB_HTTP_PORT", value: String(config.ports.default) },
    { name: "WEB_HTTP_PATH", value: "/api" },
    { name: "WEB_HTTP_MANAGEMENT_PORT", value: String(config.ports.management) },
    { name: "WEB_HTTP_MANAGEMENT_PATH", value: "/management" },
    { name: "WEB_HTTP_PROTOCOL_PORT", value: String(config.ports.protocol) },
    { name: "WEB_HTTP_PROTOCOL_PATH", value: "/protocol" },
    { name: "WEB_HTTP_CONTROL_PORT", value: String(config.ports.control) },
    { name: "WEB_HTTP_CONTROL_PATH", value: "/control" },
    { name: "EDC_DSP_CALLBACK_ADDRESS", value: dspCallbackAddress(config, tenant) },
  ] : [
    { name: "WEB_HTTP_PORT", value: String(config.ports.dataPlaneDefault) },
    { name: "WEB_HTTP_PATH", value: "/api" },
    { name: "WEB_HTTP_CONTROL_PORT", value: String(config.ports.dataPlaneControl) },
    { name: "WEB_HTTP_CONTROL_PATH", value: "/control" },
    { name: "EDC_CONTROL_ENDPOINT", value: `http://edc-data-plane:${config.ports.dataPlaneControl}/control` },
    { name: "EDC_DPF_SELECTOR_URL", value: `http://edc-control-plane:${config.ports.control}/control/v1/dataplanes` },
  ];
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: metadata(config, tenant, `edc-${component}`, component, annotations, namespace),
    spec: {
      replicas,
      revisionHistoryLimit: config.revisionHistoryLimit,
      selector: { matchLabels: componentLabels },
      strategy: { type: "RollingUpdate", rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } },
      template: {
        metadata: { labels: componentLabels, annotations: { [DIGEST_ANNOTATION]: annotations[DIGEST_ANNOTATION] } },
        spec: {
          automountServiceAccountToken: false,
          serviceAccountName: "edc-runtime",
          securityContext: podSecurityContext(),
          terminationGracePeriodSeconds: config.terminationGracePeriodSeconds,
          affinity: {
            podAntiAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [{
                weight: 100,
                podAffinityTerm: { labelSelector: { matchLabels: componentLabels }, topologyKey: "kubernetes.io/hostname" },
              }],
            },
          },
          topologySpreadConstraints: [
            { maxSkew: 1, topologyKey: "topology.kubernetes.io/zone", whenUnsatisfiable: "DoNotSchedule", labelSelector: { matchLabels: componentLabels } },
            { maxSkew: 1, topologyKey: "kubernetes.io/hostname", whenUnsatisfiable: "ScheduleAnyway", labelSelector: { matchLabels: componentLabels } },
          ],
          containers: [{
            name: component,
            image,
            imagePullPolicy: "IfNotPresent",
            ports,
            env: [
              { name: "EDC_PARTICIPANT_ID", value: tenant.participantId },
              { name: "EDC_COMPONENT_ID", value: `${tenant.tenantId}-${component}` },
              { name: "EDC_CONNECTOR_NAMESPACE", value: tenant.namespace },
              { name: "EDC_PUBLIC_BASE_URL", value: tenant.endpoint },
              { name: "EDC_SQL_SCHEMA_AUTOCREATE", value: "false" },
              { name: "MOLIT_EDC_RUNTIME_PROFILE", value: tenant.runtimeProfileRef },
              { name: "MOLIT_METADATA_PROFILE_IRI", value: tenant.connectorPlanSnapshot.metadataProfile.iri },
              { name: "MOLIT_METADATA_PROFILE_VERSION", value: tenant.connectorPlanSnapshot.metadataProfile.version },
              { name: "MOLIT_METADATA_PROFILE_SHA256", value: tenant.connectorPlanSnapshot.metadataProfile.sha256 },
              { name: "MOLIT_DSP_SPECIFICATION", value: tenant.connectorPlanSnapshot.protocolProfile.specification },
              { name: "MOLIT_DSP_IDENTITY_MODE", value: tenant.connectorPlanSnapshot.protocolProfile.identityMode },
              ...(database ? [
                { name: "MOLIT_EDC_REQUIRED_SCHEMA_VERSION", value: database.schema.requiredVersion },
                { name: "MOLIT_EDC_MIGRATION_ARTIFACT_SHA256", value: database.schema.migrationArtifact.sha256 },
                { name: "MOLIT_EDC_DATABASE_TLS_MODE", value: database.connection.sslMode },
                { name: "PGSSLROOTCERT", value: database.caPath },
                ...(database.certificatePath ? [
                  { name: "PGSSLCERT", value: database.certificatePath },
                  { name: "PGSSLKEY", value: database.privateKeyPath },
                ] : []),
              ] : []),
              ...webEnvironment,
              ...boundSecretEnvironment(config, tenant, component),
              ...secretEnv,
            ],
            resources: config.resources[component],
            securityContext: containerSecurityContext(),
            readinessProbe: { httpGet: { path: "/api/check/readiness", port: "default" }, initialDelaySeconds: 10, periodSeconds: 10, timeoutSeconds: 3, failureThreshold: 6 },
            livenessProbe: { httpGet: { path: "/api/check/liveness", port: "default" }, initialDelaySeconds: 30, periodSeconds: 20, timeoutSeconds: 3, failureThreshold: 3 },
            volumeMounts: [
              ...(database ? [{ name: "database-trust", mountPath: database.connection.mountPath, readOnly: true }] : []),
              { name: "tmp", mountPath: "/tmp" },
            ],
          }],
          volumes: [
            ...(database ? [databaseSecretVolume(database)] : []),
            { name: "tmp", emptyDir: { sizeLimit: "128Mi" } },
          ],
        },
      },
    },
  };
}

function desiredResources(config, tenant, desiredState, intentDigest) {
  const namespace = kubeName(config.namespacePrefix, tenant.tenantId);
  const token = tenant.fencingToken;
  const annotations = {
    [FENCE_ANNOTATION]: token,
    [OPERATION_ANNOTATION]: tenant.operationKey,
    [GENERATION_ANNOTATION]: String(tenant.generation),
    [DIGEST_ANNOTATION]: intentDigest,
    [DESIRED_ANNOTATION]: desiredState,
  };
  const replicas = desiredState === "PROVISIONED" ? config.replicas : { controlPlane: 0, dataPlane: 0 };
  const images = tenant.connectorPlanSnapshot?.images ?? config.images;
  const common = (name, kind, component, extra = {}) => ({ apiVersion: "v1", kind, metadata: metadata(config, tenant, name, component, annotations, namespace), ...extra });
  const ingressPeers = config.networkPolicy.allowedIngressCidrs.map((cidr) => ({ ipBlock: { cidr } }));
  const referenceData = Object.fromEntries(Object.entries(tenant.deploymentSecretRefs).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, Buffer.from(value).toString("base64")]));
  const namespaceMetadata = metadata(config, tenant, namespace, "tenant", annotations);
  namespaceMetadata.labels["supply-chain.data.molit.go.kr/enforcement"] = "required";
  if (config.routing.mode === "gateway-api") namespaceMetadata.labels[GATEWAY_ACCESS_LABEL] = config.routing.gatewayAccessLabelValue;
  const resources = [
    { apiVersion: "v1", kind: "Namespace", metadata: namespaceMetadata },
    common("edc-runtime", "ServiceAccount", "identity", { automountServiceAccountToken: false }),
    common("edc-secret-references", "Secret", "secrets", { type: "Opaque", immutable: true, data: referenceData }),
    common("edc-quota", "ResourceQuota", "quota", { spec: { hard: config.quota } }),
    common("edc-defaults", "LimitRange", "limits", { spec: { limits: [{ type: "Container", default: config.limitRange.default, defaultRequest: config.limitRange.defaultRequest }] } }),
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: metadata(config, tenant, "default-deny", "network", annotations, namespace),
      spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: metadata(config, tenant, "edc-runtime", "network", annotations, namespace),
      spec: {
        podSelector: { matchLabels: { "app.kubernetes.io/name": "molit-edc" } },
        policyTypes: ["Ingress", "Egress"],
        ingress: [
          { from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "molit-edc" } } }] },
          ...(ingressPeers.length > 0 ? [{ from: ingressPeers }] : []),
        ],
        egress: [
          { to: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "molit-edc" } } }] },
          { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] },
          ...config.networkPolicy.allowedEgressCidrs.map((cidr) => ({ to: [{ ipBlock: { cidr } }] })),
        ],
      },
    },
    deployment(config, tenant, namespace, "control-plane", images.controlPlane, replicas.controlPlane, annotations),
    deployment(config, tenant, namespace, "data-plane", images.dataPlane, replicas.dataPlane, annotations),
    {
      apiVersion: "policy/v1",
      kind: "PodDisruptionBudget",
      metadata: metadata(config, tenant, "edc-control-plane", "control-plane", annotations, namespace),
      spec: { minAvailable: Math.max(0, replicas.controlPlane - 1), selector: { matchLabels: labels(config, tenant.tenantId, "control-plane") } },
    },
    {
      apiVersion: "policy/v1",
      kind: "PodDisruptionBudget",
      metadata: metadata(config, tenant, "edc-data-plane", "data-plane", annotations, namespace),
      spec: { minAvailable: Math.max(0, replicas.dataPlane - 1), selector: { matchLabels: labels(config, tenant.tenantId, "data-plane") } },
    },
    common("edc-control-plane", "Service", "control-plane", { spec: { type: "ClusterIP", selector: labels(config, tenant.tenantId, "control-plane"), ports: [
      { name: "default", port: config.ports.default, targetPort: "default" },
      { name: "management", port: config.ports.management, targetPort: "management" },
      { name: "protocol", port: config.ports.protocol, targetPort: "protocol" },
      { name: "control", port: config.ports.control, targetPort: "control" },
    ] } }),
    common("edc-data-plane", "Service", "data-plane", { spec: { type: "ClusterIP", selector: labels(config, tenant.tenantId, "data-plane"), ports: [
      { name: "default", port: config.ports.dataPlaneDefault, targetPort: "default" },
      { name: "control", port: config.ports.dataPlaneControl, targetPort: "control" },
    ] } }),
  ];
  if (config.routing.mode === "gateway-api") {
    const route = (name, component, sectionName, hostname, backendName, port) => ({
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: metadata(config, tenant, name, component, annotations, namespace),
      spec: {
        parentRefs: [{ group: "gateway.networking.k8s.io", kind: "Gateway", name: config.routing.parentRef.name, namespace: config.routing.parentRef.namespace, sectionName }],
        hostnames: [hostname],
        rules: [{ backendRefs: [{ group: "", kind: "Service", name: backendName, port, weight: 1 }] }],
      },
    });
    resources.push(
      route("edc-dsp", "protocol-route", config.routing.protocolSectionName, routeHostname(config.routing.protocolHostnameTemplate, tenant.tenantId), "edc-control-plane", config.ports.protocol),
      route("edc-data", "data-route", config.routing.dataPlaneSectionName, routeHostname(config.routing.dataPlaneHostnameTemplate, tenant.tenantId), "edc-data-plane", config.ports.dataPlaneDefault),
    );
  }
  return resources;
}

function resourceCollection(resource) {
  if (resource.kind === "HTTPRoute") {
    const namespace = resource.metadata.namespace;
    const collection = `/apis/gateway.networking.k8s.io/v1/namespaces/${encodePath(namespace)}/httproutes`;
    return { collection, item: `${collection}/${encodePath(resource.metadata.name)}` };
  }
  if (resource.kind === "NetworkPolicy") {
    const namespace = resource.metadata.namespace;
    const collection = `/apis/networking.k8s.io/v1/namespaces/${encodePath(namespace)}/networkpolicies`;
    return { collection, item: `${collection}/${encodePath(resource.metadata.name)}` };
  }
  if (resource.kind === "PodDisruptionBudget") {
    const namespace = resource.metadata.namespace;
    const collection = `/apis/policy/v1/namespaces/${encodePath(namespace)}/poddisruptionbudgets`;
    return { collection, item: `${collection}/${encodePath(resource.metadata.name)}` };
  }
  return apiPath(resource);
}

function desiredDocument(config, tenant, operationKey, desiredState) {
  const images = tenant.connectorPlanSnapshot?.images ?? config.images;
  return {
    schemaVersion: "molit.kubernetes-edc-intent/1",
    provisionerId: config.id,
    instanceId: config.instanceId,
    tenantId: tenant.tenantId,
    generation: tenant.generation,
    operationKey,
    desiredState,
    namespace: kubeName(config.namespacePrefix, tenant.tenantId),
    connectorPlanDigest: tenant.connectorPlanDigest,
    databaseSchema: tenant.connectorPlanSnapshot?.databaseSchema ?? null,
    deploymentSecretRefDigest: digest(tenant.deploymentSecretRefs),
    images,
    replicas: desiredState === "PROVISIONED" ? config.replicas : { controlPlane: 0, dataPlane: 0 },
    routing: config.routing,
  };
}

export class KubernetesEdcProvisioner {
  constructor({ id, config, api }) {
    this.id = id;
    this.config = { id, ...structuredClone(config) };
    this.api = api;
    this.intentOnly = false;
    this.fencingCapable = true;
  }

  async readiness({ signal } = {}) {
    throwIfAborted(signal);
    const [namespace, policy, binding, webhook, webhookDeployment] = await Promise.all([
      this.#get(`/api/v1/namespaces/${encodePath(this.config.controlNamespace)}`, { signal }),
      this.#get(`/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicies/${encodePath(this.config.admissionPolicyName)}`, { signal }),
      this.#get(`/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicybindings/${encodePath(this.config.admissionPolicyName)}`, { signal }),
      this.#get(`/apis/admissionregistration.k8s.io/v1/validatingwebhookconfigurations/${encodePath(this.config.admissionPolicyName)}`, { signal }),
      this.#get(`/apis/apps/v1/namespaces/${encodePath(this.config.controlNamespace)}/deployments/molit-caas-fencing-webhook`, { signal }),
    ]);
    assertCaas(namespace?.metadata?.name === this.config.controlNamespace, "CAAS_KUBERNETES_NOT_READY", "Kubernetes fencing namespace is unavailable");
    assertCaas(policy?.metadata?.annotations?.[`${API_GROUP}/fencing-policy-version`] === "2"
      && binding?.metadata?.annotations?.[`${API_GROUP}/fencing-policy-version`] === "2"
      && policy?.spec?.failurePolicy === "Fail"
      && binding?.spec?.policyName === this.config.admissionPolicyName
      && binding?.spec?.validationActions?.includes("Deny"),
    "CAAS_KUBERNETES_FENCING_POLICY_MISSING", "Kubernetes fencing admission policy is not bound in deny mode");
    const fencingWebhook = webhook?.webhooks?.find((value) => value.name === "fencing.caas.data.molit.go.kr");
    const deleteProtected = fencingWebhook?.rules?.some((rule) => rule.operations?.includes("DELETE")
      && rule.resources?.includes("namespaces"));
    const migrationProtected = fencingWebhook?.rules?.some((rule) => rule.apiGroups?.includes("batch")
      && rule.operations?.includes("DELETE") && rule.resources?.includes("jobs"));
    assertCaas(webhook?.metadata?.annotations?.[`${API_GROUP}/fencing-policy-version`] === "3"
      && fencingWebhook?.failurePolicy === "Fail"
      && fencingWebhook?.sideEffects === "None"
      && fencingWebhook?.clientConfig?.service?.namespace === this.config.controlNamespace
      && deleteProtected && migrationProtected
      && (webhookDeployment?.status?.availableReplicas ?? 0) >= 1,
    "CAAS_KUBERNETES_FENCING_WEBHOOK_MISSING", "Kubernetes target-side deletion fencing webhook is unavailable or not fail-closed");
    if (this.config.supplyChainAdmission) {
      const [referencePolicy, releasePolicy] = await Promise.all([
        this.#get(`/apis/policies.kyverno.io/v1/validatingpolicies/${SUPPLY_CHAIN_REFERENCE_POLICY}`, { signal, missing: true }),
        this.#get(`/apis/policies.kyverno.io/v1/imagevalidatingpolicies/${encodePath(this.config.supplyChainAdmission.policyName)}`, { signal, missing: true }),
      ]);
      const referenceVariables = new Map((referencePolicy?.spec?.variables ?? []).map(({ name, expression }) => [name, expression ?? ""]));
      const allowedRepositories = referenceVariables.get("allowedRepositories") ?? "";
      const runtimeRepositories = exactRuntimeRepositories(allowedRepositories);
      const referenceValidation = policyExpressions(referencePolicy);
      const referenceComplete = runtimeRepositories
        && podAdmissionScope(referencePolicy, referenceVariables.get("enforcedNamespace"))
        && referenceValidation.includes("containsDigest()")
        && referenceValidation.includes("sha256:[0-9a-f]{64}")
        && (referenceVariables.get("allContainers") ?? "").includes("initContainers")
        && (referenceVariables.get("allContainers") ?? "").includes("ephemeralContainers");
      const predicateType = this.config.supplyChainAdmission.attestationPredicateType;
      const trustAnchorSha256 = this.config.supplyChainAdmission.trustAnchorSha256;
      const releaseExpressions = policyExpressions(releasePolicy);
      const releaseScope = (releasePolicy?.spec?.matchConditions ?? []).map(({ expression }) => expression ?? "").join("\n");
      const releaseKey = releaseAttestor(releasePolicy);
      const releaseValidations = releasePolicy?.spec?.validations ?? [];
      const cryptoComplete = (releaseExpressions.match(/verifyImageSignatures/gu)?.length ?? 0) === 1
        && (releaseExpressions.match(/verifyAttestationSignatures/gu)?.length ?? 0) === 1;
      const identitiesComplete = SUPPLY_CHAIN_RUNTIME_IDENTITIES.every(({ service, runtimeClass }) =>
        releaseExpressions.includes(`${runtimeRepositories?.prefix}/${service}@sha256:`)
        && releaseExpressions.includes(`payload.artifact.service == '${service}'`)
        && releaseExpressions.includes(`payload.artifact.runtimeClass == '${runtimeClass}'`));
      const releaseComplete = releasePolicy?.apiVersion === "policies.kyverno.io/v1"
        && releasePolicy.kind === "ImageValidatingPolicy"
        && policyReady(releasePolicy)
        && releasePolicy.spec?.failurePolicy === "Fail"
        && releasePolicy.spec?.validationActions?.includes("Deny")
        && releasePolicy.spec?.validationConfigurations?.required === true
        && releasePolicy.spec?.validationConfigurations?.verifyDigest === true
        && releasePolicy.spec?.validationConfigurations?.mutateDigest === false
        && podAdmissionScope(releasePolicy, releaseScope)
        && releasePolicy.spec?.matchImageReferences?.length === 1
        && releasePolicy.spec.matchImageReferences[0].glob === `${runtimeRepositories?.prefix}/*@sha256:*`
        && releaseAttestation(releasePolicy, predicateType)
        && releaseKey?.ctlog?.url === SUPPLY_CHAIN_REKOR_SENTINEL
        && releaseKey?.ctlog?.insecureIgnoreTlog === true
        && Object.keys(releaseKey.ctlog).length === 2
        && canonicalPemSha256(releaseKey?.key?.data) === trustAnchorSha256
        && releasePolicy.metadata?.annotations?.["supply-chain.data.molit.go.kr/trust-anchor-sha256"] === trustAnchorSha256
        && releaseValidations.length === 3 + SUPPLY_CHAIN_RUNTIME_IDENTITIES.length
        && cryptoComplete
        && identitiesComplete
        && ["verifyImageSignatures", "verifyAttestationSignatures", "extractPayload", "images.initContainers", "images.ephemeralContainers",
          "payload.image.name", "payload.image.digest", "productionEligible", "vulnerabilityGate.decision", "findingCount",
          "time.now()", "https://slsa.dev/provenance/v1"].every((term) => releaseExpressions.includes(term));
      assertCaas(referencePolicy?.apiVersion === "policies.kyverno.io/v1"
        && referencePolicy.kind === "ValidatingPolicy"
        && policyReady(referencePolicy)
        && referencePolicy.spec?.failurePolicy === "Fail"
        && referencePolicy.spec?.validationActions?.includes("Deny")
        && referenceComplete && releaseComplete && identitiesComplete,
      "CAAS_KUBERNETES_SUPPLY_CHAIN_POLICY_MISSING", "stable Kyverno release-image policy, embedded runtime identities, or pinned trust anchor is absent or not fail-closed");
    }
    if (this.config.routing.mode === "gateway-api") {
      const gateway = await this.#get(`/apis/gateway.networking.k8s.io/v1/namespaces/${encodePath(this.config.routing.parentRef.namespace)}/gateways/${encodePath(this.config.routing.parentRef.name)}`, { signal });
      const generation = gateway?.metadata?.generation;
      assertCaas(conditionTrue(gateway?.status?.conditions, "Accepted", generation)
        && conditionTrue(gateway?.status?.conditions, "Programmed", generation),
      "CAAS_KUBERNETES_GATEWAY_NOT_READY", "Approved Gateway API parent is not accepted and programmed");
      for (const sectionName of [this.config.routing.protocolSectionName, this.config.routing.dataPlaneSectionName]) {
        const listener = gateway.spec?.listeners?.find((value) => value.name === sectionName);
        const listenerStatus = gateway.status?.listeners?.find((value) => value.name === sectionName);
        const selector = listener?.allowedRoutes?.namespaces?.selector?.matchLabels;
        assertCaas(listener?.protocol === "HTTPS"
          && listener.allowedRoutes?.namespaces?.from === "Selector"
          && selector?.[GATEWAY_ACCESS_LABEL] === this.config.routing.gatewayAccessLabelValue
          && conditionTrue(listenerStatus?.conditions, "Accepted", generation)
          && conditionTrue(listenerStatus?.conditions, "Programmed", generation),
        "CAAS_KUBERNETES_GATEWAY_LISTENER_NOT_READY", `Approved Gateway listener is unavailable or has an unsafe namespace policy: ${sectionName}`);
      }
    }
    return true;
  }

  provision(tenant, operationKey, options = {}) {
    return this.#converge(tenant, operationKey, "PROVISIONED", options);
  }

  deprovision(tenant, operationKey, options = {}) {
    return this.#converge(tenant, operationKey, "DEPROVISIONED", options);
  }

  suspend(tenant, operationKey, options = {}) {
    return this.#converge(tenant, operationKey, "SUSPENDED", options);
  }

  delete(tenant, operationKey, options = {}) {
    return this.#converge(tenant, operationKey, "DELETED", options);
  }

  async observe(tenant, operationKey, { signal, fencingToken, expectedLastAppliedFencingToken } = {}) {
    throwIfAborted(signal);
    const expectedToken = fencingToken ?? expectedLastAppliedFencingToken;
    const fence = await this.#get(this.#fencePath(tenant.tenantId), { signal, missing: true });
    if (!fence) return this.#emptyObservation(tenant);
    const lastToken = fence.data?.fencingToken ?? null;
    if (expectedToken !== null && expectedToken !== undefined && BigInt(lastToken ?? 0) > BigInt(expectedToken)) {
      throw new CaaSError("CAAS_RECONCILE_FENCE_LOST", "Kubernetes target has accepted a newer fencing token");
    }
    const namespaceName = kubeName(this.config.namespacePrefix, tenant.tenantId);
    const namespace = await this.#get(`/api/v1/namespaces/${encodePath(namespaceName)}`, { signal, missing: true });
    if (namespace) assertCaas(ownedBy(namespace, this.config, tenant.tenantId),
      "CAAS_KUBERNETES_OWNERSHIP_CONFLICT", "observed tenant namespace is not owned by this CaaS instance");
    const receiptMatches = fence.data?.phase === "APPLIED"
      && fence.data?.operationKey === operationKey
      && fence.data?.generation === String(tenant.generation)
      && fence.data?.desiredState === tenant.desiredState;
    let converged = false;
    let exists = false;
    if (fence.data?.desiredState === "PROVISIONED" && namespace) {
      exists = true;
      const deployments = await Promise.all(["control-plane", "data-plane"].map((component) => this.#get(
        `/apis/apps/v1/namespaces/${encodePath(namespaceName)}/deployments/edc-${component}`,
        { signal, missing: true },
      )));
      let routesReady = true;
      let schemaReady = true;
      if (tenant.connectorPlanSnapshot?.databaseSchema) {
        const descriptor = databaseDescriptor(this.config, tenant);
        const [receipt, databaseSecret] = await Promise.all([
          this.#get(`/api/v1/namespaces/${encodePath(namespaceName)}/configmaps/edc-schema-ready`, { signal, missing: true }),
          this.#get(`/api/v1/namespaces/${encodePath(namespaceName)}/secrets/${encodePath(descriptor.secretName)}`, { signal, missing: true }),
        ]);
        let evidence = null;
        try { if (databaseSecret) evidence = validateDatabaseSecret(databaseSecret, descriptor); } catch { evidence = null; }
        const schema = tenant.connectorPlanSnapshot.databaseSchema;
        schemaReady = Boolean(receipt && evidence
          && receipt.metadata?.annotations?.[DIGEST_ANNOTATION] === fence.data.intentDigest
          && receipt.metadata?.annotations?.[FENCE_ANNOTATION] === lastToken
          && receipt.metadata?.annotations?.[SCHEMA_VERSION_ANNOTATION] === schema.requiredVersion
          && receipt.metadata?.annotations?.[SCHEMA_ARTIFACT_ANNOTATION] === schema.migrationArtifact.sha256
          && receipt.data?.requiredVersion === schema.requiredVersion
          && receipt.data?.migrationArtifactSha256 === schema.migrationArtifact.sha256
          && receipt.data?.databaseSecretUid === evidence.uid
          && receipt.data?.databaseSecretResourceVersion === evidence.resourceVersion
          && receipt.data?.databaseSecretSha256 === evidence.sha256);
      }
      if (this.config.routing.mode === "gateway-api") {
        const routes = await Promise.all(["edc-dsp", "edc-data"].map((name) => this.#get(
          `/apis/gateway.networking.k8s.io/v1/namespaces/${encodePath(namespaceName)}/httproutes/${name}`,
          { signal, missing: true },
        )));
        routesReady = routes.every((value) => value
          && value.metadata?.annotations?.[DIGEST_ANNOTATION] === fence.data.intentDigest
          && value.metadata?.annotations?.[FENCE_ANNOTATION] === lastToken
          && routeAccepted(value, this.config.routing));
      }
      converged = receiptMatches && routesReady && schemaReady && deployments.every((value) => value
        && value.metadata?.annotations?.[DIGEST_ANNOTATION] === fence.data.intentDigest
        && value.metadata?.annotations?.[FENCE_ANNOTATION] === lastToken
        && value.status?.observedGeneration === value.metadata?.generation
        && (value.status?.availableReplicas ?? 0) >= (value.spec?.replicas ?? 0));
    } else if (["SUSPENDED", "DEPROVISIONED"].includes(fence.data?.desiredState) && namespace) {
        const deployments = await Promise.all(["control-plane", "data-plane"].map((component) => this.#get(
          `/apis/apps/v1/namespaces/${encodePath(namespaceName)}/deployments/edc-${component}`,
          { signal, missing: true },
        )));
        converged = receiptMatches && deployments.every((value) => value?.spec?.replicas === 0 && (value.status?.availableReplicas ?? 0) === 0);
        exists = true;
    } else if (["DELETED", "DEPROVISIONED"].includes(fence.data?.desiredState)) {
      converged = receiptMatches && !namespace;
    }
    return {
      adapterResourceId: exists ? `kubernetes:namespace/${namespaceName}` : null,
      intentDigest: fence.data?.intentDigest ?? null,
      exists,
      converged,
      operationKey: fence.data?.operationKey ?? null,
      generation: Number.isSafeInteger(Number(fence.data?.generation)) ? Number(fence.data.generation) : null,
      desiredState: ["PROVISIONED", "SUSPENDED", "DELETED", "DEPROVISIONED"].includes(fence.data?.desiredState) ? fence.data.desiredState : null,
      lastAppliedFencingToken: lastToken,
    };
  }

  async listOrphans(activeTenantIds, { signal } = {}) {
    activeTenantIds.forEach(validateTenantId);
    const active = new Set(activeTenantIds);
    const response = await this.api.get("/api/v1/namespaces", {
      signal,
      query: { labelSelector: `app.kubernetes.io/managed-by=${MANAGED_BY},${INSTANCE_LABEL}=${this.config.instanceId}` },
    });
    return (response.items ?? [])
      .map((item) => item.metadata?.labels?.[TENANT_LABEL])
      .filter((tenantId) => TENANT_ID.test(tenantId ?? "") && !active.has(tenantId))
      .sort();
  }

  async reclaimOrphan(tenantId, { fencingToken, holderId, signal } = {}) {
    validateTenantId(tenantId);
    const tenant = {
      tenantId,
      generation: 0,
      desiredState: "DELETED",
      connectorPlanDigest: "orphan-recovery",
      deploymentSecretRefs: {},
    };
    const operationKey = createHash("sha256").update(`molit-caas-orphan\0${tenantId}\0${fencingToken}`).digest("hex");
    const intent = desiredDocument(this.config, tenant, operationKey, "DELETED");
    const intentDigest = digest(intent);
    await this.#claimFence(tenantId, { fencingToken, holderId, operationKey, generation: 0, desiredState: "DELETED", intentDigest }, { signal });
    await this.#deleteNamespace(tenantId, fencingToken, { signal });
    await this.#recordReceipt(tenantId, fencingToken, { operationKey, generation: 0, desiredState: "DELETED", intentDigest, phase: "APPLIED" }, { signal });
    return { tenantId, fencingToken, reclaimed: true };
  }

  async #converge(tenantInput, operationKey, desiredState, { signal, fencingToken, holderId } = {}) {
    throwIfAborted(signal);
    validateTenantId(tenantInput?.tenantId);
    assertCaas(SHA256.test(operationKey ?? "") && Number.isSafeInteger(tenantInput?.generation) && tenantInput.generation >= 0,
      "CAAS_KUBERNETES_COMMAND_INVALID", "Kubernetes command key or generation is invalid");
    requiredFencingToken(fencingToken);
    if (this.config.routing.mode === "gateway-api") {
      let endpoint;
      try { endpoint = new URL(tenantInput.endpoint); } catch { endpoint = null; }
      assertCaas(endpoint?.protocol === "https:"
        && endpoint.hostname === routeHostname(this.config.routing.protocolHostnameTemplate, tenantInput.tenantId),
      "CAAS_KUBERNETES_ROUTE_ENDPOINT_MISMATCH", "Connector endpoint does not match the approved Gateway API protocol hostname policy");
    }
    const tenant = { ...structuredClone(tenantInput), operationKey, fencingToken };
    const intent = desiredDocument(this.config, tenant, operationKey, desiredState);
    const intentDigest = digest(intent);
    const command = { fencingToken, holderId, operationKey, generation: tenant.generation, desiredState, intentDigest };
    await this.#claimFence(tenant.tenantId, command, { signal });
    const snapshots = [];
    try {
      if (desiredState === "DELETED" || (desiredState === "DEPROVISIONED" && this.config.deprovisionPolicy === "delete")) {
        await this.#deleteNamespace(tenant.tenantId, fencingToken, { signal });
      } else {
        const resources = desiredResources(this.config, tenant, desiredState, intentDigest);
        if (desiredState === "PROVISIONED" && tenant.connectorPlanSnapshot?.databaseSchema) {
          const runtimeKinds = new Set(["Deployment", "PodDisruptionBudget", "HTTPRoute"]);
          const foundation = resources.filter((resource) => !runtimeKinds.has(resource.kind));
          const runtime = resources.filter((resource) => runtimeKinds.has(resource.kind));
          for (const resource of foundation) snapshots.push(await this.#apply(resource, fencingToken, { signal }));
          await this.#quiesceExistingDeployments(tenant, runtime.filter((resource) => resource.kind === "Deployment"), fencingToken, snapshots, { signal });
          const namespace = kubeName(this.config.namespacePrefix, tenant.tenantId);
          const secretEvidence = await this.#waitForDatabaseSecret(tenant, namespace, { signal });
          const annotations = foundation[0].metadata.annotations;
          const job = schemaMigrationJob(this.config, tenant, namespace, annotations, intentDigest);
          snapshots.push(await this.#apply(job, fencingToken, { signal }));
          const migration = await this.#waitForMigrationJob(tenant, job, fencingToken, { signal });
          await this.#assertDatabaseSecretUnchanged(tenant, namespace, secretEvidence, { signal });
          snapshots.push(await this.#apply(schemaReadyReceipt(this.config, tenant, namespace, annotations, secretEvidence, migration), fencingToken, { signal }));
          for (const resource of runtime) snapshots.push(await this.#apply(resource, fencingToken, { signal }));
        } else {
          for (const resource of resources) snapshots.push(await this.#apply(resource, fencingToken, { signal }));
        }
      }
      await this.#recordReceipt(tenant.tenantId, fencingToken, { ...command, phase: "APPLIED" }, { signal });
      const observation = await this.observe(tenant, operationKey, { signal, fencingToken });
      return {
        adapterResourceId: `kubernetes:namespace/${kubeName(this.config.namespacePrefix, tenant.tenantId)}`,
        intentDigest,
        converged: observation.converged,
        fencingAccepted: true,
        fencingToken,
        observedGeneration: observation.generation,
      };
    } catch (error) {
      let rollbackError;
      try { await this.#rollback(snapshots, tenant.tenantId, fencingToken, { signal }); } catch (failure) { rollbackError = failure; }
      await this.#recordReceipt(tenant.tenantId, fencingToken, { ...command, phase: "FAILED", errorCode: boundedErrorCode(error) }, { signal }).catch(() => {});
      if (rollbackError) throw new CaaSError("CAAS_KUBERNETES_ROLLBACK_FAILED", "Kubernetes apply and rollback both failed", { details: { applyError: boundedErrorCode(error), rollbackError: boundedErrorCode(rollbackError) } });
      throw error;
    }
  }

  async #waitForDatabaseSecret(tenant, namespace, { signal } = {}) {
    const descriptor = databaseDescriptor(this.config, tenant);
    assertCaas(descriptor, "CAAS_KUBERNETES_DATABASE_BINDING_MISSING", "database schema descriptor is absent");
    const deadline = Date.now() + descriptor.schema.migrationTimeoutMs;
    const path = `/api/v1/namespaces/${encodePath(namespace)}/secrets/${encodePath(descriptor.secretName)}`;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const secret = await this.#get(path, { signal, missing: true });
      if (secret) return validateDatabaseSecret(secret, descriptor);
      await sleep(descriptor.schema.pollIntervalMs, undefined, { signal });
    }
    throw new CaaSError("CAAS_KUBERNETES_DATABASE_SECRET_TIMEOUT", "immutable EDC database Secret did not become available before the migration deadline");
  }

  async #quiesceExistingDeployments(tenant, deployments, fencingToken, snapshots, { signal } = {}) {
    const schema = tenant.connectorPlanSnapshot.databaseSchema;
    const quiesced = [];
    for (const desired of deployments) {
      const { item } = resourceCollection(desired);
      const current = await this.#get(item, { signal, missing: true });
      if (!current) continue;
      const scaled = structuredClone(desired);
      scaled.spec.replicas = 0;
      snapshots.push(await this.#apply(scaled, fencingToken, { signal }));
      quiesced.push(item);
    }
    const deadline = Date.now() + schema.migrationTimeoutMs;
    while (quiesced.length && Date.now() < deadline) {
      await this.#assertFence(tenant.tenantId, fencingToken, { signal });
      const values = await Promise.all(quiesced.map((path) => this.#get(path, { signal })));
      if (values.every((value) => value.spec?.replicas === 0
        && value.status?.observedGeneration === value.metadata?.generation
        && (value.status?.availableReplicas ?? 0) === 0)) return;
      await sleep(schema.pollIntervalMs, undefined, { signal });
    }
    assertCaas(quiesced.length === 0, "CAAS_KUBERNETES_SCHEMA_QUIESCE_TIMEOUT", "existing EDC workloads did not quiesce before schema migration");
  }

  async #assertDatabaseSecretUnchanged(tenant, namespace, expected, { signal } = {}) {
    const descriptor = databaseDescriptor(this.config, tenant);
    const path = `/api/v1/namespaces/${encodePath(namespace)}/secrets/${encodePath(descriptor.secretName)}`;
    const actual = validateDatabaseSecret(await this.#get(path, { signal }), descriptor);
    assertCaas(actual.uid === expected.uid && actual.resourceVersion === expected.resourceVersion && actual.sha256 === expected.sha256,
      "CAAS_KUBERNETES_DATABASE_SECRET_CHANGED", "EDC database Secret changed between schema validation and runtime rollout");
    return actual;
  }

  async #waitForMigrationJob(tenant, job, fencingToken, { signal } = {}) {
    const schema = tenant.connectorPlanSnapshot.databaseSchema;
    const { item } = resourceCollection(job);
    const deadline = Date.now() + schema.migrationTimeoutMs;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      await this.#assertFence(tenant.tenantId, fencingToken, { signal });
      const current = await this.#get(item, { signal, missing: true });
      assertCaas(current && ownedBy(current, this.config, tenant.tenantId)
        && current.metadata?.annotations?.[FENCE_ANNOTATION] === fencingToken
        && current.metadata?.annotations?.[SCHEMA_VERSION_ANNOTATION] === schema.requiredVersion
        && current.metadata?.annotations?.[SCHEMA_ARTIFACT_ANNOTATION] === schema.migrationArtifact.sha256,
      "CAAS_KUBERNETES_SCHEMA_MIGRATION_INVALID", "EDC schema migration Job identity or fencing metadata changed");
      const failed = (current.status?.failed ?? 0) > 0
        || (current.status?.conditions ?? []).some((condition) => condition.type === "Failed" && condition.status === "True");
      if (failed) throw new CaaSError("CAAS_KUBERNETES_SCHEMA_MIGRATION_FAILED", "EDC schema migration or version verification failed");
      const complete = (current.status?.succeeded ?? 0) >= 1
        && (current.status?.conditions ?? []).some((condition) => condition.type === "Complete" && condition.status === "True");
      if (complete) return current;
      await sleep(schema.pollIntervalMs, undefined, { signal });
    }
    throw new CaaSError("CAAS_KUBERNETES_SCHEMA_MIGRATION_TIMEOUT", "EDC schema migration did not complete before its bounded deadline");
  }

  #emptyObservation(tenant) {
    return { adapterResourceId: null, intentDigest: null, exists: false, converged: false, operationKey: null, generation: null, desiredState: null, lastAppliedFencingToken: null };
  }

  #fenceName(tenantId) { return kubeName("tenant-fence-", tenantId); }
  #fencePath(tenantId) { return `/api/v1/namespaces/${encodePath(this.config.controlNamespace)}/configmaps/${encodePath(this.#fenceName(tenantId))}`; }

  async #claimFence(tenantId, command, { signal } = {}) {
    const token = requiredFencingToken(command.fencingToken);
    const path = this.#fencePath(tenantId);
    const collection = `/api/v1/namespaces/${encodePath(this.config.controlNamespace)}/configmaps`;
    for (let attempt = 0; attempt < RETRY_LIMIT; attempt += 1) {
      throwIfAborted(signal);
      const current = await this.#get(path, { signal, missing: true });
      if (current) assertCaas(ownedBy(current, this.config, tenantId),
        "CAAS_KUBERNETES_OWNERSHIP_CONFLICT", "Kubernetes fencing record is not owned by this CaaS instance");
      const currentToken = BigInt(current?.data?.fencingToken ?? 0);
      if (currentToken > token) throw new CaaSError("CAAS_RECONCILE_FENCE_LOST", "Kubernetes target has accepted a newer fencing token");
      if (currentToken === token) {
        assertCaas(current.data?.operationKey === command.operationKey
          && current.data?.generation === String(command.generation)
          && current.data?.desiredState === command.desiredState
          && current.data?.intentDigest === command.intentDigest,
        "CAAS_KUBERNETES_FENCE_CONFLICT", "fencing token is already bound to a different Kubernetes command");
        return current;
      }
      const body = {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: {
          name: this.#fenceName(tenantId),
          namespace: this.config.controlNamespace,
          ...(current ? { resourceVersion: current.metadata.resourceVersion } : {}),
          labels: { "app.kubernetes.io/managed-by": MANAGED_BY, [TENANT_LABEL]: tenantId, [INSTANCE_LABEL]: this.config.instanceId },
          annotations: {
            [FENCE_ANNOTATION]: command.fencingToken,
            [OPERATION_ANNOTATION]: command.operationKey,
            [GENERATION_ANNOTATION]: String(command.generation),
            [DIGEST_ANNOTATION]: command.intentDigest,
            [DESIRED_ANNOTATION]: command.desiredState,
          },
        },
        data: {
          fencingToken: command.fencingToken,
          holderId: command.holderId ?? "unknown",
          operationKey: command.operationKey,
          generation: String(command.generation),
          desiredState: command.desiredState,
          intentDigest: command.intentDigest,
          phase: "CLAIMED",
        },
      };
      try {
        return current
          ? await this.api.replace(path, body, { signal })
          : await this.api.create(collection, body, { signal });
      } catch (error) {
        if (!(error instanceof KubernetesApiError) || error.status !== 409) throw error;
      }
    }
    throw new CaaSError("CAAS_KUBERNETES_CAS_EXHAUSTED", "Kubernetes fencing CAS retry limit was exhausted");
  }

  async #assertFence(tenantId, fencingToken, { signal } = {}) {
    const current = await this.#get(this.#fencePath(tenantId), { signal });
    if (current.data?.fencingToken !== fencingToken) throw new CaaSError("CAAS_RECONCILE_FENCE_LOST", "Kubernetes target fencing token changed during reconciliation");
    return current;
  }

  async #recordReceipt(tenantId, fencingToken, receipt, { signal } = {}) {
    const path = this.#fencePath(tenantId);
    for (let attempt = 0; attempt < RETRY_LIMIT; attempt += 1) {
      const current = await this.#assertFence(tenantId, fencingToken, { signal });
      const body = structuredClone(current);
      body.data = {
        ...body.data,
        operationKey: receipt.operationKey,
        generation: String(receipt.generation),
        desiredState: receipt.desiredState,
        intentDigest: receipt.intentDigest,
        phase: receipt.phase,
        ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
      };
      try { return await this.api.replace(path, body, { signal }); } catch (error) {
        if (!(error instanceof KubernetesApiError) || error.status !== 409) throw error;
      }
    }
    throw new CaaSError("CAAS_KUBERNETES_CAS_EXHAUSTED", "Kubernetes receipt CAS retry limit was exhausted");
  }

  async #apply(desired, fencingToken, { signal } = {}) {
    const tenantId = desired.metadata.labels[TENANT_LABEL];
    const { collection, item } = resourceCollection(desired);
    for (let attempt = 0; attempt < RETRY_LIMIT; attempt += 1) {
      await this.#assertFence(tenantId, fencingToken, { signal });
      const current = await this.#get(item, { signal, missing: true });
      if (current) assertCaas(ownedBy(current, this.config, tenantId),
        "CAAS_KUBERNETES_OWNERSHIP_CONFLICT", "refusing to adopt an existing Kubernetes resource");
      if (current && resourceToken(current) > BigInt(fencingToken)) throw new CaaSError("CAAS_RECONCILE_FENCE_LOST", "managed Kubernetes resource carries a newer fencing token");
      const body = current ? replacementBody(current, desired) : structuredClone(desired);
      try {
        const result = current
          ? await this.api.replace(item, body, { signal })
          : await this.api.create(collection, body, { signal });
        await this.#assertFence(tenantId, fencingToken, { signal });
        return { path: item, collection, before: current ? withoutServerFields(current) : null, applied: result };
      } catch (error) {
        if (!(error instanceof KubernetesApiError) || error.status !== 409) throw error;
      }
    }
    throw new CaaSError("CAAS_KUBERNETES_CAS_EXHAUSTED", `Kubernetes resource CAS retry limit was exhausted for ${desired.kind}`);
  }

  async #rollback(snapshots, tenantId, fencingToken, { signal } = {}) {
    for (const snapshot of [...snapshots].reverse()) {
      await this.#assertFence(tenantId, fencingToken, { signal });
      const current = await this.#get(snapshot.path, { signal, missing: true });
      if (!current) continue;
      if (resourceToken(current) > BigInt(fencingToken)) throw new CaaSError("CAAS_RECONCILE_FENCE_LOST", "newer Kubernetes state prevents rollback");
      if (snapshot.before === null) {
        await this.api.delete(snapshot.path, { apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid: current.metadata.uid, resourceVersion: current.metadata.resourceVersion } }, { signal });
        continue;
      }
      const body = structuredClone(snapshot.before);
      body.metadata.resourceVersion = current.metadata.resourceVersion;
      body.metadata.annotations = {
        ...body.metadata.annotations,
        [FENCE_ANNOTATION]: fencingToken,
        [OPERATION_ANNOTATION]: current.metadata.annotations?.[OPERATION_ANNOTATION],
        [GENERATION_ANNOTATION]: current.metadata.annotations?.[GENERATION_ANNOTATION],
        [DIGEST_ANNOTATION]: current.metadata.annotations?.[DIGEST_ANNOTATION],
        [DESIRED_ANNOTATION]: current.metadata.annotations?.[DESIRED_ANNOTATION],
      };
      await this.api.replace(snapshot.path, body, { signal });
    }
  }

  async #deleteNamespace(tenantId, fencingToken, { signal } = {}) {
    const fence = await this.#assertFence(tenantId, fencingToken, { signal });
    const name = kubeName(this.config.namespacePrefix, tenantId);
    const path = `/api/v1/namespaces/${encodePath(name)}`;
    let current = await this.#get(path, { signal, missing: true });
    if (!current) return;
    assertCaas(current.metadata?.labels?.[TENANT_LABEL] === tenantId
      && current.metadata?.labels?.[INSTANCE_LABEL] === this.config.instanceId
      && current.metadata?.labels?.["app.kubernetes.io/managed-by"] === MANAGED_BY,
    "CAAS_KUBERNETES_OWNERSHIP_CONFLICT", "refusing to delete a namespace not owned by this CaaS instance");
    if (resourceToken(current) > BigInt(fencingToken)) throw new CaaSError("CAAS_RECONCILE_FENCE_LOST", "tenant namespace carries a newer fencing token");
    const synchronized = withoutServerFields(current);
    synchronized.metadata.resourceVersion = current.metadata.resourceVersion;
    synchronized.metadata.annotations = {
      ...synchronized.metadata.annotations,
      [FENCE_ANNOTATION]: fencingToken,
      [OPERATION_ANNOTATION]: fence.data.operationKey,
      [GENERATION_ANNOTATION]: fence.data.generation,
      [DIGEST_ANNOTATION]: fence.data.intentDigest,
      [DESIRED_ANNOTATION]: fence.data.desiredState,
    };
    current = await this.api.replace(path, synchronized, { signal });
    await this.#assertFence(tenantId, fencingToken, { signal });
    await this.api.delete(path, { apiVersion: "v1", kind: "DeleteOptions", propagationPolicy: "Foreground", preconditions: { uid: current.metadata.uid, resourceVersion: current.metadata.resourceVersion } }, { signal });
    await this.#assertFence(tenantId, fencingToken, { signal });
  }

  async #get(path, { signal, missing = false } = {}) {
    try { return await this.api.get(path, { signal }); } catch (error) {
      if (missing && error instanceof KubernetesApiError && error.status === 404) return null;
      throw error;
    }
  }
}

export function createKubernetesEdcProvisioner({ id, config, api }) {
  const client = api ?? new KubernetesApiClient({
    apiServer: config.apiServer,
    tokenFile: config.authentication.tokenFile,
    caFile: config.authentication.caFile,
    requestTimeoutMs: config.requestTimeoutMs,
  });
  return new KubernetesEdcProvisioner({ id, config, api: client });
}

export const kubernetesProvisionerContract = Object.freeze({
  annotations: Object.freeze({ fencingToken: FENCE_ANNOTATION, operationKey: OPERATION_ANNOTATION, generation: GENERATION_ANNOTATION, digest: DIGEST_ANNOTATION, desiredState: DESIRED_ANNOTATION }),
  labels: Object.freeze({ tenant: TENANT_LABEL, instance: INSTANCE_LABEL }),
});
