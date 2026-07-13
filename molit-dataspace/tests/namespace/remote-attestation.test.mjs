import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

import { loadNamespaceConfig } from "../../src/publication/config.mjs";
import { attestNamespace } from "../../src/publication/remote-attestation.mjs";
import { createNamespaceService } from "../../src/publication/server.mjs";

const FIXTURE_DIRECTORY = path.resolve("tests/namespace/fixtures");
const SOURCE_RELEASE = path.resolve("profiles/molit-dcat-ap/releases/1.0.0-rc.1");
const logger = { info() {}, warn() {} };
let artifactLock;
let ca;
let origin;
let releaseRoot;
let service;
let tlsServer;
let upstreamPort;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

before(async () => {
  releaseRoot = await mkdtemp(path.join(tmpdir(), "molit-namespace-attestation-"));
  await mkdir(path.join(releaseRoot, "ontology"), { recursive: true });
  await mkdir(path.join(releaseRoot, "publication"), { recursive: true });
  await mkdir(path.join(releaseRoot, "serializations"), { recursive: true });
  const representationPaths = ["index.html", "ontology/molit-dcat-ap.ttl", "serializations/molit-dcat-ap.jsonld"];
  for (const artifactPath of representationPaths) {
    await copyFile(path.join(SOURCE_RELEASE, artifactPath), path.join(releaseRoot, artifactPath));
  }

  ca = await readFile(path.join(FIXTURE_DIRECTORY, "localhost-test.crt"));
  const pfx = await readFile(path.join(FIXTURE_DIRECTORY, "localhost-test.p12"));
  tlsServer = https.createServer({ passphrase: "molit-test-only", pfx }, (request, response) => {
    const upstream = http.request({
      headers: { ...request.headers, Host: new URL(origin).host },
      host: "127.0.0.1",
      method: request.method,
      path: request.url,
      port: upstreamPort,
    }, (incoming) => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response);
    });
    upstream.once("error", (error) => {
      response.statusCode = 502;
      response.end(error.message);
    });
    request.pipe(upstream);
  });
  const tlsAddress = await listen(tlsServer);
  origin = `https://localhost:${tlsAddress.port}`;

  const contract = {
    profileVersion: "1.0.0-test",
    resources: [{
      iris: [`${origin}/def/molit-dcat-ap`, `${origin}/def/molit-dcat-ap/1.0.0-test`],
      representations: {
        "application/ld+json": "serializations/molit-dcat-ap.jsonld",
        "text/html": "index.html",
        "text/turtle": "ontology/molit-dcat-ap.ttl",
      },
    }],
    responseRules: {
      canonicalRedirect: { preserveQuery: true, status: 308, trailingSlash: "remove" },
      defaultMediaType: "text/html",
      dynamicNetworkImports: false,
      exactByteArtifacts: true,
      notFound: 404,
      unsupportedAccept: 406,
      vary: ["Accept"],
    },
  };
  await writeFile(path.join(releaseRoot, "publication/content-negotiation.json"), JSON.stringify(contract));

  artifactLock = {
    artifacts: [],
    profileVersion: "1.0.0-test",
    schemaVersion: "molit.profile-artifact-lock/1",
  };
  for (const artifactPath of ["publication/content-negotiation.json", ...representationPaths]) {
    const bytes = await readFile(path.join(releaseRoot, artifactPath));
    artifactLock.artifacts.push({ path: artifactPath, sha256: digest(bytes) });
  }
  await writeFile(path.join(releaseRoot, "artifact-lock.json"), JSON.stringify(artifactLock));

  const config = await loadNamespaceConfig({
    env: {
      MOLIT_NAMESPACE_ALLOWED_HOSTS: new URL(origin).host,
      MOLIT_NAMESPACE_PORT: "0",
      MOLIT_NAMESPACE_PUBLIC_ORIGIN: origin,
      MOLIT_NAMESPACE_RELEASE_ROOT: releaseRoot,
    },
  });
  service = await createNamespaceService({ config, logger });
  ({ port: upstreamPort } = await service.start());
});

after(async () => {
  await service?.close();
  if (tlsServer?.listening) await closeServer(tlsServer);
});

test("remote attestation verifies HTTPS, locked bytes, negotiation, redirects, ETag, and HEAD", async () => {
  const report = await attestNamespace({ ca, expectedOrigin: origin, releaseRoot });
  assert.equal(report.passed, true, JSON.stringify(report.checks.filter((check) => !check.ok), null, 2));
  assert.equal(report.targetOrigin, origin);
  assert.ok(report.checks.some((check) => check.id.startsWith("bytes:get:")));
  assert.ok(report.checks.some((check) => check.id.startsWith("status:conditional:")));
  assert.ok(report.checks.some((check) => check.id === "status:not-acceptable"));
  assert.ok(report.tlsObservations.every((observation) => observation.authorized));
});

test("remote attestation stops before network verification when the reviewed artifact digest is wrong", async () => {
  const mutated = structuredClone(artifactLock);
  const target = mutated.artifacts.find((entry) => entry.path === "index.html");
  target.sha256 = "0".repeat(64);
  await writeFile(path.join(releaseRoot, "artifact-lock.json"), JSON.stringify(mutated));
  await assert.rejects(
    attestNamespace({ ca, expectedOrigin: origin, releaseRoot }),
    { code: "PUBLICATION_ARTIFACT_DIGEST_MISMATCH" },
  );
  await writeFile(path.join(releaseRoot, "artifact-lock.json"), JSON.stringify(artifactLock));
});

test("attestation CLI refuses network access without explicit confirmation", async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/publication/attest-cli.mjs"], { cwd: process.cwd() });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /NETWORK_EXECUTION_NOT_CONFIRMED/u);
});
