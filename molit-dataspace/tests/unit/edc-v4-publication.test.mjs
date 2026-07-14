import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { EdcManagementV4PublicationClient } from "../../src/bridge-runtime/edc-v4-management-client.mjs";

const metadata = {
  sha256: "a".repeat(64),
  profileName: "dataspace-offering",
  profileVersion: "1.0.0-rc.1",
  decisionDigest: "sha256:decision",
};

async function fixture() {
  return JSON.parse(await readFile(new URL("../../fixtures/runtime/edc-v4-publication.example.json", import.meta.url), "utf8"));
}

function memoryHttp({ race = false } = {}) {
  const resources = new Map();
  const calls = [];
  let raced = false;
  return {
    resources,
    calls,
    async json(url, options = {}) {
      const parsed = new URL(url);
      const call = { method: options.method ?? "GET", path: parsed.pathname, headers: options.headers ?? {}, body: options.body ? JSON.parse(options.body.toString()) : null };
      calls.push(call);
      const match = parsed.pathname.match(/\/(policydefinitions|assets|contractdefinitions)(?:\/(.+))?$/u);
      assert.ok(match, parsed.pathname);
      const collection = match[1];
      if (call.method === "GET") {
        const id = decodeURIComponent(match[2]);
        return resources.has(`${collection}:${id}`)
          ? { status: 200, value: structuredClone(resources.get(`${collection}:${id}`)) }
          : { status: 404, value: [] };
      }
      assert.equal(call.method, "POST");
      assert.equal(call.headers["idempotency-key"], undefined, "EDC Management API v4 does not promise Idempotency-Key semantics");
      const key = `${collection}:${call.body["@id"]}`;
      if (race && !raced) {
        raced = true;
        resources.set(key, structuredClone(call.body));
        return { status: 409, value: [{ message: "concurrent create" }] };
      }
      if (resources.has(key)) return { status: 409, value: [] };
      resources.set(key, structuredClone(call.body));
      return { status: 200, value: { "@id": call.body["@id"], "@type": "IdResponse" } };
    },
  };
}

function client(http, overrides = {}) {
  return new EdcManagementV4PublicationClient({
    config: {
      adapter: "edc-v4",
      baseUrl: "https://connector.example/management/",
      allowedDataOrigins: ["https://platform.example.go.kr"],
      auth: { type: "api-key", env: "EDC_KEY", header: "x-api-key" },
      ...overrides,
    },
    http,
    env: { EDC_KEY: "not-written-to-payload" },
  });
}

test("EDC v4 publication creates bounded policies, one asset and an asset-scoped contract definition", async () => {
  const http = memoryHttp();
  const publication = await fixture();
  const first = await client(http).publishOffering(publication, "queue:1", { metadata });
  assert.equal(first.created, 4);
  assert.equal(first.reconciled, 0);
  assert.deepEqual(http.calls.filter(({ method }) => method === "POST").map(({ path }) => path), [
    "/management/v4/policydefinitions",
    "/management/v4/policydefinitions",
    "/management/v4/assets",
    "/management/v4/contractdefinitions",
  ]);
  const asset = http.resources.get(`assets:${publication.asset.id}`);
  assert.deepEqual(asset["@context"], ["https://w3id.org/edc/connector/management/v2"]);
  assert.equal(asset.properties.molitMetadataSha256, metadata.sha256);
  assert.equal(asset.dataAddress.secretName, "molit/platform/traffic-reader");
  assert.equal(JSON.stringify(asset).includes("not-written-to-payload"), false);
  assert.equal(asset.dataAddress.authCode, undefined);
  const definition = http.resources.get(`contractdefinitions:${publication.contractDefinition.id}`);
  assert.deepEqual(definition.assetsSelector, [{ "@type": "Criterion", operandLeft: "id", operator: "=", operandRight: publication.asset.id }]);

  const second = await client(http).publishOffering(publication, "queue:1", { metadata });
  assert.equal(second.created, 0);
  assert.equal(second.reconciled, 4);
  assert.equal(http.calls.filter(({ method }) => method === "POST").length, 4);
});

test("EDC v4 publication reconciles a concurrent 409 by reading the ownership marker", async () => {
  const http = memoryHttp({ race: true });
  const result = await client(http).publishOffering(await fixture(), "queue:race", { metadata });
  assert.equal(result.created, 3);
  assert.equal(result.reconciled, 1);
  assert.ok(http.calls.some(({ method, path }) => method === "GET" && path.includes("policydefinitions")));
});

