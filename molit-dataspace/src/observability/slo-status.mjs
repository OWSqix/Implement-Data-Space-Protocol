import { assertObservability, ObservabilityError } from "./errors.mjs";
import { sha256 } from "./stable-json.mjs";

const SERVICES = new Set(["molit-caas", "molit-dsaas"]);
const MAX_RESPONSE_BYTES = 256 * 1024;

function finiteRatio(value, code, name) {
  assertObservability(typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1, code, `${name} must be between zero and one`);
  return value;
}

function count(value, name) {
  assertObservability(Number.isSafeInteger(value) && value >= 0, "OBS_SLO_MEASUREMENT_INVALID", `${name} must be a non-negative safe integer`);
  return value;
}

function objective(good, eligible, target, extra = {}) {
  if (eligible === 0) return Object.freeze({ target, ...extra, sli: null, badEventRatio: null, budgetConsumedRatio: null, budgetRemainingRatio: null, burnRate: null, met: null });
  const sli = good / eligible;
  const badEventRatio = 1 - sli;
  const budget = 1 - target;
  const budgetConsumedRatio = badEventRatio / budget;
  return Object.freeze({
    target,
    ...extra,
    sli,
    badEventRatio,
    budgetConsumedRatio,
    budgetRemainingRatio: Math.max(0, 1 - budgetConsumedRatio),
    burnRate: budgetConsumedRatio,
    met: sli >= target,
  });
}

function canonicalUtc(value, code, name) {
  const date = new Date(value);
  assertObservability(typeof value === "string" && Number.isFinite(date.valueOf()) && date.toISOString() === value, code, `${name} must be a canonical UTC timestamp`);
  return date;
}

export function calculateSloStatusSnapshot({ service, generatedAt = new Date().toISOString(), window, objectives, measurements }) {
  assertObservability(SERVICES.has(service), "OBS_SLO_SERVICE_INVALID", "SLO service is invalid");
  const generated = canonicalUtc(generatedAt, "OBS_SLO_TIME_INVALID", "generation time");
  const from = canonicalUtc(window?.from, "OBS_SLO_WINDOW_INVALID", "window start");
  const to = canonicalUtc(window?.to, "OBS_SLO_WINDOW_INVALID", "window end");
  assertObservability(to > from && generated >= from, "OBS_SLO_WINDOW_INVALID", "SLO window is invalid");
  const availabilityTarget = finiteRatio(objectives?.availabilityTarget, "OBS_SLO_OBJECTIVE_INVALID", "availability target");
  const latencyTarget = finiteRatio(objectives?.latencyTarget, "OBS_SLO_OBJECTIVE_INVALID", "latency target");
  assertObservability(Number.isFinite(objectives?.latencyThresholdMs) && objectives.latencyThresholdMs > 0, "OBS_SLO_OBJECTIVE_INVALID", "latency threshold must be positive");
  const requestCount = count(measurements?.requestCount, "request count");
  const serverErrorCount = count(measurements?.serverErrorCount, "server error count");
  const latencyEligibleCount = count(measurements?.latencyEligibleCount, "latency eligible count");
  const latencyGoodCount = count(measurements?.latencyGoodCount, "latency good count");
  assertObservability(serverErrorCount <= requestCount && latencyGoodCount <= latencyEligibleCount && latencyEligibleCount <= requestCount, "OBS_SLO_MEASUREMENT_INVALID", "SLO event counts are inconsistent");
  const availability = objective(requestCount - serverErrorCount, requestCount, availabilityTarget);
  const latency = objective(latencyGoodCount, latencyEligibleCount, latencyTarget, { thresholdMs: objectives.latencyThresholdMs });
  const status = requestCount === 0 || latencyEligibleCount === 0
    ? "INSUFFICIENT_DATA"
    : availability.met && latency.met ? "MET" : "BREACHED";
  const body = {
    schemaVersion: "molit.slo-status-snapshot/1",
    service,
    generatedAt: generated.toISOString(),
    window: { from: from.toISOString(), to: to.toISOString(), seconds: Math.floor((to - from) / 1_000) },
    status,
    measurements: { requestCount, serverErrorCount, latencyEligibleCount, latencyGoodCount },
    availability,
    latency,
  };
  return Object.freeze({ ...body, snapshotDigest: sha256(body) });
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ObservabilityError("OBS_PROMETHEUS_RESPONSE_TOO_LARGE", "Prometheus response exceeded its byte limit");
      }
      chunks.push(Buffer.from(value));
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new ObservabilityError("OBS_PROMETHEUS_RESPONSE_INVALID", "Prometheus response was not JSON", { cause: error });
  }
}

