import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTransferConfig } from "../../src/transfer-runtime/config.mjs";
import { TransferConnectorManagementClient } from "../../src/transfer-runtime/clients.mjs";

function config() {
  return {
    schemaVersion: "molit.provider-transfer-runtime-config/1",
    environment: "production",
    journalPath: "journal.json",
    journalIntegrity: { keyEnv: "TRANSFER_JOURNAL_HMAC_KEY", keyId: "test-transfer-key-1" },
    network: { allowedOrigins: ["https://connector.example", "https://platform.example"], privateOrigins: [], allowHttp: false, allowPrivate: false, timeoutMs: 1000, maxResponseBytes: 4096, retries: 0 },
    connector: { baseUrl: "https://connector.example/management/", statusPath: "transfers/{providerPid}", startAckPath: "transfers/{providerPid}/start", terminationAckPath: "transfers/{providerPid}/termination", supportsIdempotencyKey: true },
    provisioners: { p: { baseUrl: "https://platform.example/control/", provisionPath: "provision", revokePath: "revoke", supportsIdempotencyKey: true, idempotentRevoke: true } },
  };
}

test("production config requires env-backed adapter authentication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-transfer-config-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(config()));
  await assert.rejects(loadTransferConfig(path), { code: "TRANSFER_CONFIG_INVALID" });
});

test("connector path cannot escape its configured origin", async () => {
  const client = new TransferConnectorManagementClient({
    config: { ...config().connector, statusPath: "//attacker.example/{providerPid}" },
    http: { json: async () => assert.fail("HTTP must not be attempted") },
  });
  await assert.rejects(client.status("provider-1"), { code: "ADAPTER_ORIGIN_ESCAPE" });
});
