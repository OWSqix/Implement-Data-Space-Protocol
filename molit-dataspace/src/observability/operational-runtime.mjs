import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Agent } from "undici";

import { assertObservability, ObservabilityError } from "./errors.mjs";
import { OtlpHttpJsonExporter } from "./otlp-http-exporter.mjs";
import { MolitTracer } from "./tracer.mjs";
import { createRotatingMtlsDispatcher } from "./rotating-mtls-dispatcher.mjs";
import { HttpWormBackend, WormAuditExporter } from "./worm-audit.mjs";
import { createWormOutboxDispatcher } from "./worm-outbox-dispatcher.mjs";

const schema = JSON.parse(await readFile(new URL("../../contracts/observability-config.v1.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function validateConfig(config) {
  assertObservability(validate(config), "OBS_CONFIG_INVALID", `observability configuration is invalid: ${(validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ")}`);
  return structuredClone(config);
}

function textSecret(value, code, message) {
  const result = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  assertObservability(typeof result === "string" && result.length > 0, code, message);
  return result;
}

function bearerResolver(reference, secretResolver, purpose) {
  return async ({ signal } = {}) => {
    const value = textSecret(await secretResolver(reference, { purpose, signal }), "OBS_AUTHORIZATION_INVALID", "observability authorization secret is empty");
    assertObservability(!/\s/u.test(value) && value.length <= 8192, "OBS_AUTHORIZATION_INVALID", "observability authorization secret must be a raw bearer token");
    return `Bearer ${value}`;
  };
}

export async function loadOperationalObservabilityConfig(path) {
  assertObservability(typeof path === "string" && path.length > 0, "OBS_CONFIG_PATH_REQUIRED", "observability config path is required");
  let parsed;
  try { parsed = JSON.parse(await readFile(path, "utf8")); } catch (error) { throw new ObservabilityError("OBS_CONFIG_READ_FAILED", "observability config could not be read", { cause: error }); }
  return validateConfig(parsed);
}

export async function createOperationalObservability({ config, secretResolver, fetchImpl = fetch, agentFactory = (options) => new Agent(options) }) {
  const resolved = validateConfig(config);
  assertObservability(typeof secretResolver === "function", "OBS_SECRET_RESOLVER_REQUIRED", "observability secret resolver is required");
  assertObservability(typeof agentFactory === "function", "OBS_AGENT_FACTORY_REQUIRED", "observability TLS agent factory is required");
  const tenantSaltValue = await secretResolver(resolved.tracing.tenantSaltRef, { purpose: "tenant-cardinality-salt" });
  const tracingAgent = await createRotatingMtlsDispatcher({ tls: resolved.tracing.tls, secretResolver, agentFactory });
  let auditAgent;
  try { auditAgent = await createRotatingMtlsDispatcher({ tls: resolved.audit.tls, secretResolver, agentFactory }); }
  catch (error) { await tracingAgent.close?.(); throw error; }
  const tenantSalt = textSecret(tenantSaltValue, "OBS_TENANT_SALT_REQUIRED", "tenant cardinality salt is empty");
  assertObservability(Buffer.byteLength(tenantSalt) >= 16, "OBS_TENANT_SALT_REQUIRED", "tenant cardinality salt must have at least 16 bytes");
  const spanSink = new OtlpHttpJsonExporter({
    endpoint: resolved.tracing.endpoint,
    serviceName: resolved.service.name,
    serviceVersion: resolved.service.version,
    environment: resolved.service.environment,
    authorization: bearerResolver(resolved.tracing.authorizationRef, secretResolver, "otlp-authorization"),
    dispatcher: tracingAgent,
    timeoutMs: resolved.tracing.timeoutMs,
    fetchImpl,
  });
  const tracer = new MolitTracer({ sink: spanSink, component: resolved.service.name, tenantSalt, tenantBucketCount: resolved.tracing.tenantBucketCount });
  const auditBackend = new HttpWormBackend({
    baseUrl: resolved.audit.baseUrl,
    authorization: bearerResolver(resolved.audit.authorizationRef, secretResolver, "worm-authorization"),
    dispatcher: auditAgent,
    timeoutMs: resolved.audit.timeoutMs,
    fetchImpl,
  });
  const auditExporter = new WormAuditExporter({ backend: auditBackend, retentionDays: resolved.audit.retentionDays });
  try { await Promise.all([spanSink.initialize(), auditExporter.initialize()]); }
  catch (error) { await Promise.all([spanSink.close(), tracingAgent.close?.(), auditAgent.close?.()]); throw error; }
  const dispatchers = new Set();
  let closed = false;
  return Object.freeze({
    mode: "operational",
    config: Object.freeze(resolved),
    tracer,
    auditExporter,
    createAuditDispatcher(options) {
      assertObservability(!closed, "OBS_RUNTIME_CLOSED", "observability runtime is closed");
      const dispatcher = createWormOutboxDispatcher({ ...options, exporter: auditExporter });
      dispatchers.add(dispatcher);
      return dispatcher;
    },
    async readiness({ signal } = {}) {
      assertObservability(!closed, "OBS_RUNTIME_CLOSED", "observability runtime is closed");
      const [trace, audit, results] = await Promise.all([
        spanSink.probeReadiness({ signal }),
        auditExporter.probeReadiness({ signal }),
        Promise.all([...dispatchers].map((dispatcher) => dispatcher.readiness({ signal }))),
      ]);
      const tls = Object.freeze({ tracing: tracingAgent.readiness(), audit: auditAgent.readiness() });
      return Object.freeze({ ready: trace.ready && audit.ready && results.every((item) => item.ready) && tls.tracing.ready && tls.audit.ready, trace, audit, dispatchers: results, tls });
    },
    async close({ timeoutMs = 30_000 } = {}) {
      if (closed) return;
      assertObservability(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 120_000, "OBS_RUNTIME_CLOSE_INVALID", "observability runtime close timeout is invalid");
      closed = true;
      const deadline = Date.now() + timeoutMs;
      await Promise.all([...dispatchers].map((dispatcher) => dispatcher.stop({ timeoutMs: Math.max(0, deadline - Date.now()) })));
      await Promise.all([spanSink.close(), tracingAgent.close?.(), auditAgent.close?.()]);
    },
  });
}