function prometheusScalar(payload) {
  assertObservability(payload?.status === "success" && payload.data?.resultType === "vector" && Array.isArray(payload.data.result) && payload.data.result.length === 1, "OBS_PROMETHEUS_RESPONSE_INVALID", "Prometheus query must return exactly one vector element");
  const value = Number(payload.data.result[0]?.value?.[1]);
  assertObservability(Number.isFinite(value) && value >= 0 && Number.isSafeInteger(value), "OBS_PROMETHEUS_RESPONSE_INVALID", "Prometheus counter result is invalid");
  return value;
}

export class PrometheusSloStatusGenerator {
  constructor({ baseUrl, authorization, dispatcher, objectives, windowDays = 30, timeoutMs = 5_000, fetchImpl = fetch, clock = () => new Date() }) {
    const url = new URL(baseUrl);
    assertObservability(url.protocol === "https:" && url.pathname.endsWith("/") && !url.username && !url.password && !url.search && !url.hash, "OBS_PROMETHEUS_URL_INVALID", "Prometheus URL must be an uncredentialed HTTPS base URL");
    assertObservability(windowDays === 30 && Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30_000, "OBS_PROMETHEUS_CONFIG_INVALID", "Prometheus SLO generator requires the deployed thirty-day recording window");
    finiteRatio(objectives?.availabilityTarget, "OBS_SLO_OBJECTIVE_INVALID", "availability target");
    finiteRatio(objectives?.latencyTarget, "OBS_SLO_OBJECTIVE_INVALID", "latency target");
    assertObservability(objectives?.latencyThresholdMs === 500, "OBS_SLO_OBJECTIVE_INVALID", "Prometheus SLO generator requires the deployed 500 ms latency threshold");
    Object.assign(this, { baseUrl: url, authorization, dispatcher, objectives: structuredClone(objectives), windowDays, timeoutMs, fetchImpl, clock });
  }

  async #query(query, at, signal) {
    const url = new URL("api/v1/query", this.baseUrl);
    url.searchParams.set("query", query);
    url.searchParams.set("time", String(at.valueOf() / 1_000));
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    const token = await this.authorization?.({ signal: combined });
    assertObservability(!token || (typeof token === "string" && !/[\r\n]/u.test(token)), "OBS_PROMETHEUS_AUTH_INVALID", "Prometheus authorization value is invalid");
    let response;
    try {
      response = await this.fetchImpl(url, { headers: { accept: "application/json", ...(token ? { authorization: token } : {}) }, redirect: "error", signal: combined, ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}) });
    } catch (error) {
      throw new ObservabilityError("OBS_PROMETHEUS_UNAVAILABLE", "Prometheus query failed", { cause: error });
    }
    assertObservability(response.status >= 200 && response.status < 300, "OBS_PROMETHEUS_REJECTED", `Prometheus returned HTTP ${response.status}`);
    assertObservability(/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""), "OBS_PROMETHEUS_RESPONSE_INVALID", "Prometheus response must be application/json");
    return prometheusScalar(await boundedJson(response));
  }

  async snapshot({ service, signal } = {}) {
    assertObservability(SERVICES.has(service), "OBS_SLO_SERVICE_INVALID", "SLO service is invalid");
    const at = this.clock();
    assertObservability(at instanceof Date && Number.isFinite(at.valueOf()), "OBS_CLOCK_INVALID", "SLO generator clock is invalid");
    const selector = `{service_name="${service}"}`;
    const names = ["request_count", "server_error_count", "latency_eligible_count", "latency_good_count"];
    const values = await Promise.all(names.map((name) => this.#query(`molit:sli_${name}:${this.windowDays}d${selector} or vector(0)`, at, signal)));
    const from = new Date(at.valueOf() - this.windowDays * 86_400_000);
    return calculateSloStatusSnapshot({
      service,
      generatedAt: at.toISOString(),
      window: { from: from.toISOString(), to: at.toISOString() },
      objectives: this.objectives,
      measurements: { requestCount: values[0], serverErrorCount: values[1], latencyEligibleCount: values[2], latencyGoodCount: values[3] },
    });
  }
}
