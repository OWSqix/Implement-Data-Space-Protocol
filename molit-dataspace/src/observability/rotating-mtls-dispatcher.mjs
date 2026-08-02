import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { Agent } from "undici";

import { assertObservability, ObservabilityError } from "./errors.mjs";

function textSecret(value, code, message) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  assertObservability(typeof text === "string" && text.length > 0, code, message);
  return text;
}

function materialDigest({ ca, cert, key, serverName }) {
  const hash = createHash("sha256");
  for (const value of [ca, cert, key, serverName ?? ""]) hash.update(value).update("\0");
  return hash.digest("hex");
}

function validatedMaterial(values, clock) {
  const ca = textSecret(values.ca, "OBS_TLS_CA_INVALID", "observability TLS CA is empty");
  const cert = textSecret(values.cert, "OBS_TLS_CERTIFICATE_INVALID", "observability TLS client certificate is empty");
  const key = textSecret(values.key, "OBS_TLS_PRIVATE_KEY_INVALID", "observability TLS client private key is empty");
  let certificate;
  let authority;
  try {
    createSecureContext({ ca, cert, key, minVersion: "TLSv1.2" });
    certificate = new X509Certificate(cert);
    authority = new X509Certificate(ca);
    const privateKey = createPrivateKey(key);
    const certificateKey = certificate.publicKey.export({ format: "der", type: "spki" });
    const privatePublicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    assertObservability(certificateKey.equals(privatePublicKey), "OBS_TLS_KEY_MISMATCH", "observability TLS client certificate and private key do not match");
  } catch (error) {
    if (error instanceof ObservabilityError) throw error;
    throw new ObservabilityError("OBS_TLS_MATERIAL_INVALID", "observability TLS material is invalid", { cause: error });
  }
  const now = clock();
  assertObservability(now instanceof Date && Number.isFinite(now.valueOf()), "OBS_CLOCK_INVALID", "observability TLS validation clock is invalid");
  assertObservability(certificate.validFromDate <= now && now < certificate.validToDate && certificate.ca === false,
    "OBS_TLS_CERTIFICATE_INVALID", "observability TLS client certificate is expired, not yet valid, or is a CA certificate");
  assertObservability(authority.validFromDate <= now && now < authority.validToDate && authority.ca === true,
    "OBS_TLS_CA_INVALID", "observability TLS trust anchor is expired, not yet valid, or is not a CA certificate");
  const result = { ca, cert, key, serverName: values.serverName };
  return Object.freeze({ ...result, digest: materialDigest(result) });
}

export class RotatingMtlsDispatcher {
  constructor({ tls, secretResolver, agentFactory = (options) => new Agent(options), clock = () => new Date() }) {
    assertObservability(tls && typeof tls === "object" && typeof tls.caRef === "string" && typeof tls.certificateRef === "string"
      && typeof tls.privateKeyRef === "string" && Number.isSafeInteger(tls.reloadIntervalMs) && tls.reloadIntervalMs >= 250 && tls.reloadIntervalMs <= 300_000,
    "OBS_TLS_ROTATION_CONFIG_INVALID", "observability TLS rotation configuration is invalid");
    assertObservability(typeof secretResolver === "function" && typeof agentFactory === "function" && typeof clock === "function",
      "OBS_TLS_ROTATION_CONFIG_INVALID", "observability TLS rotation dependencies are invalid");
    Object.assign(this, { tls: Object.freeze({ ...tls }), secretResolver, agentFactory, clock });
    Object.defineProperties(this, {
      active: { value: null, writable: true, enumerable: false },
      reloadPromise: { value: null, writable: true, enumerable: false },
      retired: { value: new Set(), enumerable: false },
      timer: { value: null, writable: true, enumerable: false },
    });
    this.closed = false;
    this.failure = null;
    this.generation = 0;
    this.lastSuccessAt = null;
  }

  async #load({ signal } = {}) {
    const [ca, cert, key] = await Promise.all([
      this.secretResolver(this.tls.caRef, { purpose: "telemetry-tls-ca", signal }),
      this.secretResolver(this.tls.certificateRef, { purpose: "telemetry-tls-client-certificate", signal }),
      this.secretResolver(this.tls.privateKeyRef, { purpose: "telemetry-tls-client-private-key", signal }),
    ]);
    return validatedMaterial({ ca, cert, key, serverName: this.tls.serverName }, this.clock);
  }

  #newAgent(material) {
    return this.agentFactory({
      connect: {
        ca: material.ca,
        cert: material.cert,
        key: material.key,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        ...(material.serverName ? { servername: material.serverName } : {}),
      },
    });
  }

  async initialize() {
    assertObservability(!this.closed && this.active === null, "OBS_TLS_ROTATION_STATE_INVALID", "observability TLS dispatcher is already initialized or closed");
    const material = await this.#load();
    this.active = Object.freeze({ agent: this.#newAgent(material), digest: material.digest });
    this.generation = 1;
    this.failure = null;
    this.lastSuccessAt = this.clock().toISOString();
    this.timer = setInterval(() => void this.reload().catch(() => {}), this.tls.reloadIntervalMs);
    this.timer.unref?.();
    return this;
  }

  async reload({ signal } = {}) {
    if (this.reloadPromise) return this.reloadPromise;
    assertObservability(!this.closed && this.active, "OBS_TLS_ROTATION_STATE_INVALID", "observability TLS dispatcher is not active");
    this.reloadPromise = (async () => {
      const recovering = this.failure !== null;
      try {
        const material = await this.#load({ signal });
        if (material.digest !== this.active.digest) {
          const candidate = Object.freeze({ agent: this.#newAgent(material), digest: material.digest });
          const previous = this.active;
          this.active = candidate;
          this.generation += 1;
          const retiring = Promise.resolve(previous.agent.close?.()).catch(() => {});
          this.retired.add(retiring);
          retiring.finally(() => this.retired.delete(retiring)).catch(() => {});
        } else if (recovering) {
          this.generation += 1;
        }
        this.failure = null;
        this.lastSuccessAt = this.clock().toISOString();
        return true;
      } catch (error) {
        this.failure = error instanceof ObservabilityError
          ? new ObservabilityError("OBS_TLS_ROTATION_FAILED", "observability TLS credential rotation failed", { cause: error })
          : new ObservabilityError("OBS_TLS_ROTATION_FAILED", "observability TLS credential rotation failed", { cause: error });
        return false;
      } finally {
        this.reloadPromise = null;
      }
    })();
    return this.reloadPromise;
  }

  dispatch(options, handler) {
    assertObservability(!this.closed && this.active?.agent && typeof this.active.agent.dispatch === "function",
      "OBS_TLS_DISPATCHER_UNAVAILABLE", "observability TLS dispatcher is unavailable");
    return this.active.agent.dispatch(options, handler);
  }

  readiness() {
    return Object.freeze({
      activeDigest: this.active?.digest ?? null,
      failureCode: this.failure?.code ?? null,
      generation: this.generation,
      lastSuccessAt: this.lastSuccessAt,
      ready: !this.closed && this.active !== null && this.failure === null,
      status: !this.closed && this.active !== null && this.failure === null ? "READY" : "NOT_READY",
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.timer = null;
    await this.reloadPromise?.catch(() => {});
    const active = this.active;
    this.active = null;
    await Promise.allSettled([active?.agent.close?.(), ...this.retired]);
  }
}

export async function createRotatingMtlsDispatcher(options) {
  return new RotatingMtlsDispatcher(options).initialize();
}
