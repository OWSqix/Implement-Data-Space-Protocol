import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Agent } from "undici";
import { RuntimeError, assertRuntime } from "./errors.mjs";
import { classifyNetworkAddress } from "./network-address-policy.mjs";

function validateUrl(rawUrl, policy) {
  const url = new URL(rawUrl);
  assertRuntime(!url.username && !url.password, "URL_CREDENTIALS_FORBIDDEN", "URL userinfo is forbidden");
  assertRuntime(policy.allowHttp === true || url.protocol === "https:", "HTTPS_REQUIRED", "runtime endpoints require HTTPS");
  const allowedOrigins = policy.allowedOrigins ?? [];
  assertRuntime(allowedOrigins.includes(url.origin), "ORIGIN_NOT_ALLOWED", "endpoint origin is not allowlisted", { origin: url.origin });
  return url;
}

async function resolveAddresses(url, lookupImpl) {
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookupImpl(host, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({ address, family: Number(family) || isIP(address) }));
}

export async function resolveUrlPolicy(rawUrl, policy = {}, { lookupImpl = lookup, resolveForConnection = false } = {}) {
  const url = validateUrl(rawUrl, policy);
  const addresses = !policy.allowPrivate || resolveForConnection
    ? await resolveAddresses(url, lookupImpl)
    : [];
  if (!policy.allowPrivate) {
    assertRuntime(addresses.length > 0 && addresses.every(({ address }) => classifyNetworkAddress(address) !== "forbidden"), "PRIVATE_ADDRESS_FORBIDDEN", "endpoint resolves to an IANA non-global address that cannot be allowlisted");
    const hasPrivate = addresses.some(({ address }) => classifyNetworkAddress(address) === "private");
    assertRuntime(!hasPrivate || (policy.privateOrigins ?? []).includes(url.origin), "PRIVATE_ADDRESS_FORBIDDEN", "private endpoint origin is not in the exact privateOrigins allowlist");
  }
  assertRuntime(!resolveForConnection || addresses.length > 0, "DNS_RESOLUTION_EMPTY", "endpoint did not resolve to a connectable address");
  return { url, addresses };
}

export async function enforceUrlPolicy(rawUrl, policy = {}, options = {}) {
  return (await resolveUrlPolicy(rawUrl, policy, options)).url;
}

export function createPinnedLookup(addresses) {
  const pinned = addresses.map(({ address, family }) => Object.freeze({ address, family: Number(family) || isIP(address) }));
  assertRuntime(pinned.length > 0 && pinned.every(({ address, family }) => [4, 6].includes(family) && isIP(address) === family), "DNS_PIN_INVALID", "validated endpoint addresses cannot be pinned");
  return (_hostname, options, callback) => {
    if (options?.all === true) callback(null, pinned.map((entry) => ({ ...entry })));
    else callback(null, pinned[0].address, pinned[0].family);
  };
}

function createPinnedDispatcher(_url, addresses) {
  const dispatcher = new Agent({ connect: { lookup: createPinnedLookup(addresses) } });
  return dispatcher;
}

