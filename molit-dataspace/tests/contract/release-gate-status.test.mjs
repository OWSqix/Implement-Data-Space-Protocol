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
  "44091fdd9cd4c482dc4efc6a2ef07ea7abc05b59bd25c7ea2e389feac70ccb41",
    "standards/provider-authority-registry.json":
      "e91563ef137b756e5f3c14820293eda141d25a78d6e2e951d53514301bc71684",
    "standards/iso19115-1-tech-gate/manifest.json":
      "ea78a62b2084deaa9e7182bb2d625c6f830f46356d46c9fcccd4ab7158e5616d",
  });
  assert.equal(
    createHash("sha256").update(JSON.stringify(report)).digest("hex"),
    "9a2522e21ddd7139d6c9aac04aaa4e848130c5b45c616d3534328e6a8e133504",
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
    "1edcfd72b65adb286df47f397c78be8b1fdc439aad7c9116544eefa429d2cde9",
  );
  const report = JSON.parse(result.stdout);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.decision, "blocked");
});
