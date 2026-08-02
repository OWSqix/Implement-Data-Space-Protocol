#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

try {
  const { stdout: prefixOutput } = await execute("git", ["rev-parse", "--show-prefix"], { encoding: "utf8" });
  const prefix = prefixOutput.trim().replace(/\/$/u, "");
  const treeish = prefix ? `HEAD:${prefix}` : "HEAD";
  const { stdout: archive } = await execute("git", ["archive", "--format=tar", treeish], { encoding: null, maxBuffer: 512 * 1024 * 1024 });
  process.stdout.write(`sha256:${createHash("sha256").update(archive).digest("hex")}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: "SUP_SOURCE_DIGEST_FAILED", message: error.message })}\n`);
  process.exitCode = 1;
}
