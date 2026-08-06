import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadTransferJournal } from "../../src/transfer-runtime/journal.mjs";
import { ProviderTransferWorker } from "../../src/transfer-runtime/worker.mjs";

const IDENTITY = Object.freeze({
  providerPid: "provider-lifecycle-1",
  consumerPid: "consumer-lifecycle-1",
  agreementId: "agreement-lifecycle-1",
  datasetId: "dataset-lifecycle-1",
  format: "HttpData-PULL",
});

const REGISTRY = Object.freeze({
  bindings: [Object.freeze({
    datasetId: IDENTITY.datasetId,
    format: IDENTITY.format,
    transferMode: "PULL",
    provisionerId: "platform",
    resourceRef: Object.freeze({ catalogObject: "ROAD_SPEED" }),
    enabled: true,
  })],
});

const JOURNAL_INTEGRITY = Object.freeze({
  journalIntegrityKey: "test-worker-journal-hmac-key-32-bytes-minimum",
  journalIntegrityKeyId: "test-worker-journal-key-1",
});
const JOURNAL_OPTIONS = Object.freeze({
  integrityKey: JOURNAL_INTEGRITY.journalIntegrityKey,
  integrityKeyId: JOURNAL_INTEGRITY.journalIntegrityKeyId,
});

function event(action, eventId) {
  return { schemaVersion: "molit.provider-transfer-event/1", eventId, action, ...IDENTITY };
}

test("STARTED without local provision evidence is rejected before provisioning", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-start-gate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let state = "START_AUTHORIZED";
  let provisionCalls = 0;
  const worker = new ProviderTransferWorker({
    connector: {
      async status() { return { ...IDENTITY, state }; },
      async acknowledgeStart() {},
      async acknowledgeTermination() {},
    },
    provisioners: {
      platform: {
        async provision() {
          provisionCalls += 1;
          const error = new Error("injected provisioning failure");
          error.code = "PROVISION_INJECTED_FAILURE";
          throw error;
        },
        async revoke() { throw new Error("not expected"); },
      },
    },
    registry: REGISTRY,
    journalPath: join(directory, "journal.json"),
    ...JOURNAL_INTEGRITY,
  });
  const start = event("START", "start-gate-1");
  await assert.rejects(worker.process(start), { code: "PROVISION_INJECTED_FAILURE" });
  assert.equal(provisionCalls, 1);

  state = "STARTED";
  await assert.rejects(worker.process(start), { code: "TRANSFER_RECONCILIATION_REQUIRED" });
  assert.equal(provisionCalls, 1, "STARTED with only an authorized journal must not reprovision access");

  for (const terminationState of ["TERMINATION_AUTHORIZED", "TERMINATED"]) {
    state = terminationState;
    await assert.rejects(worker.process(start), { code: "TRANSFER_NOT_AUTHORIZED" });
    assert.equal(provisionCalls, 1, `${terminationState} must not provision access`);
  }
});

test("STARTED recovery rehydrates DataAddress only when local provision evidence exists", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-start-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let state = "START_AUTHORIZED";
  let provisionCalls = 0;
  let startAcks = 0;
  let failAfterStartAck = true;
  const result = {
    provisioningId: "provisioning-start-recovery-1",
    idempotencyKey: "provision-start-recovery-key-1",
    dataAddress: { type: "HttpData", endpoint: "https://data.internal.example/export/start-recovery" },
  };
  const worker = new ProviderTransferWorker({
    connector: {
      async status() { return { ...IDENTITY, state }; },
      async acknowledgeStart() {
        startAcks += 1;
        state = "STARTED";
        if (failAfterStartAck) {
          failAfterStartAck = false;
          const error = new Error("injected post-ack failure");
          error.code = "START_ACK_INJECTED_FAILURE";
          throw error;
        }
      },
      async acknowledgeTermination() {},
    },
    provisioners: {
      platform: {
        async provision() { provisionCalls += 1; return structuredClone(result); },
        async revoke() { throw new Error("not expected"); },
      },
    },
    registry: REGISTRY,
    journalPath: join(directory, "journal.json"),
    ...JOURNAL_INTEGRITY,
  });
  const start = event("START", "start-recovery-1");
  await assert.rejects(worker.process(start), { code: "START_ACK_INJECTED_FAILURE" });
  assert.equal(state, "STARTED");

  const recovered = await worker.process(start);
  assert.equal(recovered.phase, "active");
  assert.equal(provisionCalls, 2, "provisioned evidence permits an idempotent DataAddress rehydration");
  assert.equal(startAcks, 2);
});

