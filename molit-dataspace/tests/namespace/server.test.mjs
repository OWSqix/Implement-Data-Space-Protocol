import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";

import { loadNamespaceConfig } from "../../src/publication/config.mjs";
import { createNamespaceService, validateRequestTarget } from "../../src/publication/server.mjs";

const RELEASE_ROOT = path.resolve("profiles/molit-dcat-ap/releases/1.0.0-rc.1");
const HOST = "data.molit.go.kr";
const logger = { info() {}, warn() {} };
let port;
let service;

function request(pathname, { headers = {}, method = "GET" } = {}) {
  return new Promise((resolve, reject) => {
    const requestObject = http.request({
      headers: { Host: HOST, ...headers },
      host: "127.0.0.1",
      method,
      path: pathname,
      port,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode,
      }));
    });
    requestObject.once("error", reject);
    requestObject.end();
  });
}

before(async () => {
  const config = await loadNamespaceConfig({
    env: {
      MOLIT_NAMESPACE_ALLOWED_HOSTS: HOST,
      MOLIT_NAMESPACE_PORT: "0",
      MOLIT_NAMESPACE_RELEASE_ROOT: RELEASE_ROOT,
    },
  });
  service = await createNamespaceService({ config, logger });
  ({ port } = await service.start());
});

after(async () => service?.close());

test("stable profile IRI serves exact default HTML with security and cache headers", async () => {
  const response = await request("/profile/molit-dcat-ap");
  const expected = await readFile(path.join(RELEASE_ROOT, "index.html"));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, expected);
  assert.equal(response.headers["content-type"], "text/html");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["access-control-allow-origin"], "*");
  assert.equal(response.headers["cache-control"], "public, max-age=300, must-revalidate");
  assert.match(response.headers.etag, /^"sha256-[a-f0-9]{64}"$/u);
  assert.equal(response.headers.vary, "Accept");
});

test("versioned ontology IRI negotiates exact Turtle with immutable caching", async () => {
  const response = await request("/def/molit-dcat-ap/1.0.0-rc.1", {
    headers: { Accept: "text/turtle" },
  });
  const expected = await readFile(path.join(RELEASE_ROOT, "ontology/molit-dcat-ap.ttl"));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, expected);
  assert.equal(response.headers["content-type"], "text/turtle");
  assert.equal(response.headers["cache-control"], "public, max-age=31536000, immutable");
});

test("module stable and version IRIs negotiate JSON-LD", async () => {
  for (const pathname of [
    "/profile/molit-dcat-ap/geo",
    "/profile/molit-dcat-ap/1.0.0-rc.1/geo",
  ]) {
    const response = await request(pathname, { headers: { Accept: "application/ld+json" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "application/ld+json");
    assert.doesNotThrow(() => JSON.parse(response.body.toString("utf8")));
  }
});

test("HEAD and conditional GET use the exact representation ETag", async () => {
  const get = await request("/profile/molit-dcat-ap", { headers: { Accept: "text/turtle" } });
  const head = await request("/profile/molit-dcat-ap", {
    headers: { Accept: "text/turtle" },
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers.etag, get.headers.etag);
  assert.equal(Number(head.headers["content-length"]), get.body.length);

  const conditional = await request("/profile/molit-dcat-ap", {
    headers: { Accept: "text/turtle", "If-None-Match": `W/${get.headers.etag}` },
  });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.body.length, 0);
});

test("canonical redirect removes a trailing slash and preserves query", async () => {
  const response = await request("/profile/molit-dcat-ap/?source=test");
  assert.equal(response.status, 308);
  assert.equal(response.headers.location, "https://data.molit.go.kr/profile/molit-dcat-ap?source=test");
});

test("unsupported Accept, unknown paths, and methods fail with bounded responses", async () => {
  const unacceptable = await request("/profile/molit-dcat-ap", { headers: { Accept: "application/xml" } });
  assert.equal(unacceptable.status, 406);
  assert.equal(unacceptable.headers.vary, "Accept");

  const missing = await request("/does-not-exist");
  assert.equal(missing.status, 404);
  const unapprovedVocabulary = await request("/scheme/molit-domain");
  assert.equal(unapprovedVocabulary.status, 404);
  const method = await request("/profile/molit-dcat-ap", { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, "GET, HEAD");
});

test("Host allowlist rejects Host header poisoning", async () => {
  const response = await new Promise((resolve, reject) => {
    const requestObject = http.request({
      headers: { Host: "attacker.example" }, host: "127.0.0.1", path: "/profile/molit-dcat-ap", port,
    }, (incoming) => {
      incoming.resume();
      incoming.once("end", () => resolve(incoming));
    });
    requestObject.once("error", reject);
    requestObject.end();
  });
  assert.equal(response.statusCode, 421);
});

test("health and readiness do not depend on external network calls", async () => {
  for (const pathname of ["/healthz", "/readyz"]) {
    const response = await request(pathname);
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(JSON.parse(response.body).profileVersion, "1.0.0-rc.1");
  }
});

test("request-target validation rejects traversal and encoded separators", () => {
  assert.equal(validateRequestTarget("/profile/molit-dcat-ap", 4096), true);
  assert.equal(validateRequestTarget("/%2e%2e/secret", 4096), false);
  assert.equal(validateRequestTarget("/safe%2fsecret", 4096), false);
  assert.equal(validateRequestTarget("/safe\\secret", 4096), false);
  assert.equal(validateRequestTarget("//attacker.example/path", 4096), false);
  assert.equal(validateRequestTarget(`/${"x".repeat(4096)}`, 4096), false);
});
