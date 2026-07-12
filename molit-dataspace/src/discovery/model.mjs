import { BridgeError, invariant } from "./errors.mjs";
import {
  PLATFORM_ROLES,
  RECORD_TYPES,
  isPlainObject,
  optionalString,
  requiredString,
  validateIdentifier,
  validateEvidenceIds,
  validateHttpsUrl,
  validateTimestamp,
} from "./validation.mjs";

const ACCESS_RIGHTS = new Set(["open", "registered", "restricted", "secure", "excluded"]);
const TRANSFER_DECISIONS = new Set(["approved", "conditional", "pending", "denied"]);
const AUTHORITY_KINDS = new Set(["owner", "delegate", "agent"]);
const LIFECYCLE_MODES = new Set([
  "none",
  "manual",
  "token",
  "entitlement",
  "subscription",
  "job",
]);

function stringArray(value, field) {
  if (value === undefined) {
    return [];
  }
  invariant(Array.isArray(value), "INVALID_FIELD", `${field} must be an array`, { field });
  return [...new Set(value.map((item, index) => requiredString(item, `${field}[${index}]`)))];
}

function opaqueReference(value, field, allowedPrefixes) {
  const reference = requiredString(value, field);
  const validGrammar = (
    /^binding:\/\/[A-Za-z0-9][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._~-]*)+$/u.test(reference)
    || /^(?:policy|transfer):[A-Za-z0-9][A-Za-z0-9._~-]*(?::[A-Za-z0-9][A-Za-z0-9._~-]*)*$/u.test(reference)
    || /^urn:[A-Za-z0-9][A-Za-z0-9._~-]*(?::[A-Za-z0-9][A-Za-z0-9._~-]*)+$/u.test(reference)
  );
  invariant(
    reference.length <= 512
      && !/[\s?#@]/u.test(reference)
      && validGrammar
      && allowedPrefixes.some((prefix) => reference.startsWith(prefix)),
    "INVALID_REFERENCE",
    `${field} must be an opaque registry reference`,
    { field },
  );
  return reference;
}

function resourceIri(value, field) {
  const iri = requiredString(value, field);
  if (iri.startsWith("urn:")) {
    return opaqueReference(iri, field, ["urn:"]);
  }
  return validateSyntheticPublicUrl(iri, field);
}

function validateSyntheticPublicUrl(value, field) {
  const url = validateHttpsUrl(value, field);
  invariant(
    new URL(url).hostname.toLowerCase().endsWith(".invalid"),
    "NON_SYNTHETIC_PUBLIC_URL",
    `${field} must use a reserved .invalid host in S1`,
    { field },
  );
  return url;
}

function validateMediaTypeIri(value, field) {
  const url = validateHttpsUrl(value, field);
  const parsed = new URL(url);
  invariant(
    parsed.hostname.toLowerCase() === "www.iana.org"
      && parsed.pathname.startsWith("/assignments/media-types/"),
    "INVALID_MEDIA_TYPE_IRI",
    `${field} must be an IANA media type IRI`,
    { field },
  );
  return url;
}

function organization(value, field) {
  invariant(isPlainObject(value), "INVALID_FIELD", `${field} must be an object`, { field });
  return {
    id: resourceIri(value.id, `${field}.id`),
    name: requiredString(value.name, `${field}.name`),
  };
}

function platformRole(value) {
  invariant(isPlainObject(value), "INVALID_FIELD", "platformRecordRole must be an object");
  invariant(
    PLATFORM_ROLES.has(value.value),
    "INVALID_PLATFORM_ROLE",
    "platformRecordRole.value is not supported",
    { value: value.value },
  );
  return {
    value: value.value,
    evidenceIds: validateEvidenceIds(value.evidenceIds ?? [], "platformRecordRole.evidenceIds"),
  };
}

function authority(value) {
  if (value === undefined) {
    return undefined;
  }
  invariant(isPlainObject(value), "INVALID_FIELD", "providerAuthority must be an object");
  invariant(
    AUTHORITY_KINDS.has(value.kind),
    "INVALID_AUTHORITY",
    "providerAuthority.kind is not supported",
    { kind: value.kind },
  );
  return {
    kind: value.kind,
    evidenceIds: validateEvidenceIds(value.evidenceIds ?? [], "providerAuthority.evidenceIds"),
  };
}

