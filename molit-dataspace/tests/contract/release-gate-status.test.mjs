import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
      "a24b285ed7dfefcd8d624d78857ce71a9cc14ef91d0290ea8585d02e5fdca841",
    "standards/provider-authority-registry.json":
      "e91563ef137b756e5f3c14820293eda141d25a78d6e2e951d53514301bc71684",
    "standards/iso19115-1-tech-gate/manifest.json":
      "ea78a62b2084deaa9e7182bb2d625c6f830f46356d46c9fcccd4ab7158e5616d",
  });
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
  const report = JSON.parse(result.stdout);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.decision, "blocked");
});
