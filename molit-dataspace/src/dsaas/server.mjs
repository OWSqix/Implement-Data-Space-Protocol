import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { managementAccountingTenant, managementOperation } from "../observability/index.mjs";

import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { validateRequestTarget } from "../publication/server.mjs";
import { authorizationChallenge } from "./auth.mjs";
import { rejectUntrustedPresentedClientCertificate } from "../identity/tls-runtime.mjs";
import { recordHttpDenial } from "../control-store/http-denial-audit.mjs";

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Cross-Origin-Resource-Policy": "same-site",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

const STATUS = Object.freeze({
  DSAAS_ALREADY_EXISTS: 409,
  DSAAS_APPROVAL_REGISTRY_DIGEST_MISMATCH: 503,
  DSAAS_APPROVAL_REGISTRY_DUPLICATE: 503,
  DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED: 503,
  DSAAS_APPROVAL_REGISTRY_STALE: 503,
  DSAAS_APPROVAL_REVALIDATION_FAILED: 503,
  DSAAS_APPROVAL_EVIDENCE_MISMATCH: 409,
  DSAAS_APPROVAL_DECISION_EXPIRED: 409,
  DSAAS_APPROVAL_DECISION_MISMATCH: 409,
  DSAAS_APPROVAL_DECISION_NOT_APPROVED: 409,
  DSAAS_APPROVAL_DECISION_NOT_TRUSTED: 409,
  DSAAS_EXTERNAL_APPROVAL_GATE_BLOCKED: 503,
  DSAAS_APPROVAL_INVALID: 422,
  DSAAS_APPROVAL_STATE_INVALID: 409,
  DSAAS_AUTH_CONFIGURATION_ERROR: 503,
  DSAAS_AUTH_UNAVAILABLE: 503,
  DSAAS_BODY_FORBIDDEN: 400,
  DSAAS_CAPACITY: 503,
  DSAAS_CONTRACT_INVALID: 422,
  DSAAS_FORBIDDEN: 403,
  DSAAS_FOUR_EYES_REQUIRED: 409,
  DSAAS_IDEMPOTENCY_CAPACITY: 503,
  DSAAS_IDEMPOTENCY_CONFLICT: 409,
  DSAAS_IDEMPOTENCY_KEY_REQUIRED: 400,
  DSAAS_CONNECTOR_PLAN_NOT_APPROVED: 422,
  DSAAS_CONNECTOR_PLAN_MISMATCH: 422,
  DSAAS_DESIRED_STATE_INVALID: 422,
  DSAAS_GOVERNANCE_NOT_APPROVED: 422,
  DSAAS_IDENTITY_MODE_NOT_APPROVED: 422,
  DSAAS_METHOD_NOT_ALLOWED: 405,
  DSAAS_NAMESPACE_NOT_APPROVED: 422,
  DSAAS_NOT_FOUND: 404,
  DSAAS_PARTICIPANT_CAPACITY: 503,
  DSAAS_PARTICIPANT_EXISTS: 409,
  DSAAS_PARTICIPANT_IDENTIFIER_CONFLICT: 409,
  DSAAS_PARTICIPANT_NOT_FOUND: 404,
  DSAAS_PROFILE_NOT_APPROVED: 422,
  DSAAS_RECONCILE_IN_PROGRESS: 409,
  DSAAS_RECONCILE_FENCE_LOST: 503,
  DSAAS_RECONCILE_SUPERSEDED: 409,
  DSAAS_REQUEST_ABORTED: 408,
  DSAAS_REQUEST_TIMEOUT: 408,
  DSAAS_REVISION_CONFLICT: 409,
  DSAAS_REVISION_REQUIRED: 428,
  DSAAS_STATE_LOCKED: 503,
  DSAAS_STATE_ABORTED: 503,
  DSAAS_STATE_CLOSED: 503,
  DSAAS_STATE_COMMIT_UNKNOWN: 503,
  DSAAS_STATE_MIGRATION_REQUIRED: 503,
  DSAAS_STATE_MISSING: 503,
  DSAAS_STATE_TIMEOUT: 503,
  DSAAS_STATE_TOO_LARGE: 507,
  DSAAS_STATE_UNAVAILABLE: 503,
  DSAAS_SECRET_MATERIAL_FORBIDDEN: 422,
  DSAAS_SHUTTING_DOWN: 503,
  DSAAS_SERVICE_REGISTRY_DIGEST_MISMATCH: 503,
  DSAAS_SERVICE_REGISTRY_DUPLICATE: 503,
  DSAAS_SERVICE_REGISTRY_REFRESH_FAILED: 503,
  DSAAS_SERVICE_REGISTRY_STALE: 503,
  DSAAS_TOKEN_INVALID: 401,
  DSAAS_UNAUTHENTICATED: 401,
  DSAAS_URI_COMPONENT_FORBIDDEN: 422,
  DSAAS_URI_INVALID: 422,
});

