import { createHash } from "node:crypto";
import { authorizationHeaders } from "../bridge-runtime/telemetry.mjs";
import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { digest } from "../discovery/stable-json.mjs";
import { validateContract } from "./contracts.mjs";
import { identityFields, verifyAuthoritativeIdentity } from "./identity.mjs";

const REVOKE_KEY_DOMAIN = "molit.provider-transfer.revoke-idempotency-key";
const REVOKE_KEY_VERSION = 1;
const REVOKE_REQUEST_DOMAIN = "molit.provider-transfer.revoke-request";
const REVOKE_REQUEST_VERSION = 1;

export function operationKey(providerPid, operation) {
  return createHash("sha256").update(`molit-provider-transfer/1\0${providerPid}\0${operation}`).digest("hex");
}

function transferIdentity(event) {
  return Object.fromEntries(identityFields.map((field) => [field, event[field]]));
}

function revokeOperationKey(event, provisioningId, resourceRefDigest) {
  return digest({
    domain: REVOKE_KEY_DOMAIN,
    version: REVOKE_KEY_VERSION,
    transfer: transferIdentity(event),
    provisioningId,
    resourceRefDigest,
  });
}

function revokeRequestDigest(request) {
  return digest({
    domain: REVOKE_REQUEST_DOMAIN,
    version: REVOKE_REQUEST_VERSION,
    request,
  });
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
    headers: { ...headers, accept: "application/json", "content-type": "application/json", "idempotency-key": key },
    body: json(payload),
    retryUnsafe: true,
    signal,
  });
}

async function reconcileConnectorConflict(client, event, expectedState, code, signal) {
  const status = verifyAuthoritativeIdentity(event, await client.status(event.providerPid, { signal }));
  assertRuntime(
    status.state === expectedState,
    code,
    `connector acknowledgement conflict is not reconciled by authoritative ${expectedState} state`,
    { providerPid: event.providerPid, authoritativeState: status.state },
  );
  return status;
}

const inactiveRevokeStates = new Set(["REVOKED", "ABSENT", "INACTIVE"]);
const absentRevokeStates = new Set(["ABSENT"]);

function verifyInactiveRevokeReceipt(value, expected, { code, allowedStates }) {
  let receipt;
  try { receipt = validateContract("revokeResult", value); } catch (error) {
    if (error?.code !== "TRANSFER_CONTRACT_INVALID") throw error;
    throw new RuntimeError(code, "platform revoke response is not a canonical request-bound receipt");
  }
  for (const field of [...identityFields, "provisioningId", "provisioningKey", "resourceRefDigest", "requestDigest"]) {
    assertRuntime(
      receipt[field] === expected[field],
      code,
      `platform revoke receipt ${field} does not match the request`,
      { field },
    );
  }
  assertRuntime(
    allowedStates.has(receipt.state),
    code,
    "platform revoke receipt does not prove the required inactive state",
    { state: receipt.state },
  );
  return receipt;
}

function verifyProvisionReceipt(value, expected) {
  let receipt;
  try { receipt = validateContract("result", value); } catch (error) {
    if (error?.code !== "TRANSFER_CONTRACT_INVALID") throw error;
    throw new RuntimeError("PLATFORM_PROVISION_RECEIPT_INVALID", "platform provision response is not a canonical request-bound receipt");
  }
  for (const field of ["providerPid", "agreementId", "provisioningKey", "resourceRefDigest", "requestDigest"]) {
    assertRuntime(receipt[field] === expected[field], "PLATFORM_PROVISION_RECEIPT_INVALID", `platform provision receipt ${field} does not match the request`, { field });
  }
  return receipt;
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
    if (result.status === 409) {
      await reconcileConnectorConflict(this, event, "STARTED", "CONNECTOR_START_ACK_CONFLICT", signal);
    } else {
      assertRuntime([200, 204].includes(result.status), "CONNECTOR_START_ACK_FAILED", `connector start acknowledgement returned ${result.status}`);
    }
    return { idempotencyKey: key, reconciled: result.status === 409 };
  }

  async acknowledgeTermination(event, { signal } = {}) {
    const key = operationKey(event.providerPid, "connector-termination-ack");
    const result = await post(this.http, exactUrl(this.config.baseUrl, this.config.terminationAckPath, event.providerPid), {
      providerPid: event.providerPid,
      consumerPid: event.consumerPid,
    }, this.headers, key, signal);
    if (result.status === 409) {
      await reconcileConnectorConflict(this, event, "TERMINATED", "CONNECTOR_TERMINATION_ACK_CONFLICT", signal);
    } else {
      assertRuntime([200, 204].includes(result.status), "CONNECTOR_TERMINATION_ACK_FAILED", `connector termination acknowledgement returned ${result.status}`);
    }
    return { idempotencyKey: key, reconciled: result.status === 409 };
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
    const request = {
      provisioningKey: key,
      providerPid: event.providerPid,
      agreementId: event.agreementId,
      transfer: Object.fromEntries(["providerPid", "consumerPid", "agreementId", "datasetId", "format"].map((field) => [field, event[field]])),
      resourceRef: binding.resourceRef,
      resourceRefDigest: digest(binding.resourceRef),
    };
    const payload = { ...request, requestDigest: digest(request) };
    const result = await post(this.http, adapterUrl(this.config.baseUrl, this.config.provisionPath), payload, this.headers, key, signal);
    assertRuntime([200, 201, 409].includes(result.status), "PLATFORM_PROVISION_FAILED", `platform provisioner returned ${result.status}`);
    return { ...verifyProvisionReceipt(result.value, payload), idempotencyKey: key };
  }

  async revoke(event, binding, { signal, provisioningId = null } = {}) {
    assertRuntime(
      provisioningId === null || (typeof provisioningId === "string" && provisioningId.length > 0 && provisioningId.length <= 512),
      "PLATFORM_REVOKE_TARGET_INVALID",
      "platform revocation provisioningId must be a bounded string or null when no start receipt exists",
    );
    const provisionKey = operationKey(event.providerPid, "platform-provision");
    const resourceRefDigest = digest(binding.resourceRef);
    const request = {
      ...transferIdentity(event),
      provisioningId,
      provisioningKey: provisionKey,
      resourceRef: binding.resourceRef,
      resourceRefDigest,
    };
    const key = revokeOperationKey(event, provisioningId, resourceRefDigest);
    const payload = { ...request, requestDigest: revokeRequestDigest(request) };
    const result = await post(this.http, adapterUrl(this.config.baseUrl, this.config.revokePath), payload, this.headers, key, signal);
    assertRuntime([200, 204, 404, 409].includes(result.status), "PLATFORM_REVOKE_FAILED", `platform revocation returned ${result.status}`);
    let code = "PLATFORM_REVOKE_RECEIPT_INVALID";
    let allowedStates = inactiveRevokeStates;
    if (result.status === 404) {
      code = "PLATFORM_REVOKE_ABSENCE_UNVERIFIED";
      allowedStates = absentRevokeStates;
    } else if (result.status === 409) {
      code = "PLATFORM_REVOKE_CONFLICT_UNVERIFIED";
    }
    const receipt = verifyInactiveRevokeReceipt(result.value, {
      ...transferIdentity(event),
      provisioningId,
      provisioningKey: provisionKey,
      resourceRefDigest,
      requestDigest: payload.requestDigest,
    }, {
      code,
      allowedStates,
    });
    return { idempotencyKey: key, outcome: receipt.state, receiptDigest: digest(receipt) };
  }
}
