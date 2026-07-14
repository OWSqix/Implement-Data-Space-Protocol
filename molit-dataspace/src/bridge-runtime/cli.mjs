#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConnectorManagementClient } from "./clients.mjs";
import { ResilientHttpClient } from "./http-client.mjs";
import { HttpPlatformAdapter } from "./platform-adapter.mjs";
import { Telemetry } from "./telemetry.mjs";
import { BridgeRuntime } from "./worker.mjs";
import { JsonPathDispatchProjector } from "./projector.mjs";
import { validateRuntimeDocuments } from "./config-validator.mjs";
import { MolitProfileGate } from "./profile-gate.mjs";
import { EdcManagementV4PublicationClient } from "./edc-v4-management-client.mjs";

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--once" || value === "--dry-run") result[value.slice(2)] = true;
    else if (value.startsWith("--") && argv[index + 1]) result[value.slice(2)] = argv[++index];
    else throw new Error(`invalid argument: ${value}`);
  }
  return result;
}

export async function buildRuntime(config, { env = process.env } = {}) {
  if (config.fixtureMode && env.NODE_ENV !== "test") throw new Error("fixtureMode requires NODE_ENV=test");
  const telemetry = new Telemetry();
  const allowedOrigins = [config.provider.baseUrl, config.management.baseUrl].map((value) => new URL(value).origin);
  const http = new ResilientHttpClient({
    telemetry,
    ...(config.http ?? {}),
    policy: { allowedOrigins, privateOrigins: config.privateOrigins ?? [], allowHttp: config.fixtureMode === true, allowPrivate: config.fixtureMode === true },
  });
  const approvalRegistry = JSON.parse(await readFile(resolve(config.approvalRegistryPath), "utf8"));
  await validateRuntimeDocuments(config, approvalRegistry);
  return new BridgeRuntime({
    statePath: resolve(config.statePath),
    providerId: config.provider.id,
    adapter: new HttpPlatformAdapter({ config: config.provider, http, env }),
    projector: new JsonPathDispatchProjector(config.mapping, { metadataRoot: config.metadataRoot, profileGate: new MolitProfileGate() }),
    approvalRegistry,
    approvalRegistryProvider: async () => {
      const current = JSON.parse(await readFile(resolve(config.approvalRegistryPath), "utf8"));
      await validateRuntimeDocuments(config, current);
      return current;
    },
    managementClient: config.management.adapter === "edc-v4"
      ? new EdcManagementV4PublicationClient({ config: config.management, http, env })
      : new ConnectorManagementClient({ config: config.management, http, env }),
    telemetry,
    queue: config.queue,
  });
}

async function main() {
  const parsed = options(process.argv.slice(2));
  if (!parsed.config) throw new Error("--config <path> is required");
  const config = JSON.parse(await readFile(resolve(parsed.config), "utf8"));
  const runtime = await buildRuntime(config);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  do {
    const result = await runtime.runOnce({ signal: controller.signal, dryRun: parsed["dry-run"] === true });
    process.stderr.write(`${JSON.stringify(result)}\n`);
    if (parsed.once || parsed["dry-run"]) break;
    await new Promise((resolvePromise) => {
      const timer = setTimeout(resolvePromise, config.pollIntervalMs ?? 60_000);
      controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolvePromise(); }, { once: true });
    });
  } while (!controller.signal.aborted);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error.code ?? error.name, message: error.message })}\n`);
    process.exitCode = 1;
  });
}
