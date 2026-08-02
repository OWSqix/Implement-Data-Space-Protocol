import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:https";
import { pathToFileURL } from "node:url";

const API_GROUP = "caas.data.molit.go.kr";
const MANAGED_BY = "molit-caas";
const FENCE_ANNOTATION = `${API_GROUP}/fencing-token`;
const TENANT_LABEL = `${API_GROUP}/tenant-id`;
const INSTANCE_LABEL = `${API_GROUP}/instance-id`;
const COMMAND_FIELDS = Object.freeze([
  ["operationKey", `${API_GROUP}/operation-key`],
  ["generation", `${API_GROUP}/generation`],
  ["intentDigest", `${API_GROUP}/intent-digest`],
  ["desiredState", `${API_GROUP}/desired-state`],
]);
const TENANT_ID = /^[a-z][a-z0-9-]{2,62}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_API_BYTES = 1024 * 1024;

function admissionResponse(uid, allowed, message) {
  return {
    apiVersion: "admission.k8s.io/v1",
    kind: "AdmissionReview",
    response: {
      uid,
      allowed,
      ...(allowed ? {} : { status: { code: 403, reason: "Forbidden", message } }),
    },
  };
}

function selectedResource(request) {
  return request.operation === "DELETE" ? request.oldObject : request.object;
}

function commandMatches(resource, fence) {
  const annotations = resource?.metadata?.annotations ?? {};
  return COMMAND_FIELDS.every(([field, annotation]) => (
    typeof annotations[annotation] === "string"
    && annotations[annotation] === fence?.data?.[field]
  ));
}

export async function validateFencingAdmission(review, { readFence }) {
  const request = review?.request;
  const uid = typeof request?.uid === "string" ? request.uid : "";
  if (!uid || !["CREATE", "UPDATE", "DELETE"].includes(request?.operation)) {
    return admissionResponse(uid, false, "Unsupported or malformed admission request.");
  }
  const resource = selectedResource(request);
  if (resource?.metadata?.labels?.["app.kubernetes.io/managed-by"] !== MANAGED_BY) {
    return admissionResponse(uid, true);
  }
  const tenantId = resource.metadata.labels?.[TENANT_LABEL];
  const instanceId = resource.metadata.labels?.[INSTANCE_LABEL];
  const resourceToken = resource.metadata.annotations?.[FENCE_ANNOTATION];
  if (!TENANT_ID.test(tenantId ?? "") || typeof instanceId !== "string" || instanceId.length === 0
      || !POSITIVE_INTEGER.test(resourceToken ?? "")) {
    return admissionResponse(uid, false, "Managed resources require valid tenant, instance, and fencing metadata.");
  }
  let fence;
  try {
    fence = await readFence(tenantId);
  } catch {
    return admissionResponse(uid, false, "The central fencing record could not be verified.");
  }
  const fenceToken = fence?.data?.fencingToken;
  const fenceOwned = fence?.metadata?.labels?.["app.kubernetes.io/managed-by"] === MANAGED_BY
    && fence.metadata.labels?.[TENANT_LABEL] === tenantId
    && fence.metadata.labels?.[INSTANCE_LABEL] === instanceId;
  if (!fenceOwned || !POSITIVE_INTEGER.test(fenceToken ?? "")) {
    return admissionResponse(uid, false, "The central fencing record is absent or has invalid ownership.");
  }
  if (resourceToken !== fenceToken || !commandMatches(resource, fence)) {
    return admissionResponse(uid, false, "The resource command does not match the current central fencing record.");
  }
  return admissionResponse(uid, true);
}

function readBoundedJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) request.destroy(new Error("admission body exceeded limit"));
      else chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("admission body is not valid JSON")); }
    });
  });
}

export function createInClusterFenceReader({ apiServer, tokenFile, caFile, controlNamespace, timeoutMs = 2_000 }) {
  const base = new URL(apiServer);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Kubernetes API server must be an HTTPS origin URL");
  }
  return async (tenantId) => {
    if (!TENANT_ID.test(tenantId)) throw new Error("invalid tenant identifier");
    const [tokenValue, ca] = await Promise.all([readFile(tokenFile, "utf8"), readFile(caFile)]);
    const token = tokenValue.trim();
    if (token.length < 16 || token.length > 16_384 || /[\s\u0000-\u001f\u007f]/u.test(token)) {
      throw new Error("invalid service account token");
    }
    const path = `/api/v1/namespaces/${encodeURIComponent(controlNamespace)}/configmaps/${encodeURIComponent(`tenant-fence-${tenantId}`)}`;
    return new Promise((resolve, reject) => {
      const request = httpsRequest(new URL(path, base), {
        method: "GET",
        ca,
        rejectUnauthorized: true,
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
      }, (response) => {
        const chunks = [];
        let length = 0;
        response.on("data", (chunk) => {
          length += chunk.length;
          if (length > MAX_API_BYTES) request.destroy(new Error("Kubernetes API response exceeded limit"));
          else chunks.push(chunk);
        });
        response.on("end", () => {
          if (response.statusCode !== 200) return reject(new Error(`Kubernetes API returned ${response.statusCode}`));
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { reject(new Error("Kubernetes API returned invalid JSON")); }
        });
      });
      request.setTimeout(timeoutMs, () => request.destroy(new Error("Kubernetes API request timed out")));
      request.on("error", reject);
      request.end();
    });
  };
}

export function createFencingWebhookServer({ tls, readFence }) {
  return createServer(tls, async (request, response) => {
    const pathname = new URL(request.url ?? "/", "https://webhook.invalid").pathname;
    if (request.method === "GET" && pathname === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    if (request.method !== "POST" || pathname !== "/validate"
        || !String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"not found"}');
      return;
    }
    let result;
    try {
      const review = await readBoundedJson(request);
      result = await validateFencingAdmission(review, { readFence });
    } catch {
      result = admissionResponse("", false, "The admission request could not be evaluated.");
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
  });
}

export async function startFencingWebhook(environment = process.env) {
  const required = (name) => {
    const value = environment[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const port = Number(environment.MOLIT_FENCING_WEBHOOK_PORT ?? "8443");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("invalid webhook port");
  const readFence = createInClusterFenceReader({
    apiServer: environment.MOLIT_KUBERNETES_API_SERVER ?? "https://kubernetes.default.svc/",
    tokenFile: environment.MOLIT_KUBERNETES_TOKEN_FILE ?? "/var/run/secrets/kubernetes.io/serviceaccount/token",
    caFile: environment.MOLIT_KUBERNETES_CA_FILE ?? "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
    controlNamespace: environment.MOLIT_FENCING_CONTROL_NAMESPACE ?? "molit-caas-system",
    timeoutMs: Number(environment.MOLIT_FENCING_API_TIMEOUT_MS ?? "2000"),
  });
  const [cert, key] = await Promise.all([
    readFile(required("MOLIT_FENCING_TLS_CERT_FILE")),
    readFile(required("MOLIT_FENCING_TLS_KEY_FILE")),
  ]);
  const server = createFencingWebhookServer({ tls: { cert, key, minVersion: "TLSv1.2" }, readFence });
  server.listen(port, "0.0.0.0");
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFencingWebhook().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
