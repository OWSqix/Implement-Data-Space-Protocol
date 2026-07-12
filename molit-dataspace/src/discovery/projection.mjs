import { invariant, BridgeError } from "./errors.mjs";
import {
  encodeIdentifier,
  validateHttpsUrl,
  validateIdentifier,
} from "./validation.mjs";
import { isIP } from "node:net";
import {
  validateCandidateDocument,
  validateDiscoveryDocument,
  validateProjectionConfigDocument,
} from "./schema-validator.mjs";

const CONTEXT = Object.freeze({
  dcat: "http://www.w3.org/ns/dcat#",
  dct: "http://purl.org/dc/terms/",
});

function datasetId(config, record) {
  return `${config.identifierNamespace}:dataset:${encodeIdentifier(record.sourceSystemId)}:${encodeIdentifier(record.sourceRecordId)}`;
}

function distributionId(config, record, distribution) {
  return `${config.identifierNamespace}:distribution:${encodeIdentifier(record.sourceSystemId)}:${encodeIdentifier(record.sourceRecordId)}:${encodeIdentifier(distribution.id)}`;
}

function serviceId(config, record) {
  return `${config.identifierNamespace}:service:${encodeIdentifier(record.providerParticipantId)}:${encodeIdentifier(config.serviceId)}`;
}

function participantId(config, value) {
  return `${config.identifierNamespace}:participant:${encodeIdentifier(value)}`;
}

export function validateProjectionConfig(config) {
  validateProjectionConfigDocument(config);
  invariant(config && typeof config === "object", "INVALID_CONFIG", "config must be an object");
  const identifierNamespace = validateIdentifier(
    config.identifierNamespace,
    "identifierNamespace",
  );
  invariant(
    /^urn:[A-Za-z0-9][A-Za-z0-9._~-]*(?::[A-Za-z0-9][A-Za-z0-9._~-]*)+$/u
      .test(identifierNamespace),
    "INVALID_CONFIG",
    "identifierNamespace must be a canonical URN namespace",
    { field: "identifierNamespace" },
  );
  const service = validateIdentifier(config.serviceId, "serviceId");
  invariant(
    Array.isArray(config.allowedConnectorHosts)
      && config.allowedConnectorHosts.length > 0
      && config.allowedConnectorHosts.length <= 50,
    "INVALID_CONFIG",
    "allowedConnectorHosts must be a non-empty bounded array",
    { field: "allowedConnectorHosts" },
  );
  const allowedConnectorHosts = config.allowedConnectorHosts.map((value, index) => {
    const host = validateIdentifier(value, `allowedConnectorHosts[${index}]`).toLowerCase();
    invariant(
      isIP(host) === 0 && host.endsWith(".invalid"),
      "INVALID_CONFIG",
      "S1 connector host allowlist entries must use the reserved .invalid domain",
      { field: `allowedConnectorHosts[${index}]` },
    );
    return host;
  });
  invariant(
    config.dspVersion === "2025-1",
    "INVALID_CONFIG",
    "this implementation slice only accepts dspVersion 2025-1",
    { field: "dspVersion", value: config.dspVersion },
  );
  const providerConnectorEndpoint = validateHttpsUrl(
    config.providerConnectorEndpoint,
    "providerConnectorEndpoint",
  );
  const endpoint = new URL(providerConnectorEndpoint);
  invariant(
    allowedConnectorHosts.includes(endpoint.hostname.toLowerCase())
      && (!endpoint.port || endpoint.port === "443"),
    "CONNECTOR_ENDPOINT_NOT_ALLOWED",
    "providerConnectorEndpoint is outside the configured public host allowlist",
    { field: "providerConnectorEndpoint" },
  );
  return {
    allowedConnectorHosts,
    dspVersion: config.dspVersion,
    identifierNamespace,
    providerConnectorEndpoint,
    serviceId: service,
  };
}

export function toDiscoveryProjection(record, decision) {
  const projection = {
    automaticDispatchAllowed: false,
    schemaVersion: "molit.discovery-record/1",
    syntheticOnly: true,
    id: `urn:kr:molit-dataspace:discovery:${encodeIdentifier(record.sourceSystemId)}:${encodeIdentifier(record.sourceRecordId)}`,
    source: {
      systemId: record.sourceSystemId,
      recordId: record.sourceRecordId,
    },
    recordType: record.recordType,
    title: record.title,
    description: record.description,
    publisher: record.publisher,
    landingPage: record.landingPage,
    issuedAt: record.issuedAt,
    modifiedAt: record.modifiedAt,
    keywords: record.keywords,
    themes: record.themes,
    catalogVisibility: record.catalogVisibility,
    accessRights: record.accessRights,
    platformRecordRole: record.platformRecordRole?.value,
    offeringState: decision.state,
    decisionReasons: decision.reasons,
    evidenceIds: [...new Set([
      ...record.evidenceIds,
      ...(record.platformRecordRole?.evidenceIds ?? []),
    ])],
  };
  validateDiscoveryDocument(projection);
  return projection;
}

