import { assertObservability } from "./errors.mjs";
import { createOperationalObservability } from "./operational-runtime.mjs";
import { createOperationalTelemetryFromConfig } from "./operational-telemetry-runtime.mjs";
import { createUsageOutboxDispatcher } from "./usage-outbox-dispatcher.mjs";

function telemetryConfig(config) {
  return {
    schemaVersion: "molit.operational-telemetry-config/1",
    service: config.service,
    tenantCardinality: {
      bucketCount: config.tracing.tenantBucketCount,
      saltRef: config.tracing.tenantSaltRef,
    },
    metrics: config.metrics,
    logs: config.logs,
  };
}

export async function createOperationalObservabilityBundle({
  config,
  secretResolver,
  fetchImpl = fetch,
  auditFactory = createOperationalObservability,
  telemetryFactory = createOperationalTelemetryFromConfig,
  agentFactory,
}) {
  assertObservability(config?.metrics && config?.logs, "OBS_SIGNALS_REQUIRED", "operational metrics and logs are required");
  const common = { secretResolver, fetchImpl, ...(agentFactory ? { agentFactory } : {}) };
  const audit = await auditFactory({ config, ...common });
  let telemetry;
  try {
    telemetry = await telemetryFactory({ config: telemetryConfig(config), ...common });
  } catch (error) {
    await audit.close().catch(() => {});
    throw error;
  }
  let closed = false;
  const usageDispatchers = new Set();
  return Object.freeze({
    mode: "operational",
    tracer: audit.tracer,
    telemetry,
    auditExporter: audit.auditExporter,
    createAuditDispatcher: (options) => audit.createAuditDispatcher(options),
    createUsageDispatcher(options) {
      assertObservability(!closed, "OBS_RUNTIME_CLOSED", "observability runtime is closed");
      const dispatcher = createUsageOutboxDispatcher({ ...options, telemetry });
      usageDispatchers.add(dispatcher);
      return dispatcher;
    },
    async readiness(options) {
      const [auditStatus, telemetryStatus, usageStatuses] = await Promise.all([
        audit.readiness(options),
        telemetry.probeReadiness ? telemetry.probeReadiness(options) : telemetry.readiness(),
        Promise.all([...usageDispatchers].map((dispatcher) => dispatcher.readiness(options))),
      ]);
      return Object.freeze({
        ready: auditStatus.ready === true && telemetryStatus.ready === true && usageStatuses.every((status) => status.ready === true),
        audit: auditStatus,
        telemetry: telemetryStatus,
        usageDispatchers: usageStatuses,
      });
    },
    async close({ timeoutMs = 30_000 } = {}) {
      if (closed) return;
      assertObservability(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 120_000, "OBS_RUNTIME_CLOSE_INVALID", "observability bundle close timeout is invalid");
      closed = true;
      const deadline = Date.now() + timeoutMs;
      const dispatcherResults = await Promise.allSettled([...usageDispatchers].map((dispatcher) => dispatcher.stop({ timeoutMs: Math.max(0, deadline - Date.now()) })));
      const remainingMs = Math.max(0, deadline - Date.now());
      const results = await Promise.allSettled([
        audit.close({ timeoutMs: remainingMs }),
        telemetry.close({ timeoutMs: remainingMs }),
      ]);
      const failure = [...dispatcherResults, ...results].find(({ status }) => status === "rejected");
      if (failure) throw failure.reason;
    },
  });
}