test("termination without a start receipt binds an explicit null provisioning ID", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-terminate-without-start-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journalPath = join(directory, "journal.json");
  let state = "TERMINATION_AUTHORIZED";
  let revokeOptions;
  const worker = new ProviderTransferWorker({
    connector: {
      async status() { return { ...IDENTITY, state }; },
      async acknowledgeStart() { throw new Error("not expected"); },
      async acknowledgeTermination() { state = "TERMINATED"; },
    },
    provisioners: {
      platform: {
        async provision() { throw new Error("not expected"); },
        async revoke(_event, _binding, options) {
          revokeOptions = options;
          return { idempotencyKey: "revoke-without-start-key-1", receiptDigest: "c".repeat(64) };
        },
      },
    },
    registry: REGISTRY,
    journalPath,
    ...JOURNAL_INTEGRITY,
  });

  const result = await worker.process(event("TERMINATE", "terminate-without-start-1"));
  assert.equal(result.phase, "terminated");
  assert.equal(revokeOptions.provisioningId, null);
  assert.equal((await loadTransferJournal(journalPath, JOURNAL_OPTIONS)).records[IDENTITY.providerPid].provisioningId, null);
});

test("termination lifecycle gate rejects stale states before revoke and preserves terminated replay", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-terminate-gate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let state = "START_AUTHORIZED";
  let provisionCalls = 0;
  let revokeCalls = 0;
  let startAcks = 0;
  let terminationAcks = 0;
  const worker = new ProviderTransferWorker({
    connector: {
      async status() { return { ...IDENTITY, state }; },
      async acknowledgeStart() { startAcks += 1; state = "STARTED"; },
      async acknowledgeTermination() { terminationAcks += 1; state = "TERMINATED"; },
    },
    provisioners: {
      platform: {
        async provision() {
          provisionCalls += 1;
          return {
            provisioningId: "provisioning-lifecycle-1",
            idempotencyKey: "provision-lifecycle-key-1",
            dataAddress: { type: "HttpData", endpoint: "https://data.internal.example/export/lifecycle" },
          };
        },
        async revoke() {
          revokeCalls += 1;
          return { idempotencyKey: "revoke-lifecycle-key-1", receiptDigest: "a".repeat(64) };
        },
      },
    },
    registry: REGISTRY,
    journalPath: join(directory, "journal.json"),
    ...JOURNAL_INTEGRITY,
  });
  const start = event("START", "start-gate-2");
  const terminate = event("TERMINATE", "terminate-gate-2");
  await worker.process(start);
  assert.equal(provisionCalls, 1);
  assert.equal(startAcks, 1);

  state = "TERMINATED";
  await assert.rejects(worker.process(terminate), { code: "TRANSFER_RECONCILIATION_REQUIRED" });
  assert.equal(revokeCalls, 0, "TERMINATED without local termination evidence must not revoke resources");

  state = "STARTED";
  await assert.rejects(worker.process(terminate), { code: "TRANSFER_NOT_AUTHORIZED" });
  assert.equal(revokeCalls, 0, "stale TERMINATE at STARTED must not revoke resources");

  state = "TERMINATION_AUTHORIZED";
  await worker.process(terminate);
  assert.equal(revokeCalls, 1);
  assert.equal(terminationAcks, 1);
  assert.equal(state, "TERMINATED");
  worker.provisioners = {};
  const replay = await worker.process(terminate);
  assert.equal(replay.replayed, true, "a completed replay does not require a retired provisioner adapter");
  assert.equal(revokeCalls, 1);
  assert.equal(terminationAcks, 1);
});