function distribution(value, index) {
  const field = `distributions[${index}]`;
  invariant(isPlainObject(value), "INVALID_FIELD", `${field} must be an object`, { field });
  if (value.lifecycleMode !== undefined) {
    invariant(
      LIFECYCLE_MODES.has(value.lifecycleMode),
      "INVALID_LIFECYCLE_MODE",
      `${field}.lifecycleMode is not supported`,
      { field: `${field}.lifecycleMode` },
    );
  }

  return {
    id: validateIdentifier(value.id, `${field}.id`),
    accessProfile: requiredString(value.accessProfile, `${field}.accessProfile`),
    format: requiredString(value.format, `${field}.format`),
    transferFormat: value.transferFormat === undefined
      ? undefined
      : opaqueReference(
        value.transferFormat,
        `${field}.transferFormat`,
        ["transfer:", "urn:"],
      ),
    mediaType: validateMediaTypeIri(value.mediaType, `${field}.mediaType`),
    sourceBindingRef: value.sourceBindingRef === undefined
      ? undefined
      : opaqueReference(
        value.sourceBindingRef,
        `${field}.sourceBindingRef`,
        ["binding://", "urn:"],
      ),
    lifecycleMode: value.lifecycleMode,
    revocationMode: optionalString(value.revocationMode, `${field}.revocationMode`),
    evidenceIds: validateEvidenceIds(value.evidenceIds ?? [], `${field}.evidenceIds`),
  };
}

export function normalizeRecord({ governanceApproval, sourceSystemId, recordId, record }) {
  invariant(
    RECORD_TYPES.has(record.recordType),
    "INVALID_RECORD_TYPE",
    "recordType is not supported",
    { recordType: record.recordType },
  );

  const normalized = {
    sourceSystemId,
    sourceRecordId: recordId,
    recordType: record.recordType,
    title: requiredString(record.title, "record.title"),
    description: requiredString(record.description, "record.description"),
    publisher: organization(record.publisher, "record.publisher"),
    landingPage: validateSyntheticPublicUrl(record.landingPage, "record.landingPage"),
    issuedAt: validateTimestamp(record.issuedAt, "record.issuedAt"),
    modifiedAt: validateTimestamp(record.modifiedAt, "record.modifiedAt"),
    keywords: stringArray(record.keywords, "record.keywords"),
    themes: [...new Set(stringArray(record.themes, "record.themes").map((item, index) => (
      resourceIri(item, `record.themes[${index}]`)
    )))],
    evidenceIds: validateEvidenceIds(record.evidenceIds ?? [], "record.evidenceIds"),
    governanceApproval,
    catalogVisibility: governanceApproval?.catalogVisibility ?? "internal",
  };

  if (record.recordType !== "dataset") {
    return normalized;
  }

  const accessRights = record.accessRights ?? "unknown";
  const transferDecision = record.transferDecision ?? "pending";
  invariant(
    ACCESS_RIGHTS.has(accessRights) || accessRights === "unknown",
    "INVALID_ACCESS_RIGHTS",
    "record.accessRights is not supported",
    { accessRights: record.accessRights },
  );
  invariant(
    TRANSFER_DECISIONS.has(transferDecision),
    "INVALID_TRANSFER_DECISION",
    "record.transferDecision is not supported",
    { field: "record.transferDecision" },
  );
  invariant(
    record.distributions === undefined || Array.isArray(record.distributions),
    "INVALID_FIELD",
    "record.distributions must be an array",
  );

  const distributions = (record.distributions ?? []).map(distribution);
  const distributionIds = new Set();
  for (const item of distributions) {
    invariant(
      !distributionIds.has(item.id),
      "DUPLICATE_DISTRIBUTION",
      "distribution IDs must be unique within a record",
      { distributionId: item.id },
    );
    distributionIds.add(item.id);
  }

  return {
    ...normalized,
    originDataHolderId: record.originDataHolderId === undefined
      ? undefined
      : validateIdentifier(record.originDataHolderId, "record.originDataHolderId"),
    platformRecordRole: record.platformRecordRole === undefined
      ? { value: "unknown", evidenceIds: [] }
      : platformRole(record.platformRecordRole),
    accessRights,
    license: record.license === undefined
      ? undefined
      : validateSyntheticPublicUrl(record.license, "record.license"),
    rights: optionalString(record.rights, "record.rights"),
    providerParticipantId: record.providerParticipantId === undefined ? undefined : validateIdentifier(
      record.providerParticipantId,
      "record.providerParticipantId",
    ),
    connectorOperatorId: record.connectorOperatorId === undefined
      ? undefined
      : validateIdentifier(record.connectorOperatorId, "record.connectorOperatorId"),
    deliveryOperatorId: record.deliveryOperatorId === undefined
      ? undefined
      : validateIdentifier(record.deliveryOperatorId, "record.deliveryOperatorId"),
    contractingPartyId: record.contractingPartyId === undefined
      ? undefined
      : validateIdentifier(record.contractingPartyId, "record.contractingPartyId"),
    providerAuthority: authority(record.providerAuthority),
    transferDecision,
    policyRef: record.policyRef === undefined
      ? undefined
      : opaqueReference(record.policyRef, "record.policyRef", ["policy:", "urn:"]),
    distributions,
  };
}

