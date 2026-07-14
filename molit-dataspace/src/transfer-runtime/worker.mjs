import { createHash } from "node:crypto";
import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { validateContract } from "./contracts.mjs";
import { assertSafeResourceRef, resolveBinding } from "./binding-registry.mjs";
import { verifyAuthoritativeIdentity, identityFields } from "./identity.mjs";
import { loadTransferJournal, withProviderOperationLock, withTransferJournal } from "./journal.mjs";
import { digest } from "../discovery/stable-json.mjs";

function identity(event) {
  return Object.fromEntries(identityFields.map((field) => [field, event[field]]));
}

function assertSameIdentity(record, event) {
  for (const field of identityFields) {
    assertRuntime(record[field] === event[field], "TRANSFER_JOURNAL_IDENTITY_MISMATCH", `journal ${field} differs from the event`, { field });
  }
}

function addressDigest(dataAddress) {
  const entries = Object.entries(dataAddress).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(entries))).digest("hex");
}

export class ProviderTransferWorker {
  constructor({ connector, provisioners, registry, journalPath, journalIntegrityKey, journalIntegrityKeyId, telemetry, now = () => new Date() }) {
    assertRuntime(typeof journalIntegrityKey === "string" && Buffer.byteLength(journalIntegrityKey, "utf8") >= 32, "TRANSFER_JOURNAL_INTEGRITY_KEY_INVALID", "provider transfer worker requires a journal HMAC key");
    Object.assign(this, { connector, provisioners, registry, journalPath, journalIntegrityKey, journalIntegrityKeyId, telemetry, now });
  }

