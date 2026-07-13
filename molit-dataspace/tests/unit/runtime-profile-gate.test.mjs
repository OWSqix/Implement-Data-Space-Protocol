import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MolitProfileGate } from "../../src/bridge-runtime/profile-gate.mjs";

test("runtime profile gate reports the digest of the bytes it validated", async () => {
  const inputPath = "profiles/molit-dcat-ap/releases/1.0.0-rc.1/examples/valid/core-catalog.ttl";
  const expected = createHash("sha256").update(await readFile(inputPath)).digest("hex");
  const result = await new MolitProfileGate().validate({
    inputPath,
    profileName: "core",
    version: "1.0.0-rc.1",
  });
  assert.equal(result.gatePassed, true);
  assert.equal(result.inputSha256, expected);
  assert.match(result.decisionDigest, /^sha256:[a-f0-9]{64}$/u);
});
