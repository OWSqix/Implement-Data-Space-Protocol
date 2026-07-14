import { ResilientHttpClient } from "../bridge-runtime/http-client.mjs";
import { Telemetry } from "../bridge-runtime/telemetry.mjs";
import { loadTransferConfig } from "./config.mjs";
import { loadBindingRegistry } from "./binding-registry.mjs";
import { TransferConnectorManagementClient, PlatformProvisionerClient } from "./clients.mjs";
import { ProviderTransferWorker } from "./worker.mjs";
import { assertRuntime } from "../bridge-runtime/errors.mjs";

export async function createProviderTransferRuntime({ configPath, bindingPath, env = process.env, fetchImpl = fetch, telemetry = new Telemetry({ serviceName: "molit-provider-transfer-worker" }) }) {
  const config = await loadTransferConfig(configPath);
  const journalIntegrityKey = env[config.journalIntegrity.keyEnv];
  assertRuntime(typeof journalIntegrityKey === "string" && Buffer.byteLength(journalIntegrityKey, "utf8") >= 32 && !/[\u0000-\u001f\u007f]/u.test(journalIntegrityKey), "TRANSFER_JOURNAL_INTEGRITY_KEY_INVALID", "provider transfer journal HMAC key must be at least 32 bytes and free of control characters");
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
  return new ProviderTransferWorker({
    connector,
    provisioners,
    registry,
    journalPath: config.journalPath,
    journalIntegrityKey,
    journalIntegrityKeyId: config.journalIntegrity.keyId,
    telemetry,
  });
}
