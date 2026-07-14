import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../../src/discovery/stable-json.mjs";
import {
  operationKey,
  PlatformProvisionerClient,
  TransferConnectorManagementClient,
} from "../../src/transfer-runtime/clients.mjs";

const startEvent = {
  schemaVersion: "molit.provider-transfer-event/1",
  eventId: "evt-start-1",
  action: "START",
  providerPid: "provider-1",
  consumerPid: "consumer-1",
  agreementId: "agreement-1",
  datasetId: "dataset-1",
  format: "HttpData-PULL",
};

const terminationEvent = { ...startEvent, eventId: "evt-terminate-1", action: "TERMINATE" };
const connectorConfig = {
  baseUrl: "https://connector.example/management/",
  statusPath: "transfers/{providerPid}",
  startAckPath: "transfers/{providerPid}/started",
  terminationAckPath: "transfers/{providerPid}/terminated",
  supportsIdempotencyKey: true,
};
const provisionerConfig = {
  baseUrl: "https://platform.example/control/",
  provisionPath: "provision",
  revokePath: "revoke",
  supportsIdempotencyKey: true,
  idempotentRevoke: true,
};
const binding = { resourceRef: { catalogObject: "ROAD_SPEED_HOURLY", snapshotPolicy: "agreement-time" } };

function connectorClient(event, statusValue) {
  const calls = [];
  const http = {
    async json(url, options = {}) {
      calls.push({ url: url.href, options });
      if (options.method === "POST") return { status: 409 };
      return { status: 200, value: { ...event, state: statusValue } };
    },
  };
  return { client: new TransferConnectorManagementClient({ config: connectorConfig, http }), calls };
}

test("start acknowledgement reconciles 409 only after exact authoritative STARTED observation", async () => {
  const { client, calls } = connectorClient(startEvent, "STARTED");
  const result = await client.acknowledgeStart(startEvent, { type: "HttpData" });
  assert.equal(result.reconciled, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, undefined);
  assert.match(calls[1].url, /transfers\/provider-1$/u);
});

test("start acknowledgement rejects 409 while authoritative state is only START_AUTHORIZED", async () => {
  const { client } = connectorClient(startEvent, "START_AUTHORIZED");
  await assert.rejects(client.acknowledgeStart(startEvent, { type: "HttpData" }), { code: "CONNECTOR_START_ACK_CONFLICT" });
});

test("termination acknowledgement reconciles 409 only after exact TERMINATED identity", async () => {
  const { client } = connectorClient(terminationEvent, "TERMINATED");
  assert.equal((await client.acknowledgeTermination(terminationEvent)).reconciled, true);

  const mismatch = connectorClient({ ...terminationEvent, agreementId: "other-agreement" }, "TERMINATED");
  await assert.rejects(mismatch.client.acknowledgeTermination(terminationEvent), { code: "TRANSFER_IDENTITY_MISMATCH" });
});

function provisionerClient(responseFactory) {
  const requests = [];
  const http = {
    async json(url, options) {
      const body = JSON.parse(options.body.toString("utf8"));
      requests.push({ url: url.href, body, options });
      return responseFactory(body);
    },
  };
  return { client: new PlatformProvisionerClient({ config: provisionerConfig, http }), requests };
}

test("provision accepts 200, 201 and 409 only with an exact request-bound receipt", async () => {
  for (const status of [200, 201, 409]) {
    const { client, requests } = provisionerClient((request) => ({
      status,
      value: {
        providerPid: request.providerPid,
        agreementId: request.agreementId,
        provisioningKey: request.provisioningKey,
        resourceRefDigest: request.resourceRefDigest,
        requestDigest: request.requestDigest,
        provisioningId: "provisioning-1",
        dataAddress: { type: "HttpData", endpoint: "https://data.example/opaque" },
      },
    }));
    const result = await client.provision(startEvent, binding);
    assert.equal(result.provisioningId, "provisioning-1");
    assert.equal(requests[0].body.resourceRefDigest, digest(binding.resourceRef));
    assert.equal(requests[0].body.requestDigest, digest({
      provisioningKey: requests[0].body.provisioningKey,
      providerPid: startEvent.providerPid,
      agreementId: startEvent.agreementId,
      transfer: requests[0].body.transfer,
      resourceRef: binding.resourceRef,
      resourceRefDigest: digest(binding.resourceRef),
    }));
  }
});

