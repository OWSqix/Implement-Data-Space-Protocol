import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const register = JSON.parse(await readFile(
  path.join(root, "standards/korean-interoperability-register.json"),
  "utf8",
));

test("CRS-REG-001: content-addressed OGC resolver snapshots cover the release CRS set", () => {
  const result = spawnSync(
    process.execPath,
    ["tools/registries/verify-crs-snapshots.mjs"],
    { cwd: root, encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.definitions.length, 7);
  const registerByCode = new Map(register.referenceSystems.map((item) => [
    item.authority === "OGC" ? "OGC-CRS84" : `EPSG-${item.code}`,
    item,
  ]));
  assert.deepEqual(report.definitions.map(({ id, canonicalIri, sourceUrl }) => ({
    id,
    canonicalIri,
    sourceUrl,
  })), report.definitions.map(({ id }) => ({
    id,
    canonicalIri: registerByCode.get(id).iri,
    sourceUrl: registerByCode.get(id).officialUrl,
  })));
  assert.ok(report.definitions.every(({ deprecated }) => deprecated === false));
});

test("CRS-REG-002: each approved resolver response is fixed by a unique digest", async () => {
  const manifestPath = path.join(
    root,
    "standards/vendor/ogc-crs/2026-07-12/manifest.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.ok(manifest.artifacts.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256)));
  assert.equal(new Set(manifest.artifacts.map(({ sha256 }) => sha256)).size, 7);
  const artifact = manifest.artifacts[0];
  const bytes = await readFile(path.join(root, ...artifact.path.split("/")));
  const mutated = Buffer.from(bytes);
  mutated[mutated.length - 1] ^= 1;
  const digest = createHash("sha256").update(mutated).digest("hex");
  assert.notEqual(digest, artifact.sha256);
});
