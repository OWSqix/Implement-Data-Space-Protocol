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
    const { config, service, server } = await createCaaSRuntime({ configPath: resolve(configPath) });
    await service.readiness();
    server.listen(config.listen.port, config.listen.host, () => {
      const address = server.address();
      process.stdout.write(`${JSON.stringify({ status: "listening", host: address.address, port: address.port })}\n`);
    });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close((error) => { process.exitCode = error ? 1 : 0; });
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error?.code ?? "CAAS_START_FAILED", message: error?.message ?? "CaaS failed to start" })}\n`);
    process.exitCode = 1;
  }
}
