#!/usr/bin/env node
import { loadNamespaceConfig } from "./config.mjs";
import { createNamespaceService } from "./server.mjs";

async function main() {
  const config = await loadNamespaceConfig();
  const service = await createNamespaceService({ config });
  const address = await service.start();
  process.stdout.write(`${JSON.stringify({
    address: address.address,
    event: "namespace.started",
    port: address.port,
    profileVersion: service.snapshot.profileVersion,
    publicOrigin: config.publicOrigin,
  })}\n`);

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`${JSON.stringify({ event: "namespace.stopping", signal })}\n`);
    await service.close();
    process.stdout.write(`${JSON.stringify({ event: "namespace.stopped" })}\n`);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    code: error.code ?? "NAMESPACE_STARTUP_FAILED",
    details: error.details ?? {},
    event: "namespace.fatal",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
});
