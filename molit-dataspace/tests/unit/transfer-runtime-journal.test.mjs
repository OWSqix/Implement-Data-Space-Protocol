import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withProviderOperationLock, withTransferJournal, loadTransferJournal } from "../../src/transfer-runtime/journal.mjs";
import { digest } from "../../src/discovery/stable-json.mjs";

const INTEGRITY = Object.freeze({
  integrityKey: "test-journal-hmac-key-32-bytes-minimum-value",
  integrityKeyId: "test-journal-key-1",
});

test("journal is atomically persisted and forbids DataAddress material", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-journal-"));
  const path = join(directory, "journal.json");
  const bindingSnapshot = { datasetId: "d", format: "f", transferMode: "PULL", provisionerId: "adapter", resourceRef: { object: "x" }, enabled: true };
  const base = { providerPid: "p", consumerPid: "c", agreementId: "a", datasetId: "d", format: "f", provisionerId: "adapter", bindingSnapshot, bindingDigest: digest(bindingSnapshot), phase: "authorized", authorizedAt: new Date().toISOString() };
  await withTransferJournal(path, (journal) => { journal.records.p = base; }, INTEGRITY);
  assert.equal((await loadTransferJournal(path, INTEGRITY)).records.p.phase, "authorized");
  await assert.rejects(withTransferJournal(path, (journal) => { journal.records.p.dataAddress = { endpoint: "secret" }; }, INTEGRITY), { code: "TRANSFER_JOURNAL_SECRET_FORBIDDEN" });
  assert.doesNotMatch(await readFile(path, "utf8"), /secret/u);
});

test("journal rejects a binding snapshot whose digest was not updated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-tamper-"));
  const path = join(directory, "journal.json");
  const bindingSnapshot = { datasetId: "d", format: "f", transferMode: "PULL", provisionerId: "adapter", resourceRef: { object: "x" }, enabled: true };
  await withTransferJournal(path, (journal) => {
    journal.records.p = { providerPid: "p", consumerPid: "c", agreementId: "a", datasetId: "d", format: "f", provisionerId: "adapter", bindingSnapshot, bindingDigest: digest(bindingSnapshot), phase: "authorized" };
  }, INTEGRITY);
  await assert.rejects(withTransferJournal(path, (journal) => { journal.records.p.bindingSnapshot.resourceRef.object = "different"; }, INTEGRITY), { code: "TRANSFER_JOURNAL_INVALID" });
});

test("journal HMAC rejects a forged revoked phase and receipt digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-journal-forgery-"));
  const path = join(directory, "journal.json");
  const bindingSnapshot = { datasetId: "d", format: "f", transferMode: "PULL", provisionerId: "adapter", resourceRef: { object: "x" }, enabled: true };
  await withTransferJournal(path, (journal) => {
    journal.records.p = { providerPid: "p", consumerPid: "c", agreementId: "a", datasetId: "d", format: "f", provisionerId: "adapter", bindingSnapshot, bindingDigest: digest(bindingSnapshot), phase: "authorized" };
  }, INTEGRITY);
  const forged = JSON.parse(await readFile(path, "utf8"));
  Object.assign(forged.records.p, {
    phase: "revoked",
    provisioningId: null,
    revokeIdempotencyKey: "forged-revoke",
    revokeReceiptDigest: "f".repeat(64),
    revokedAt: new Date().toISOString(),
  });
  await writeFile(path, JSON.stringify(forged));
  await assert.rejects(loadTransferJournal(path, INTEGRITY), { code: "TRANSFER_JOURNAL_INTEGRITY_INVALID" });
});

