import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadNamespaceConfig } from "../../src/publication/config.mjs";
import { loadPublicationSnapshot } from "../../src/publication/snapshot.mjs";
import { createNamespaceService } from "../../src/publication/server.mjs";

test("configuration applies environment overrides and canonicalizes paths", async () => {
  const cwd = process.cwd();
  const config = await loadNamespaceConfig({
    cwd,
    env: {
      MOLIT_NAMESPACE_ALLOWED_HOSTS: "data.molit.go.kr,localhost:8443",
      MOLIT_NAMESPACE_PORT: "0",
      MOLIT_NAMESPACE_RELEASE_ROOT: "profiles/molit-dcat-ap/releases/1.0.0-rc.1",
    },
  });
  assert.equal(config.port, 0);
  assert.deepEqual(config.allowedHosts, ["data.molit.go.kr", "localhost:8443"]);
  assert.equal(config.publicOrigin, "https://data.molit.go.kr");
  assert.equal(path.isAbsolute(config.releaseRoot), true);
});

test("configuration rejects HTTP origins and unknown file properties", async () => {
  await assert.rejects(
    loadNamespaceConfig({ env: { MOLIT_NAMESPACE_PUBLIC_ORIGIN: "http://data.molit.go.kr" } }),
    { code: "INVALID_NAMESPACE_CONFIGURATION" },
  );
  await assert.rejects(
    loadNamespaceConfig({ env: { MOLIT_NAMESPACE_ALLOWED_HOSTS: "internal.example" } }),
    { code: "INVALID_NAMESPACE_CONFIGURATION" },
  );

  const directory = await mkdtemp(path.join(tmpdir(), "molit-namespace-config-"));
  await writeFile(path.join(directory, "config.json"), JSON.stringify({ unexpected: true }));
  await assert.rejects(
    loadNamespaceConfig({ cwd: directory, env: { MOLIT_NAMESPACE_CONFIG: "config.json" } }),
    { code: "INVALID_NAMESPACE_CONFIGURATION" },
  );
});

test("snapshot rejects contract artifact traversal", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-namespace-snapshot-"));
  const contractBytes = Buffer.from(JSON.stringify({
    profileVersion: "test",
    resources: [{
      iris: ["https://data.molit.go.kr/def/example"],
      representations: { "text/html": "../outside.html" },
    }],
    responseRules: {
      canonicalRedirect: { preserveQuery: true, status: 308, trailingSlash: "remove" },
      defaultMediaType: "text/html",
      notFound: 404,
      unsupportedAccept: 406,
      vary: ["Accept"],
    },
  }));
  await writeFile(path.join(directory, "contract.json"), contractBytes);
  await writeFile(path.join(directory, "artifact-lock.json"), JSON.stringify({
    artifacts: [{
      path: "contract.json",
      sha256: createHash("sha256").update(contractBytes).digest("hex"),
    }],
    profileVersion: "test",
    schemaVersion: "molit.profile-artifact-lock/1",
  }));
  await assert.rejects(
    loadPublicationSnapshot({
      contractFile: "contract.json",
      publicOrigin: "https://data.molit.go.kr",
      releaseRoot: directory,
    }),
    { code: "UNSAFE_PUBLICATION_ARTIFACT" },
  );
});

test("namespace service startup rejects changed contract and representation bytes", async () => {
  const source = path.resolve("profiles/molit-dcat-ap/releases/1.0.0-rc.1");
  const { cp, appendFile } = await import("node:fs/promises");
  for (const [relativePath, suffix] of [
    ["index.html", "\n<!-- unauthorized change -->\n"],
    ["publication/content-negotiation.json", "\n"],
  ]) {
    const directory = await mkdtemp(path.join(tmpdir(), "molit-namespace-tamper-"));
    await cp(source, directory, { recursive: true });
    await appendFile(path.join(directory, relativePath), suffix);
    const config = await loadNamespaceConfig({
      env: {
        MOLIT_NAMESPACE_ALLOWED_HOSTS: "data.molit.go.kr",
        MOLIT_NAMESPACE_PORT: "0",
        MOLIT_NAMESPACE_RELEASE_ROOT: directory,
      },
    });
    await assert.rejects(
      createNamespaceService({ config, logger: { info() {}, warn() {} } }),
      { code: "PUBLICATION_ARTIFACT_DIGEST_MISMATCH" },
    );
  }
});