const REGISTRY_UNAVAILABLE = new Set([
  "DSAAS_APPROVAL_REGISTRY_DIGEST_MISMATCH",
  "DSAAS_APPROVAL_REGISTRY_DUPLICATE",
  "DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED",
  "DSAAS_APPROVAL_REGISTRY_STALE",
  "DSAAS_APPROVAL_REVALIDATION_FAILED",
  "DSAAS_EXTERNAL_APPROVAL_GATE_BLOCKED",
  "DSAAS_SERVICE_REGISTRY_DIGEST_MISMATCH",
  "DSAAS_SERVICE_REGISTRY_DUPLICATE",
  "DSAAS_SERVICE_REGISTRY_REFRESH_FAILED",
  "DSAAS_SERVICE_REGISTRY_STALE",
]);

const STATE_RETRYABLE = new Set([
  "DSAAS_RECONCILE_FENCE_LOST",
  "DSAAS_STATE_ABORTED",
  "DSAAS_STATE_CLOSED",
  "DSAAS_STATE_COMMIT_UNKNOWN",
  "DSAAS_STATE_TIMEOUT",
  "DSAAS_STATE_UNAVAILABLE",
]);

function applyHeaders(response, requestId) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  response.setHeader("X-Request-Id", requestId);
}

function json(request, response, status, value, revision, contentType = "application/json; charset=utf-8") {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", bytes.length);
  if (revision !== undefined) response.setHeader("ETag", `"${revision}"`);
  if (request.method === "HEAD") response.end();
  else response.end(bytes);
}

function problem(request, response, status, code, message, requestId) {
  if (status === 401) authorizationChallenge(response);
  json(request, response, status, { code, message, requestId, status }, undefined, "application/problem+json; charset=utf-8");
}

function headerValues(request, name) {
  const values = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === name) values.push(request.rawHeaders[index + 1]);
  }
  return values;
}

function hostAllowed(request, allowedHosts) {
  const values = headerValues(request, "host");
  return values.length === 1 && allowedHosts.some((host) => host.toLowerCase() === values[0].toLowerCase());
}

function requireNoBody(request) {
  const transferEncodings = headerValues(request, "transfer-encoding");
  const lengths = headerValues(request, "content-length");
  assertRuntime(transferEncodings.length === 0 && lengths.length <= 1, "DSAAS_BODY_FORBIDDEN", "request body is not allowed for this route");
  const declared = lengths.length === 0 ? 0 : Number(lengths[0]);
  assertRuntime(Number.isSafeInteger(declared) && declared === 0, "DSAAS_BODY_FORBIDDEN", "request body is not allowed for this route");
}

