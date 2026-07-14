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

const stateErrorStatuses = Object.freeze({
  CAAS_RECONCILE_FENCE_LOST: 409,
  CAAS_STATE_LOCKED: 409,
  CAAS_TENANT_BUSY: 409,
  CAAS_STATE_TOO_LARGE: 507,
  CAAS_STATE_ABORTED: 503,
  CAAS_STATE_CLOSED: 503,
  CAAS_STATE_COMMIT_UNKNOWN: 503,
  CAAS_STATE_MIGRATION_REQUIRED: 503,
  CAAS_STATE_MISSING: 503,
  CAAS_STATE_TIMEOUT: 503,
  CAAS_STATE_UNAVAILABLE: 503,
});

export function createCaaSHttpServer({ config, service, authorizer }) {
  let ready = true;
  let closing = false;
  let closePromise = null;
  const requestControllers = new Set();
  const sockets = new Set();
  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
    const writeRequest = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
    const requestController = new AbortController();
    requestControllers.add(requestController);
    const abortRequest = (reason) => {
      if (!requestController.signal.aborted) requestController.abort(reason);
    };
    const timeoutError = () => new CaaSError("CAAS_REQUEST_TIMEOUT", "request timed out", { status: 408 });
    const deadlineTimer = setTimeout(() => abortRequest(timeoutError()), config.limits.requestTimeoutMs);
    deadlineTimer?.unref();
    request.setTimeout(config.limits.requestTimeoutMs, () => {
      const error = timeoutError();
      abortRequest(error);
      request.destroy(error);
    });
    request.once("aborted", () => abortRequest(new CaaSError("CAAS_REQUEST_ABORTED", "client aborted the request", { status: 408 })));
    response.once("close", () => {
      if (!response.writableFinished) abortRequest(new CaaSError("CAAS_REQUEST_ABORTED", "client closed the response", { status: 408 }));
    });
    try {
      rejectDuplicateSecurityHeaders(request);
      const url = new URL(request.url, "http://caas.invalid");
      assertCaas(url.origin === "http://caas.invalid" && !url.search && !url.hash, "CAAS_ROUTE_INVALID", "request target is invalid", { status: 400 });
      if (request.method === "GET" && url.pathname === "/healthz") { requireNoBody(request); return send(response, 200, { status: closing ? "stopping" : "alive" }); }
      if (request.method === "GET" && url.pathname === "/readyz") {
        requireNoBody(request);
        if (!ready || closing) return send(response, 503, { status: "not-ready" }, { connection: "close" });
        try { return send(response, 200, { status: "ready", ...(await service.readiness({ signal: requestController.signal })) }); }
        catch { return send(response, 503, { status: "not-ready" }); }
      }
      if (closing && writeRequest) {
        return send(response, 503, { error: { code: "CAAS_SHUTTING_DOWN", message: "CaaS is draining and does not accept management writes" } }, { connection: "close" });
      }
      if (request.method === "POST" && url.pathname === "/v1/tenants") {
        const actor = authorizer.admin(request.headers.authorization);
        return send(response, 201, await service.register(await readJson(request, config.limits.maxRequestBytes), requestKey(request), actor, { signal: requestController.signal }));
      }
      if (request.method === "POST" && url.pathname === "/v1/connectors/ensure") {
        const actor = authorizer.controller(request.headers.authorization);
        return send(response, 200, await service.ensureConnector(await readJson(request, config.limits.maxRequestBytes), requestKey(request), actor, { signal: requestController.signal }));
      }
      if (request.method === "GET" && url.pathname === "/v1/audit") {
        requireNoBody(request);
        authorizer.admin(request.headers.authorization);
        return send(response, 200, await service.audit(undefined, { signal: requestController.signal }));
      }
      const match = /^\/v1\/tenants\/([a-z][a-z0-9-]{2,62})(?:\/(desired-state|reconcile|audit))?$/u.exec(url.pathname);
      if (match) {
        const [, tenantId, operation] = match;
        const actor = await authorizer.tenant(request.headers.authorization, tenantId, { signal: requestController.signal });
        if (!operation && request.method === "GET") { requireNoBody(request); return send(response, 200, await service.getTenant(tenantId, { signal: requestController.signal })); }
        if (operation === "desired-state" && request.method === "PUT") return send(response, 200, await service.setDesiredState(tenantId, await readJson(request, config.limits.maxRequestBytes), requestKey(request), actor, { signal: requestController.signal }));
        if (operation === "reconcile" && request.method === "POST") { requireNoBody(request); return send(response, 200, await service.reconcile(tenantId, requestKey(request), actor, { signal: requestController.signal })); }
        if (operation === "audit" && request.method === "GET") { requireNoBody(request); return send(response, 200, await service.audit(tenantId, { signal: requestController.signal })); }
        throw new CaaSError("CAAS_METHOD_NOT_ALLOWED", "method is not allowed for this resource", { status: 405 });
      }
      throw new CaaSError("CAAS_NOT_FOUND", "resource was not found", { status: 404 });
    } catch (error) {
      if (response.headersSent) return response.destroy();
      const stateStatus = stateErrorStatuses[error?.code];
      const known = error instanceof CaaSError || stateStatus !== undefined;
      const status = error instanceof CaaSError ? error.status : stateStatus ?? 500;
      return send(response, status, { error: { code: known ? error.code : "CAAS_INTERNAL_ERROR", message: known ? error.message : "internal control-plane error" } }, status === 401 ? { "www-authenticate": "Bearer" } : {});
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      requestControllers.delete(requestController);
    }
  });
  server.requestTimeout = config.limits.requestTimeoutMs;
  server.headersTimeout = config.limits.requestTimeoutMs;
  server.keepAliveTimeout = Math.min(5_000, config.limits.requestTimeoutMs);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  Object.defineProperties(server, {
    caasSetReady: {
      value(value) {
        if (value && closing) throw new CaaSError("CAAS_SHUTTING_DOWN", "CaaS readiness cannot be restored during shutdown", { status: 503 });
        ready = value === true;
      },
    },
    caasBeginDrain: {
      value() {
        ready = false;
        closing = true;
      },
    },
    closeGracefully: {
      value({ deadline: requestedDeadline, timeoutMs = config.limits.gracefulShutdownMs ?? 10_000 } = {}) {
        if (closePromise) return closePromise;
        server.caasBeginDrain();
        const budgetMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 10_000;
        const deadline = Number.isFinite(requestedDeadline) ? Math.max(0, requestedDeadline) : Date.now() + budgetMs;
        const serverDrain = server.listening
          ? new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
          : Promise.resolve();
        server.closeIdleConnections?.();
        closePromise = (async () => {
          let timer;
          const remainingMs = Math.max(0, deadline - Date.now());
          const outcome = remainingMs === 0
            ? { timedOut: true }
            : await Promise.race([
              serverDrain.then(() => ({ timedOut: false })),
              new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), remainingMs); }),
            ]);
          clearTimeout(timer);
          if (!outcome.timedOut) return;
          const reason = new CaaSError("CAAS_SHUTTING_DOWN", "CaaS shutdown deadline expired", { status: 503 });
          for (const controller of requestControllers) controller.abort(reason);
          for (const socket of sockets) socket.destroy();
        })();
        return closePromise;
      },
    },
  });
  return server;
}
