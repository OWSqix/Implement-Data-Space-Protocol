#!/usr/bin/env node
import { resolve } from "node:path";
import { createCaaSRuntime } from "./runtime.mjs";

const index = process.argv.indexOf("--config");
const configPath = index >= 0 ? process.argv[index + 1] : undefined;
if (!configPath) {
  process.stderr.write("usage: node src/caas/cli.mjs --config <file>\n");
  process.exitCode = 64;
} else {
  try {
    const runtime = await createCaaSRuntime({ configPath: resolve(configPath) });
    const address = await runtime.start();
    process.stdout.write(`${JSON.stringify({ status: "listening", host: address.address, port: address.port })}\n`);
    let stopPromise = null;
    const stop = () => {
      if (stopPromise) return stopPromise;
      stopPromise = runtime.close({ timeoutMs: runtime.config.limits.gracefulShutdownMs ?? 10_000 })
        .then(() => { process.exitCode = 0; })
        .catch((error) => {
          process.stderr.write(`${JSON.stringify({ code: error?.code ?? "CAAS_STOP_FAILED", message: error?.message ?? "CaaS failed to stop" })}\n`);
          process.exitCode = 1;
        });
      return stopPromise;
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error?.code ?? "CAAS_START_FAILED", message: error?.message ?? "CaaS failed to start" })}\n`);
    process.exitCode = 1;
  }
}