test("provision rejects stale, mismatched and non-canonical receipts for every success-like status", async () => {
  for (const status of [200, 201, 409]) {
    for (const mutate of [
      (receipt) => { receipt.providerPid = "other-provider"; },
      (receipt) => { receipt.agreementId = "other-agreement"; },
      (receipt) => { receipt.provisioningKey = "0".repeat(64); },
      (receipt) => { receipt.resourceRefDigest = "0".repeat(64); },
      (receipt) => { receipt.requestDigest = "0".repeat(64); },
      (receipt) => { receipt.unexpected = true; },
    ]) {
      const { client } = provisionerClient((request) => {
        const value = {
          providerPid: request.providerPid,
          agreementId: request.agreementId,
          provisioningKey: request.provisioningKey,
          resourceRefDigest: request.resourceRefDigest,
          requestDigest: request.requestDigest,
          provisioningId: "provisioning-1",
          dataAddress: { type: "HttpData" },
        };
        mutate(value);
        return { status, value };
      });
      await assert.rejects(client.provision(startEvent, binding), { code: "PLATFORM_PROVISION_RECEIPT_INVALID" });
    }
  }
});

function revokeReceipt(request, state = "REVOKED") {
  return {
    providerPid: request.providerPid,
    consumerPid: request.consumerPid,
    agreementId: request.agreementId,
    datasetId: request.datasetId,
    format: request.format,
    provisioningId: request.provisioningId,
    provisioningKey: request.provisioningKey,
    resourceRefDigest: request.resourceRefDigest,
    requestDigest: request.requestDigest,
    state,
  };
}

test("revoke accepts 409 only with an exact matching canonical inactive receipt", async () => {
  const { client, requests } = provisionerClient((request) => ({
    status: 409,
    value: revokeReceipt(request),
  }));
  const result = await client.revoke(startEvent, binding, { provisioningId: "provisioning-1" });
  assert.equal(result.outcome, "REVOKED");
  assert.equal(requests[0].body.resourceRefDigest, digest(binding.resourceRef));
  const { requestDigest, ...request } = requests[0].body;
  assert.equal(requestDigest, digest({
    domain: "molit.provider-transfer.revoke-request",
    version: 1,
    request,
  }));
  assert.equal(requests[0].options.headers["idempotency-key"], digest({
    domain: "molit.provider-transfer.revoke-idempotency-key",
    version: 1,
    transfer: Object.fromEntries(["providerPid", "consumerPid", "agreementId", "datasetId", "format"].map((field) => [field, startEvent[field]])),
    provisioningId: "provisioning-1",
    resourceRefDigest: digest(binding.resourceRef),
  }));
});

test("revoke rejects a stale receipt from another agreement sharing the provider PID", async () => {
  let staleReceipt;
  const { client, requests } = provisionerClient((request) => {
    if (!staleReceipt) {
      staleReceipt = revokeReceipt(request);
      return { status: 200, value: staleReceipt };
    }
    return { status: 409, value: staleReceipt };
  });
  await client.revoke(startEvent, binding);
  const otherAgreement = { ...startEvent, agreementId: "agreement-2" };
  await assert.rejects(
    client.revoke(otherAgreement, binding),
    { code: "PLATFORM_REVOKE_CONFLICT_UNVERIFIED" },
  );
  assert.equal(requests[0].body.provisioningId, null);
  assert.equal(requests[1].body.provisioningId, null);
  assert.notEqual(requests[0].body.requestDigest, requests[1].body.requestDigest);
  assert.notEqual(requests[0].options.headers["idempotency-key"], requests[1].options.headers["idempotency-key"]);
});