export function toOfferingCandidate(record, decision, config) {
  invariant(
    decision.state === "APPROVED",
    "OFFERING_NOT_APPROVED",
    "only an APPROVED record can be projected as an Offering candidate",
  );
  const normalizedConfig = validateProjectionConfig(config);

  const dataset = datasetId(normalizedConfig, record);
  const service = serviceId(normalizedConfig, record);
  const provider = participantId(normalizedConfig, record.providerParticipantId);
  const distributions = record.distributions.map((item) => ({
    "@id": distributionId(normalizedConfig, record, item),
    "@type": "dcat:Distribution",
    "dct:format": item.format,
    "dcat:mediaType": { "@id": item.mediaType },
    "dcat:accessService": { "@id": service },
  }));

  const datasetNode = {
    "@id": dataset,
    "@type": "dcat:Dataset",
    "dct:identifier": record.sourceRecordId,
    "dct:title": record.title,
    "dct:description": record.description,
    "dct:publisher": { "@id": record.publisher.id },
    "dct:issued": record.issuedAt,
    "dct:modified": record.modifiedAt,
    "dct:accessRights": record.accessRights,
    ...(record.license ? { "dct:license": { "@id": record.license } } : {}),
    ...(record.rights ? { "dct:rights": record.rights } : {}),
    "dcat:keyword": record.keywords,
    "dcat:theme": record.themes.map((theme) => ({ "@id": theme })),
    "dcat:landingPage": { "@id": record.landingPage },
    "dcat:distribution": distributions.map((item) => ({ "@id": item["@id"] })),
  };

  const catalogProjection = {
    profileStatus: "project-draft-not-dsp-wire-message",
    dspVersion: normalizedConfig.dspVersion,
    "@context": CONTEXT,
    "@graph": [
      datasetNode,
      ...distributions,
      {
      "@id": service,
      "@type": "dcat:DataService",
      "dcat:endpointURL": { "@id": normalizedConfig.providerConnectorEndpoint },
      },
    ],
  };

  const publicStrings = stringLeaves(catalogProjection);
  for (const item of record.distributions) {
    invariant(
      !publicStrings.some((value) => value.includes(item.sourceBindingRef)),
      "PRIVATE_BINDING_LEAK",
      "private source binding leaked into Catalog projection",
      { distributionId: item.id },
    );
  }

  const candidate = {
    schemaVersion: "molit.connector-registration-candidate/1",
    automaticDispatchAllowed: false,
    routing: "internal-review-only",
    source: {
      systemId: record.sourceSystemId,
      recordId: record.sourceRecordId,
    },
    catalogProjection,
    registration: {
      datasetId: dataset,
      providerParticipantId: record.providerParticipantId,
      providerParticipantUrn: provider,
      connectorOperatorId: record.connectorOperatorId,
      deliveryOperatorId: record.deliveryOperatorId,
      contractingPartyId: record.contractingPartyId,
      originDataHolderId: record.originDataHolderId,
      providerAuthority: record.providerAuthority,
      governanceApproval: record.governanceApproval,
      policyRef: record.policyRef,
      bindings: record.distributions.map((item) => ({
        distributionId: distributionId(normalizedConfig, record, item),
        format: item.format,
        transferFormat: item.transferFormat,
        accessProfile: item.accessProfile,
        sourceBindingRef: item.sourceBindingRef,
        lifecycleMode: item.lifecycleMode,
        revocationMode: item.revocationMode,
        evidenceIds: item.evidenceIds,
      })),
    },
  };
  validateCandidateDocument(candidate);
  return candidate;
}

function stringLeaves(value, result = []) {
  if (typeof value === "string") {
    result.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => stringLeaves(item, result));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => stringLeaves(item, result));
  }
  return result;
}

export function publicCatalogContainsPrivateReference(candidate) {
  if (!candidate?.catalogProjection) {
    throw new BridgeError("INVALID_CANDIDATE", "candidate has no catalogProjection");
  }
  const publicValues = stringLeaves(candidate.catalogProjection);
  return candidate.registration.bindings.some((binding) => (
    publicValues.some((value) => value.includes(binding.sourceBindingRef))
  ));
}
