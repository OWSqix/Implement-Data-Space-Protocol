import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateRuntimeDocuments } from "../../src/bridge-runtime/config-validator.mjs";

test("publication runtime config rejects unknown provider and DSP properties", async () => {
  const config = JSON.parse(await readFile("fixtures/runtime/config.example.json", "utf8"));
  const approvals = {
    entries: [],
    schemaVersion: "molit.dispatch-approval-registry/1",
  };
  await validateRuntimeDocuments(config, approvals);

  config.provider.unreviewedOption = true;
  await assert.rejects(validateRuntimeDocuments(config, approvals), {
    code: "RUNTIME_CONFIG_INVALID",
  });
  delete config.provider.unreviewedOption;

  config.dsp = { baseUrl: "https://connector.example" };
  await assert.rejects(validateRuntimeDocuments(config, approvals), {
    code: "RUNTIME_CONFIG_INVALID",
  });
});
