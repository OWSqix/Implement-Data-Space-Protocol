import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateReleaseGate } from "../../tools/release/release-gate.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

test("RELEASE-GATE-001: unresolved machine-register decisions block release", async () => {
  const report = await evaluateReleaseGate();
  assert.equal(report.schemaVersion, "molit.release-gate-status/1");
  assert.equal(report.targetLane, "win32-x64");
  assert.equal(report.releaseEligible, false);
  assert.equal(report.decision, "blocked");
  assert.ok(report.blockers.some(({ id }) => id === "BS-AUTHORITY-REGISTRY"));
  assert.ok(report.blockers.some(({ id }) => id === "PROVIDER-AUTHORITY-APPROVAL"));
  assert.ok(report.blockers.some(({ id }) => id === "ISO19115-OFFICIAL-BYTES"));
  assert.deepEqual(report.inputEvidence, {
    "standards/korean-interoperability-register.json":
      "1ad2fe10f34148dce1611d2c9cdf74eb755d1640e1c4f1f2238e079f47e2ae4c",
    "standards/provider-authority-registry.json":
      "e91563ef137b756e5f3c14820293eda141d25a78d6e2e951d53514301bc71684",
    "standards/iso19115-1-tech-gate/manifest.json":
      "ea78a62b2084deaa9e7182bb2d625c6f830f46356d46c9fcccd4ab7158e5616d",
  });
  assert.equal(
    createHash("sha256").update(JSON.stringify(report)).digest("hex"),
    "14c06a2f766d957bd29ee9757d7998f1f794cb5f09af6fe34de83bf85f804514",
  );
});

test("RELEASE-GATE-002: the command uses exit 2 for a valid blocked decision", () => {
  const result = spawnSync(process.execPath, ["tools/release/release-gate.mjs"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(
    createHash("sha256").update(result.stdout, "utf8").digest("hex"),
    "114ca11dfe1f02dbe898a1be9cd9c097cf8c1ba7a1e0f864be97916b68c485b7",
  );
  const report = JSON.parse(result.stdout);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.decision, "blocked");
});