async function readJson(request, maxBytes) {
  const contentTypes = headerValues(request, "content-type");
  assertRuntime(contentTypes.length === 1 && /^application\/json(?:\s*;.*)?$/iu.test(contentTypes[0]), "DSAAS_CONTENT_TYPE_REQUIRED", "Content-Type must be application/json");
  const lengths = headerValues(request, "content-length");
  if (lengths.length > 1) throw new RuntimeError("DSAAS_REQUEST_INVALID", "multiple Content-Length headers are forbidden");
  const declared = lengths.length === 1 ? Number(lengths[0]) : null;
  assertRuntime(declared === null || (Number.isSafeInteger(declared) && declared >= 0 && declared <= maxBytes), "DSAAS_REQUEST_TOO_LARGE", "request body exceeds the configured byte limit");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      request.destroy();
      throw new RuntimeError("DSAAS_REQUEST_TOO_LARGE", "request body exceeds the configured byte limit");
    }
    chunks.push(chunk);
  }
  assertRuntime(bytes > 0, "DSAAS_REQUEST_INVALID", "request body is empty");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new RuntimeError("DSAAS_REQUEST_INVALID", "request body is not valid JSON"); }
}

function idempotencyKey(request) {
  const values = headerValues(request, "idempotency-key");
  assertRuntime(values.length === 1, "DSAAS_IDEMPOTENCY_KEY_REQUIRED", "exactly one Idempotency-Key is required");
  return values[0];
}

function expectedRevision(request) {
  const values = headerValues(request, "if-match");
  assertRuntime(values.length === 1, "DSAAS_REVISION_REQUIRED", "exactly one If-Match revision is required");
  const match = /^"([1-9][0-9]*)"$/u.exec(values[0]);
  assertRuntime(match && Number.isSafeInteger(Number(match[1])), "DSAAS_REVISION_REQUIRED", "If-Match must contain one quoted positive integer revision");
  return Number(match[1]);
}

function identifier(value) {
  assertRuntime(/^[a-z][a-z0-9-]{2,62}$/u.test(value), "DSAAS_REQUEST_INVALID", "resource identifier is invalid");
  return value;
}

function correlatedActor(actor, span, correlationId) {
  if (!span) return { ...actor, correlationId };
  return { ...actor, correlationId, traceId: span.context.traceId, traceContext: span.context };
}

