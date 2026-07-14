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
    let stopping = false;
    const stop = async (signal) => {
      if (stopping) return;
      stopping = true;
      runtime.telemetry.log("INFO", "dsaas.stopping", { signal });
      await runtime.close();
    };
    process.once("SIGINT", () => void stop("SIGINT"));
    process.once("SIGTERM", () => void stop("SIGTERM"));
  } catch (error) {
    await runtime?.close().catch(() => {});
    process.stderr.write(`${JSON.stringify({ code: error?.code ?? "DSAAS_STARTUP_FAILED", message: error?.message ?? String(error) })}\n`);
    process.exitCode = 1;
  }
}
