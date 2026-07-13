import { createHash } from "node:crypto";
import { authorizationHeaders } from "../bridge-runtime/telemetry.mjs";
import { assertRuntime } from "../bridge-runtime/errors.mjs";
import { validateContract } from "./contracts.mjs";

export function operationKey(providerPid, operation) {
  return createHash("sha256").update(`molit-provider-transfer/1\0${providerPid}\0${operation}`).digest("hex");
}

function json(value) { return Buffer.from(JSON.stringify(value)); }

function exactUrl(baseUrl, path, providerPid) {
  assertRuntime(path.split("{providerPid}").length === 2, "ADAPTER_PATH_INVALID", "connector management path must contain exactly one {providerPid}");
  const suffix = path.replace("{providerPid}", encodeURIComponent(providerPid));
  const url = new URL(suffix, baseUrl);
  assertRuntime(url.origin === new URL(baseUrl).origin, "ADAPTER_ORIGIN_ESCAPE", "connector management path escapes its configured origin");
  return url;
}

function adapterUrl(baseUrl, path) {
  const url = new URL(path, baseUrl);
  assertRuntime(url.origin === new URL(baseUrl).origin, "ADAPTER_ORIGIN_ESCAPE", "platform adapter path escapes its configured origin");
  return url;
}

async function post(http, url, payload, headers, key, signal) {
  return http.json(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "idempotency-key": key, ...headers },
    body: json(payload),
    retryUnsafe: true,
    signal,
  });
}

/** Connector-specific management control plane. None of these routes is a DSP endpoint. */
export class TransferConnectorManagementClient {
  constructor({ config, http, env = process.env }) {
    assertRuntime(config.supportsIdempotencyKey === true, "CONNECTOR_IDEMPOTENCY_REQUIRED", "connector management adapter must guarantee Idempotency-Key semantics");
    this.config = config;
    this.http = http;
    this.headers = authorizationHeaders(config.auth, env);
  }

  async status(providerPid, { signal } = {}) {
    const result = await this.http.json(exactUrl(this.config.baseUrl, this.config.statusPath, providerPid), { headers: { accept: "application/json", ...this.headers }, signal });
    assertRuntime(result.status === 200, "CONNECTOR_STATUS_FAILED", `connector status returned ${result.status}`);
    return result.value;
  }

  async acknowledgeStart(event, dataAddress, { signal } = {}) {
    const key = operationKey(event.providerPid, "connector-start-ack");
    const result = await post(this.http, exactUrl(this.config.baseUrl, this.config.startAckPath, event.providerPid), {
      providerPid: event.providerPid,
      consumerPid: event.consumerPid,
      dataAddress,
    }, this.headers, key, signal);
    assertRuntime([200, 204, 409].includes(result.status), "CONNECTOR_START_ACK_FAILED", `connector start acknowledgement returned ${result.status}`);
    return { idempotencyKey: key };
  }

  async acknowledgeTermination(event, { signal } = {}) {
    const key = operationKey(event.providerPid, "connector-termination-ack");
    const result = await post(this.http, exactUrl(this.config.baseUrl, this.config.terminationAckPath, event.providerPid), {
      providerPid: event.providerPid,
      consumerPid: event.consumerPid,
    }, this.headers, key, signal);
    assertRuntime([200, 204, 409].includes(result.status), "CONNECTOR_TERMINATION_ACK_FAILED", `connector termination acknowledgement returned ${result.status}`);
    return { idempotencyKey: key };
  }
}

/** Private platform adapter. The event can never select an endpoint or source resource. */
export class PlatformProvisionerClient {
  constructor({ config, http, env = process.env }) {
    assertRuntime(config.supportsIdempotencyKey === true && config.idempotentRevoke === true, "PROVISIONER_IDEMPOTENCY_REQUIRED", "provision and revoke adapters must guarantee Idempotency-Key semantics");
    this.config = config;
    this.http = http;
    this.headers = authorizationHeaders(config.auth, env);
  }

  async provision(event, binding, { signal } = {}) {
    const key = operationKey(event.providerPid, "platform-provision");
    const result = await post(this.http, adapterUrl(this.config.baseUrl, this.config.provisionPath), {
      provisioningKey: key,
      transfer: Object.fromEntries(["providerPid", "consumerPid", "agreementId", "datasetId", "format"].map((field) => [field, event[field]])),
      resourceRef: binding.resourceRef,
    }, this.headers, key, signal);
    assertRuntime([200, 201, 409].includes(result.status), "PLATFORM_PROVISION_FAILED", `platform provisioner returned ${result.status}`);
    return { ...validateContract("result", result.value), idempotencyKey: key };
  }

  async revoke(event, binding, { signal } = {}) {
    const provisionKey = operationKey(event.providerPid, "platform-provision");
    const key = operationKey(event.providerPid, "platform-revoke");
    const result = await post(this.http, adapterUrl(this.config.baseUrl, this.config.revokePath), {
      provisioningKey: provisionKey,
      providerPid: event.providerPid,
      resourceRef: binding.resourceRef,
    }, this.headers, key, signal);
    assertRuntime([200, 204, 404, 409].includes(result.status), "PLATFORM_REVOKE_FAILED", `platform revocation returned ${result.status}`);
    return { idempotencyKey: key };
  }
}
