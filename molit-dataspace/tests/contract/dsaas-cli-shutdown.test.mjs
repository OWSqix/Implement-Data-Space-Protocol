import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cli = await readFile(new URL("../../src/dsaas/cli.mjs", import.meta.url), "utf8");

test("DSaaS CLI handles one graceful stop promise and reports shutdown failure", () => {
  assert.match(cli, /let stopPromise = null/u);
  assert.match(cli, /if \(stopPromise\) return stopPromise/u);
  assert.match(cli, /runtime\.close\(\{ timeoutMs: runtime\.config\.limits\.gracefulShutdownMs/u);
  assert.match(cli, /DSAAS_STOP_FAILED/u);
  assert.match(cli, /process\.exitCode = 1/u);
  assert.doesNotMatch(cli, /void stop/u);
});
