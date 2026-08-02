import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { randomUUID } from "node:crypto";
import { managementAccountingTenant, managementOperation } from "../observability/index.mjs";
import { rejectUntrustedPresentedClientCertificate } from "../identity/tls-runtime.mjs";
import { recordHttpDenial } from "../control-store/http-denial-audit.mjs";
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
  CAAS_CAPACITY: 503,
  CAAS_IDENTITY_COLLISION: 409,
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

function correlatedActor(actor, span, correlationId) {
  if (!span) return { ...actor, correlationId };
  return { ...actor, correlationId, traceId: span.context.traceId, traceContext: span.context };
}

export function createCaaSHttpServer({ config, service, authorizer, tlsRuntime = null, tracer = null, telemetry = null, operationalTelemetry = null, observabilityReadiness = null, tenantAccessStore = null, usageRecorder = null }) {
  assertCaas(config.environment !== "production" || tlsRuntime?.readiness().ready === true,
    "CAAS_PRODUCTION_TLS_REQUIRED", "production CaaS requires a valid directly terminated TLS context", { status: 500 });
  let ready = true;
  let closing = false;
  let closePromise = null;
  const requestControllers = new Set();
  const requestFinalizers = new Set();
  const sockets = new Set();
  const handleRequest = async (request, response) => {
    const requestId = randomUUID();
    response.setHeader("x-request-id", requestId);
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
    let span = null;
    let requestActor = null;
    let requestAuthenticated = false;
    let requestedTenantId = null;
    let requestPath = request.url?.split("?", 1)[0] ?? "/";
    const startedAt = process.hrtime.bigint();
    response.once("finish", () => telemetry?.log("INFO", "caas.access", {
      "http.request.method": request.method,
      "http.response.status_code": response.statusCode,
      "http.route": request.url?.split("?", 1)[0] ?? null,
      "molit.request.id": requestId,
      "molit.trace.id": span?.context.traceId ?? null,
      "molit.duration.ms": Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3)),
    }));
    try {
      rejectUntrustedPresentedClientCertificate(request);
      rejectDuplicateSecurityHeaders(request);
      const url = new URL(request.url, "http://caas.invalid");
      requestPath = url.pathname;
      assertCaas(url.origin === "http://caas.invalid" && !url.search && !url.hash, "CAAS_ROUTE_INVALID", "request target is invalid", { status: 400 });
      const tenantMatch = /^\/v1\/tenants\/([a-z][a-z0-9-]{2,62})(?:\/|$)/u.exec(url.pathname);
      requestedTenantId = tenantMatch?.[1] ?? null;
      span = tracer?.startIncomingSpan("caas.http.request", request.headers, {
        attributes: { "http.request.method": request.method, "http.route": url.pathname, "molit.request.id": requestId },
        tenantId: tenantMatch?.[1],
      });
      if (span) response.setHeader("traceparent", span.outboundHeaders({}).traceparent);
      if (request.method === "GET" && url.pathname === "/healthz") { requireNoBody(request); return send(response, 200, { status: closing ? "stopping" : "alive" }); }
      if (request.method === "GET" && url.pathname === "/readyz") {
        requireNoBody(request);
        const tlsReadiness = tlsRuntime?.readiness();
        const observation = await observabilityReadiness?.({ signal: requestController.signal });
        if (!ready || closing || (tlsReadiness && !tlsReadiness.ready) || (observation && !observation.ready)) return send(response, 503, { status: "not-ready", ...(tlsReadiness ? { tls: tlsReadiness } : {}), ...(observation ? { observability: observation } : {}) }, { connection: "close" });
        try { return send(response, 200, { status: "ready", ...(await service.readiness({ signal: requestController.signal })), ...(tlsReadiness ? { tls: tlsReadiness } : {}), ...(observation ? { observability: observation } : {}) }); }
        catch { return send(response, 503, { status: "not-ready" }); }
      }
      if (closing && writeRequest) {
        return send(response, 503, { error: { code: "CAAS_SHUTTING_DOWN", message: "CaaS is draining and does not accept management writes" } }, { connection: "close" });
      }
      if (request.method === "POST" && url.pathname === "/v1/tenants") {
        const actor = correlatedActor(await authorizer.admin(request, { signal: requestController.signal }), span, requestId);
        requestAuthenticated = true;
        requestActor = actor;
        const body = await readJson(request, config.limits.maxRequestBytes);
        requestedTenantId = typeof body?.tenantId === "string" ? body.tenantId : null;
        return send(response, 201, await service.register(body, requestKey(request), actor, { signal: requestController.signal }));
      }
      if (request.method === "POST" && url.pathname === "/v1/connectors/ensure") {
        const body = await readJson(request, config.limits.maxRequestBytes);
        requestedTenantId = typeof body?.caasTenantId === "string" ? body.caasTenantId : requestedTenantId;
        const actor = correlatedActor(await authorizer.controller(request, { signal: requestController.signal, tenantId: body.caasTenantId }), span, requestId);
        requestAuthenticated = true;
        requestActor = actor;
        return send(response, 200, await service.ensureConnector(body, requestKey(request), actor, { signal: requestController.signal }));
      }
      if (request.method === "GET" && url.pathname === "/v1/audit") {
        requireNoBody(request);
        requestActor = await authorizer.admin(request, { signal: requestController.signal });
        requestAuthenticated = true;
        return send(response, 200, await service.audit(undefined, { signal: requestController.signal }));
      }
      const match = /^\/v1\/tenants\/([a-z][a-z0-9-]{2,62})(?:\/(desired-state|upgrade|rollback|reconcile|audit))?$/u.exec(url.pathname);
      if (match) {
        const [, tenantId, operation] = match;
        const actor = correlatedActor(await authorizer.tenant(request, tenantId, { signal: requestController.signal }), span, requestId);
        requestAuthenticated = true;
        requestActor = actor;
        if (!operation && request.method === "GET") { requireNoBody(request); return send(response, 200, await service.getTenant(tenantId, { signal: requestController.signal })); }
        if (operation === "desired-state" && request.method === "PUT") return send(response, 200, await service.setDesiredState(tenantId, await readJson(request, config.limits.maxRequestBytes), requestKey(request), actor, { signal: requestController.signal }));
        if (operation === "upgrade" && request.method === "POST") return send(response, 202, await service.upgrade(tenantId, await readJson(request, config.limits.maxRequestBytes), requestKey(request), actor, { signal: requestController.signal }));
        if (operation === "rollback" && request.method === "POST") return send(response, 202, await service.rollback(tenantId, await readJson(request, config.limits.maxRequestBytes), requestKey(request), actor, { signal: requestController.signal }));
        if (operation === "reconcile" && request.method === "POST") { requireNoBody(request); return send(response, 200, await service.reconcile(tenantId, requestKey(request), actor, { signal: requestController.signal })); }
        if (operation === "audit" && request.method === "GET") { requireNoBody(request); return send(response, 200, await service.audit(tenantId, { signal: requestController.signal })); }
        throw new CaaSError("CAAS_METHOD_NOT_ALLOWED", "method is not allowed for this resource", { status: 405 });
      }
      throw new CaaSError("CAAS_NOT_FOUND", "resource was not found", { status: 404 });
    } catch (error) {
      let rejectedError = error;
      try {
        await recordHttpDenial({
          actor: requestActor,
          component: "caas",
          error,
          method: request.method,
          path: requestPath,
          requestId,
          store: tenantAccessStore,
          tenantId: requestedTenantId,
          traceId: span?.context.traceId,
        });
      } catch (auditError) {
        rejectedError = auditError;
      }
      telemetry?.log(response.statusCode >= 500 ? "ERROR" : "WARN", "caas.request_rejected", {
        "error.code": rejectedError?.code ?? "INTERNAL_ERROR",
        "molit.request.id": requestId,
        "molit.trace.id": span?.context.traceId ?? null,
      });
      if (response.headersSent) return response.destroy();
      const stateStatus = stateErrorStatuses[rejectedError?.code];
      const identityError = typeof rejectedError?.code === "string" && rejectedError.code.startsWith("IDENTITY_") && Number.isInteger(rejectedError.status);
      const known = rejectedError instanceof CaaSError || stateStatus !== undefined || identityError;
      const status = rejectedError instanceof CaaSError || identityError ? rejectedError.status : stateStatus ?? 500;
      if (["CAAS_FORBIDDEN", "CAAS_TENANT_MISMATCH"].includes(rejectedError?.code)) requestAuthenticated = true;
      return send(response, status, { error: { code: known ? rejectedError.code : "CAAS_INTERNAL_ERROR", message: known ? rejectedError.message : "internal control-plane error" } }, status === 401 ? { "www-authenticate": "Bearer" } : {});
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      const usageOperation = requestAuthenticated ? managementOperation("caas", request.method, requestPath) : null;
      const accountingTenantId = usageOperation ? managementAccountingTenant({
        authenticated: true,
        requestedTenantId,
        statusCode: response.statusCode,
      }) : null;
      let usagePromise = Promise.resolve();
      if (span && usageRecorder && usageOperation && accountingTenantId) {
        try {
          usagePromise = Promise.resolve(usageRecorder.record({
            tenantId: accountingTenantId,
            operation: usageOperation,
            statusCode: response.statusCode,
            requestId,
            traceId: span.context.traceId,
            spanId: span.context.spanId,
            signal: requestController.signal,
          })).catch((error) => telemetry?.log("ERROR", "caas.usage_meter_failed", { "error.code": error?.code ?? "OBS_USAGE_RECORD_FAILED", "molit.request.id": requestId }));
        } catch (error) {
          telemetry?.log("ERROR", "caas.usage_meter_failed", { "error.code": error?.code ?? "OBS_USAGE_RECORD_FAILED", "molit.request.id": requestId });
        }
      }
      if (span) {
        await span.end({
          status: response.statusCode >= 500 ? "ERROR" : "OK",
          ...(response.statusCode >= 400 ? { message: `HTTP ${response.statusCode}` } : {}),
          attributes: { "http.response.status_code": response.statusCode },
          signal: requestController.signal,
        }).catch((error) => telemetry?.log("ERROR", "caas.trace_export_failed", { "error.code": error?.code ?? "OBS_TRACE_EXPORT_FAILED", "molit.request.id": requestId }));
      }
      if (span && operationalTelemetry) {
        await operationalTelemetry.recordRequest({
          tenantId: requestedTenantId ?? "molit-platform",
          operation: "caas.http.request",
          statusCode: response.statusCode,
          durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
          correlationId: requestId,
          traceId: span.context.traceId,
          spanId: span.context.spanId,
          signal: requestController.signal,
        }).catch((error) => telemetry?.log("ERROR", "caas.telemetry_export_failed", { "error.code": error?.code ?? "OBS_EXPORT_FAILED", "molit.request.id": requestId }));
      }
      await usagePromise;
      requestControllers.delete(requestController);
    }
  };
  const handler = (request, response) => {
    const finalizer = handleRequest(request, response);
    requestFinalizers.add(finalizer);
    void finalizer.catch((error) => {
      telemetry?.log("ERROR", "caas.request_finalizer_failed", {
        "error.code": error?.code ?? "CAAS_FINALIZER_FAILED",
        "molit.request.id": response.getHeader("x-request-id") ?? null,
      });
      if (!response.destroyed && !response.writableFinished) response.destroy(error);
    }).finally(() => requestFinalizers.delete(finalizer));
  };
  const drainRequestFinalizers = async () => {
    while (requestFinalizers.size > 0) await Promise.allSettled([...requestFinalizers]);
  };
  const server = tlsRuntime
    ? createHttpsServer({ ...tlsRuntime.serverOptions(), maxHeaderSize: 16 * 1024 }, handler)
    : createHttpServer({ maxHeaderSize: 16 * 1024 }, handler);
  if (tlsRuntime) tlsRuntime.attach(server);
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
        const finalizerDrain = serverDrain.then(drainRequestFinalizers);
        server.closeIdleConnections?.();
        closePromise = (async () => {
          let timer;
          const remainingMs = Math.max(0, deadline - Date.now());
          const outcome = remainingMs === 0
            ? { timedOut: true }
            : await Promise.race([
              finalizerDrain.then(() => ({ timedOut: false })),
              new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), remainingMs); }),
            ]);
          clearTimeout(timer);
          if (outcome.timedOut) {
            const reason = new CaaSError("CAAS_SHUTTING_DOWN", "CaaS shutdown deadline expired", { status: 503 });
            for (const controller of requestControllers) controller.abort(reason);
            for (const socket of sockets) socket.destroy();
          }
          await tlsRuntime?.close();
        })();
        return closePromise;
      },
    },
  });
  return server;
}
