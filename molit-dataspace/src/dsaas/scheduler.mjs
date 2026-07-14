import { randomUUID } from "node:crypto";

function boundedErrorCode(error, fallback) {
  let code;
  try { code = error?.code; } catch { return fallback; }
  return typeof code === "string" && /^[A-Z][A-Z0-9_:-]{0,63}$/u.test(code) ? code : fallback;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("DSaaS reconcile scheduler was stopped");
  error.name = "AbortError";
  throw error;
}

export class DsaasReconcileScheduler {
  constructor({ controlPlane, config, telemetry, clock = () => new Date(), setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
    Object.assign(this, { controlPlane, config, telemetry, clock, setIntervalFn, clearIntervalFn });
    this.started = false;
    this.timer = null;
    this.inFlight = null;
    this.inFlightController = null;
    this.acceptingTicks = true;
    this.cursor = 0;
    this.lastTickStartedAt = null;
    this.lastTickCompletedAt = null;
    this.lastFatalErrorCode = null;
    this.lastFailures = [];
    this.lastBlocked = [];
    this.skippedOverlappingTicks = 0;
  }

  now() { return this.clock().toISOString(); }

  #recordBackgroundFailure(error) {
    this.lastFatalErrorCode = boundedErrorCode(error, "DSAAS_SCHEDULER_TICK_FAILED");
    this.lastTickCompletedAt = this.now();
  }