test("revoked journal finalizes from exact authoritative TERMINATED after an acknowledgement crash", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-termination-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journalPath = join(directory, "journal.json");
  let state = "START_AUTHORIZED";
  let revokeCalls = 0;
  let terminationAcks = 0;
  let failAfterTerminationAck = true;
  const worker = new ProviderTransferWorker({
    connector: {
      async status() { return { ...IDENTITY, state }; },
      async acknowledgeStart() { state = "STARTED"; },
      async acknowledgeTermination() {
        terminationAcks += 1;
        state = "TERMINATED";
        if (failAfterTerminationAck) {
          failAfterTerminationAck = false;
          const error = new Error("injected post-termination-ack failure");
          error.code = "TERMINATION_ACK_INJECTED_FAILURE";
          throw error;
        }
      },
    },
    provisioners: {
      platform: {
        async provision() {
          return {
            provisioningId: "provisioning-termination-recovery-1",
            idempotencyKey: "provision-termination-recovery-key-1",
            dataAddress: { type: "HttpData", endpoint: "https://data.internal.example/export/termination-recovery" },
          };
        },
        async revoke() {
          revokeCalls += 1;
          return { idempotencyKey: "revoke-termination-recovery-key-1", receiptDigest: "b".repeat(64) };
        },
      },
    },
    registry: REGISTRY,
    journalPath,
    ...JOURNAL_INTEGRITY,
  });
  await worker.process(event("START", "start-termination-recovery-1"));
  state = "TERMINATION_AUTHORIZED";
  const terminate = event("TERMINATE", "terminate-recovery-1");
  await assert.rejects(worker.process(terminate), { code: "TERMINATION_ACK_INJECTED_FAILURE" });
  assert.equal((await loadTransferJournal(journalPath, JOURNAL_OPTIONS)).records[IDENTITY.providerPid].phase, "revoked");
  assert.equal(state, "TERMINATED");

  worker.provisioners = {};
  const recovered = await worker.process(terminate);
  assert.equal(recovered.phase, "terminated");
  assert.equal(recovered.reconciled, true);
  assert.equal(revokeCalls, 1, "authoritative TERMINATED with revocation evidence must not repeat revoke");
  assert.equal(terminationAcks, 1, "authoritative TERMINATED recovery must not repeat acknowledgement");
  const record = (await loadTransferJournal(journalPath, JOURNAL_OPTIONS)).records[IDENTITY.providerPid];
  assert.equal(record.phase, "terminated");
  assert.equal(record.terminationRecoveredFromStatus, true);
});


// A 3차(DSP·PLT·ID) 보강에서 확인된 구현 공백 — 시험으로 닫을 수 없어
// todo와 검증 계획 §4.2의 GAP-IMPL 항목으로 등록한다.

test(
  "IT-PLT-003(축 유보): 외부 자원의 scope는 Offering·Agreement·Transfer·Request 중 하나로 기록돼야 한다",
  { todo: "transfer contracts·binding registry 어디에도 scope 어휘가 없다. 자원-scope 기록이 미구현이다(GAP-IMPL-09)" },
  () => {},
);

test(
  "IT-PLT-004(축 유보): Dataset별 provisioning trigger 선택(FINALIZED ACK·Transfer Request ACK·첫 payload/TTL)이 기록돼야 한다",
  { todo: "현행 worker는 Connector 승인 뒤 START 단일 경로만 갖는다. trigger 어휘·선택·기록이 미구현이다(GAP-IMPL-10). FINALIZED 전 provision 금지 축은 워커 실행 계약으로 충족" },
  () => {},
);

test(
  "IT-PLT-005(축 유보): 정지·재개 command와 TERMINATE의 대상 external resource ID가 필요하다",
  { todo: "구현된 action은 START·TERMINATE뿐이고 revoke-result schema에 externalResourceId 필드가 없다(GAP-IMPL-11). 생성 응답 ID·멱등키 저장은 journal 시험이 이미 고정" },
  () => {},
);

test(
  "ST-PLT-004(축 유보): Agreement 만료·철회 시 active Transfer와 Agreement scope 자원이 종료돼야 한다",
  { todo: "만료·철회 승인의 신규 dispatch 차단은 runtime-approval 시험이 고정했으나, 이미 활성인 Transfer·자원의 종료 전파는 미구현이다(GAP-IMPL-13)" },
  () => {},
);