export function createDsaasServer({ config, controlPlane, authenticator, scheduler, telemetry, tlsRuntime = null, tracer = null, operationalTelemetry = null, observabilityReadiness = null, tenantAccessStore = null, usageRecorder = null }) {
  let ready = true;
  let started = false;
  let starting = false;
  let closing = false;
  let closePromise = null;
  let lifecycleEpoch = 0;
  const sockets = new Set();
  const requestControllers = new Set();
  const requestFinalizers = new Set();
  const handleRequest = async (request, response) => {
    const requestController = new AbortController();
    requestControllers.add(requestController);
    const abortRequest = (reason) => {
      if (!requestController.signal.aborted) requestController.abort(reason);
    };
    const deadlineTimer = setTimeout(() => {
      abortRequest(new RuntimeError("DSAAS_REQUEST_TIMEOUT", "request timed out"));
    }, config.limits.requestTimeoutMs);
    deadlineTimer.unref();
    requestController.signal.addEventListener("abort", () => {
      if (!request.complete && !request.destroyed) request.destroy(requestController.signal.reason);
    }, { once: true });
    request.once("aborted", () => abortRequest(new RuntimeError("DSAAS_REQUEST_ABORTED", "client aborted the request")));
    response.once("close", () => {
      if (!response.writableFinished) abortRequest(new RuntimeError("DSAAS_REQUEST_ABORTED", "client closed the response"));
    });
    const requestId = randomUUID();
    let span = null;
    let requestActor = null;
    let requestAuthenticated = false;
    let requestedTenantId = null;
    let requestPath = request.url?.split("?", 1)[0] ?? "/";
    const startedAt = process.hrtime.bigint();
    applyHeaders(response, requestId);
    response.once("finish", () => telemetry?.log("INFO", "dsaas.access", {
      "http.request.method": request.method,
      "http.response.status_code": response.statusCode,
      "http.route": request.url?.split("?", 1)[0] ?? null,
      "molit.request.id": requestId,
      "molit.trace.id": span?.context.traceId ?? null,
      "molit.duration.ms": Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3)),
    }));
    try {
      rejectUntrustedPresentedClientCertificate(request);
      if (!hostAllowed(request, config.allowedHosts)) throw new RuntimeError("DSAAS_HOST_NOT_ALLOWED", "request Host is not allowed");
      if (!validateRequestTarget(request.url, 4096)) throw new RuntimeError("DSAAS_REQUEST_INVALID", "request target is malformed or unsafe");
      const target = new URL(request.url, config.publicOrigin);
      requestPath = target.pathname;
      assertRuntime(target.search === "", "DSAAS_REQUEST_INVALID", "query parameters are not supported");
      const tenantMatch = /^\/v1\/dataspaces\/([a-z][a-z0-9-]{2,62})(?:\/|$)/u.exec(target.pathname);
      requestedTenantId = tenantMatch?.[1] ?? null;
      span = tracer?.startIncomingSpan("dsaas.http.request", request.headers, {
        attributes: { "http.request.method": request.method, "http.route": target.pathname, "molit.request.id": requestId },
        tenantId: tenantMatch?.[1],
      });
      if (span) response.setHeader("traceparent", span.outboundHeaders({}).traceparent);
      if (["/healthz", "/readyz"].includes(target.pathname)) {
        assertRuntime(request.method === "GET", "DSAAS_METHOD_NOT_ALLOWED", "health endpoints support GET only");
        requireNoBody(request);
      }
      if (target.pathname === "/healthz") {
        json(request, response, 200, { ready, status: "ok" });
        return;
      }
      if (target.pathname === "/readyz") {
        if (!ready) {
          json(request, response, 503, { ready: false, status: "stopping" });
          return;
        }
        const localReadiness = await controlPlane.readiness({ signal: requestController.signal });
        const tlsReadiness = tlsRuntime?.readiness();
        const observation = await observabilityReadiness?.({ signal: requestController.signal });
        const schedulerReadiness = scheduler?.readiness();
        const available = localReadiness.ready && (schedulerReadiness?.ready ?? true) && (tlsReadiness?.ready ?? true) && (observation?.ready ?? true);
        const failureCodes = [...localReadiness.failureCodes];
        if (schedulerReadiness && !schedulerReadiness.ready) {
          const schedulerFailures = [schedulerReadiness.lastFatalErrorCode, ...(schedulerReadiness.lastFailureCodes ?? [])].filter(Boolean);
          failureCodes.push(...(schedulerFailures.length > 0 ? schedulerFailures : ["DSAAS_RECONCILE_SCHEDULER_NOT_READY"]));
        }
        const uniqueFailureCodes = [...new Set(failureCodes)].sort();
        if (!available && uniqueFailureCodes.some((code) => REGISTRY_UNAVAILABLE.has(code))) response.setHeader("Retry-After", "60");
        json(request, response, available ? 200 : 503, {
          ...localReadiness,
          ready: available,
          checks: {
            ...localReadiness.checks,
            ...(schedulerReadiness ? { reconcileScheduler: schedulerReadiness.status } : {}),
          },
          failureCodes: uniqueFailureCodes,
          ...(schedulerReadiness ? { scheduler: schedulerReadiness } : {}),
          ...(tlsReadiness ? { tls: tlsReadiness } : {}),
          ...(observation ? { observability: observation } : {}),
          status: available ? "ok" : "not-ready",
        });
        return;
      }
      if (closing) {
        response.setHeader("Connection", "close");
        problem(request, response, 503, "DSAAS_SHUTTING_DOWN", "DSaaS is draining and does not accept management requests", requestId);
        return;
      }
      const actor = correlatedActor(await authenticator.authenticate(request, { signal: requestController.signal }), span, requestId);
      requestAuthenticated = true;
      requestActor = actor;
      let match;
      if (request.method === "POST" && target.pathname === "/v1/dataspaces") {
        const body = await readJson(request, config.limits.maxRequestBytes);
        requestedTenantId = typeof body?.dataspaceId === "string" ? body.dataspaceId : null;
        const result = await controlPlane.createDataspace(body, actor, idempotencyKey(request), { signal: requestController.signal });
        json(request, response, 201, result, result.revision);
        return;
      }
      if ((match = /^\/v1\/dataspaces\/([^/]+)$/u.exec(target.pathname)) && request.method === "GET") {
        requireNoBody(request);
        const result = await controlPlane.getDataspace(identifier(decodeURIComponent(match[1])), actor, { signal: requestController.signal });
        json(request, response, 200, result, result.revision);
        return;
      }
      if ((match = /^\/v1\/dataspaces\/([^/]+)\/desired-state$/u.exec(target.pathname)) && request.method === "PUT") {
        const body = await readJson(request, config.limits.maxRequestBytes);
        assertRuntime(body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1 && typeof body.desiredState === "string", "DSAAS_REQUEST_INVALID", "desired-state body must contain only desiredState");
        const result = await controlPlane.setDesiredState(identifier(decodeURIComponent(match[1])), body.desiredState, expectedRevision(request), actor, idempotencyKey(request), { signal: requestController.signal });
        json(request, response, 200, result, result.revision);
        return;
      }
      if ((match = /^\/v1\/dataspaces\/([^/]+)\/reconcile$/u.exec(target.pathname)) && request.method === "POST") {
        requireNoBody(request);
        const result = await controlPlane.reconcile(identifier(decodeURIComponent(match[1])), actor, idempotencyKey(request), null, { signal: requestController.signal });
        json(request, response, 200, result, result.revision);
        return;
      }
      if ((match = /^\/v1\/dataspaces\/([^/]+)\/participants$/u.exec(target.pathname)) && request.method === "POST") {
        const result = await controlPlane.submitParticipant(identifier(decodeURIComponent(match[1])), await readJson(request, config.limits.maxRequestBytes), actor, idempotencyKey(request), { signal: requestController.signal });
        json(request, response, 201, result, result.revision);
        return;
      }
      if ((match = /^\/v1\/dataspaces\/([^/]+)\/participants\/([^/]+)$/u.exec(target.pathname)) && request.method === "GET") {
        requireNoBody(request);
        const result = await controlPlane.getParticipant(identifier(decodeURIComponent(match[1])), identifier(decodeURIComponent(match[2])), actor, { signal: requestController.signal });
        json(request, response, 200, result, result.revision);
        return;
      }
      if ((match = /^\/v1\/dataspaces\/([^/]+)\/participants\/([^/]+)\/approval$/u.exec(target.pathname)) && request.method === "POST") {
        const result = await controlPlane.approveParticipant(identifier(decodeURIComponent(match[1])), identifier(decodeURIComponent(match[2])), await readJson(request, config.limits.maxRequestBytes), actor, idempotencyKey(request), { signal: requestController.signal });
        json(request, response, 200, result, result.revision);
        return;
      }
      throw new RuntimeError("DSAAS_ROUTE_NOT_FOUND", "route does not exist");
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      let rejectedError = error;
      try {
        await recordHttpDenial({
          actor: requestActor,
          component: "dsaas",
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
      const identityStatus = typeof rejectedError?.code === "string" && rejectedError.code.startsWith("IDENTITY_") ? rejectedError.status : undefined;
      const status = identityStatus ?? STATUS[rejectedError?.code] ?? ({
        DSAAS_CONTENT_TYPE_REQUIRED: 415,
        DSAAS_HOST_NOT_ALLOWED: 421,
        DSAAS_REQUEST_INVALID: 400,
        DSAAS_REQUEST_TOO_LARGE: 413,
        DSAAS_ROUTE_NOT_FOUND: 404,
      }[rejectedError?.code] ?? 500);
      telemetry?.log(status >= 500 ? "ERROR" : "WARN", "dsaas.request_rejected", { "error.code": rejectedError?.code ?? "INTERNAL_ERROR", "molit.request.id": requestId, "molit.trace.id": span?.context.traceId ?? null });
      if (REGISTRY_UNAVAILABLE.has(rejectedError?.code)) response.setHeader("Retry-After", "60");
      else if (STATE_RETRYABLE.has(rejectedError?.code)) response.setHeader("Retry-After", "1");
      problem(request, response, status, status === 500 ? "DSAAS_INTERNAL_ERROR" : rejectedError.code, status === 500 ? "internal server error" : rejectedError.message, requestId);
    } finally {
      clearTimeout(deadlineTimer);
      const usageOperation = requestAuthenticated ? managementOperation("dsaas", request.method, requestPath) : null;
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
          })).catch((error) => telemetry?.log("ERROR", "dsaas.usage_meter_failed", { "error.code": error?.code ?? "OBS_USAGE_RECORD_FAILED", "molit.request.id": requestId }));
        } catch (error) {
          telemetry?.log("ERROR", "dsaas.usage_meter_failed", { "error.code": error?.code ?? "OBS_USAGE_RECORD_FAILED", "molit.request.id": requestId });
        }
      }
      if (span) {
        await span.end({
          status: response.statusCode >= 500 ? "ERROR" : "OK",
          ...(response.statusCode >= 400 ? { message: `HTTP ${response.statusCode}` } : {}),
          attributes: { "http.response.status_code": response.statusCode },
          signal: requestController.signal,
        }).catch((error) => telemetry?.log("ERROR", "dsaas.trace_export_failed", { "error.code": error?.code ?? "OBS_TRACE_EXPORT_FAILED", "molit.request.id": requestId }));
      }
      if (span && operationalTelemetry) {
        await operationalTelemetry.recordRequest({
          tenantId: requestedTenantId ?? "molit-platform",
          operation: "dsaas.http.request",
          statusCode: response.statusCode,
          durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
          correlationId: requestId,
          traceId: span.context.traceId,
          spanId: span.context.spanId,
          signal: requestController.signal,
        }).catch((error) => telemetry?.log("ERROR", "dsaas.telemetry_export_failed", { "error.code": error?.code ?? "OBS_EXPORT_FAILED", "molit.request.id": requestId }));
      }
      await usagePromise;
      requestControllers.delete(requestController);
    }
  };
  const handler = (request, response) => {
    const finalizer = handleRequest(request, response);
    requestFinalizers.add(finalizer);
    void finalizer.catch((error) => {
      telemetry?.log("ERROR", "dsaas.request_finalizer_failed", {
        "error.code": error?.code ?? "DSAAS_FINALIZER_FAILED",
        "molit.request.id": response.getHeader("x-request-id") ?? null,
      });
      if (!response.destroyed && !response.writableFinished) response.destroy(error);
    }).finally(() => requestFinalizers.delete(finalizer));
  };
  const drainRequestFinalizers = async () => {
    while (requestFinalizers.size > 0) await Promise.allSettled([...requestFinalizers]);
  };
  const server = tlsRuntime
    ? https.createServer({ ...tlsRuntime.serverOptions(), keepAlive: true, maxHeaderSize: 16_384, requireHostHeader: true }, handler)
    : http.createServer({ keepAlive: true, maxHeaderSize: 16_384, requireHostHeader: true }, handler);
  if (tlsRuntime) tlsRuntime.attach(server);
  server.headersTimeout = config.limits.headerTimeoutMs;
  server.requestTimeout = config.limits.requestTimeoutMs;
  server.keepAliveTimeout = config.limits.keepAliveTimeoutMs;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return Object.freeze({
    server,
    async start() {
      if (started || starting) throw new Error("DSaaS server is already started");
      starting = true;
      const epoch = ++lifecycleEpoch;
      ready = false;
      closing = false;
      closePromise = null;
      try {
        if (config.environment === "production") {
          assertRuntime(authenticator?.productionEligible === true, "DSAAS_PRODUCTION_AUTH_REQUIRED", "production DSaaS requires OAuth2 introspection authentication");
          assertRuntime(typeof authenticator.initialize === "function" && typeof authenticator.readiness === "function", "DSAAS_PRODUCTION_AUTH_REQUIRED", "production DSaaS requires an identity startup probe");
          await authenticator.initialize();
          const identity = await authenticator.readiness({ probe: false });
          assertRuntime(identity?.ready === true, "DSAAS_PRODUCTION_AUTH_NOT_READY", "production DSaaS cannot start while the identity provider is unavailable");
          assertRuntime(tlsRuntime?.readiness().ready === true, "DSAAS_PRODUCTION_TLS_REQUIRED", "production DSaaS requires a valid directly terminated TLS context");
          const localReadiness = await controlPlane.readiness();
          assertRuntime(localReadiness?.ready === true, "DSAAS_PRODUCTION_NOT_READY", "production DSaaS cannot start before all local readiness gates pass", { failureCodes: localReadiness?.failureCodes ?? [] });
          const observation = await observabilityReadiness?.();
          assertRuntime(observation?.ready === true, "DSAAS_OBSERVABILITY_NOT_READY", "production DSaaS cannot start before observability and usage delivery are ready");
        }
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(config.port, config.listenHost, () => {
            server.off("error", reject);
            if (closing || epoch !== lifecycleEpoch) {
              const error = new Error("DSaaS server start was cancelled by shutdown");
              error.code = "DSAAS_START_ABORTED";
              if (server.listening) server.close(() => {});
              reject(error);
              return;
            }
            started = true;
            resolve();
          });
        });
        if (closing || epoch !== lifecycleEpoch) {
          const error = new Error("DSaaS server start was cancelled by shutdown");
          error.code = "DSAAS_START_ABORTED";
          throw error;
        }
        await scheduler?.start();
        if (closing || epoch !== lifecycleEpoch) {
          const error = new Error("DSaaS server start was cancelled by shutdown");
          error.code = "DSAAS_START_ABORTED";
          throw error;
        }
        ready = true;
      } catch (error) {
        await scheduler?.stop({ timeoutMs: config.limits.gracefulShutdownMs });
        if (started) {
          await new Promise((resolve) => server.close(resolve));
          started = false;
        }
        throw error;
      } finally {
        starting = false;
      }
      return server.address();
    },
    async close({ deadline: requestedDeadline, timeoutMs = config.limits.gracefulShutdownMs } = {}) {
      if (closePromise) return closePromise;
      ready = false;
      closing = true;
      lifecycleEpoch += 1;
      const budgetMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : config.limits.gracefulShutdownMs;
      const deadline = Number.isFinite(requestedDeadline) ? Math.max(0, requestedDeadline) : Date.now() + budgetMs;
      const serverDrain = started || server.listening
        ? new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        })
        : Promise.resolve();
      const finalizerDrain = serverDrain.then(drainRequestFinalizers);
      server.closeIdleConnections?.();
      const schedulerDrain = Promise.resolve(scheduler?.stop({
        deadline,
        timeoutMs: Math.max(0, deadline - Date.now()),
      }));
      closePromise = (async () => {
        let timer;
        const drains = Promise.allSettled([schedulerDrain, finalizerDrain]);
        const remainingMs = Math.max(0, deadline - Date.now());
        const outcome = remainingMs === 0
          ? { timedOut: true }
          : await Promise.race([
            drains.then((results) => ({ results, timedOut: false })),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve({ timedOut: true }), remainingMs);
            }),
          ]);
        clearTimeout(timer);
        if (outcome.timedOut) {
          const reason = new RuntimeError("DSAAS_SHUTTING_DOWN", "DSaaS shutdown deadline expired");
          for (const controller of requestControllers) controller.abort(reason);
          for (const socket of sockets) socket.destroy();
        }
        await tlsRuntime?.close();
        started = false;
        const failure = outcome.results?.find(({ status }) => status === "rejected");
        if (failure) throw failure.reason;
      })();
      return closePromise;
    },
  });
}

export { SECURITY_HEADERS as DSAAS_SECURITY_HEADERS };
