import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Agent } from "undici";

import { assertObservability, ObservabilityError } from "./errors.mjs";
import { OperationalTelemetry } from "./operational-telemetry.mjs";
import { OtlpLogExporter, OtlpMetricExporter } from "./otlp-signals.mjs";
import { createRotatingMtlsDispatcher } from "./rotating-mtls-dispatcher.mjs";

const schema = JSON.parse(await readFile(new URL("../../contracts/operational-telemetry-config.v1.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function validatedConfig(config) {
  assertObservability(validate(config), "OBS_TELEMETRY_CONFIG_INVALID", `telemetry configuration is invalid: ${(validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ")}`);
  const result = structuredClone(config);
  assertObservability(new URL(result.metrics.endpoint).pathname.endsWith("/v1/metrics"), "OBS_TELEMETRY_CONFIG_INVALID", "metrics endpoint path is invalid");
  assertObservability(new URL(result.logs.endpoint).pathname.endsWith("/v1/logs"), "OBS_TELEMETRY_CONFIG_INVALID", "logs endpoint path is invalid");
  return result;
}

function textSecret(value, code, message) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  assertObservability(typeof text === "string" && text.length > 0, code, message);
  return text;
}

function bearer(reference, secretResolver, purpose) {
  return async ({ signal } = {}) => {
    const token = textSecret(await secretResolver(reference, { purpose, signal }), "OBS_AUTHORIZATION_INVALID", "telemetry bearer token is empty");
    assertObservability(!/\s/u.test(token) && token.length <= 8192, "OBS_AUTHORIZATION_INVALID", "telemetry authorization must be a raw bearer token");
    return `Bearer ${token}`;
  };
}

export async function loadOperationalTelemetryConfig(path) {
  assertObservability(typeof path === "string" && path.length > 0, "OBS_TELEMETRY_CONFIG_PATH_REQUIRED", "telemetry config path is required");
  try {
    return validatedConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof ObservabilityError) throw error;
    throw new ObservabilityError("OBS_TELEMETRY_CONFIG_READ_FAILED", "telemetry config could not be read", { cause: error });
  }
}

export function operationalTelemetryConfigFromObservability(config) {
  assertObservability(config?.schemaVersion === "molit.observability-config/1", "OBS_TELEMETRY_CONFIG_INVALID", "unified observability configuration is invalid");
  assertObservability(config.tracing && config.metrics && config.logs, "OBS_TELEMETRY_CONFIG_INVALID", "unified observability configuration lacks metrics or logs");
  return validatedConfig({
    schemaVersion: "molit.operational-telemetry-config/1",
    service: structuredClone(config.service),
    tenantCardinality: {
      bucketCount: config.tracing.tenantBucketCount,
      saltRef: config.tracing.tenantSaltRef,
    },
    metrics: structuredClone(config.metrics),
    logs: structuredClone(config.logs),
  });
}

export async function createOperationalTelemetryFromConfig({ config, secretResolver, fetchImpl = fetch, agentFactory = (options) => new Agent(options), clock }) {
  const resolved = validatedConfig(config);
  assertObservability(typeof secretResolver === "function", "OBS_SECRET_RESOLVER_REQUIRED", "telemetry secret resolver is required");
  assertObservability(typeof agentFactory === "function", "OBS_AGENT_FACTORY_REQUIRED", "telemetry TLS agent factory is required");
  let metricAgent;
  let logAgent;
  let tenantSaltValue;
  try {
    tenantSaltValue = await secretResolver(resolved.tenantCardinality.saltRef, { purpose: "tenant-cardinality-salt" });
    metricAgent = await createRotatingMtlsDispatcher({ tls: resolved.metrics.tls, secretResolver, agentFactory, clock });
    logAgent = await createRotatingMtlsDispatcher({ tls: resolved.logs.tls, secretResolver, agentFactory, clock });
  } catch (error) {
    await Promise.allSettled([metricAgent?.close?.(), logAgent?.close?.()]);
    throw error;
  }
  const tenantSalt = textSecret(tenantSaltValue, "OBS_TENANT_SALT_REQUIRED", "tenant cardinality salt is empty");
  assertObservability(Buffer.byteLength(tenantSalt) >= 16, "OBS_TENANT_SALT_REQUIRED", "tenant cardinality salt must have at least 16 bytes");
  const common = {
    serviceName: resolved.service.name,
    serviceVersion: resolved.service.version,
    environment: resolved.service.environment,
    fetchImpl,
  };
  const metricExporter = new OtlpMetricExporter({
    ...common,
    endpoint: resolved.metrics.endpoint,
    authorization: bearer(resolved.metrics.authorizationRef, secretResolver, "metrics-otlp-authorization"),
    dispatcher: metricAgent,
    timeoutMs: resolved.metrics.timeoutMs,
  });
  const logExporter = new OtlpLogExporter({
    ...common,
    endpoint: resolved.logs.endpoint,
    authorization: bearer(resolved.logs.authorizationRef, secretResolver, "logs-otlp-authorization"),
    dispatcher: logAgent,
    timeoutMs: resolved.logs.timeoutMs,
  });
  const telemetry = new OperationalTelemetry({
    metricExporter,
    logExporter,
    component: resolved.service.name,
    environment: resolved.service.environment,
    tenantSalt,
    tenantBucketCount: resolved.tenantCardinality.bucketCount,
    clock,
  });
  try {
    await telemetry.initialize();
  } catch (error) {
    await Promise.allSettled([telemetry.close(), metricAgent.close?.(), logAgent.close?.()]);
    throw error;
  }
  const closeTelemetry = telemetry.close.bind(telemetry);
  const telemetryReadiness = telemetry.readiness.bind(telemetry);
  const telemetryProbeReadiness = telemetry.probeReadiness.bind(telemetry);
  const withTls = (signals) => {
    const tls = Object.freeze({ metrics: metricAgent.readiness(), logs: logAgent.readiness() });
    const ready = signals.ready === true && tls.metrics.ready && tls.logs.ready;
    return Object.freeze({ ...signals, ready, status: ready ? "READY" : "NOT_READY", tls });
  };
  telemetry.readiness = () => {
    return withTls(telemetryReadiness());
  };
  telemetry.probeReadiness = async (options) => withTls(await telemetryProbeReadiness(options));
  telemetry.close = async () => {
    await closeTelemetry();
    await Promise.allSettled([metricAgent.close?.(), logAgent.close?.()]);
  };
  return telemetry;
}