function reason(code, field, message) {
  return { code, field, message };
}

export function decideOffering(record) {
  if (record.recordType !== "dataset") {
    return {
      state: "CATALOG_ONLY",
      reasons: [reason("NOT_DATASET", "recordType", "record is not a Dataset")],
    };
  }

  const role = record.platformRecordRole.value;
  if (record.accessRights === "excluded") {
    return {
      state: "QUARANTINED",
      reasons: [reason(
        "ACCESS_EXCLUDED",
        "accessRights",
        "excluded Dataset must remain in the internal inventory",
      )],
    };
  }
  if (role === "index-only") {
    return {
      state: "CATALOG_ONLY",
      reasons: [reason(
        "INDEX_ONLY",
        "platformRecordRole",
        "platform only indexes the delivery path",
      )],
    };
  }

  const reasons = [];
  if (record.governanceApproval?.status !== "verified-synthetic") {
    reasons.push(reason(
      "GOVERNANCE_APPROVAL_MISSING",
      "governanceApproval",
      record.governanceApproval?.reason
        ?? "record digest is not approved by the synthetic governance registry",
    ));
  } else if (record.governanceApproval.offeringDecision !== "approved") {
    reasons.push(reason(
      "GOVERNANCE_OFFERING_NOT_APPROVED",
      "governanceApproval.offeringDecision",
      "synthetic governance decision is pending or denied",
    ));
  }
  if (record.catalogVisibility !== "public") {
    reasons.push(reason(
      "CATALOG_NOT_PUBLIC",
      "catalogVisibility",
      "S1 Offering candidates require public catalog visibility",
    ));
  }
  if (record.accessRights === "unknown") {
    reasons.push(reason(
      "ACCESS_RIGHTS_UNKNOWN",
      "accessRights",
      "access rights must be verified before Offering review",
    ));
  }
  if (["registered", "restricted", "secure"].includes(record.accessRights)) {
    reasons.push(reason(
      "ACCESS_PROFILE_UNIMPLEMENTED",
      "accessRights",
      "S1 only approves open Dataset access profiles",
    ));
  }
  if (role === "unknown") {
    reasons.push(reason("ROLE_UNKNOWN", "platformRecordRole", "platform delivery role is unverified"));
  }
  if (["hosted", "brokered"].includes(role) && record.platformRecordRole.evidenceIds.length === 0) {
    reasons.push(reason(
      "MISSING_ROLE_EVIDENCE",
      "platformRecordRole.evidenceIds",
      "hosted or brokered role requires evidence",
    ));
  }
  if (!record.originDataHolderId) {
    reasons.push(reason("MISSING_DATA_HOLDER", "originDataHolderId", "origin data holder is required"));
  }
  if (!record.providerParticipantId) {
    reasons.push(reason(
      "MISSING_PROVIDER_PARTICIPANT",
      "providerParticipantId",
      "Offering Provider Participant is required",
    ));
  }
  if (!record.connectorOperatorId || !record.deliveryOperatorId || !record.contractingPartyId) {
    reasons.push(reason(
      "MISSING_OPERATING_ROLE",
      "connectorOperatorId|deliveryOperatorId|contractingPartyId",
      "Connector, delivery and contracting roles are required",
    ));
  }
  if (!record.providerAuthority || record.providerAuthority.evidenceIds.length === 0) {
    reasons.push(reason(
      "MISSING_PROVIDER_AUTHORITY",
      "providerAuthority",
      "provider authority evidence is required",
    ));
  }
  if (!record.license && !record.rights) {
    reasons.push(reason(
      "MISSING_RIGHTS",
      "license|rights",
      "license or rights statement is required",
    ));
  }
  if (!record.policyRef) {
    reasons.push(reason("MISSING_POLICY", "policyRef", "approved policy reference is required"));
  }
  if (record.transferDecision !== "approved") {
    reasons.push(reason(
      "TRANSFER_NOT_APPROVED",
      "transferDecision",
      "S1 requires an approved transfer decision",
    ));
  }
  if (record.distributions.length === 0) {
    reasons.push(reason(
      "MISSING_DISTRIBUTION",
      "distributions",
      "at least one Distribution is required",
    ));
  }

  const transferFormats = new Set();

  for (const item of record.distributions) {
    if (!item.transferFormat) {
      reasons.push(reason(
        "MISSING_TRANSFER_FORMAT",
        `distributions.${item.id}.transferFormat`,
        "transfer format selector is required",
      ));
    }
    if (transferFormats.has(item.transferFormat)) {
      reasons.push(reason(
        "AMBIGUOUS_TRANSFER_FORMAT",
        `distributions.${item.id}.transferFormat`,
        "each Dataset transfer format must resolve to one source binding",
      ));
    }
    if (item.transferFormat) {
      transferFormats.add(item.transferFormat);
    }
    if (!item.sourceBindingRef) {
      reasons.push(reason(
        "MISSING_SOURCE_BINDING",
        `distributions.${item.id}.sourceBindingRef`,
        "private source binding reference is required",
      ));
    }
    if (item.evidenceIds.length === 0) {
      reasons.push(reason(
        "MISSING_DISTRIBUTION_EVIDENCE",
        `distributions.${item.id}.evidenceIds`,
        "Distribution evidence is required",
      ));
    }
    if (!item.lifecycleMode) {
      reasons.push(reason(
        "MISSING_LIFECYCLE_MODE",
        `distributions.${item.id}.lifecycleMode`,
        "platform lifecycle mode is required",
      ));
    } else if (item.lifecycleMode !== "none" && !item.revocationMode) {
      reasons.push(reason(
        "MISSING_REVOCATION",
        `distributions.${item.id}.revocationMode`,
        "revocation method is required for managed lifecycle resources",
      ));
    }
  }

  if (reasons.length > 0) {
    return { state: "PENDING_EVIDENCE", reasons };
  }

  return { state: "APPROVED", reasons: [] };
}