test("identical shared policies are reused across two different assets", async () => {
  const http = memoryHttp();
  const first = await fixture();
  await client(http).publishOffering(first, "queue:shared:1", { metadata });
  const second = structuredClone(first);
  second.asset.id = "urn:molit:asset:road-traffic-speed-busan-v1";
  second.asset.properties.name = "부산시 도로 구간별 통행속도";
  second.asset.properties.metadataIri = "https://data.molit.go.kr/id/dataset/road-traffic-speed-busan-v1";
  second.contractDefinition.id = "urn:molit:contract-definition:road-traffic-speed-busan-v1";
  const result = await client(http).publishOffering(second, "queue:shared:2", { metadata });
  assert.equal(result.created, 2);
  assert.equal(result.reconciled, 2);
});

test("EDC v4 publication fails closed on a deterministic ID owned by another publication", async () => {
  const http = memoryHttp();
  const publication = await fixture();
  http.resources.set(`policydefinitions:${publication.accessPolicy.id}`, {
    "@id": publication.accessPolicy.id,
    privateProperties: { molitManagedBy: "another-adapter", molitResourceDigest: "0".repeat(64) },
  });
  await assert.rejects(client(http).publishOffering(publication, "queue:2", { metadata }), { code: "EDC_PUBLICATION_CONFLICT" });
  assert.equal(http.calls.filter(({ method }) => method === "POST").length, 0);
});

test("EDC v4 publication rejects managed resource drift even when ownership markers are unchanged", async () => {
  const publication = await fixture();
  const mutations = [
    ["policydefinitions", publication.accessPolicy.id, (value) => { value.policy.permission[0].action = "distribute"; }],
    ["assets", publication.asset.id, (value) => { value.properties.name = "변조된 제목"; }],
    ["assets", publication.asset.id, (value) => { value.dataAddress.baseUrl = "https://platform.example.go.kr/other"; }],
    ["contractdefinitions", publication.contractDefinition.id, (value) => { value.assetsSelector[0].operandRight = "urn:molit:asset:other"; }],
  ];

  for (const [collection, id, mutate] of mutations) {
    const http = memoryHttp();
    await client(http).publishOffering(publication, `queue:drift:${collection}`, { metadata });
    mutate(http.resources.get(`${collection}:${id}`));
    await assert.rejects(client(http).publishOffering(publication, `queue:drift:${collection}`, { metadata }), {
      code: "EDC_PUBLICATION_CONFLICT",
    });
  }
});

test("EDC v4 publication ignores unknown suffix namespaces and rejects conflicting canonical aliases", async () => {
  const publication = await fixture();

  const canonicalHttp = memoryHttp();
  await client(canonicalHttp).publishOffering(publication, "queue:namespace:canonical", { metadata });
  const canonicalPolicy = canonicalHttp.resources.get(`policydefinitions:${publication.accessPolicy.id}`);
  const canonicalMarkers = canonicalPolicy.privateProperties;
  canonicalPolicy["https://w3id.org/edc/v0.0.1/ns/privateProperties"] = {
    "https://w3id.org/edc/v0.0.1/ns/molitManagedBy": canonicalMarkers.molitManagedBy,
    "https://w3id.org/edc/v0.0.1/ns/molitResourceDigest": canonicalMarkers.molitResourceDigest,
  };
  canonicalPolicy["https://w3id.org/edc/v0.0.1/ns/policy"] = canonicalPolicy.policy;
  delete canonicalPolicy.privateProperties;
  delete canonicalPolicy.policy;
  const canonicalResult = await client(canonicalHttp).publishOffering(publication, "queue:namespace:canonical", { metadata });
  assert.equal(canonicalResult.reconciled, 4);

  const suffixHttp = memoryHttp();
  await client(suffixHttp).publishOffering(publication, "queue:namespace:suffix", { metadata });
  const suffixPolicy = suffixHttp.resources.get(`policydefinitions:${publication.accessPolicy.id}`);
  const marker = suffixPolicy.privateProperties;
  delete suffixPolicy.privateProperties;
  suffixPolicy["evil:privateProperties"] = marker;
  await assert.rejects(client(suffixHttp).publishOffering(publication, "queue:namespace:suffix", { metadata }), {
    code: "EDC_PUBLICATION_CONFLICT",
  });

  const markerHttp = memoryHttp();
  await client(markerHttp).publishOffering(publication, "queue:namespace:marker", { metadata });
  const markerPolicy = markerHttp.resources.get(`policydefinitions:${publication.accessPolicy.id}`);
  markerPolicy.privateProperties["evil:molitManagedBy"] = markerPolicy.privateProperties.molitManagedBy;
  delete markerPolicy.privateProperties.molitManagedBy;
  await assert.rejects(client(markerHttp).publishOffering(publication, "queue:namespace:marker", { metadata }), {
    code: "EDC_PUBLICATION_CONFLICT",
  });

  const conflictHttp = memoryHttp();
  await client(conflictHttp).publishOffering(publication, "queue:namespace:conflict", { metadata });
  const conflictPolicy = conflictHttp.resources.get(`policydefinitions:${publication.accessPolicy.id}`);
  conflictPolicy["https://w3id.org/edc/v0.0.1/ns/privateProperties"] = {
    molitManagedBy: "another-adapter",
    molitResourceDigest: "0".repeat(64),
  };
  await assert.rejects(client(conflictHttp).publishOffering(publication, "queue:namespace:conflict", { metadata }), {
    code: "EDC_PUBLICATION_CONFLICT",
  });
});

