import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateContract } from "../../src/transfer-runtime/contracts.mjs";
import { loadBindingRegistry, resolveBinding } from "../../src/transfer-runtime/binding-registry.mjs";
import { verifyAuthoritativeIdentity } from "../../src/transfer-runtime/identity.mjs";

const event = {
  schemaVersion: "molit.provider-transfer-event/1",
  eventId: "evt-1",
  action: "START",
  providerPid: "p-1",
  consumerPid: "c-1",
  agreementId: "a-1",
  datasetId: "d-1",
  format: "HttpData-PULL",
};

test("transfer event is closed and authoritative identity is exact", () => {
  assert.equal(validateContract("event", event), event);
  assert.throws(() => validateContract("event", { ...event, sourceUrl: "https://attacker.example/data" }), { code: "TRANSFER_CONTRACT_INVALID" });
  assert.throws(() => verifyAuthoritativeIdentity(event, { ...event, state: "START_AUTHORIZED", agreementId: "other" }), { code: "TRANSFER_IDENTITY_MISMATCH" });
  assert.throws(() => verifyAuthoritativeIdentity(event, { ...event, state: "REQUESTED" }), { code: "TRANSFER_NOT_AUTHORIZED" });
});

test("binding registry rejects duplicate dataset and format and fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-binding-"));
  const path = join(directory, "registry.json");
  const binding = { datasetId: "d-1", format: "HttpData-PULL", transferMode: "PULL", provisionerId: "p", resourceRef: { object: "private-object" }, enabled: true };
  await writeFile(path, JSON.stringify({ schemaVersion: "molit.transfer-binding-registry/1", bindings: [binding, binding] }));
  await assert.rejects(loadBindingRegistry(path), { code: "DUPLICATE_TRANSFER_BINDING" });
  assert.throws(() => resolveBinding({ bindings: [{ ...binding, enabled: false }] }, "d-1", "HttpData-PULL"), { code: "TRANSFER_BINDING_NOT_FOUND" });
  await writeFile(path, JSON.stringify({ schemaVersion: "molit.transfer-binding-registry/1", bindings: [{ ...binding, resourceRef: { apiToken: "must-not-persist" } }] }));
  await assert.rejects(loadBindingRegistry(path), { code: "BINDING_SECRET_FORBIDDEN" });
});
