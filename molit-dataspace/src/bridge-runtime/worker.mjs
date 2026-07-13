import { randomUUID } from "node:crypto";
import { ack, claim, enqueue, nack, recoverExpiredLeases, renewLease, withRuntimeLock } from "./durable-store.mjs";
import { operationalEnvelope } from "./clients.mjs";
import { digest } from "../discovery/stable-json.mjs";

export class BridgeRuntime {
  constructor({ statePath, providerId, adapter, projector, approvalRegistry, approvalRegistryProvider, managementClient, telemetry, queue = {} }) {
    Object.assign(this, { statePath, providerId, adapter, projector, approvalRegistry, approvalRegistryProvider, managementClient, telemetry, queue });
    this.owner = `worker-${process.pid}-${randomUUID()}`;
  }

  async poll({ signal, dryRun = false } = {}) {
    let checkpoint;
    await withRuntimeLock(this.statePath, (state) => {
      checkpoint = structuredClone(state.checkpoints[this.providerId] ?? {});
    });
    const result = await this.adapter.poll(checkpoint, { signal });
    const accepted = [];
    const rejected = [];
    const approvals = this.approvalRegistryProvider ? await this.approvalRegistryProvider() : this.approvalRegistry;
    for (const item of result.records) {
      try {
        const record = await this.projector.project(item.record);
        operationalEnvelope(record, approvals, { sourceSystemId: this.providerId, sourceRecordId: item.id, resourceVersion: item.version });
        accepted.push({ ...item, record });
      } catch (error) {
        rejected.push({ id: item.id, version: item.version, code: error.code });
      }
    }
    if (!dryRun) {
      await withRuntimeLock(this.statePath, (state) => {
        for (const item of accepted) {
          enqueue(state, {
            idempotencyKey: `publication:${digest({ providerId: this.providerId, sourceRecordId: item.id, resourceVersion: item.version })}`,
            payload: { providerId: this.providerId, sourceId: item.id, sourceVersion: item.version, record: item.record },
          });
          delete state.quarantine[`${this.providerId}:${item.id}`];
        }
        for (const item of rejected) state.quarantine[`${this.providerId}:${item.id}`] = { ...item, providerId: this.providerId, observedAt: new Date().toISOString() };
        if (!result.notModified && rejected.length === 0) state.checkpoints[this.providerId] = result.checkpoint;
      });
    }
    this.telemetry?.add("molit_bridge_poll_records_total", result.records.length, { providerId: this.providerId });
    this.telemetry?.add("molit_bridge_poll_rejected_total", rejected.length, { providerId: this.providerId });
    return { fetched: result.records.length, accepted: accepted.length, rejected, notModified: result.notModified, dryRun };
  }

  async dispatch({ signal, dryRun = false } = {}) {
    if (dryRun) {
      let count = 0;
      await withRuntimeLock(this.statePath, (state) => { count = Object.keys(state.queue).length; });
      return { claimed: 0, delivered: 0, failed: 0, planned: count, dryRun: true };
    }
    let items;
    await withRuntimeLock(this.statePath, (state) => {
      const recovered = recoverExpiredLeases(state);
      this.telemetry?.add("molit_bridge_queue_recovered_total", recovered);
      items = claim(state, { owner: this.owner, limit: 1, leaseMs: this.queue.leaseMs ?? 60_000 });
    });
    let delivered = 0;
    let failed = 0;
    for (const item of items) {
      const leaseMs = this.queue.leaseMs ?? 60_000;
      let heartbeat = Promise.resolve();
      let heartbeatError;
      const leaseController = new AbortController();
      const timer = setInterval(() => {
        heartbeat = withRuntimeLock(this.statePath, (state) => renewLease(state, item.id, this.owner, leaseMs)).catch((error) => {
          heartbeatError = error;
          leaseController.abort(error);
          this.telemetry?.log("ERROR", "lease heartbeat failed", { queueId: item.id, code: error?.code ?? error?.name });
        });
      }, this.queue.leaseHeartbeatMs ?? Math.max(1_000, Math.floor(leaseMs / 3)));
      timer.unref();
      try {
        const approvals = this.approvalRegistryProvider ? await this.approvalRegistryProvider() : this.approvalRegistry;
        const envelope = operationalEnvelope(item.payload.record, approvals, { sourceSystemId: item.payload.providerId, sourceRecordId: item.payload.sourceId, resourceVersion: item.payload.sourceVersion });
        if (heartbeatError) throw heartbeatError;
        const requestSignal = signal ? AbortSignal.any([signal, leaseController.signal]) : leaseController.signal;
        const published = await this.managementClient.publishOffering(envelope.offering, item.id, { signal: requestSignal });
        clearInterval(timer);
        await heartbeat;
        if (heartbeatError) throw heartbeatError;
        await withRuntimeLock(this.statePath, (state) => ack(state, item.id, this.owner, published));
        delivered += 1;
      } catch (error) {
        clearInterval(timer);
        await heartbeat;
        await withRuntimeLock(this.statePath, (state) => nack(state, item.id, this.owner, error, {
          maxAttempts: this.queue.maxAttempts ?? 8,
          delayMs: Math.min((this.queue.retryBaseMs ?? 1_000) * (2 ** item.attempts), this.queue.retryMaxMs ?? 300_000),
        }));
        this.telemetry?.log("ERROR", "dispatch failed", { queueId: item.id, code: error?.code ?? error?.name });
        failed += 1;
      }
    }
    this.telemetry?.set("molit_bridge_queue_claimed", items.length);
    return { claimed: items.length, delivered, failed, dryRun: false };
  }

  async runOnce(options = {}) {
    const poll = await this.poll(options);
    const dispatch = await this.dispatch(options);
    return { poll, dispatch, metrics: this.telemetry?.snapshot() };
  }
}
