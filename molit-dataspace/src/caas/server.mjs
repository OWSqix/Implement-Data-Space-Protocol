import { createServer } from "node:http";
import { CaaSError, assertCaas } from "./errors.mjs";

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

function send(response, status, value, extra = {}) {
  const body = status === 204 ? Buffer.alloc(0) : Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, { ...securityHeaders, ...extra, "content-type": "application/json; charset=utf-8", "content-length": body.length });
  response.end(body);
}

async function readJson(request, limit) {
  assertCaas(/^application\/json(?:\s*;|$)/iu.test(request.headers["content-type"] ?? ""), "CAAS_CONTENT_TYPE_REQUIRED", "Content-Type must be application/json", { status: 415 });
  const declared = Number(request.headers["content-length"]);
  assertCaas(!Number.isFinite(declared) || declared <= limit, "CAAS_REQUEST_TOO_LARGE", "request body exceeds its byte limit", { status: 413 });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw new CaaSError("CAAS_REQUEST_TOO_LARGE", "request body exceeds its byte limit", { status: 413 });
    chunks.push(chunk);
  }
  assertCaas(bytes > 0, "CAAS_BODY_REQUIRED", "JSON request body is required", { status: 400 });
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new CaaSError("CAAS_JSON_INVALID", "request body is not valid JSON", { status: 400 }); }
}

function requestKey(request) {
  return request.headers["idempotency-key"];
}

function rejectDuplicateSecurityHeaders(request) {
  for (const name of ["authorization", "idempotency-key", "content-type", "content-length", "transfer-encoding"]) {
    assertCaas((request.headersDistinct[name]?.length ?? 0) <= 1, "CAAS_DUPLICATE_HEADER", `duplicate ${name} header is forbidden`, { status: 400 });
  }
}

function requireNoBody(request) {
  assertCaas(!request.headers["transfer-encoding"] && Number(request.headers["content-length"] ?? 0) === 0, "CAAS_BODY_FORBIDDEN", "request body is not allowed for this route", { status: 400 });
}

export function createCaaSHttpServer({ config, service, authorizer }) {
  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
    request.setTimeout(config.limits.requestTimeoutMs, () => request.destroy(new CaaSError("CAAS_REQUEST_TIMEOUT", "request timed out", { status: 408 })));
    try {
      rejectDuplicateSecurityHeaders(request);
      const url = new URL(request.url, "http://caas.invalid");
      assertCaas(url.origin === "http://caas.invalid" && !url.search && !url.hash, "CAAS_ROUTE_INVALID", "request target is invalid", { status: 400 });
      if (request.method === "GET" && url.pathname === "/healthz") { requireNoBody(request); return send(response, 200, { status: "alive" }); }
      if (request.method === "GET" && url.pathname === "/readyz") {
        requireNoBody(request);
        try { return send(response, 200, { status: "ready", ...(await service.readiness()) }); }
        catch { return send(response, 503, { status: "not-ready" }); }
      }
      if (request.method === "POST" && url.pathname === "/v1/tenants") {
        const actor = authorizer.admin(request.headers.authorization);
        return send(response, 201, await service.register(await readJson(request, config.limits.maxRequestBytes), requestKey(request), actor));
      }
      if (request.method === "POST" && url.pathname === "/v1/connectors/ensure") {
        const actor = authorizer.controller(request.headers.authorization);
        return send(response, 200, await service.ensureConnector(await readJson(request, config.limits.maxRequestBytes), requestKey(request), actor));
      }
      if (request.method === "GET" && url.pathname === "/v1/audit") {
        requireNoBody(request);
        authorizer.admin(request.headers.authorization);
        return send(response, 200, await service.audit());
      }
      const match = /^\/v1\/tenants\/([a-z][a-z0-9-]{2,62})(?:\/(desired-state|reconcile|audit))?$/u.exec(url.pathname);
      if (match) {
        const [, tenantId, operation] = match;
        const actor = await authorizer.tenant(request.headers.authorization, tenantId);
        if (!operation && request.method === "GET") { requireNoBody(request); return send(response, 200, await service.getTenant(tenantId)); }
        if (operation === "desired-state" && request.method === "PUT") return send(response, 200, await service.setDesiredState(tenantId, await readJson(request, config.limits.maxRequestBytes), requestKey(request), actor));
        if (operation === "reconcile" && request.method === "POST") { requireNoBody(request); return send(response, 200, await service.reconcile(tenantId, requestKey(request), actor)); }
        if (operation === "audit" && request.method === "GET") { requireNoBody(request); return send(response, 200, await service.audit(tenantId)); }
        throw new CaaSError("CAAS_METHOD_NOT_ALLOWED", "method is not allowed for this resource", { status: 405 });
      }
      throw new CaaSError("CAAS_NOT_FOUND", "resource was not found", { status: 404 });
    } catch (error) {
      if (response.headersSent) return response.destroy();
      const known = error instanceof CaaSError;
      return send(response, known ? error.status : 500, { error: { code: known ? error.code : "CAAS_INTERNAL_ERROR", message: known ? error.message : "internal control-plane error" } }, known && error.status === 401 ? { "www-authenticate": "Bearer" } : {});
    }
  });
  server.requestTimeout = config.limits.requestTimeoutMs;
  server.headersTimeout = config.limits.requestTimeoutMs;
  server.keepAliveTimeout = Math.min(5_000, config.limits.requestTimeoutMs);
  return server;
}
