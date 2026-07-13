#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createProviderTransferRuntime } from "./runtime.mjs";
import { redact } from "../bridge-runtime/telemetry.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const configPath = option("--config");
const bindingPath = option("--bindings");
const eventPath = option("--event");
if (!configPath || !bindingPath || !eventPath) {
  process.stderr.write("usage: node src/transfer-runtime/cli.mjs --config <file> --bindings <file> --event <file>\n");
  process.exitCode = 64;
} else {
  try {
    const worker = await createProviderTransferRuntime({ configPath: resolve(configPath), bindingPath: resolve(bindingPath) });
    const event = JSON.parse(await readFile(resolve(eventPath), "utf8"));
    const result = await worker.process(event);
    process.stdout.write(`${JSON.stringify(redact(result))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(redact({ code: error?.code ?? "TRANSFER_WORKER_FAILED", message: error?.message, details: error?.details }))}\n`);
    process.exitCode = 1;
  }
}
