import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { digest } from "../discovery/stable-json.mjs";
import { CaaSError, assertCaas } from "./errors.mjs";
import { createKubernetesEdcProvisioner } from "./kubernetes-provisioner.mjs";

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("CaaS provisioner operation was aborted");
  error.name = "AbortError";
  throw error;
}

async function writeAtomic(path, value, { signal } = {}) {
  throwIfAborted(signal);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(serialized);
    await handle.sync();
    await handle.close();
    handle = undefined;
    throwIfAborted(signal);
    await rename(temporary, path);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

/**
 * Emits connector deployment intent only. It neither assumes an EDC Management
 * API nor claims that an EDC process was deployed.
 */
export class DryRunManifestProvisioner {
  constructor({ id, manifestDirectory }) {
    this.id = id;
    this.manifestDirectory = manifestDirectory;
    this.intentOnly = true;
    this.fencingCapable = false;
  }

  async readiness({ signal } = {}) {
    throwIfAborted(signal);
    await mkdir(this.manifestDirectory, { recursive: true });
    const probe = join(this.manifestDirectory, `.ready-${process.pid}-${randomUUID()}`);
    const handle = await open(probe, "wx", 0o600);
    await handle.close();
    throwIfAborted(signal);
    await unlink(probe);
    return true;
  }

  async provision(tenant, operationKey, { signal } = {}) {
    return this.#writeIntent(tenant, operationKey, "PROVISIONED", { signal });
  }

  async deprovision(tenant, operationKey, { signal } = {}) {
    return this.#writeIntent(tenant, operationKey, "DEPROVISIONED", { signal });
  }

  async suspend(tenant, operationKey, { signal } = {}) {
    return this.#writeIntent(tenant, operationKey, "SUSPENDED", { signal });
  }

  async delete(tenant, operationKey, { signal } = {}) {
    return this.#writeIntent(tenant, operationKey, "DELETED", { signal });
  }

  async observe(tenant, _operationKey, { signal } = {}) {
    throwIfAborted(signal);
    const path = join(this.manifestDirectory, `${tenant.tenantId}.intent.json`);
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      throwIfAborted(signal);
      assertCaas(value && typeof value === "object" && !Array.isArray(value), "CAAS_PROVISIONER_OBSERVATION_INVALID", "deployment intent observation is not an object");
      return {
        adapterResourceId: `dry-run:${tenant.tenantId}`,
        intentDigest: digest(value),
        exists: true,
      };
    } catch (error) {
      if (error?.code === "ENOENT") return { adapterResourceId: `dry-run:${tenant.tenantId}`, intentDigest: null, exists: false };
      if (error instanceof SyntaxError) throw new CaaSError("CAAS_PROVISIONER_OBSERVATION_INVALID", "deployment intent is not valid JSON");
      throw error;
    }
  }

  async #writeIntent(tenant, operationKey, desiredState, { signal } = {}) {
    throwIfAborted(signal);
    await mkdir(this.manifestDirectory, { recursive: true });
    const path = join(this.manifestDirectory, `${tenant.tenantId}.intent.json`);
    const intent = {
      schemaVersion: "molit.caas-deployment-intent/1",
      adapterContract: "connector-provisioner-neutral/1",
      adapterId: tenant.adapterId,
      tenantId: tenant.tenantId,
      generation: tenant.generation,
      operationKey,
      desiredState,
      connectorIdentity: {
        organizationId: tenant.organizationId,
        participantId: tenant.participantId,
        namespace: tenant.namespace,
        endpoint: tenant.endpoint,
      },
      runtimeProfileRef: tenant.runtimeProfileRef,
      connectorPlanId: tenant.connectorPlanId,
      connectorPlan: tenant.connectorPlanSnapshot,
      connectorPlanDigest: tenant.connectorPlanDigest,
      deploymentSecretRefs: ["PROVISIONED", "SUSPENDED"].includes(desiredState) ? tenant.deploymentSecretRefs : {},
    };
    const intentDigest = digest(intent);
    let existing;
    try { existing = JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    throwIfAborted(signal);
    if (existing?.operationKey === operationKey) {
      assertCaas(digest(existing) === intentDigest, "CAAS_PROVISIONER_IDEMPOTENCY_CONFLICT", "same operation key produced a different deployment intent");
      return { adapterResourceId: `dry-run:${tenant.tenantId}`, intentDigest, converged: false };
    }
    await writeAtomic(path, intent, { signal });
    return { adapterResourceId: `dry-run:${tenant.tenantId}`, intentDigest, converged: false };
  }
}

export function createCaasProvisioners(config) {
  return Object.fromEntries(Object.entries(config.provisioners).map(([id, value]) => {
    if (value.type === "dry-run-manifest") return [id, new DryRunManifestProvisioner({ id, manifestDirectory: value.manifestDirectory })];
    if (value.type === "kubernetes-edc") return [id, createKubernetesEdcProvisioner({ id, config: value })];
    throw new CaaSError("CAAS_PROVISIONER_UNSUPPORTED", `unsupported provisioner type: ${value.type}`);
  }));
}
