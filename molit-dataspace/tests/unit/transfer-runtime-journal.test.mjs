import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withProviderOperationLock, withTransferJournal, loadTransferJournal } from "../../src/transfer-runtime/journal.mjs";
import { digest } from "../../src/discovery/stable-json.mjs";

test("journal is atomically persisted and forbids DataAddress material", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-journal-"));
  const path = join(directory, "journal.json");
  const bindingSnapshot = { datasetId: "d", format: "f", transferMode: "PULL", provisionerId: "adapter", resourceRef: { object: "x" }, enabled: true };
  const base = { providerPid: "p", consumerPid: "c", agreementId: "a", datasetId: "d", format: "f", provisionerId: "adapter", bindingSnapshot, bindingDigest: digest(bindingSnapshot), phase: "authorized", authorizedAt: new Date().toISOString() };
  await withTransferJournal(path, (journal) => { journal.records.p = base; });
  assert.equal((await loadTransferJournal(path)).records.p.phase, "authorized");
  await assert.rejects(withTransferJournal(path, (journal) => { journal.records.p.dataAddress = { endpoint: "secret" }; }), { code: "TRANSFER_JOURNAL_SECRET_FORBIDDEN" });
  assert.doesNotMatch(await readFile(path, "utf8"), /secret/u);
});

test("journal rejects a binding snapshot whose digest was not updated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-tamper-"));
  const path = join(directory, "journal.json");
  const bindingSnapshot = { datasetId: "d", format: "f", transferMode: "PULL", provisionerId: "adapter", resourceRef: { object: "x" }, enabled: true };
  await withTransferJournal(path, (journal) => {
    journal.records.p = { providerPid: "p", consumerPid: "c", agreementId: "a", datasetId: "d", format: "f", provisionerId: "adapter", bindingSnapshot, bindingDigest: digest(bindingSnapshot), phase: "authorized" };
  });
  await assert.rejects(withTransferJournal(path, (journal) => { journal.records.p.bindingSnapshot.resourceRef.object = "different"; }), { code: "TRANSFER_JOURNAL_INVALID" });
});

test("provider operation lock serializes external lifecycle side effects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-lock-"));
  const path = join(directory, "journal.json");
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = withProviderOperationLock(path, "provider-1", () => gate);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await assert.rejects(withProviderOperationLock(path, "provider-1", async () => {}), { code: "TRANSFER_OPERATION_IN_PROGRESS" });
  release();
  await first;
});
