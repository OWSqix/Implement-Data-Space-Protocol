import { isIP } from "node:net";
import { assertIdentity, unavailable } from "./errors.mjs";
import { parseStrictJson } from "./strict-json.mjs";

function loopback(hostname) {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

export function validatePinnedUrl(value, { allowedOrigins, allowInsecureLoopback = false, label = "identity endpoint" }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    assertIdentity(false, "IDENTITY_ENDPOINT_INVALID", `${label} is not a valid URL`, { status: 500 });
  }
  assertIdentity(!url.username && !url.password && !url.hash, "IDENTITY_ENDPOINT_INVALID", `${label} must not contain userinfo or a fragment`, { status: 500 });
  const secure = url.protocol === "https:";
  const permittedDevelopmentUrl = allowInsecureLoopback && url.protocol === "http:" && loopback(url.hostname);
  assertIdentity(secure || permittedDevelopmentUrl, "IDENTITY_ENDPOINT_INVALID", `${label} must use HTTPS`, { status: 500 });
  assertIdentity(Array.isArray(allowedOrigins) && allowedOrigins.includes(url.origin), "IDENTITY_ENDPOINT_NOT_ALLOWED", `${label} origin is not allowlisted`, { status: 500 });
  if (secure && isIP(url.hostname.replace(/^\[|\]$/gu, ""))) {
    assertIdentity(!loopback(url.hostname), "IDENTITY_ENDPOINT_INVALID", `${label} must not use a loopback IP in production`, { status: 500 });
  }
  return url;
}

function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function boundedText(response, maxBytes) {
  const length = response.headers.get("content-length");
  assertIdentity(length === null || (/^[0-9]+$/u.test(length) && Number(length) <= maxBytes), "IDENTITY_UPSTREAM_RESPONSE_TOO_LARGE", "identity response exceeds the configured limit", { status: 503 });
  assertIdentity(response.body, "IDENTITY_UPSTREAM_INVALID", "identity endpoint returned an empty response", { status: 503 });
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        assertIdentity(false, "IDENTITY_UPSTREAM_RESPONSE_TOO_LARGE", "identity response exceeds the configured limit", { status: 503 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

export class PinnedJsonClient {
  constructor({ allowedOrigins, allowInsecureLoopback = false, timeoutMs = 5_000, maxResponseBytes = 262_144, fetchImpl = globalThis.fetch }) {
    assertIdentity(typeof fetchImpl === "function", "IDENTITY_HTTP_CONFIGURATION_INVALID", "fetch implementation is required", { status: 500 });
    assertIdentity(Array.isArray(allowedOrigins) && allowedOrigins.length > 0 && allowedOrigins.every((value) => typeof value === "string"), "IDENTITY_HTTP_CONFIGURATION_INVALID", "at least one allowed identity origin is required", { status: 500 });
    assertIdentity(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30_000, "IDENTITY_HTTP_CONFIGURATION_INVALID", "identity HTTP timeout is invalid", { status: 500 });
    assertIdentity(Number.isSafeInteger(maxResponseBytes) && maxResponseBytes >= 1_024 && maxResponseBytes <= 2_097_152, "IDENTITY_HTTP_CONFIGURATION_INVALID", "identity response limit is invalid", { status: 500 });
    Object.assign(this, { allowedOrigins: [...new Set(allowedOrigins)], allowInsecureLoopback, timeoutMs, maxResponseBytes, fetchImpl });
    this.productionEligible = allowInsecureLoopback === false;
  }

  url(value, label) {
    return validatePinnedUrl(value, { allowedOrigins: this.allowedOrigins, allowInsecureLoopback: this.allowInsecureLoopback, label });
  }

  async json(value, { method = "GET", headers = {}, body, signal, label } = {}) {
    const url = this.url(value, label);
    const requestSignal = combinedSignal(signal, this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, { method, headers, body, signal: requestSignal, redirect: "error", credentials: "omit" });
    } catch (error) {
      if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
      throw unavailable("IDENTITY_UPSTREAM_UNAVAILABLE", `${label ?? "identity endpoint"} request failed`, error);
    }
    assertIdentity(response.status === 200, "IDENTITY_UPSTREAM_UNAVAILABLE", `${label ?? "identity endpoint"} returned HTTP ${response.status}`, { status: 503 });
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    assertIdentity(mediaType === "application/json" || mediaType === "application/jwk-set+json", "IDENTITY_UPSTREAM_INVALID", `${label ?? "identity endpoint"} returned a non-JSON media type`, { status: 503 });
    let text;
    try {
      text = await boundedText(response, this.maxResponseBytes);
    } catch (error) {
      if (error instanceof TypeError) throw unavailable("IDENTITY_UPSTREAM_INVALID", `${label ?? "identity endpoint"} is not valid UTF-8`, error);
      throw error;
    }
    return parseStrictJson(text, { maxCharacters: this.maxResponseBytes });
  }
}