test("journal HMAC authenticates its domain, version, algorithm, and key ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-journal-metadata-"));
  const path = join(directory, "journal.json");
  const bindingSnapshot = { datasetId: "d", format: "f", transferMode: "PULL", provisionerId: "adapter", resourceRef: { object: "x" }, enabled: true };
  await withTransferJournal(path, (journal) => {
    journal.records.p = { providerPid: "p", consumerPid: "c", agreementId: "a", datasetId: "d", format: "f", provisionerId: "adapter", bindingSnapshot, bindingDigest: digest(bindingSnapshot), phase: "authorized" };
  }, INTEGRITY);
  const original = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(original.integrity, {
    domain: "molit.provider-transfer-journal.integrity",
    version: 1,
    algorithm: "hmac-sha256",
    keyId: INTEGRITY.integrityKeyId,
    mac: original.integrity.mac,
  });

  for (const [field, value, options = INTEGRITY] of [
    ["domain", "other.journal.integrity"],
    ["version", 2],
    ["algorithm", "hmac-sha512"],
    ["keyId", "test-journal-key-2", { ...INTEGRITY, integrityKeyId: "test-journal-key-2" }],
  ]) {
    const forged = structuredClone(original);
    forged.integrity[field] = value;
    await writeFile(path, JSON.stringify(forged));
    await assert.rejects(loadTransferJournal(path, options), { code: "TRANSFER_JOURNAL_INTEGRITY_INVALID" });
  }
});

test("unsigned journal files fail closed instead of being adopted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-journal-unsigned-"));
  const path = join(directory, "journal.json");
  await writeFile(path, JSON.stringify({ schemaVersion: "molit.provider-transfer-journal/1", revision: 0, records: {}, integrity: null }));
  await assert.rejects(loadTransferJournal(path, INTEGRITY), { code: "TRANSFER_JOURNAL_INTEGRITY_INVALID" });
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

test("stale transfer journal lock fails closed until operator recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-stale-lock-"));
  const path = join(directory, "journal.json");
  await writeFile(`${path}.lock`, `${JSON.stringify({ pid: 99999999, host: "fixture", recovery: "operator-only" })}\n`);
  await assert.rejects(withTransferJournal(path, async () => {}, INTEGRITY), { code: "TRANSFER_JOURNAL_LOCKED" });
  await unlink(`${path}.lock`);
  await withTransferJournal(path, async () => {}, INTEGRITY);
});


// FR-AUD-001 — participant, negotiation PID, Agreement, Transfer PID,
// platform external resource와 source request의 상관관계. journal 레코드가
// 이 사슬 전체를 보존하며, provisioned 단계에서 platform external
// resource(provisioningId) 없이는 저장 자체가 거부된다 — 검증 계획
// OP-AUD-001의 external resource 축.
test("OP-AUD-001: a provisioned journal record preserves the full correlation chain including the platform external resource", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-journal-correlation-"));
  const path = join(directory, "journal.json");
  const bindingSnapshot = { datasetId: "d", format: "f", transferMode: "PULL", provisionerId: "adapter", resourceRef: { object: "x" }, enabled: true };
  const provisioned = {
    providerPid: "p", consumerPid: "c", agreementId: "a", datasetId: "d", format: "f",
    provisionerId: "adapter", bindingSnapshot, bindingDigest: digest(bindingSnapshot),
    phase: "provisioned", authorizedAt: new Date().toISOString(),
    provisioningId: "ext-resource-77", provisionIdempotencyKey: "prov-key-1",
    dataAddressDigest: "0".repeat(64), provisionedAt: new Date().toISOString(),
  };
  await withTransferJournal(path, (journal) => { journal.records.p = provisioned; }, INTEGRITY);
  const record = (await loadTransferJournal(path, INTEGRITY)).records.p;
  // 사슬의 모든 고리 — 양측 Transfer PID, Agreement, Dataset(원천 요청 결속),
  // platform external resource, source binding 지문.
  assert.equal(record.providerPid, "p");
  assert.equal(record.consumerPid, "c");
  assert.equal(record.agreementId, "a");
  assert.equal(record.datasetId, "d");
  assert.equal(record.provisioningId, "ext-resource-77");
  assert.equal(record.bindingDigest, digest(bindingSnapshot));
  assert.equal(record.bindingSnapshot.resourceRef.object, "x");

  // 실패축 — provisioned 단계에서 external resource가 빠지면 사슬이 끊기므로 거부.
  const broken = { ...provisioned, providerPid: "q" };
  delete broken.provisioningId;
  await assert.rejects(
    withTransferJournal(path, (journal) => { journal.records.q = broken; }, INTEGRITY),
    { code: "TRANSFER_JOURNAL_INVALID" },
  );
});
