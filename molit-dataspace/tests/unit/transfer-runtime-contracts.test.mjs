import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateContract } from "../../src/transfer-runtime/contracts.mjs";
import { assertSafeResourceRef, loadBindingRegistry, resolveBinding } from "../../src/transfer-runtime/binding-registry.mjs";
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

test("revoke result is a closed canonical inactive receipt", () => {
  const receipt = {
    providerPid: event.providerPid,
    consumerPid: event.consumerPid,
    agreementId: event.agreementId,
    datasetId: event.datasetId,
    format: event.format,
    provisioningId: "provisioning-1",
    provisioningKey: "a".repeat(64),
    resourceRefDigest: "b".repeat(64),
    requestDigest: "c".repeat(64),
    state: "REVOKED",
  };
  assert.equal(validateContract("revokeResult", receipt), receipt);
  assert.equal(validateContract("revokeResult", { ...receipt, provisioningId: null }).provisioningId, null);
  const { provisioningId: _omitted, ...withoutProvisioningId } = receipt;
  assert.throws(() => validateContract("revokeResult", withoutProvisioningId), { code: "TRANSFER_CONTRACT_INVALID" });
  assert.throws(() => validateContract("revokeResult", { ...receipt, provisioningId: "" }), { code: "TRANSFER_CONTRACT_INVALID" });
  assert.throws(() => validateContract("revokeResult", { ...receipt, agreementId: undefined }), { code: "TRANSFER_CONTRACT_INVALID" });
  assert.throws(() => validateContract("revokeResult", { ...receipt, state: "ACTIVE" }), { code: "TRANSFER_CONTRACT_INVALID" });
  assert.throws(() => validateContract("revokeResult", { ...receipt, evidence: "unbound" }), { code: "TRANSFER_CONTRACT_INVALID" });
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

test("resourceRef accepts typed identifiers and rejects credential-bearing values and URLs", () => {
  assert.deepEqual(
    assertSafeResourceRef({ objectId: "urn:molit:object:road-speed-hourly", revision: 7, immutable: true, endpoint: "https://data.example/objects/road-speed-hourly" }),
    { objectId: "urn:molit:object:road-speed-hourly", revision: 7, immutable: true, endpoint: "https://data.example/objects/road-speed-hourly" },
  );

  const unsafe = [
    { objectId: "Bearer must-not-persist" },
    { objectId: "token=must-not-persist" },
    { objectId: "password:must-not-persist" },
    { endpoint: "https://user:password@data.example/object" },
    { endpoint: "https://data.example/object?access_token=must-not-persist" },
    { endpoint: "https://data.example/object?x-amz-signature=must-not-persist" },
    { endpoint: "https://data.example/object?X-Goog-Signature=must-not-persist" },
    { endpoint: "https://data.example/object?GoogleAccessId=must-not-persist" },
    { endpoint: "https://data.example/object?client_secret=must-not-persist" },
    { endpoint: "https://data.example/object?code=must-not-persist" },
    { endpoint: "https://data.example/object?mode=Bearer%20must-not-persist" },
    { endpoint: "https://data.example/object#authorization=Bearer%20must-not-persist" },
  ];
  for (const resourceRef of unsafe) {
    assert.throws(() => assertSafeResourceRef(resourceRef), { code: "BINDING_SECRET_FORBIDDEN" });
  }
  assert.throws(() => assertSafeResourceRef({ objectId: { nested: "not-an-identifier" } }), { code: "BINDING_RESOURCE_REF_INVALID" });
});
