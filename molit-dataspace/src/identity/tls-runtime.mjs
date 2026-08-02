import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { open } from "node:fs/promises";
import { createSecureContext } from "node:tls";

import { IdentityError, assertIdentity } from "./errors.mjs";

async function readBoundedFile(path, label, maxBytes) {
  let handle;
  try {
    handle = await open(path, "r");
    const before = await handle.stat();
    assertIdentity(before.isFile() && before.size > 0 && before.size <= maxBytes,
      "IDENTITY_TLS_MATERIAL_INVALID", `${label} is empty, non-regular, or exceeds its byte limit`, { status: 500 });
    const value = await handle.readFile();
    const after = await handle.stat();
    assertIdentity(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs,
      "IDENTITY_TLS_MATERIAL_INVALID", `${label} changed while it was being read`, { status: 500 });
    return value;
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError("IDENTITY_TLS_MATERIAL_INVALID", `${label} could not be read`, { status: 500, cause: error });
  } finally {
    await handle?.close().catch(() => {});
  }
}

function materialDigest(material) {
  const hash = createHash("sha256");
  for (const name of ["cert", "key", "ca"]) hash.update(name).update("\0").update(material[name]).update("\0");
  return hash.digest("hex");
}

export class ReloadingTlsContext {
  constructor({ certFile, keyFile, clientCaFile, reloadIntervalMs, maxMaterialBytes = 1_048_576 }, { clock = () => new Date() } = {}) {
    for (const [label, value] of Object.entries({ certFile, keyFile, clientCaFile })) {
      assertIdentity(typeof value === "string" && value.length > 0, "IDENTITY_TLS_CONFIGURATION_INVALID", `${label} is required`, { status: 500 });
    }
    assertIdentity(Number.isSafeInteger(reloadIntervalMs) && reloadIntervalMs >= 250 && reloadIntervalMs <= 300_000,
      "IDENTITY_TLS_CONFIGURATION_INVALID", "TLS reload interval is invalid", { status: 500 });
    this.config = { certFile, keyFile, clientCaFile, reloadIntervalMs, maxMaterialBytes };
    this.clock = clock;
    this.active = null;
    this.failure = null;
    this.generation = 0;
    this.timer = null;
    this.reloading = null;
    this.server = null;
  }

  async #load() {
    const [cert, key, ca] = await Promise.all([
      readBoundedFile(this.config.certFile, "TLS certificate", this.config.maxMaterialBytes),
      readBoundedFile(this.config.keyFile, "TLS private key", this.config.maxMaterialBytes),
      readBoundedFile(this.config.clientCaFile, "TLS client CA", this.config.maxMaterialBytes),
    ]);
    const material = { cert, key, ca };
    try {
      createSecureContext({ ...material, minVersion: "TLSv1.2" });
      const now = this.clock();
      assertIdentity(now instanceof Date && Number.isFinite(now.getTime()), "IDENTITY_TLS_CONFIGURATION_INVALID", "TLS validation clock is invalid", { status: 500 });
      const serverCertificate = new X509Certificate(cert);
      const clientAuthority = new X509Certificate(ca);
      for (const [label, certificate] of [["server certificate", serverCertificate], ["client CA", clientAuthority]]) {
        assertIdentity(certificate.validFromDate <= now && now <= certificate.validToDate,
          "IDENTITY_TLS_MATERIAL_INVALID", `${label} is not currently valid`, { status: 500 });
      }
      assertIdentity(serverCertificate.ca === false, "IDENTITY_TLS_MATERIAL_INVALID", "TLS server certificate cannot be a CA certificate", { status: 500 });
      assertIdentity(clientAuthority.ca === true, "IDENTITY_TLS_MATERIAL_INVALID", "TLS client trust material must begin with a CA certificate", { status: 500 });
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      throw new IdentityError("IDENTITY_TLS_MATERIAL_INVALID", "TLS certificate, private key, or client CA is invalid", { status: 500, cause: error });
    }
    return { ...material, digest: materialDigest(material) };
  }

  async initialize() {
    assertIdentity(this.active === null, "IDENTITY_TLS_ALREADY_INITIALIZED", "TLS context is already initialized", { status: 500 });
    this.active = await this.#load();
    this.generation = 1;
    this.failure = null;
    return this;
  }

  serverOptions() {
    assertIdentity(this.active, "IDENTITY_TLS_NOT_INITIALIZED", "TLS context is not initialized", { status: 500 });
    return {
      cert: this.active.cert,
      key: this.active.key,
      ca: this.active.ca,
      minVersion: "TLSv1.2",
      requestCert: true,
      rejectUnauthorized: false,
      ticketKeys: randomBytes(48),
    };
  }

  async reload() {
    if (this.reloading) return this.reloading;
    this.reloading = (async () => {
      try {
        const candidate = await this.#load();
        if (candidate.digest !== this.active.digest) {
          this.server?.setSecureContext({ cert: candidate.cert, key: candidate.key, ca: candidate.ca, minVersion: "TLSv1.2" });
          this.server?.setTicketKeys?.(randomBytes(48));
          this.active = candidate;
          this.generation += 1;
        }
        this.failure = null;
        return true;
      } catch (error) {
        this.failure = error instanceof IdentityError
          ? error
          : new IdentityError("IDENTITY_TLS_ROTATION_FAILED", "TLS material rotation failed", { status: 500, cause: error });
        return false;
      } finally {
        this.reloading = null;
      }
    })();
    return this.reloading;
  }

  attach(server) {
    assertIdentity(this.active && server && typeof server.setSecureContext === "function",
      "IDENTITY_TLS_CONFIGURATION_INVALID", "an initialized TLS context and TLS server are required", { status: 500 });
    assertIdentity(!this.server, "IDENTITY_TLS_ALREADY_ATTACHED", "TLS context is already attached", { status: 500 });
    this.server = server;
    this.timer = setInterval(() => void this.reload(), this.config.reloadIntervalMs);
    this.timer.unref?.();
  }

  readiness() {
    return Object.freeze({
      ready: this.active !== null && this.failure === null,
      generation: this.generation,
      activeDigest: this.active?.digest ?? null,
      failureCode: this.failure?.code ?? null,
    });
  }

  async close() {
    clearInterval(this.timer);
    this.timer = null;
    await this.reloading?.catch(() => {});
    this.server = null;
  }
}

export function rejectUntrustedPresentedClientCertificate(request) {
  const socket = request?.socket;
  if (!socket?.encrypted || typeof socket.getPeerCertificate !== "function") return;
  const certificate = socket.getPeerCertificate(true);
  const presented = Buffer.isBuffer(certificate?.raw) && certificate.raw.length > 0;
  assertIdentity(!presented || socket.authorized === true,
    "IDENTITY_CLIENT_CERTIFICATE_UNTRUSTED", "the presented client certificate is not trusted", { status: 401 });
}
