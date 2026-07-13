import { ResilientHttpClient } from "../bridge-runtime/http-client.mjs";
import { Telemetry } from "../bridge-runtime/telemetry.mjs";
import { loadTransferConfig } from "./config.mjs";
import { loadBindingRegistry } from "./binding-registry.mjs";
import { TransferConnectorManagementClient, PlatformProvisionerClient } from "./clients.mjs";
import { ProviderTransferWorker } from "./worker.mjs";

export async function createProviderTransferRuntime({ configPath, bindingPath, env = process.env, fetchImpl = fetch, telemetry = new Telemetry({ serviceName: "molit-provider-transfer-worker" }) }) {
  const config = await loadTransferConfig(configPath);
  const registry = await loadBindingRegistry(bindingPath);
  const http = new ResilientHttpClient({
    policy: config.network,
    telemetry,
    fetchImpl,
    timeoutMs: config.network.timeoutMs,
    maxResponseBytes: config.network.maxResponseBytes,
    retries: config.network.retries,
  });
  const connector = new TransferConnectorManagementClient({ config: config.connector, http, env });
  const provisioners = Object.fromEntries(Object.entries(config.provisioners).map(([id, provisionerConfig]) => [
    id,
    new PlatformProvisionerClient({ config: provisionerConfig, http, env }),
  ]));
  return new ProviderTransferWorker({ connector, provisioners, registry, journalPath: config.journalPath, telemetry });
}