test("EDC v4 publication rejects compact, expanded and context-aliased ODRL targets", async () => {
  const targetForms = [
    { "odrl:target": "urn:molit:asset:other" },
    { "http://www.w3.org/ns/odrl/2/target": "urn:molit:asset:other" },
    { "@context": { assetTarget: "http://www.w3.org/ns/odrl/2/target" }, assetTarget: "urn:molit:asset:other" },
  ];
  for (const form of targetForms) {
    const publication = await fixture();
    Object.assign(publication.accessPolicy.policy, form);
    await assert.rejects(client(memoryHttp()).publishOffering(publication, "queue:target", { metadata }), {
      code: "EDC_PUBLICATION_INVALID",
    });
  }
});

test("EDC v4 publication rejects embedded credentials and non-allowlisted data origins", async () => {
  const publication = await fixture();
  publication.asset.dataAddress.authCode = "raw-token";
  await assert.rejects(client(memoryHttp()).publishOffering(publication, "queue:3", { metadata }), { code: "EDC_PUBLICATION_INVALID" });
  delete publication.asset.dataAddress.authCode;
  publication.asset.dataAddress.baseUrl = "https://attacker.example/data";
  await assert.rejects(client(memoryHttp()).publishOffering(publication, "queue:4", { metadata }), { code: "EDC_DATA_ORIGIN_NOT_ALLOWED" });
  publication.asset.dataAddress.baseUrl = "https://platform.example.go.kr/data?api_key=raw-token";
  await assert.rejects(client(memoryHttp()).publishOffering(publication, "queue:5", { metadata }), { code: "EDC_PUBLICATION_SECRET_FORBIDDEN" });
  publication.asset.dataAddress.baseUrl = "https://platform.example.go.kr/data?sv=2026-01-01&sig=presigned-secret";
  await assert.rejects(client(memoryHttp()).publishOffering(publication, "queue:5-signed", { metadata }), { code: "EDC_PUBLICATION_SECRET_FORBIDDEN" });
  publication.asset.dataAddress.baseUrl = "https://platform.example.go.kr/data";
  publication.asset.dataAddress.queryParams = "format=json&code=credential-value";
  await assert.rejects(client(memoryHttp()).publishOffering(publication, "queue:5-code", { metadata }), { code: "EDC_PUBLICATION_SECRET_FORBIDDEN" });
  publication.asset.dataAddress.queryParams = "format=json&serviceKey=credential-value";
  await assert.rejects(client(memoryHttp()).publishOffering(publication, "queue:5-service-key", { metadata }), { code: "EDC_PUBLICATION_SECRET_FORBIDDEN" });
  delete publication.asset.dataAddress.queryParams;
  publication.asset.dataAddress.path = "/records?serviceKey=credential-value";
  await assert.rejects(client(memoryHttp()).publishOffering(publication, "queue:5-path-query", { metadata }), { code: "EDC_PUBLICATION_INVALID" });
  delete publication.asset.dataAddress.path;
  publication.asset.dataAddress.baseUrl = "https://platform.example.go.kr/data";
  publication.asset.properties.metadataIri = "https://data.molit.go.kr/id/dataset/road-traffic-speed-seoul-v1?access_token=raw-token";
  await assert.rejects(client(memoryHttp()).publishOffering(publication, "queue:6", { metadata }), { code: "EDC_PUBLICATION_INVALID" });
});