  #launchTick() {
    void this.runOnce().catch((error) => {
      if (error?.name !== "AbortError") this.#recordBackgroundFailure(error);
    });
  }

  async runOnce({ signal } = {}) {
    if (!this.acceptingTicks) return Object.freeze({ skipped: true, reason: "STOPPED" });
    if (this.inFlight) {
      this.skippedOverlappingTicks += 1;
      this.telemetry?.log("WARN", "dsaas.scheduler_tick_skipped", { reason: "in-progress" });
      return Object.freeze({ skipped: true, reason: "IN_PROGRESS" });
    }
    const controller = new AbortController();
    const executionSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const execution = this.#execute(executionSignal);
    this.inFlight = execution;
    this.inFlightController = controller;
    try {
      return await execution;
    } finally {
      if (this.inFlight === execution) {
        this.inFlight = null;
        this.inFlightController = null;
      }
    }
  }

  async #execute(signal) {
    throwIfAborted(signal);
    this.lastTickStartedAt = this.now();
    let allTargets;
    try {
      allTargets = await this.controlPlane.scheduledReconciliationTargets({ signal });
      throwIfAborted(signal);
    } catch (error) {
      throwIfAborted(signal);
      this.lastFatalErrorCode = boundedErrorCode(error, "DSAAS_SCHEDULER_TARGET_SCAN_FAILED");
      this.lastFailures = [];
      this.lastBlocked = [];
      this.lastTickCompletedAt = this.now();
      this.telemetry?.log("ERROR", "dsaas.scheduler_tick_failed", { "error.code": this.lastFatalErrorCode });
      return Object.freeze({ attempted: 0, blocked: 0, blockedCodes: [], failed: 0, failureCodes: [this.lastFatalErrorCode], nextRetryAt: null, skipped: false, succeeded: 0 });
    }
    const count = Math.min(allTargets.length, this.config.maxDataspacesPerTick);
    const targets = [];
    if (count > 0) {
      const start = this.cursor % allTargets.length;
      for (let index = 0; index < count; index += 1) targets.push(allTargets[(start + index) % allTargets.length]);
      this.cursor = (start + count) % allTargets.length;
    } else {
      this.cursor = 0;
    }
    const runId = `scheduler:${randomUUID()}`;
    const failures = [];
    const blocked = [];
    let succeeded = 0;
    for (const dataspaceId of targets) {
      throwIfAborted(signal);
      try {
        const result = await this.controlPlane.reconcileScheduled(dataspaceId, runId, { signal });
        throwIfAborted(signal);
        if (result.caasRetry) {
          failures.push({
            dataspaceId,
            errorCodes: result.caasRetry.errorCodes,
            nextRetryAt: result.caasRetry.nextRetryAt,
          });
        } else if (result.reconcilePending) {
          const approvalBlocked = Object.values(result.participants).some(({ approvalState }) => approvalState === "REAPPROVAL_REQUIRED");
          const serviceBlocked = result.serviceObservations.some(({ effectiveStatus }) => effectiveStatus !== "READY");
          blocked.push({
            dataspaceId,
            errorCode: approvalBlocked
              ? "DSAAS_APPROVAL_BLOCKED"
              : serviceBlocked ? "DSAAS_REQUIRED_SERVICE_BLOCKED" : "DSAAS_RECONCILIATION_BLOCKED",
          });
        } else succeeded += 1;
      } catch (error) {
        throwIfAborted(signal);
        failures.push({ dataspaceId, errorCodes: [boundedErrorCode(error, "DSAAS_SCHEDULED_RECONCILE_FAILED")], nextRetryAt: null });
      }
    }
    if (typeof this.controlPlane.reconciliationBacklog === "function") {
      throwIfAborted(signal);
      try {
        const durable = await this.controlPlane.reconciliationBacklog({ signal });
        throwIfAborted(signal);
        const durableFailureIds = new Set(durable.failures.map(({ dataspaceId }) => dataspaceId));
        const transientFailures = failures.filter(({ dataspaceId }) => !durableFailureIds.has(dataspaceId));
        failures.splice(0, failures.length, ...durable.failures, ...transientFailures);
        blocked.splice(0, blocked.length, ...durable.blocked);
      } catch (error) {
        throwIfAborted(signal);
        this.lastFatalErrorCode = boundedErrorCode(error, "DSAAS_SCHEDULER_BACKLOG_SCAN_FAILED");
        this.lastFailures = failures;
        this.lastBlocked = blocked;
        this.lastTickCompletedAt = this.now();
        return Object.freeze({ attempted: targets.length, blocked: blocked.length, blockedCodes: [], failed: failures.length, failureCodes: [this.lastFatalErrorCode], nextRetryAt: null, skipped: false, succeeded });
      }
    }
    this.lastFatalErrorCode = null;
    this.lastFailures = failures;
    this.lastBlocked = blocked;
    this.lastTickCompletedAt = this.now();
    this.telemetry?.log(failures.length > 0 || blocked.length > 0 ? "WARN" : "INFO", "dsaas.scheduler_tick_completed", {
      "dsaas.scheduler.attempted": targets.length,
      "dsaas.scheduler.blocked": blocked.length,
      "dsaas.scheduler.failed": failures.length,
      "dsaas.scheduler.succeeded": succeeded,
    });
    const failureCodes = [...new Set(failures.flatMap(({ errorCodes }) => errorCodes))].sort();
    const blockedCodes = [...new Set(blocked.map(({ errorCode }) => errorCode))].sort();
    const nextRetryAt = failures.map(({ nextRetryAt: retryAt }) => retryAt).filter(Boolean).sort()[0] ?? null;
    return Object.freeze({
      attempted: targets.length,
      blocked: blocked.length,
      blockedCodes: Object.freeze(blockedCodes),
      failed: failures.length,
      failureCodes: Object.freeze(failureCodes),
      nextRetryAt,
      skipped: false,
      succeeded,
    });
  }

  async start() {
    if (this.started) throw new Error("DSaaS reconcile scheduler is already started");
    this.started = true;
    this.acceptingTicks = true;
    this.#launchTick();
    this.timer = this.setIntervalFn(() => this.#launchTick(), this.config.intervalMs);
    this.timer?.unref?.();
  }

  async waitForIdle() {
    while (this.inFlight) await this.inFlight;
  }

  async stop({ timeoutMs = 30_000, deadline } = {}) {
    this.started = false;
    this.acceptingTicks = false;
    if (this.timer !== null) this.clearIntervalFn(this.timer);
    this.timer = null;
    const execution = this.inFlight;
    const controller = this.inFlightController;
    controller?.abort();
    if (!execution) return;
    const budgetMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 30_000;
    const expiresAt = Number.isFinite(deadline) ? deadline : Date.now() + budgetMs;
    const remainingMs = Math.max(0, expiresAt - Date.now());
    let timer;
    await Promise.race([
      execution.catch((error) => {
        if (!controller?.signal.aborted) throw error;
      }),
      new Promise((resolve) => {
        timer = setTimeout(resolve, remainingMs);
      }),
    ]);
    clearTimeout(timer);
  }

  readiness() {
    const completedAt = this.lastTickCompletedAt === null ? null : Date.parse(this.lastTickCompletedAt);
    const lagMs = completedAt === null ? null : Math.max(0, this.clock().getTime() - completedAt);
    const ready = this.started
      && this.lastFatalErrorCode === null
      && this.lastFailures.length === 0
      && lagMs !== null
      && lagMs <= this.config.readinessMaxLagMs;
    return Object.freeze({
      ready,
      status: ready ? "READY" : this.started ? "NOT_READY" : "STOPPED",
      lastTickCompletedAt: this.lastTickCompletedAt,
      lastFatalErrorCode: this.lastFatalErrorCode,
      lastFailureCodes: Object.freeze([...new Set(this.lastFailures.flatMap(({ errorCodes }) => errorCodes))].sort()),
      lastBlockedCodes: Object.freeze([...new Set(this.lastBlocked.map(({ errorCode }) => errorCode))].sort()),
      lastBlockedCount: this.lastBlocked.length,
      nextRetryAt: this.lastFailures.map(({ nextRetryAt }) => nextRetryAt).filter(Boolean).sort()[0] ?? null,
      lagMs,
      skippedOverlappingTicks: this.skippedOverlappingTicks,
    });
  }
}