  #journalOptions() {
    return { integrityKey: this.journalIntegrityKey, integrityKeyId: this.journalIntegrityKeyId };
  }

  async process(rawEvent, { signal } = {}) {
    const event = validateContract("event", structuredClone(rawEvent));
    return withProviderOperationLock(this.journalPath, event.providerPid, () => this.#processLocked(event, signal));
  }

  async #processLocked(event, signal) {
    const status = verifyAuthoritativeIdentity(event, await this.connector.status(event.providerPid, { signal }));
    const existing = await this.#record(event.providerPid);
    const binding = existing?.bindingSnapshot
      ? structuredClone(existing.bindingSnapshot)
      : resolveBinding(this.registry, event.datasetId, event.format, { requireEnabled: event.action === "START" });
    const bindingDigest = digest(binding);
    assertRuntime(binding.transferMode === "PULL", "TRANSFER_MODE_UNSUPPORTED", "this worker provisions PULL transfers only");
    assertSafeResourceRef(binding.resourceRef);
    if (existing) assertRuntime(existing.bindingDigest === bindingDigest, "TRANSFER_BINDING_CHANGED", "immutable transfer binding differs from the authorization snapshot; operator reconciliation is required");
    const result = event.action === "START"
      ? await this.#start(event, status, binding, bindingDigest, signal)
      : await this.#terminate(event, status, binding, bindingDigest, signal);
    this.telemetry?.add("molit_provider_transfer_events_total", 1, { action: event.action, result: result.phase });
    this.telemetry?.log("INFO", "provider transfer lifecycle event processed", { action: event.action, providerPid: event.providerPid, phase: result.phase });
    return result;
  }

  async #record(providerPid) {
    return structuredClone((await loadTransferJournal(this.journalPath, this.#journalOptions())).records[providerPid] ?? null);
  }

  #provisioner(binding) {
    const provisioner = Object.hasOwn(this.provisioners, binding.provisionerId) ? this.provisioners[binding.provisionerId] : undefined;
    assertRuntime(provisioner, "PROVISIONER_NOT_CONFIGURED", "binding refers to an unconfigured provisioner", { provisionerId: binding.provisionerId });
    return provisioner;
  }

  async #start(event, status, binding, bindingDigest, signal) {
    let record = await this.#record(event.providerPid);
    if (record) assertSameIdentity(record, event);
    if (record) assertRuntime(record.provisionerId === binding.provisionerId, "TRANSFER_BINDING_CHANGED", "binding provisioner changed during an existing transfer; operator reconciliation is required");
    if (record?.phase === "terminated" || record?.phase === "terminating" || record?.phase === "revoked") {
      throw new RuntimeError("TRANSFER_STATE_VIOLATION", "a terminated transfer cannot be started again");
    }
    if (!record) {
      assertRuntime(status.state === "START_AUTHORIZED", "TRANSFER_RECONCILIATION_REQUIRED", "connector reports STARTED but the local journal has no provisioning evidence");
      await withTransferJournal(this.journalPath, (journal) => {
        journal.records[event.providerPid] = {
          ...identity(event),
          phase: "authorized",
          provisionerId: binding.provisionerId,
          bindingSnapshot: binding,
          bindingDigest,
          startEventId: event.eventId,
          lastEventId: event.eventId,
          authorizedAt: this.now().toISOString(),
        };
      }, this.#journalOptions());
      record = await this.#record(event.providerPid);
    }

    if (record.phase === "active" && status.state === "STARTED") return { providerPid: event.providerPid, phase: "active", replayed: true };
    assertRuntime(status.state === "START_AUTHORIZED"
      || (status.state === "STARTED" && ["provisioned", "active"].includes(record.phase)),
    "TRANSFER_RECONCILIATION_REQUIRED", "authoritative STARTED requires local provision or active evidence before start recovery", { phase: record.phase, state: status.state });
    let provisionResult;
    if (["authorized", "provisioned", "active"].includes(record.phase)) {
      const result = await this.#provisioner(binding).provision(event, binding, { signal });
      provisionResult = result;
      await withTransferJournal(this.journalPath, (journal) => {
        const current = journal.records[event.providerPid];
        assertSameIdentity(current, event);
        if (current.phase === "authorized") Object.assign(current, {
          phase: "provisioned",
          provisioningId: result.provisioningId,
          provisionIdempotencyKey: result.idempotencyKey,
          dataAddressDigest: addressDigest(result.dataAddress),
          provisionedAt: this.now().toISOString(),
        });
      }, this.#journalOptions());
      record = await this.#record(event.providerPid);
    }
    assertRuntime(["provisioned", "active"].includes(record.phase), "TRANSFER_STATE_VIOLATION", "start reconciliation found an invalid journal phase", { phase: record.phase });
    assertRuntime(provisionResult.provisioningId === record.provisioningId && provisionResult.idempotencyKey === record.provisionIdempotencyKey, "PROVISIONER_IDEMPOTENCY_VIOLATION", "replayed provision response changed its provisioning identity");
    assertRuntime(provisionResult && addressDigest(provisionResult.dataAddress) === record.dataAddressDigest, "PROVISIONER_IDEMPOTENCY_VIOLATION", "replayed provision response changed its DataAddress");
    await this.connector.acknowledgeStart(event, provisionResult.dataAddress, { signal });
    await withTransferJournal(this.journalPath, (journal) => {
      const current = journal.records[event.providerPid];
      if (current.phase === "provisioned") Object.assign(current, {
        phase: "active",
        acknowledgedAt: this.now().toISOString(),
      });
    }, this.#journalOptions());
    return { providerPid: event.providerPid, phase: "active", dataAddressDigest: record.dataAddressDigest };
  }

  async #terminate(event, status, binding, bindingDigest, signal) {
    let record = await this.#record(event.providerPid);
    if (record) assertSameIdentity(record, event);
    if (record) assertRuntime(record.provisionerId === binding.provisionerId, "TRANSFER_BINDING_CHANGED", "binding provisioner changed during an existing transfer; operator reconciliation is required");
    if (record?.phase === "terminated") {
      if (status.state === "TERMINATED") return { providerPid: event.providerPid, phase: "terminated", replayed: true };
      await this.connector.acknowledgeTermination(event, { signal });
      const reconciled = verifyAuthoritativeIdentity(event, await this.connector.status(event.providerPid, { signal }));
      assertRuntime(
        reconciled.state === "TERMINATED",
        "CONNECTOR_TERMINATION_RECONCILIATION_FAILED",
        "termination acknowledgement did not converge the authoritative connector state to TERMINATED",
        { state: reconciled.state },
      );
      return { providerPid: event.providerPid, phase: "terminated", replayed: true, reconciled: true };
    }
    if (record?.phase === "revoked" && status.state === "TERMINATED") {
      await withTransferJournal(this.journalPath, (journal) => {
        const current = journal.records[event.providerPid];
        assertSameIdentity(current, event);
        if (current.phase === "revoked") Object.assign(current, {
          phase: "terminated",
          terminatedAt: this.now().toISOString(),
          terminationRecoveredFromStatus: true,
        });
      }, this.#journalOptions());
      return { providerPid: event.providerPid, phase: "terminated", replayed: true, reconciled: true };
    }
    if (status.state === "TERMINATED") throw new RuntimeError("TRANSFER_RECONCILIATION_REQUIRED", "connector reports TERMINATED but the local journal has no completed revocation evidence");
    assertRuntime(status.state === "TERMINATION_AUTHORIZED", "TRANSFER_RECONCILIATION_REQUIRED", "destructive revocation requires authoritative TERMINATION_AUTHORIZED state", { state: status.state });
    await withTransferJournal(this.journalPath, (journal) => {
      const current = journal.records[event.providerPid];
      if (current) {
        assertSameIdentity(current, event);
        if (["authorized", "provisioned", "active"].includes(current.phase)) Object.assign(current, { phase: "terminating", provisioningId: current.provisioningId ?? null, terminationEventId: event.eventId, lastEventId: event.eventId, terminationAuthorizedAt: this.now().toISOString() });
      } else {
        journal.records[event.providerPid] = { ...identity(event), provisionerId: binding.provisionerId, bindingSnapshot: binding, bindingDigest, provisioningId: null, terminationEventId: event.eventId, lastEventId: event.eventId, phase: "terminating", terminationAuthorizedAt: this.now().toISOString(), recoveredWithoutStartJournal: true };
      }
    }, this.#journalOptions());
    record = await this.#record(event.providerPid);
    if (record.phase === "terminating") {
      const revoked = await this.#provisioner(binding).revoke(event, binding, {
        signal,
        provisioningId: record.provisioningId,
      });
      assertRuntime(/^[a-f0-9]{64}$/u.test(revoked.receiptDigest ?? ""), "PLATFORM_REVOKE_RECEIPT_INVALID", "provisioner did not return a canonical revoke receipt digest");
      await withTransferJournal(this.journalPath, (journal) => {
        const current = journal.records[event.providerPid];
        if (current.phase === "terminating") Object.assign(current, { phase: "revoked", revokeIdempotencyKey: revoked.idempotencyKey, revokeReceiptDigest: revoked.receiptDigest, revokedAt: this.now().toISOString() });
      }, this.#journalOptions());
    }
    await this.connector.acknowledgeTermination(event, { signal });
    await withTransferJournal(this.journalPath, (journal) => {
      const current = journal.records[event.providerPid];
      if (current.phase === "revoked") Object.assign(current, { phase: "terminated", terminatedAt: this.now().toISOString() });
    }, this.#journalOptions());
    return { providerPid: event.providerPid, phase: "terminated" };
  }
}