export function decideDiscoveryVisibility(record, offeringDecision) {
  if (offeringDecision.state === "QUARANTINED") {
    return { publish: false, reason: "RECORD_QUARANTINED", visibility: "internal" };
  }
  if (record.governanceApproval?.status !== "verified-synthetic") {
    return { publish: false, reason: "DISCOVERY_APPROVAL_MISSING", visibility: "internal" };
  }
  if (record.catalogVisibility !== "public") {
    return {
      publish: false,
      reason: "DISCOVERY_NOT_PUBLIC",
      visibility: record.catalogVisibility,
    };
  }
  if (record.recordType === "dataset" && record.accessRights !== "open") {
    return { publish: false, reason: "S1_NON_OPEN_DISCOVERY_BLOCKED", visibility: "internal" };
  }
  return { publish: true, reason: "SYNTHETIC_PUBLIC_APPROVAL", visibility: "public" };
}

export function quarantineDecision(error) {
  const safeError = error instanceof BridgeError
    ? error
    : new BridgeError("RECORD_NORMALIZATION_FAILED", "record normalization failed");
  return {
    state: "QUARANTINED",
    reasons: [{
      code: safeError.code,
      field: safeError.details?.field ?? safeError.details?.path ?? "record",
      message: safeError.message,
    }],
  };
}