test("EDC v4 publication allows only configured static query names and rejects credentials hidden in values", async () => {
  const allowed = { allowedDataQueryParameters: ["format", "page", "q"] };
  const safe = await fixture();
  safe.asset.dataAddress.baseUrl = "https://platform.example.go.kr/data?format=json&page=1";
  await client(memoryHttp(), allowed).publishOffering(safe, "queue:query:safe", { metadata });

  for (const query of [
    "q=Bearer%20secret",
    "q=Basic%20dXNlcjpwYXNz",
    "q=token%3Draw",
    "q=api_key%3Draw",
    "q=https%3A%2F%2Fuser%3Apass%40example.org%2Fdata",
    "q=https%3A%2F%2Fexample.org%2Fdata%3FX-Amz-Signature%3Draw",
  ]) {
    const publication = await fixture();
    publication.asset.dataAddress.queryParams = query;
    await assert.rejects(client(memoryHttp(), allowed).publishOffering(publication, `queue:query:${query}`, { metadata }), {
      code: "EDC_PUBLICATION_SECRET_FORBIDDEN",
    });
  }

  const unlisted = await fixture();
  unlisted.asset.dataAddress.queryParams = "filter=active";
  await assert.rejects(client(memoryHttp(), allowed).publishOffering(unlisted, "queue:query:unlisted", { metadata }), {
    code: "EDC_PUBLICATION_INVALID",
  });
});

test("EDC v4 publication constrains credential headers, Vault aliases and relative paths", async () => {
  for (const authKey of ["cookie", "host", "content-length", "transfer-encoding", "connection", "forwarded", "idempotency-key", "Authorization"]) {
    const publication = await fixture();
    publication.asset.dataAddress.authKey = authKey;
    await assert.rejects(client(memoryHttp()).publishOffering(publication, `queue:auth-key:${authKey}`, { metadata }), {
      code: "EDC_PUBLICATION_INVALID",
    });
  }
  for (const secretName of ["/absolute/path", "vault://secret", "molit//secret", "molit/../secret", "molit/./secret"]) {
    const publication = await fixture();
    publication.asset.dataAddress.secretName = secretName;
    await assert.rejects(client(memoryHttp()).publishOffering(publication, `queue:secret-name:${secretName}`, { metadata }), {
      code: "EDC_PUBLICATION_INVALID",
    });
  }
  for (const path of ["//attacker.example/x", "/../x", "/%2e%2e/x", "/%252e%252e/x", "%2f%2fattacker.example/x", "https://attacker.example/x", "\\\\attacker.example\\x"]) {
    const publication = await fixture();
    publication.asset.dataAddress.path = path;
    await assert.rejects(client(memoryHttp()).publishOffering(publication, `queue:path:${path}`, { metadata }), {
      code: /EDC_(?:PUBLICATION_INVALID|DATA_ORIGIN_NOT_ALLOWED)/u,
    });
  }

  const safe = await fixture();
  safe.asset.dataAddress.path = "/traffic/v1/records";
  const http = memoryHttp();
  await client(http).publishOffering(safe, "queue:path:safe", { metadata });
  assert.equal(http.resources.get(`assets:${safe.asset.id}`).dataAddress.path, "/traffic/v1/records");
});

test("EDC v4 publication fixture and both bridge management configurations satisfy their schemas", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const publicationSchema = JSON.parse(await readFile(new URL("../../contracts/edc-v4-publication.v1.schema.json", import.meta.url), "utf8"));
  const runtimeSchema = JSON.parse(await readFile(new URL("../../contracts/bridge-runtime-config.v1.schema.json", import.meta.url), "utf8"));
  const validatePublication = ajv.compile(publicationSchema);
  const validPublication = await fixture();
  assert.equal(validatePublication(validPublication), true, JSON.stringify(validatePublication.errors));
  const targetedPublication = structuredClone(validPublication);
  targetedPublication.accessPolicy.policy.permission[0]["odrl:target"] = "urn:molit:asset:other";
  assert.equal(validatePublication(targetedPublication), false, "the publication schema must reject nested target aliases");
  const validateRuntime = ajv.compile(runtimeSchema);
  for (const path of ["../../fixtures/runtime/config.example.json", "../../fixtures/runtime/config.edc-v4.example.json"]) {
    const value = JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
    assert.equal(validateRuntime(value), true, JSON.stringify(validateRuntime.errors));
  }
});