test("revoke requires an exact request-bound receipt for 200 and 204", async () => {
  for (const status of [200, 204]) {
    const positive = provisionerClient((request) => ({ status, value: revokeReceipt(request) }));
    assert.equal((await positive.client.revoke(startEvent, binding)).outcome, "REVOKED");

    for (const mutate of [
      () => undefined,
      (receipt) => ({ ...receipt, providerPid: "other-provider" }),
      (receipt) => ({ ...receipt, consumerPid: "other-consumer" }),
      (receipt) => ({ ...receipt, agreementId: "other-agreement" }),
      (receipt) => ({ ...receipt, datasetId: "other-dataset" }),
      (receipt) => ({ ...receipt, format: "other-format" }),
      (receipt) => ({ ...receipt, provisioningId: "other-provisioning" }),
      (receipt) => ({ ...receipt, provisioningKey: "0".repeat(64) }),
      (receipt) => ({ ...receipt, resourceRefDigest: "0".repeat(64) }),
      (receipt) => ({ ...receipt, requestDigest: "0".repeat(64) }),
      (receipt) => ({ ...receipt, state: "ACTIVE" }),
      (receipt) => ({ ...receipt, evidence: "unexpected" }),
    ]) {
      const negative = provisionerClient((request) => ({ status, value: mutate(revokeReceipt(request)) }));
      await assert.rejects(negative.client.revoke(startEvent, binding), { code: "PLATFORM_REVOKE_RECEIPT_INVALID" });
    }
  }
});

test("revoke rejects unverifiable, mismatched, active, and non-canonical 409 receipts", async () => {
  const mutations = [
    () => undefined,
    (receipt) => ({ ...receipt, providerPid: "other-provider" }),
    (receipt) => ({ ...receipt, agreementId: "other-agreement" }),
    (receipt) => ({ ...receipt, provisioningId: "other-provisioning" }),
    (receipt) => ({ ...receipt, provisioningKey: "0".repeat(64) }),
    (receipt) => ({ ...receipt, resourceRefDigest: "0".repeat(64) }),
    (receipt) => ({ ...receipt, requestDigest: "0".repeat(64) }),
    (receipt) => ({ ...receipt, state: "ACTIVE" }),
    (receipt) => ({ ...receipt, evidence: "unexpected" }),
  ];
  for (const mutate of mutations) {
    const { client } = provisionerClient((request) => ({ status: 409, value: mutate(revokeReceipt(request)) }));
    await assert.rejects(client.revoke(startEvent, binding), { code: "PLATFORM_REVOKE_CONFLICT_UNVERIFIED" });
  }
});

test("revoke accepts 404 only when a canonical receipt proves ABSENT", async () => {
  const { client } = provisionerClient((request) => ({ status: 404, value: revokeReceipt(request, "ABSENT") }));
  assert.equal((await client.revoke(startEvent, binding)).outcome, "ABSENT");

  for (const mutate of [
    () => undefined,
    (receipt) => ({ ...receipt, state: "REVOKED" }),
    (receipt) => ({ ...receipt, agreementId: "other-agreement" }),
    (receipt) => ({ ...receipt, provisioningId: "other-provisioning" }),
    (receipt) => ({ ...receipt, provisioningKey: "0".repeat(64) }),
    (receipt) => ({ ...receipt, resourceRefDigest: "0".repeat(64) }),
    (receipt) => ({ ...receipt, requestDigest: "0".repeat(64) }),
  ]) {
    const negative = provisionerClient((request) => ({ status: 404, value: mutate(revokeReceipt(request, "ABSENT")) }));
    await assert.rejects(negative.client.revoke(startEvent, binding), { code: "PLATFORM_REVOKE_ABSENCE_UNVERIFIED" });
  }
});
