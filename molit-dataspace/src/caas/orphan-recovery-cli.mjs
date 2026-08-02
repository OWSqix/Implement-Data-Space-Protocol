#!/usr/bin/env node
import { resolve } from "node:path";
import { assertCaasEnvironment, loadCaasConfig } from "./config.mjs";
import { createCaasProvisioners } from "./provisioner.mjs";
import { createCaasStateStore } from "./runtime.mjs";
import { recoverKubernetesOrphans } from "./orphan-recovery.mjs";

const index = process.argv.indexOf("--config");
const configPath = index >= 0 ? process.argv[index + 1] : undefined;
if (!configPath) {
  process.stderr.write("usage: node src/caas/orphan-recovery-cli.mjs --config <file>\n");
  process.exitCode = 64;
} else {
  let store;
  try {
    const config = await loadCaasConfig(resolve(configPath));
    assertCaasEnvironment(config);
    store = await createCaasStateStore({ config });
    const result = await recoverKubernetesOrphans({ config, store, provisioners: createCaasProvisioners(config) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error?.code ?? "CAAS_ORPHAN_RECOVERY_FAILED", message: error?.message ?? "Kubernetes orphan recovery failed" })}\n`);
    process.exitCode = 1;
  } finally {
    await store?.close({ timeoutMs: 10_000 }).catch(() => {});
  }
}
