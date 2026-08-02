#!/usr/bin/env node
import { resolve } from "node:path";

import { createDsaasRuntime } from "./runtime.mjs";

const configIndex = process.argv.indexOf("--config");
const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : process.env.MOLIT_DSAAS_CONFIG;
if (!configPath) {
  process.stderr.write("usage: node src/dsaas/cli.mjs --config <path>\n");
  process.exitCode = 64;
} else {
  let runtime;
  try {
    runtime = await createDsaasRuntime({ configPath: resolve(configPath) });
    const address = await runtime.server.start();
    runtime.telemetry.log("INFO", "dsaas.started", { "server.address": typeof address === "string" ? address : address?.address, "server.port": address?.port });
    let stopPromise = null;
    const stop = (signal) => {
      if (stopPromise) return stopPromise;
      runtime.telemetry.log("INFO", "dsaas.stopping", { signal });
      stopPromise = runtime.close({ timeoutMs: runtime.config.limits.gracefulShutdownMs ?? 10_000 })
        .then(() => { process.exitCode = 0; })
        .catch((error) => {
          process.stderr.write(`${JSON.stringify({ code: error?.code ?? "DSAAS_STOP_FAILED", message: error?.message ?? "DSaaS failed to stop" })}\n`);
          process.exitCode = 1;
        });
      return stopPromise;
    };
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
  } catch (error) {
    await runtime?.close().catch(() => {});
    process.stderr.write(`${JSON.stringify({ code: error?.code ?? "DSAAS_STARTUP_FAILED", message: error?.message ?? String(error) })}\n`);
    process.exitCode = 1;
  }
}