function abortReason(signal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function withSignal(value, signal) {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(result);
    };
    const onAbort = () => finish(reject, abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

async function runWithSignal(operation, signal) {
  if (signal.aborted) throw abortReason(signal);
  return withSignal(operation(), signal);
}

async function closeDispatcher(dispatcher) {
  if (typeof dispatcher?.close !== "function") return;
  try { await dispatcher.close(); } catch {}
}

function retryPermitted(method, options) {
  return ["GET", "HEAD", "OPTIONS"].includes(method) || options.retryUnsafe === true;
}

function retryableFailure(error) {
  return !(error instanceof RuntimeError);
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
    lookupImpl = lookup,
    dispatcherFactory,
    sleep = (ms, { signal } = {}) => delay(ms, undefined, { signal }),
    random = Math.random,
    timeoutMs = 15_000,
    maxResponseBytes = 4 * 1024 * 1024,
    retries = 3,
    baseDelayMs = 200,
    maxDelayMs = 10_000,
    circuitFailureThreshold = 5,
    circuitOpenMs = 30_000,
  }) {
    assertRuntime(fetchImpl === globalThis.fetch || dispatcherFactory !== undefined, "HTTP_DISPATCHER_CAPABILITY_REQUIRED", "custom fetch adapters must provide a pinned dispatcher factory");
    const resolvedDispatcherFactory = dispatcherFactory ?? createPinnedDispatcher;
    assertRuntime(typeof resolvedDispatcherFactory === "function", "HTTP_DISPATCHER_CAPABILITY_REQUIRED", "HTTP requests require a pinned dispatcher factory");
    Object.assign(this, { policy, telemetry, fetchImpl, lookupImpl, dispatcherFactory: resolvedDispatcherFactory, sleep, random, timeoutMs, maxResponseBytes, retries, baseDelayMs, maxDelayMs, circuitFailureThreshold, circuitOpenMs });
    this.circuits = new Map();
  }

  async request(rawUrl, options = {}) {
    const url = validateUrl(rawUrl, this.policy);
    const circuit = this.circuits.get(url.origin) ?? { failures: 0, openUntil: 0 };
    if (circuit.openUntil > Date.now()) throw new RuntimeError("CIRCUIT_OPEN", "endpoint circuit is open", { origin: url.origin });
    const method = (options.method ?? "GET").toUpperCase();
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const operationSignal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const { maxResponseBytes, retryUnsafe: _retryUnsafe, signal: _signal, ...requestOptions } = options;
    try {
      for (let attempt = 0; attempt <= this.retries; attempt += 1) {
        let dispatcher;
        let response;
        let waitMs = null;
        try {
          const resolved = await runWithSignal(() => resolveUrlPolicy(url, this.policy, {
            lookupImpl: this.lookupImpl,
            resolveForConnection: true,
          }), operationSignal);
          dispatcher = this.dispatcherFactory(resolved.url, resolved.addresses);
          assertRuntime(dispatcher && typeof dispatcher.close === "function", "HTTP_DISPATCHER_CAPABILITY_REQUIRED", "pinned dispatcher factory returned an invalid dispatcher");
          const started = Date.now();
          response = await runWithSignal(() => this.fetchImpl(resolved.url, {
            ...requestOptions,
            redirect: "manual",
            dispatcher,
            signal: operationSignal,
          }), operationSignal);
          this.telemetry?.add("molit_bridge_http_requests_total", 1, { origin: url.origin, method, status: response.status });
          this.telemetry?.add("molit_bridge_http_duration_ms_total", Date.now() - started, { origin: url.origin });
          if ([301, 302, 303, 307, 308].includes(response.status)) throw new RuntimeError("REDIRECT_FORBIDDEN", "HTTP redirects are forbidden");
          if ((response.status === 429 || response.status >= 500) && attempt < this.retries && retryPermitted(method, options)) {
            await runWithSignal(() => response.body?.cancel() ?? Promise.resolve(), operationSignal);
            waitMs = retryDelay(response, attempt, this);
          } else {
            if (response.status >= 500 || response.status === 429) throw new RuntimeError("UPSTREAM_UNAVAILABLE", `upstream returned ${response.status}`, { status: response.status });
            const body = await runWithSignal(() => readBounded(response, maxResponseBytes ?? this.maxResponseBytes), operationSignal);
            circuit.failures = 0;
            this.circuits.set(url.origin, circuit);
            return { status: response.status, headers: response.headers, body };
          }
        } catch (error) {
          if (operationSignal.aborted || !retryableFailure(error) || attempt >= this.retries || !retryPermitted(method, options)) throw error;
          waitMs = retryDelay(response, attempt, this);
        } finally {
          await closeDispatcher(dispatcher);
        }
        await runWithSignal(() => this.sleep(waitMs, { signal: operationSignal }), operationSignal);
      }
      throw new RuntimeError("UPSTREAM_UNAVAILABLE", "request retry budget exhausted");
    } catch (error) {
      if (["REDIRECT_FORBIDDEN", "RESPONSE_TOO_LARGE", "PRIVATE_ADDRESS_FORBIDDEN", "DNS_RESOLUTION_EMPTY", "DNS_PIN_INVALID"].includes(error?.code)) throw error;
      circuit.failures += 1;
      if (circuit.failures >= this.circuitFailureThreshold) circuit.openUntil = Date.now() + this.circuitOpenMs;
      this.circuits.set(url.origin, circuit);
      this.telemetry?.add("molit_bridge_http_failures_total", 1, { origin: url.origin, code: error?.code ?? error?.name ?? "ERROR" });
      if (options.signal?.aborted) throw new RuntimeError("HTTP_ABORTED", "upstream request was aborted");
      if (timeoutSignal.aborted || error?.name === "TimeoutError") throw new RuntimeError("HTTP_TIMEOUT", "upstream request exceeded its total timeout");
      if (error?.name === "AbortError") throw new RuntimeError("HTTP_ABORTED", "upstream request was aborted");
      throw error;
    }
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
