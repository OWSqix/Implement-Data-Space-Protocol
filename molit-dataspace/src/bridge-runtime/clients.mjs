import { createHash } from "node:crypto";
import { authorizationHeaders } from "./telemetry.mjs";
import { RuntimeError, assertRuntime } from "./errors.mjs";
import { digest } from "../discovery/stable-json.mjs";

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value));
}

function boundedObject(value, label) {
  assertRuntime(value && typeof value === "object" && !Array.isArray(value), "ADAPTER_CONTRACT_VIOLATION", `${label} must be an object`);
  return value;
}

function responseId(value, field, label) {
  const id = boundedObject(value, label)[field];
  assertRuntime(typeof id === "string" && id.length > 0 && id.length <= 512, "ADAPTER_CONTRACT_VIOLATION", `${label}.${field} is invalid`);
  return id;
}

function idempotencyKey(root, operation) {
  return createHash("sha256").update(`${root}\0${operation}`).digest("hex");
}

async function postJson(http, url, value, headers, key, signal, { connectorIdempotency = false } = {}) {
  return http.json(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", accept: "application/json", ...(connectorIdempotency ? { "idempotency-key": key } : {}) },
    body: jsonBody(value),
    signal,
    retryUnsafe: connectorIdempotency,
  });
}

/** Connector-specific control plane. This is not a DSP protocol endpoint. */
export class ConnectorManagementClient {
  constructor({ config, http, env = process.env }) {
    assertRuntime(config.supportsIdempotencyKey === true, "MANAGEMENT_IDEMPOTENCY_REQUIRED", "management adapter must contractually support Idempotency-Key");
    this.config = config;
    this.http = http;
    this.headers = authorizationHeaders(config.auth, env);
  }

  async publishOffering(offering, rootKey, { signal } = {}) {
    boundedObject(offering, "offering");
    const result = await postJson(
      this.http,
      new URL(this.config.publicationPath, this.config.baseUrl),
      offering,
      this.headers,
      idempotencyKey(rootKey, "management-publication"),
      signal,
      { connectorIdempotency: true },
    );
    assertRuntime([200, 201, 409].includes(result.status), "MANAGEMENT_PUBLICATION_FAILED", `management API returned ${result.status}`);
    return { assetId: responseId(result.value, "assetId", "management publication response") };
  }
}

/**
 * DSP wire adapter with explicit transition checks. Message fields are a bounded
 * connector adapter contract; this module does not claim full DSP schema validation.
 */
export class ExperimentalDspPollingClient {
  constructor({ config, http, schemas, env = process.env, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    this.config = config;
    this.http = http;
    this.headers = authorizationHeaders(config.auth, env);
    this.schemas = schemas;
    this.sleep = sleep;
  }

  async execute({ datasetId, approvedOfferId, approvedOfferDigest, consumerPid, callbackAddress, format, dataAddress }, rootKey, { signal } = {}) {
    for (const [field, value] of Object.entries({ datasetId, approvedOfferId, approvedOfferDigest, consumerPid, callbackAddress, format })) {
      assertRuntime(typeof value === "string" && value.length > 0 && value.length <= 512, "INVALID_DSP_INPUT", `${field} is invalid`);
    }
    const catalogRequest = this.schemas.validate("catalogRequest", {
      "@context": ["https://w3id.org/dspace/2025/1/context.jsonld"],
      "@type": "CatalogRequestMessage",
      filter: [],
    });
    const catalog = await postJson(this.http, new URL(this.config.catalogPath, this.config.baseUrl), catalogRequest, this.headers, idempotencyKey(rootKey, "catalog-request"), signal);
    assertRuntime(catalog.status === 200, "DSP_CATALOG_FAILED", `catalog endpoint returned ${catalog.status}`);
    this.schemas.validate("catalog", catalog.value);
    const dataset = catalog.value.dataset?.find((candidate) => candidate["@id"] === datasetId);
    assertRuntime(dataset, "DSP_DATASET_NOT_FOUND", "catalog does not contain the requested Dataset");
    const offer = dataset.hasPolicy?.find((candidate) => candidate["@id"] === approvedOfferId);
    assertRuntime(offer && typeof offer === "object", "DSP_OFFER_NOT_FOUND", "Dataset does not contain the approved Offer");
    assertRuntime(digest(offer) === approvedOfferDigest, "DSP_OFFER_DIGEST_MISMATCH", "catalog Offer differs from the approved policy digest");
    const contractOffer = { ...offer, target: datasetId };

    const contractRequest = this.schemas.validate("contractRequest", {
      "@context": ["https://w3id.org/dspace/2025/1/context.jsonld"],
      "@type": "ContractRequestMessage",
      consumerPid,
      offer: contractOffer,
      callbackAddress,
    });
    const negotiation = await postJson(this.http, new URL(this.config.contractPath, this.config.baseUrl), contractRequest, this.headers, idempotencyKey(rootKey, "contract-request"), signal);
    assertRuntime(negotiation.status === 201, "DSP_CONTRACT_FAILED", `contract endpoint returned ${negotiation.status}`);
    this.schemas.validate("negotiation", negotiation.value);
    const negotiationId = responseId(negotiation.value, "providerPid", "contract response");
    assertRuntime(negotiation.value.consumerPid === consumerPid, "DSP_CORRELATION_MISMATCH", "contract response consumerPid does not match the request");
    const contract = await this.#pollState({
      path: `${this.config.contractStatusPath}/${encodeURIComponent(negotiationId)}`,
      allowed: new Set(["REQUESTED", "OFFERED", "ACCEPTED", "AGREED", "VERIFIED", "FINALIZED", "TERMINATED"]),
      terminal: new Set(["FINALIZED", "TERMINATED"]),
      success: "FINALIZED",
      label: "contract",
      providerPid: negotiationId,
      consumerPid,
      signal,
    });
    assertRuntime(this.config.pollingAgreementIdExtension === true, "DSP_CALLBACK_INBOX_REQUIRED", "standard DSP negotiation requires a ContractAgreementMessage callback; enable only a documented connector agreementId extension");
    const agreementId = responseId(contract, "agreementId", "contract status response (non-standard connector agreementId extension)");

