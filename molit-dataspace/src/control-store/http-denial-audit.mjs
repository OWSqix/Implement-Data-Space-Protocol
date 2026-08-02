import { digest } from "../discovery/stable-json.mjs";

const TENANT_ID = /^[a-z][a-z0-9-]{2,62}$/u;
const REASON_CODE = /^[A-Z][A-Z0-9_:-]{2,63}$/u;

function reasonCode(error) {
  const candidate = typeof error?.code === "string"
    ? error.code.toUpperCase().replaceAll(/[^A-Z0-9_:-]/gu, "_")
    : "HTTP_REQUEST_DENIED";
  return REASON_CODE.test(candidate) ? candidate : "HTTP_REQUEST_DENIED";
}

function reportedMode(actor) {
  if (actor?.role === "tenant") return "tenant";
  if (Array.isArray(actor?.roles)
    && actor.roles.some((role) => ["dsaas.dataspace-admin", "dsaas.auditor"].includes(role))) return "tenant";
  return "service";
}

export async function recordHttpDenial({
  actor,
  component,
  error,
  method,
  path,
  requestId,
  store,
  tenantId,
  traceId,
}) {
  if (!store) return null;
  const requestedTenantId = TENANT_ID.test(error?.details?.tenantId ?? "")
    ? error.details.tenantId
    : TENANT_ID.test(tenantId ?? "") ? tenantId : "molit-platform";
  const actorId = actor?.principalId ?? actor?.subject ?? `anonymous:${requestId}`;
  const actorKind = actor ? (reportedMode(actor) === "tenant" ? "user" : "service") : "user";
  return store.recordDenial({
    accessMode: "service",
    actorId,
    actorKind,
    correlationId: requestId,
    tenantId: "molit-platform",
    traceId: /^[a-f0-9]{32}$/u.test(traceId ?? "") ? traceId : digest({ requestId }).slice(0, 32),
  }, {
    reasonCode: reasonCode(error),
    reportedAccessMode: reportedMode(actor),
    requestedTenantId,
    resourceId: `http:${String(method ?? "unknown").toLowerCase()}:${digest({ path }).slice(0, 32)}`,
    resourceKind: `${component}-http-request`,
  });
}
