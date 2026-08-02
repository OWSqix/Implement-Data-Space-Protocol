import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { Agent } from "undici";

import { createPinnedLookup } from "../bridge-runtime/http-client.mjs";
import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { BoundedFileSecretProvider } from "./operational-config.mjs";

const HEADER_VALUE = /^[\x21-\x7e]+$/u;

function fileReference(path) {
  const normalized = String(path).replaceAll("\\", "/");
  return new URL(`file://${normalized.startsWith("/") ? "" : "/"}${normalized}`).href;
}

function keyDigest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateKeyPair(certPem, keyPem) {
  try {
    const certificate = new X509Certificate(certPem);
    const privateKey = createPrivateKey(keyPem);
    const certificateKey = certificate.publicKey.export({ format: "der", type: "spki" });
    const privatePublicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    assertRuntime(certificateKey.equals(privatePublicKey), "DSAAS_CAAS_MTLS_KEY_MISMATCH", "CaaS client certificate and private key do not match");
    const now = Date.now();
    assertRuntime(Date.parse(certificate.validFrom) <= now && Date.parse(certificate.validTo) > now,
      "DSAAS_CAAS_MTLS_CERTIFICATE_INVALID", "CaaS client certificate is not currently valid");
    return certificate.fingerprint256.replaceAll(":", "").toLowerCase();
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError("DSAAS_CAAS_MTLS_MATERIAL_INVALID", "CaaS mTLS certificate material is invalid");
  }
}

export class RotatingMtlsMaterial {
  constructor({ caFile, certFile, keyFile, serverName, secretProvider = new BoundedFileSecretProvider({ maxBytes: 1_048_576 }) }) {
    Object.assign(this, { caFile, certFile, keyFile, serverName, secretProvider });
  }

  async snapshot({ signal } = {}) {
    const [ca, cert, key] = await Promise.all([
      this.secretProvider.get(fileReference(this.caFile), { signal }),
      this.secretProvider.get(fileReference(this.certFile), { signal }),
      this.secretProvider.get(fileReference(this.keyFile), { signal }),
    ]);
    const certificateSha256 = validateKeyPair(cert, key);
    try { new X509Certificate(ca); } catch { throw new RuntimeError("DSAAS_CAAS_MTLS_CA_INVALID", "CaaS mTLS trust anchor is invalid"); }
    return Object.freeze({
      ca,
      cert,
      key,
      serverName: this.serverName,
      certificateSha256,
      materialDigest: keyDigest(`${ca}\0${cert}\0${key}\0${this.serverName}`),
    });
  }
}

export function createRotatingMtlsDispatcherFactory(material) {
  return async (_url, addresses, { dispatcherContext } = {}) => {
    const snapshot = dispatcherContext?.mtls ?? await material.snapshot();
    return new Agent({
      connect: {
        ca: snapshot.ca,
        cert: snapshot.cert,
        key: snapshot.key,
        servername: snapshot.serverName,
        lookup: createPinnedLookup(addresses),
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      },
    });
  };
}

export class OAuth2MtlsClientCredentials {
  constructor({ config, http, material, clock = Date.now }) {
    Object.assign(this, { config, http, material, clock });
    this.cached = null;
  }

  async get({ signal } = {}) {
    const mtls = await this.material.snapshot({ signal });
    const now = this.clock();
    if (this.cached?.materialDigest === mtls.materialDigest
      && this.cached.expiresAt - this.config.refreshSkewSeconds * 1_000 > now) {
      return Object.freeze({ accessToken: this.cached.accessToken, mtls });
    }
    const secret = await this.material.secretProvider.get(this.config.clientSecretRef, { signal });
    assertRuntime(HEADER_VALUE.test(this.config.clientId) && HEADER_VALUE.test(secret),
      "DSAAS_CAAS_OAUTH_CREDENTIAL_INVALID", "OAuth2 client credential cannot be represented in an HTTP header");
    const basic = Buffer.from(`${this.config.clientId}:${secret}`, "utf8").toString("base64");
    const body = new URLSearchParams({ grant_type: "client_credentials" });
    if (this.config.scope) body.set("scope", this.config.scope);
    const response = await this.http.json(this.config.tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      retryUnsafe: true,
      signal,
      dispatcherContext: { mtls },
    });
    assertRuntime(response.status === 200 && response.value && typeof response.value === "object",
      "DSAAS_CAAS_OAUTH_TOKEN_REJECTED", "OAuth2 token endpoint rejected the client credential", { status: response.status });
    const { access_token: accessToken, expires_in: expiresIn, token_type: tokenType } = response.value;
    assertRuntime(tokenType?.toLowerCase() === "bearer" && typeof accessToken === "string" && accessToken.length <= 16_384 && HEADER_VALUE.test(accessToken),
      "DSAAS_CAAS_OAUTH_TOKEN_INVALID", "OAuth2 token response is invalid");
    assertRuntime(Number.isSafeInteger(expiresIn) && expiresIn >= 30 && expiresIn <= 86_400,
      "DSAAS_CAAS_OAUTH_TOKEN_INVALID", "OAuth2 token lifetime is outside the permitted range");
    this.cached = Object.freeze({ accessToken, expiresAt: now + expiresIn * 1_000, materialDigest: mtls.materialDigest });
    return Object.freeze({ accessToken, mtls });
  }

  revoke() {
    this.cached = null;
  }
}
