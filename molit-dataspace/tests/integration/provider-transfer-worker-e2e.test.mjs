import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResilientHttpClient } from "../../src/bridge-runtime/http-client.mjs";
import { TransferConnectorManagementClient, PlatformProvisionerClient } from "../../src/transfer-runtime/clients.mjs";
import { ProviderTransferWorker } from "../../src/transfer-runtime/worker.mjs";

const identity = { providerPid: "provider-1", consumerPid: "consumer-1", agreementId: "agreement-1", datasetId: "dataset-1", format: "HttpData-PULL" };

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test("worker reconciles provision and acknowledgement crashes without duplicate resources", async (t) => {
  const calls = { provision: [], startAck: [], revoke: [], terminationAck: [] };
  let connectorState = "START_AUTHORIZED";
  let failStartAck = true;
  let failTerminationAck = true;
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/management/transfers/provider-1") {
      response.end(JSON.stringify({ ...identity, state: connectorState }));
      return;
    }
    const value = await body(request);
    const key = request.headers["idempotency-key"];
    assert.equal(typeof key, "string");
    if (request.url === "/control/provision") {
      calls.provision.push({ key, value });
      response.statusCode = calls.provision.some((call) => call.key === key) ? 200 : 201;
      response.end(JSON.stringify({ provisioningId: "provisioning-1", dataAddress: { type: "HttpData", endpoint: "https://data.internal.example/export/opaque" } }));
      return;
    }
    if (request.url === "/management/transfers/provider-1/started") {
      calls.startAck.push({ key, value });
      if (failStartAck) { failStartAck = false; response.statusCode = 400; response.end(JSON.stringify({ error: "injected" })); return; }
      connectorState = "STARTED";
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.url === "/control/revoke") {
      calls.revoke.push({ key, value });
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.url === "/management/transfers/provider-1/terminated") {
      calls.terminationAck.push({ key, value });
      if (failTerminationAck) { failTerminationAck = false; response.statusCode = 400; response.end(JSON.stringify({ error: "injected" })); return; }
      connectorState = "TERMINATED";
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const http = new ResilientHttpClient({ policy: { allowHttp: true, allowPrivate: true, allowedOrigins: [origin] }, retries: 0 });
  const connector = new TransferConnectorManagementClient({
    config: { baseUrl: `${origin}/management/`, statusPath: "transfers/{providerPid}", startAckPath: "transfers/{providerPid}/started", terminationAckPath: "transfers/{providerPid}/terminated", supportsIdempotencyKey: true },
    http,
  });
  const provisioner = new PlatformProvisionerClient({ config: { baseUrl: `${origin}/control/`, provisionPath: "provision", revokePath: "revoke", supportsIdempotencyKey: true, idempotentRevoke: true }, http });
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-e2e-"));
  const journalPath = join(directory, "journal.json");
  const registry = { bindings: [{ datasetId: "dataset-1", format: "HttpData-PULL", transferMode: "PULL", provisionerId: "platform", resourceRef: { catalogObject: "ROAD_SPEED" }, enabled: true }] };
  const worker = new ProviderTransferWorker({ connector, provisioners: { platform: provisioner }, registry, journalPath, telemetry: { add() {}, log() {} } });
  const start = { schemaVersion: "molit.provider-transfer-event/1", eventId: "start-1", action: "START", ...identity };

  await assert.rejects(worker.process(start), { code: "CONNECTOR_START_ACK_FAILED" });
  const afterProvision = JSON.parse(await readFile(journalPath, "utf8"));
  assert.equal(afterProvision.records[identity.providerPid].phase, "provisioned");
  assert.equal(afterProvision.records[identity.providerPid].dataAddress, undefined);
  await worker.process(start);
  assert.equal(calls.provision.length, 2, "provision is replayed to retrieve ephemeral DataAddress");
  assert.equal(calls.provision[0].key, calls.provision[1].key, "replay uses the same idempotency key");
  assert.deepEqual(calls.provision[0].value.resourceRef, { catalogObject: "ROAD_SPEED" });

  registry.bindings.length = 0;
  assert.equal((await worker.process(start)).replayed, true, "existing START replay uses its immutable journal binding even after registry removal");

  connectorState = "START_AUTHORIZED";
  await worker.process(start);
  assert.equal(calls.provision.length, 3, "active journal rehydrates DataAddress when connector start acknowledgement was lost");
  assert.equal(calls.startAck.length, 3, "lost connector acknowledgement is sent again with the stable key");

  connectorState = "TERMINATION_AUTHORIZED";
  const terminate = { ...start, eventId: "terminate-1", action: "TERMINATE" };
  await assert.rejects(worker.process(terminate), { code: "CONNECTOR_TERMINATION_ACK_FAILED" });
  assert.equal(JSON.parse(await readFile(journalPath, "utf8")).records[identity.providerPid].phase, "revoked");
  await worker.process(terminate);
  assert.equal(calls.revoke.length, 1, "a recorded revocation is not repeated merely because connector acknowledgement failed");
  assert.equal(calls.terminationAck[0].key, calls.terminationAck[1].key);
  assert.equal((await worker.process(terminate)).replayed, true);
});