    const transferRequest = this.schemas.validate("transferRequest", {
      "@context": ["https://w3id.org/dspace/2025/1/context.jsonld"],
      "@type": "TransferRequestMessage",
      consumerPid,
      agreementId,
      format,
      ...(dataAddress ? { dataAddress } : {}),
      callbackAddress,
    });
    const transfer = await postJson(this.http, new URL(this.config.transferPath, this.config.baseUrl), transferRequest, this.headers, idempotencyKey(rootKey, "transfer-request"), signal);
    assertRuntime(transfer.status === 201, "DSP_TRANSFER_FAILED", `transfer endpoint returned ${transfer.status}`);
    this.schemas.validate("transferProcess", transfer.value);
    const transferId = responseId(transfer.value, "providerPid", "transfer response");
    assertRuntime(transfer.value.consumerPid === consumerPid, "DSP_CORRELATION_MISMATCH", "transfer response consumerPid does not match the request");
    await this.#pollState({
      path: `${this.config.transferStatusPath}/${encodeURIComponent(transferId)}`,
      allowed: new Set(["REQUESTED", "STARTED", "SUSPENDED", "COMPLETED", "TERMINATED"]),
      terminal: new Set(["STARTED", "COMPLETED", "TERMINATED"]),
      success: new Set(["STARTED", "COMPLETED"]),
      label: "transfer",
      providerPid: transferId,
      consumerPid,
      signal,
    });
    return { offerId: contractOffer["@id"], negotiationId, agreementId, transferId };
  }

  async #pollState({ path, allowed, terminal, success, label, providerPid, consumerPid, signal }) {
    const limit = this.config.statusPollLimit ?? 20;
    for (let attempt = 0; attempt < limit; attempt += 1) {
      const result = await this.http.json(new URL(path, this.config.baseUrl), { headers: { accept: "application/json", ...this.headers }, signal });
      assertRuntime(result.status === 200, `DSP_${label.toUpperCase()}_STATUS_FAILED`, `${label} status endpoint returned ${result.status}`);
      const value = boundedObject(result.value, `${label} status response`);
      this.schemas.validate(label === "contract" ? "negotiation" : "transferProcess", value);
      assertRuntime(value.providerPid === providerPid && value.consumerPid === consumerPid, "DSP_CORRELATION_MISMATCH", `${label} status identifiers do not match the request`);
      assertRuntime(allowed.has(value.state), "DSP_STATE_VIOLATION", `unexpected ${label} state: ${value.state}`);
      if (terminal.has(value.state)) {
        const accepted = success instanceof Set ? success.has(value.state) : value.state === success;
        if (!accepted) throw new RuntimeError(`DSP_${label.toUpperCase()}_TERMINATED`, `${label} terminated without success`);
        return value;
      }
      await this.sleep(this.config.statusPollIntervalMs ?? 1_000);
    }
    throw new RuntimeError(`DSP_${label.toUpperCase()}_POLL_LIMIT`, `${label} did not reach a terminal state`);
  }
}

export function operationalEnvelope(record, approvalRegistry, source = {}) {
  const envelope = record.dispatchEnvelope;
  assertRuntime(envelope?.schemaVersion === "molit.operational-dispatch/1", "DISPATCH_APPROVAL_REQUIRED", "record lacks an operational dispatch envelope");
  assertRuntime(envelope.automaticDispatchAllowed === true && envelope.routing === "production-connector", "DISPATCH_APPROVAL_REQUIRED", "internal review commands cannot enter the production queue");
  assertRuntime(typeof envelope.approvalId === "string" && envelope.approvalId.length > 0, "DISPATCH_APPROVAL_REQUIRED", "dispatch approval ID is required");
  boundedObject(envelope.offering, "dispatch offering");
  const approval = approvalRegistry?.entries?.find((entry) => entry.approvalId === envelope.approvalId);
  assertRuntime(approval?.status === "approved", "DISPATCH_APPROVAL_REQUIRED", "approval is absent from the detached operator registry");
  assertRuntime(approval.sourceSystemId === source.sourceSystemId && approval.sourceRecordId === source.sourceRecordId && String(approval.resourceVersion) === String(source.resourceVersion), "DISPATCH_APPROVAL_SOURCE_MISMATCH", "approval is not bound to this source record version");
  assertRuntime(typeof approval.approvedBy === "string" && approval.approvedBy.length > 0, "DISPATCH_APPROVAL_REQUIRED", "approval authority is missing");
  const now = Date.now();
  assertRuntime(Date.parse(approval.validFrom) <= now && Date.parse(approval.validUntil) > now, "DISPATCH_APPROVAL_EXPIRED", "detached dispatch approval is outside its validity window");
  assertRuntime(approval.payloadDigest === digest({ metadata: envelope.metadata, offering: envelope.offering }), "DISPATCH_APPROVAL_DIGEST_MISMATCH", "metadata validation decision or publication payload differs from the approved payload");
  return envelope;
}
