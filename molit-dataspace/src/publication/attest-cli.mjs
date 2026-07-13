#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { attestNamespace } from "./remote-attestation.mjs";

function parseArguments(argv) {
  const options = {};
  for (const argument of argv) {
    if (argument === "--execute-network") options.executeNetwork = true;
    else if (argument.startsWith("--expected-origin=")) options.expectedOrigin = argument.slice(18);
    else if (argument.startsWith("--release-root=")) options.releaseRoot = argument.slice(15);
    else if (argument.startsWith("--contract-file=")) options.contractFile = argument.slice(16);
    else if (argument.startsWith("--ca-file=")) options.caFile = argument.slice(10);
    else if (argument.startsWith("--output=")) options.output = argument.slice(9);
    else if (argument.startsWith("--timeout-ms=")) options.timeoutMs = Number(argument.slice(13));
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.executeNetwork) {
    const error = new Error("remote namespace attestation requires --execute-network");
    error.code = "NETWORK_EXECUTION_NOT_CONFIRMED";
    throw error;
  }
  if (!options.expectedOrigin) throw new Error("--expected-origin is required");
  const releaseRoot = path.resolve(options.releaseRoot ?? "profiles/molit-dcat-ap/releases/1.0.0-rc.1");
  const ca = options.caFile ? await readFile(path.resolve(options.caFile)) : undefined;
  const report = await attestNamespace({
    ca,
    contractFile: options.contractFile,
    expectedOrigin: options.expectedOrigin,
    releaseRoot,
    timeoutMs: options.timeoutMs,
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) await writeFile(path.resolve(options.output), serialized, { encoding: "utf8", flag: "wx" });
  else process.stdout.write(serialized);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    code: error.code ?? "NAMESPACE_ATTESTATION_FAILED",
    message: error.message,
  })}\n`);
  process.exitCode = 2;
});
