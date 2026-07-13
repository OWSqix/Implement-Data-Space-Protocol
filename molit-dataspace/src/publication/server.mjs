import { randomUUID } from "node:crypto";
import http from "node:http";

import { selectContentNegotiationResponse } from "../profile/content-negotiation.mjs";
import { loadPublicationSnapshot } from "./snapshot.mjs";

const SECURITY_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

function applyBaseHeaders(response, requestId) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  response.setHeader("X-Request-Id", requestId);
}

function responseBody(status, code, message) {
  return Buffer.from(`${JSON.stringify({ code, message, status })}\n`, "utf8");
}

function endBytes(request, response, status, bytes, contentType = "application/problem+json") {
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", bytes.length);
  if (request.method === "HEAD") response.end();
  else response.end(bytes);
}

function endProblem(request, response, status, code, message) {
  endBytes(request, response, status, responseBody(status, code, message));
}

function requestHostValues(request) {
  const values = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === "host") values.push(request.rawHeaders[index + 1]);
  }
  return values;
}

function canonicalRequestAuthority(value) {
  if (typeof value !== "string" || /[/\\@\s]/u.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (!parsed.hostname || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

export function validateRequestTarget(rawTarget, maxLength) {
  if (typeof rawTarget !== "string" || rawTarget.length === 0 || rawTarget.length > maxLength
    || !rawTarget.startsWith("/") || rawTarget.startsWith("//") || rawTarget.includes("#")) {
    return false;
  }
  const rawPath = rawTarget.split("?", 1)[0];
  if (rawPath.includes("\\") || rawPath.includes("\0")) return false;
  for (const rawSegment of rawPath.split("/")) {
    let segment;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return false;
    }
    if (segment === "." || segment === ".." || /[/\\\0]/u.test(segment)) return false;
  }
  return true;
}

function hostAllowed(request, allowedHosts) {
  const values = requestHostValues(request);
  if (values.length !== 1) return false;
  const authority = canonicalRequestAuthority(values[0]);
  return authority !== null && allowedHosts.includes(authority);
}

function cacheControl(pathname, profileVersion) {
  const versionMarker = `/${profileVersion}`;
  return pathname === versionMarker || pathname.includes(`${versionMarker}/`)
    || pathname.endsWith(versionMarker)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300, must-revalidate";
}

function ifNoneMatchSatisfied(value, etag) {
  if (typeof value !== "string") return false;
  const target = etag.replace(/^W\//u, "");
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized.replace(/^W\//u, "") === target;
  });
}

function healthDocument(snapshot, ready) {
  return Buffer.from(`${JSON.stringify({
    profileVersion: snapshot.profileVersion,
    ready,
    status: ready ? "ok" : "stopping",
  })}\n`, "utf8");
}

export async function createNamespaceService({ config, logger = console }) {
  const snapshot = await loadPublicationSnapshot(config);
  let ready = true;
  let started = false;
  const sockets = new Set();

  const server = http.createServer({
    keepAlive: true,
    maxHeaderSize: 16_384,
    requireHostHeader: true,
  }, (request, response) => {
    const startedAt = process.hrtime.bigint();
    const requestId = randomUUID();
    applyBaseHeaders(response, requestId);
    response.once("finish", () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info?.(JSON.stringify({
        durationMs: Number(elapsedMs.toFixed(3)),
        event: "namespace.access",
        method: request.method,
        path: request.url?.split("?", 1)[0] ?? null,
        requestId,
        status: response.statusCode,
      }));
    });

    if (!hostAllowed(request, config.allowedHosts)) {
      endProblem(request, response, 421, "MISDIRECTED_REQUEST", "request Host is not an allowed namespace authority");
      return;
    }
    if (!validateRequestTarget(request.url, config.maxUrlLength)) {
      endProblem(request, response, 400, "INVALID_REQUEST_TARGET", "request target is malformed or unsafe");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      endProblem(request, response, 405, "METHOD_NOT_ALLOWED", "only GET and HEAD are supported");
      return;
    }

    const parsed = new URL(request.url, config.publicOrigin);
    if (parsed.pathname === "/healthz" || parsed.pathname === "/readyz") {
      const available = parsed.pathname === "/healthz" || ready;
      response.setHeader("Cache-Control", "no-store");
      endBytes(request, response, available ? 200 : 503, healthDocument(snapshot, ready), "application/json");
      return;
    }

    const selected = selectContentNegotiationResponse({
      accept: request.headers.accept,
      contract: snapshot.contract,
      iri: parsed.href,
    });
    for (const [name, value] of Object.entries(selected.headers)) response.setHeader(name, value);

    if (selected.status === 308) {
      response.statusCode = 308;
      response.setHeader("Cache-Control", "public, max-age=300");
      response.end();
      return;
    }
    if (selected.status === 404) {
      response.setHeader("Cache-Control", "no-store");
      endProblem(request, response, 404, "NOT_FOUND", "namespace resource does not exist");
      return;
    }
    if (selected.status === 406) {
      response.setHeader("Cache-Control", "no-store");
      endProblem(request, response, 406, "NOT_ACCEPTABLE", "no published representation satisfies Accept");
      return;
    }

    const artifact = snapshot.artifacts.get(selected.artifact);
    if (!artifact) {
      response.setHeader("Cache-Control", "no-store");
      endProblem(request, response, 500, "PUBLICATION_SNAPSHOT_ERROR", "selected artifact is unavailable");
      return;
    }
    response.statusCode = 200;
    response.setHeader("Cache-Control", cacheControl(parsed.pathname, snapshot.profileVersion));
    response.setHeader("Content-Length", artifact.length);
    response.setHeader("Content-Location", selected.iri);
    response.setHeader("ETag", artifact.etag);
    response.setHeader("Link", `<${selected.iri}>; rel="canonical"`);
    if (ifNoneMatchSatisfied(request.headers["if-none-match"], artifact.etag)) {
      response.statusCode = 304;
      response.removeHeader("Content-Length");
      response.end();
      return;
    }
    if (request.method === "HEAD") response.end();
    else response.end(artifact.bytes);
  });

  server.headersTimeout = config.headerTimeoutMs;
  server.requestTimeout = config.requestTimeoutMs;
  server.keepAliveTimeout = config.keepAliveTimeoutMs;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (error, socket) => {
    logger.warn?.(JSON.stringify({ code: error.code, event: "namespace.client_error" }));
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  async function start() {
    if (started) throw new Error("namespace service is already started");
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.listenHost, () => {
        server.off("error", reject);
        started = true;
        resolve();
      });
    });
    return server.address();
  }

  async function close({ timeoutMs = config.gracefulShutdownMs } = {}) {
    ready = false;
    if (!started) return;
    server.closeIdleConnections?.();
    let timeout;
    await Promise.race([
      new Promise((resolve) => server.close(() => resolve())),
      new Promise((resolve) => {
        timeout = setTimeout(() => {
          for (const socket of sockets) socket.destroy();
          resolve();
        }, timeoutMs);
        timeout.unref();
      }),
    ]);
    clearTimeout(timeout);
    started = false;
  }

  return Object.freeze({ close, server, snapshot, start });
}

export { SECURITY_HEADERS };
