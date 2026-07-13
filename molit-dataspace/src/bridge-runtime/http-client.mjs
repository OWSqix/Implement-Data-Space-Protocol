import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { RuntimeError, assertRuntime } from "./errors.mjs";

function addressClass(address) {
  const normalized = address.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (mapped.includes(".")) return addressClass(mapped);
    const words = mapped.split(":");
    if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/u.test(word))) {
      const high = Number.parseInt(words[0], 16);
      const low = Number.parseInt(words[1], 16);
      return addressClass(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
    }
    return "forbidden";
  }
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("ff")) return "forbidden";
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return "private";
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4) return "public";
  if (octets[0] === 0 || octets[0] === 127 || octets[0] >= 224 || (octets[0] === 169 && octets[1] === 254)) return "forbidden";
  if (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)) return "private";
  return "public";
}

export async function enforceUrlPolicy(rawUrl, policy = {}) {
  const url = new URL(rawUrl);
  assertRuntime(!url.username && !url.password, "URL_CREDENTIALS_FORBIDDEN", "URL userinfo is forbidden");
  assertRuntime(policy.allowHttp === true || url.protocol === "https:", "HTTPS_REQUIRED", "runtime endpoints require HTTPS");
  const allowedOrigins = policy.allowedOrigins ?? [];
  assertRuntime(allowedOrigins.includes(url.origin), "ORIGIN_NOT_ALLOWED", "endpoint origin is not allowlisted", { origin: url.origin });
  if (!policy.allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/gu, "");
    const addresses = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true, verbatim: true });
    assertRuntime(addresses.length > 0 && addresses.every(({ address }) => addressClass(address) !== "forbidden"), "PRIVATE_ADDRESS_FORBIDDEN", "endpoint resolves to a loopback, link-local, unspecified or multicast address");
    const hasPrivate = addresses.some(({ address }) => addressClass(address) === "private");
    assertRuntime(!hasPrivate || (policy.privateOrigins ?? []).includes(url.origin), "PRIVATE_ADDRESS_FORBIDDEN", "private endpoint origin is not in the exact privateOrigins allowlist");
  }
  return url;
}

export async function readBounded(response, maxResponseBytes) {
  const declared = Number(response.headers.get("content-length"));
  assertRuntime(!Number.isFinite(declared) || declared <= maxResponseBytes, "RESPONSE_TOO_LARGE", "response Content-Length exceeds limit");
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxResponseBytes) {
      await response.body.cancel().catch(() => {});
      throw new RuntimeError("RESPONSE_TOO_LARGE", "streamed response exceeds byte limit");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function retryDelay(response, attempt, { baseDelayMs, maxDelayMs, random }) {
  const header = response?.headers.get("retry-after");
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, maxDelayMs);
  const exponential = Math.min(baseDelayMs * (2 ** attempt), maxDelayMs);
  return Math.floor(exponential * (0.5 + random() * 0.5));
}

export class ResilientHttpClient {
  constructor({
    policy,
    telemetry,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    timeoutMs = 15_000,
    maxResponseBytes = 4 * 1024 * 1024,
    retries = 3,
    baseDelayMs = 200,
    maxDelayMs = 10_000,
    circuitFailureThreshold = 5,
    circuitOpenMs = 30_000,
  }) {
    Object.assign(this, { policy, telemetry, fetchImpl, sleep, random, timeoutMs, maxResponseBytes, retries, baseDelayMs, maxDelayMs, circuitFailureThreshold, circuitOpenMs });
    this.circuits = new Map();
  }

  async request(rawUrl, options = {}) {
    const url = await enforceUrlPolicy(rawUrl, this.policy);
    const circuit = this.circuits.get(url.origin) ?? { failures: 0, openUntil: 0 };
    if (circuit.openUntil > Date.now()) throw new RuntimeError("CIRCUIT_OPEN", "endpoint circuit is open", { origin: url.origin });
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const started = Date.now();
      let response;
      try {
        response = await this.fetchImpl(url, {
          ...options,
          redirect: "manual",
          signal: AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(this.timeoutMs)]),
        });
        this.telemetry?.add("molit_bridge_http_requests_total", 1, { origin: url.origin, method: options.method ?? "GET", status: response.status });
        this.telemetry?.add("molit_bridge_http_duration_ms_total", Date.now() - started, { origin: url.origin });
        if ([301, 302, 303, 307, 308].includes(response.status)) throw new RuntimeError("REDIRECT_FORBIDDEN", "HTTP redirects are forbidden");
        const retryPermitted = ["GET", "HEAD", "OPTIONS"].includes(options.method ?? "GET") || options.retryUnsafe === true;
        if ((response.status === 429 || response.status >= 500) && attempt < this.retries && retryPermitted) {
          await response.body?.cancel().catch(() => {});
          await this.sleep(retryDelay(response, attempt, this));
          continue;
        }
        if (response.status >= 500 || response.status === 429) throw new RuntimeError("UPSTREAM_UNAVAILABLE", `upstream returned ${response.status}`, { status: response.status });
        circuit.failures = 0;
        this.circuits.set(url.origin, circuit);
        const body = await readBounded(response, options.maxResponseBytes ?? this.maxResponseBytes);
        return { status: response.status, headers: response.headers, body };
      } catch (error) {
        if (error?.code === "REDIRECT_FORBIDDEN" || error?.code === "RESPONSE_TOO_LARGE") throw error;
        if (attempt < this.retries && !options.signal?.aborted && error?.name !== "AbortError" && error?.name !== "TimeoutError" && (["GET", "HEAD", "OPTIONS"].includes(options.method ?? "GET") || options.retryUnsafe === true)) {
          await this.sleep(retryDelay(response, attempt, this));
          continue;
        }
        circuit.failures += 1;
        if (circuit.failures >= this.circuitFailureThreshold) circuit.openUntil = Date.now() + this.circuitOpenMs;
        this.circuits.set(url.origin, circuit);
        this.telemetry?.add("molit_bridge_http_failures_total", 1, { origin: url.origin, code: error?.code ?? error?.name ?? "ERROR" });
        if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new RuntimeError("HTTP_TIMEOUT", "upstream request timed out");
        throw error;
      }
    }
    throw new RuntimeError("UPSTREAM_UNAVAILABLE", "request retry budget exhausted");
  }

  async json(url, options = {}) {
    const result = await this.request(url, options);
    if (result.body.length === 0) return { ...result, value: null };
    try {
      return { ...result, value: JSON.parse(result.body.toString("utf8")) };
    } catch {
      throw new RuntimeError("INVALID_JSON_RESPONSE", "upstream response is not valid JSON");
    }
  }
}
