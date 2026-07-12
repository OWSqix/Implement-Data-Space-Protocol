import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const manifestPath = path.join(
  root,
  "standards/vendor/iana/2026-07-12/manifest.json",
);
const policyPath = path.join(root, "standards/generated/iana-network-policy.v1.json");
const [manifest, policy] = await Promise.all([
  readFile(manifestPath, "utf8").then(JSON.parse),
  readFile(policyPath, "utf8").then(JSON.parse),
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("NET-REG-001: approved IANA source snapshots match byte digests", async () => {
  assert.equal(manifest.authority, "Internet Assigned Numbers Authority");
  assert.equal(manifest.license, "CC0-1.0");
  assert.equal(manifest.licenseUrl, "https://www.iana.org/help/licensing-terms");
  assert.deepEqual(
    manifest.artifacts.map(({ id }) => id).sort(),
    [
      "iana-ipv4-special-registry",
      "iana-ipv6-special-registry",
      "ipv6-unicast-address-assignments",
    ],
  );
  for (const artifact of manifest.artifacts) {
    assert.match(artifact.path, /^standards\/vendor\/iana\/2026-07-12\/[^/]+[.]csv$/u);
    const bytes = await readFile(path.join(root, ...artifact.path.split("/")));
    assert.equal(bytes.length, artifact.bytes, artifact.id);
    assert.equal(sha256(bytes), artifact.sha256, artifact.id);
  }
});

test("NET-REG-002: generated policy is reproducible from snapshots without network access", () => {
  const result = spawnSync(
    process.execPath,
    ["tools/registries/generate-iana-network-policy.mjs"],
    { cwd: root, encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.write, false);
  assert.equal(report.ipv4Special, 26);
  assert.equal(report.ipv6Special, 25);
  assert.equal(report.ipv6GlobalAllocated, 36);
});

test("NET-REG-003: longest-prefix exceptions and local prohibitions remain explicit", () => {
  const ipv4 = new Map(policy.ipv4Special.map((record) => [record.prefix, record]));
  const ipv6 = new Map(policy.ipv6Special.map((record) => [record.prefix, record]));
  const allocated = new Set(policy.ipv6GlobalAllocated.map(({ prefix }) => prefix));

  assert.equal(ipv4.get("192.0.0.9/32")?.globallyReachable, true);
  assert.equal(ipv4.get("192.0.0.0/24")?.globallyReachable, false);
  assert.equal(ipv6.get("2001:1::1/128")?.globallyReachable, true);
  assert.equal(ipv6.get("2001::/23")?.globallyReachable, false);
  assert.equal(ipv6.get("64:ff9b::/96")?.embeddedIpv4Policy, true);
  assert.equal(allocated.has("2410::/12"), true);
  assert.deepEqual(policy.localPolicyAdditions.ipv4NonGlobal, [{
    prefix: "224.0.0.0/4",
    reason: "multicast URL hosts are prohibited",
  }]);
  assert.deepEqual(policy.localPolicyAdditions.ipv6NonGlobal, [{
    prefix: "fec0::/10",
    reason: "deprecated site-local URL hosts are prohibited",
  }]);
});
