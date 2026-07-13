import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorManagementClient, ExperimentalDspPollingClient } from "../../src/bridge-runtime/clients.mjs";
import { createDspSchemaValidators, verifyDspVendorSnapshot } from "../../src/bridge-runtime/dsp-schemas.mjs";
import { ResilientHttpClient } from "../../src/bridge-runtime/http-client.mjs";
import { HttpPlatformAdapter } from "../../src/bridge-runtime/platform-adapter.mjs";
import { Telemetry } from "../../src/bridge-runtime/telemetry.mjs";
import { BridgeRuntime } from "../../src/bridge-runtime/worker.mjs";
import { JsonPathDispatchProjector } from "../../src/bridge-runtime/projector.mjs";
import { digest } from "../../src/discovery/stable-json.mjs";

const context = ["https://w3id.org/dspace/2025/1/context.jsonld"];

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks));
}

function respond(response, status, value, headers = {}) {
  const serialized = value === null ? "" : JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(serialized);
}

test("fixture platform to management API and DSP wire flow is durable and idempotent", async () => {
  const schemas = await createDspSchemaValidators();
  const manifest = await verifyDspVendorSnapshot();
  assert.equal(manifest.tag, "2025-1-err1");
  const calls = [];
  const datasetId = "urn:dataset:1";
  const server = createServer(async (request, response) => {
    calls.push({ method: request.method, url: request.url, key: request.headers["idempotency-key"] });
    if (request.url.startsWith("/metadata")) {
      if (request.headers["if-none-match"] === '"v1"') return respond(response, 304, null);
      const page2 = new URL(request.url, "http://fixture").searchParams.get("cursor") === "page-2";
      const offering = { id: datasetId, title: "fixture" };
      const transfer = { datasetId, consumerPid: "urn:consumer:1", callbackAddress: "https://consumer.example/callback", format: "HttpData-PULL" };
      const record = {
        id: "source-1",
        version: 1,
        dispatch: { approvalId: "approval-1" },
        metadata: { file: "metadata.ttl" },
        publication: { offering },
      };
      return respond(response, 200, page2 ? { items: [], nextCursor: null } : { items: [record], nextCursor: "page-2" }, page2 ? {} : { etag: '"v1"' });
    }
    if (request.url === "/management/assets") {
      assert.equal(request.headers.authorization, "Bearer management-secret");
      return respond(response, 201, { assetId: datasetId });
    }
    if (request.url === "/catalog/request") {
      schemas.validate("catalogRequest", await body(request));
      return respond(response, 200, {
        "@context": context,
        "@id": "urn:catalog:1",
        "@type": "Catalog",
        participantId: "urn:provider:1",
        service: [{ "@id": "urn:service:1", "@type": "DataService", endpointURL: "https://provider.example/connector" }],
        dataset: [{
          "@id": datasetId,
          "@type": "Dataset",
          hasPolicy: [{ "@id": "urn:offer:1", "@type": "Offer", permission: [{ action: "use" }] }],
          distribution: [{ format: "HttpData-PULL", accessService: "urn:service:1" }],
        }],
      });
    }
    if (request.url === "/negotiations/request") {
      schemas.validate("contractRequest", await body(request));
      return respond(response, 201, { "@context": context, "@type": "ContractNegotiation", providerPid: "urn:negotiation:1", consumerPid: "urn:consumer:1", state: "REQUESTED" });
    }
    if (request.url === "/negotiations/urn%3Anegotiation%3A1") return respond(response, 200, { "@context": context, "@type": "ContractNegotiation", providerPid: "urn:negotiation:1", consumerPid: "urn:consumer:1", state: "FINALIZED", agreementId: "urn:agreement:1" });
    if (request.url === "/transfers/request") {
      schemas.validate("transferRequest", await body(request));
      return respond(response, 201, { "@context": context, "@type": "TransferProcess", providerPid: "urn:transfer:1", consumerPid: "urn:consumer:1", state: "REQUESTED" });
    }
    if (request.url === "/transfers/urn%3Atransfer%3A1") return respond(response, 200, { "@context": context, "@type": "TransferProcess", providerPid: "urn:transfer:1", consumerPid: "urn:consumer:1", state: "STARTED" });
    respond(response, 404, {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), "molit-runtime-"));
  const logs = [];
  try {
    await writeFile(join(directory, "metadata.ttl"), "@prefix dcat: <http://www.w3.org/ns/dcat#> .\n");
    const metadataSha256 = createHash("sha256").update("@prefix dcat: <http://www.w3.org/ns/dcat#> .\n").digest("hex");
    const telemetry = new Telemetry({ sink: (line) => logs.push(line) });
    const http = new ResilientHttpClient({ policy: { allowedOrigins: [origin], allowHttp: true, allowPrivate: true }, telemetry, retries: 0 });
    const env = { PROVIDER: "provider-secret", MANAGEMENT: "management-secret", DSP: "dsp-secret" };
    const runtime = new BridgeRuntime({
      statePath: join(directory, "state.json"), providerId: "fixture-provider", telemetry,
      projector: new JsonPathDispatchProjector({ approvalIdPath: "dispatch.approvalId", metadataPath: "metadata.file", offeringPath: "publication.offering", profileName: "dataspace-offering", profileVersion: "1.0.0-rc.1" }, { metadataRoot: directory, profileGate: { validate: async () => ({ gatePassed: true, decisionDigest: "sha256:fixture", inputSha256: metadataSha256 }) } }),
      approvalRegistry: { schemaVersion: "molit.dispatch-approval-registry/1", entries: [{ approvalId: "approval-1", sourceSystemId: "fixture-provider", sourceRecordId: "source-1", resourceVersion: "1", status: "approved", approvedBy: "urn:operator:1", validFrom: "2026-01-01T00:00:00Z", validUntil: "2099-01-01T00:00:00Z", payloadDigest: digest({ metadata: { sha256: metadataSha256, profileName: "dataspace-offering", profileVersion: "1.0.0-rc.1", decisionDigest: "sha256:fixture" }, offering: { id: datasetId, title: "fixture" } }) }] },
      adapter: new HttpPlatformAdapter({ config: { baseUrl: origin, path: "/metadata", idPath: "id", versionPath: "version", auth: { type: "bearer", env: "PROVIDER" } }, http, env }),
      managementClient: new ConnectorManagementClient({ config: { baseUrl: origin, publicationPath: "/management/assets", supportsIdempotencyKey: true, auth: { type: "bearer", env: "MANAGEMENT" } }, http, env }),
    });
    const first = await runtime.runOnce();
    assert.deepEqual({ accepted: first.poll.accepted, delivered: first.dispatch.delivered }, { accepted: 1, delivered: 1 }, JSON.stringify({ first, logs, calls }));
    const consumerSmoke = new ExperimentalDspPollingClient({ config: { baseUrl: origin, catalogPath: "/catalog/request", contractPath: "/negotiations/request", contractStatusPath: "/negotiations", transferPath: "/transfers/request", transferStatusPath: "/transfers", statusPollIntervalMs: 0, pollingAgreementIdExtension: true }, http, env, schemas, sleep: async () => {} });
    const consumed = await consumerSmoke.execute({ datasetId, approvedOfferId: "urn:offer:1", approvedOfferDigest: digest({ "@id": "urn:offer:1", "@type": "Offer", permission: [{ action: "use" }] }), consumerPid: "urn:consumer:1", callbackAddress: "https://consumer.example/callback", format: "HttpData-PULL" }, "explicit-consumer-smoke");
    assert.equal(consumed.transferId, "urn:transfer:1");
    await assert.rejects(consumerSmoke.execute({ datasetId, approvedOfferId: "urn:offer:1", approvedOfferDigest: "0".repeat(64), consumerPid: "urn:consumer:1", callbackAddress: "https://consumer.example/callback", format: "HttpData-PULL" }, "unapproved-offer"), { code: "DSP_OFFER_DIGEST_MISMATCH" });
    const second = await runtime.runOnce();
    assert.equal(second.poll.notModified, true);
    assert.equal(second.dispatch.claimed, 0);
    const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    assert.equal(Object.keys(state.completed).length, 1);
    assert.equal(Object.keys(state.queue).length, 0);
    const keys = calls.filter((entry) => entry.key).map((entry) => entry.key);
    assert.equal(keys.length, new Set(keys).size);
    assert.equal(logs.join("\n").includes("secret"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
