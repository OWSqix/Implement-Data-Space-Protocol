import { createHash } from "node:crypto";
import { DataFactory } from "n3";

const { namedNode } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");

export const NETWORK_RUNTIME_CONTROL_BY_ERROR_CODE = Object.freeze({
  NETWORK_IDENTITY_CHECKSUM_CONFLICT: "MOLIT-NET-IDENTITY-001",
  NETWORK_IDENTITY_DUPLICATE: "MOLIT-NET-IDENTITY-001",
  NETWORK_TERMINAL_REPLACEMENT_INVALID: "MOLIT-NET-LIFECYCLE-GLOBAL-001",
  NETWORK_ACTIVE_REPLACEMENT_INVALID: "MOLIT-NET-LIFECYCLE-GLOBAL-001",
  NETWORK_REPLACEMENT_NOT_FOUND: "MOLIT-NET-LIFECYCLE-GLOBAL-001",
  NETWORK_REPLACEMENT_IDENTITY_INVALID: "MOLIT-NET-LIFECYCLE-GLOBAL-001",
  NETWORK_LIFECYCLE_TRANSITION_INVALID: "MOLIT-NET-LIFECYCLE-GLOBAL-001",
  NETWORK_TERMINAL_VALIDITY_INVALID: "MOLIT-NET-TERMINAL-VALIDITY-GLOBAL-001",
  NETWORK_REPLACEMENT_VALIDITY_OVERLAP: "MOLIT-NET-VALIDITY-GLOBAL-001",
});

export const NETWORK_RUNTIME_PATH_FIELD_BY_ERROR_CODE = Object.freeze({
  NETWORK_IDENTITY_CHECKSUM_CONFLICT: "checksumProperty",
  NETWORK_IDENTITY_DUPLICATE: "checksumProperty",
  NETWORK_TERMINAL_REPLACEMENT_INVALID: "replacementProperty",
  NETWORK_ACTIVE_REPLACEMENT_INVALID: "replacementProperty",
  NETWORK_REPLACEMENT_NOT_FOUND: "replacementProperty",
  NETWORK_REPLACEMENT_IDENTITY_INVALID: "replacementProperty",
  NETWORK_LIFECYCLE_TRANSITION_INVALID: "replacementProperty",
  NETWORK_TERMINAL_VALIDITY_INVALID: "validUntilProperty",
  NETWORK_REPLACEMENT_VALIDITY_OVERLAP: "validUntilProperty",
});

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function compile(pattern, label) {
  try {
    return new RegExp(pattern, "u");
  } catch (cause) {
    throw new Error(`invalid ${label} pattern`, { cause });
  }
}

function assertHexSha256(value, label) {
  if (!/^[a-f0-9]{64}$/u.test(value ?? "")) fail("NETWORK_CHECKSUM_INVALID", { label, value });
}

function dateValue(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? "")) fail("NETWORK_DATE_INVALID", { label, value });
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) fail("NETWORK_DATE_INVALID", { label, value });
  return parsed;
}

export function networkReferenceKey(record, policy) {
  if (!Array.isArray(policy?.identity?.key) || policy.identity.key.length !== 3) {
    fail("NETWORK_POLICY_IDENTITY_INVALID");
  }
  const values = policy.identity.key.map((field) => {
    const value = record?.[field];
    if (!nonEmpty(value)) fail("NETWORK_IDENTITY_FIELD_INVALID", { field, value });
    return value;
  });
  return JSON.stringify(values);
}

export function validateNetworkReferenceSet(records, policy) {
  if (!Array.isArray(records) || records.length === 0) fail("NETWORK_REFERENCE_SET_EMPTY");
  const statuses = new Set(policy?.lifecycle?.statuses ?? []);
  const byKey = new Map();
  const normalized = [];
  for (const [index, record] of records.entries()) {
    if (!exactKeys(record, [
      "networkAuthority",
      "networkIdentifier",
      "networkVersion",
      "networkSnapshotChecksum",
      "networkLifecycleStatus",
      "networkValidFrom",
      "networkValidUntil",
      "replacementKey",
    ])) fail("NETWORK_REFERENCE_MEMBERS_INVALID", { index });
    const key = networkReferenceKey(record, policy);
    assertHexSha256(record.networkSnapshotChecksum, `records[${index}]`);
    if (!statuses.has(record.networkLifecycleStatus)) {
      fail("NETWORK_LIFECYCLE_STATUS_INVALID", { index, status: record.networkLifecycleStatus });
    }
    const from = dateValue(record.networkValidFrom, `records[${index}].networkValidFrom`);
    const until = record.networkValidUntil === null
      ? null
      : dateValue(record.networkValidUntil, `records[${index}].networkValidUntil`);
    if (until !== null && from > until) fail("NETWORK_VALIDITY_INTERVAL_INVALID", { index });
    if (["superseded", "withdrawn"].includes(record.networkLifecycleStatus)
      && until === null) {
      fail("NETWORK_TERMINAL_VALIDITY_INVALID", { index, status: record.networkLifecycleStatus });
    }
    if (record.networkLifecycleStatus === "superseded" && !nonEmpty(record.replacementKey)) {
      fail("NETWORK_TERMINAL_REPLACEMENT_INVALID", { index, status: record.networkLifecycleStatus });
    }
    if (["candidate", "current", "withdrawn"].includes(record.networkLifecycleStatus)
      && record.replacementKey !== null) {
      fail("NETWORK_ACTIVE_REPLACEMENT_INVALID", { index, status: record.networkLifecycleStatus });
    }
    const prior = byKey.get(key);
    if (prior && prior.networkSnapshotChecksum !== record.networkSnapshotChecksum) {
      fail("NETWORK_IDENTITY_CHECKSUM_CONFLICT", {
        checksum: record.networkSnapshotChecksum,
        key,
        priorChecksum: prior.networkSnapshotChecksum,
      });
    }
    if (prior) {
      fail("NETWORK_IDENTITY_DUPLICATE", { key });
    }
    if (!prior) byKey.set(key, record);
    normalized.push({ ...record, key });
  }
  const byResolvedKey = new Map(normalized.map((item) => [item.key, item]));
  const replacementTargetStatuses = new Set(policy.lifecycle.replacementTargetStatuses ?? []);
  for (const item of normalized.filter(({ replacementKey }) => replacementKey !== null)) {
    const successor = byResolvedKey.get(item.replacementKey);
    if (!successor) fail("NETWORK_REPLACEMENT_NOT_FOUND", { key: item.key, replacementKey: item.replacementKey });
    if (successor.networkAuthority !== item.networkAuthority
      || successor.networkIdentifier !== item.networkIdentifier
      || successor.networkVersion === item.networkVersion) {
      fail("NETWORK_REPLACEMENT_IDENTITY_INVALID", { key: item.key, replacementKey: item.replacementKey });
    }
    if (!replacementTargetStatuses.has(successor.networkLifecycleStatus)) {
      fail("NETWORK_LIFECYCLE_TRANSITION_INVALID", {
        from: item.networkLifecycleStatus,
        to: successor.networkLifecycleStatus,
      });
    }
    if (item.networkValidUntil === null
      || dateValue(item.networkValidUntil, "networkValidUntil")
        >= dateValue(successor.networkValidFrom, "successor.networkValidFrom")) {
      fail("NETWORK_REPLACEMENT_VALIDITY_OVERLAP", { key: item.key, replacementKey: item.replacementKey });
    }
  }
  return {
    identityCount: byKey.size,
    recordCount: records.length,
    sha256: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
    transitionCount: normalized.filter(({ replacementKey }) => replacementKey !== null).length,
  };
}

function oneObject(store, subject, predicate, { optional = false, termType } = {}) {
  const values = store.getObjects(subject, namedNode(predicate), null);
  if ((optional && values.length === 0) || values.length === 1) {
    const value = values[0] ?? null;
    if (value !== null && termType && value.termType !== termType) {
      fail("NETWORK_RDF_PROJECTION_INVALID", {
        focusNode: subject.value,
        path: predicate,
        reason: `expected-${termType}`,
      });
    }
    return value;
  }
  fail("NETWORK_RDF_PROJECTION_INVALID", {
    focusNode: subject.value,
    path: predicate,
    reason: optional ? "expected-zero-or-one" : "expected-exactly-one",
  });
}

function projectionPolicy(policy) {
  const projection = policy?.rdfProjection;
  if (!exactKeys(projection, [
    "referenceClass",
    "authorityProperty",
    "identifierProperty",
    "versionProperty",
    "checksumProperty",
    "lifecycleStatusProperty",
    "validFromProperty",
    "validUntilProperty",
    "replacementProperty",
    "lifecycleStatusNamespace",
  ])) fail("NETWORK_RDF_PROJECTION_POLICY_INVALID");
  return projection;
}

export function projectNetworkReferenceRecords(store, policy) {
  if (!store || typeof store.getSubjects !== "function" || typeof store.getObjects !== "function") {
    fail("NETWORK_RDF_STORE_INVALID");
  }
  const projection = projectionPolicy(policy);
  const subjects = [...new Map(store
    .getSubjects(RDF_TYPE, namedNode(projection.referenceClass), null)
    .map((term) => [`${term.termType}:${term.value}`, term])).values()]
    .sort((left, right) => left.value.localeCompare(right.value));
  const entries = subjects.map((subject) => {
    const authority = oneObject(store, subject, projection.authorityProperty, {
      termType: "NamedNode",
    });
    const identifier = oneObject(store, subject, projection.identifierProperty, {
      termType: "Literal",
    });
    const version = oneObject(store, subject, projection.versionProperty, {
      termType: "Literal",
    });
    const checksum = oneObject(store, subject, projection.checksumProperty, {
      termType: "Literal",
    });
    const status = oneObject(store, subject, projection.lifecycleStatusProperty, {
      termType: "NamedNode",
    });
    if (!status.value.startsWith(projection.lifecycleStatusNamespace)) {
      fail("NETWORK_RDF_PROJECTION_INVALID", {
        focusNode: subject.value,
        path: projection.lifecycleStatusProperty,
        reason: "lifecycle-status-namespace",
      });
    }
    const validFrom = oneObject(store, subject, projection.validFromProperty, {
      termType: "Literal",
    });
    const validUntil = oneObject(store, subject, projection.validUntilProperty, {
      optional: true,
      termType: "Literal",
    });
    const replacement = oneObject(store, subject, projection.replacementProperty, {
      optional: true,
      termType: "NamedNode",
    });
    return {
      subject,
      replacement,
      record: {
        networkAuthority: authority.value,
        networkIdentifier: identifier.value,
        networkVersion: version.value,
        networkSnapshotChecksum: checksum.value,
        networkLifecycleStatus: status.value.slice(projection.lifecycleStatusNamespace.length),
        networkValidFrom: validFrom.value,
        networkValidUntil: validUntil?.value ?? null,
        replacementKey: null,
      },
    };
  });
  const bySubject = new Map(entries.map((entry) => [
    `${entry.subject.termType}:${entry.subject.value}`,
    entry,
  ]));
  for (const entry of entries) {
    if (entry.replacement === null) continue;
    const successor = bySubject.get(`${entry.replacement.termType}:${entry.replacement.value}`);
    if (!successor) {
      fail("NETWORK_REPLACEMENT_NOT_FOUND", {
        focusNode: entry.subject.value,
        replacementIri: entry.replacement.value,
      });
    }
    entry.record.replacementKey = networkReferenceKey(successor.record, policy);
  }
  return entries.map(({ record }) => record);
}

export function validateNetworkReferenceGraph(store, policy) {
  const records = projectNetworkReferenceRecords(store, policy);
  if (records.length === 0) {
    return { identityCount: 0, recordCount: 0, sha256: null, transitionCount: 0 };
  }
  return validateNetworkReferenceSet(records, policy);
}

export function validateStandardNodeLinkExtract(evidence, policy) {
  if (evidence?.source?.archiveSha256 !== policy?.sourceEvidence?.archiveSha256
    || evidence?.source?.reuseStatus !== policy?.sourceEvidence?.reuseStatus) {
    fail("NETWORK_SOURCE_EVIDENCE_MISMATCH");
  }
  const nodePattern = compile(policy.elementIdentifiers.node.pattern, "node identifier");
  const linkPattern = compile(policy.elementIdentifiers.link.pattern, "link identifier");
  const historyPattern = compile(policy.elementIdentifiers.historyCode.pattern, "history code");
  const previousPattern = compile(
    policy.elementIdentifiers.previousIdentifier.pattern,
    "previous identifier",
  );
  const link = evidence?.sample?.link?.fields;
  const nodes = evidence?.sample?.nodes ?? [];
  if (!linkPattern.test(link?.LINK_ID ?? "")
    || !nodePattern.test(link?.F_NODE ?? "")
    || !nodePattern.test(link?.T_NODE ?? "")
    || !historyPattern.test(link?.HIST_TYPE ?? "")
    || !previousPattern.test(link?.HISTREMARK ?? "")) {
    fail("NETWORK_LINK_SAMPLE_INVALID");
  }
  const nodeIds = new Set();
  for (const node of nodes) {
    if (!nodePattern.test(node?.fields?.NODE_ID ?? "")
      || !historyPattern.test(node?.fields?.HIST_TYPE ?? "")) {
      fail("NETWORK_NODE_SAMPLE_INVALID", { node: node?.fields?.NODE_ID ?? null });
    }
    nodeIds.add(node.fields.NODE_ID);
  }
  if (!nodeIds.has(link.F_NODE) || !nodeIds.has(link.T_NODE)) {
    fail("NETWORK_LINK_ENDPOINT_MISSING");
  }
  if (JSON.stringify(evidence.coordinateReference.sourceCoordinateOrder)
      !== JSON.stringify(policy.coordinateOrder.source)
    || JSON.stringify(evidence.coordinateReference.rdfCoordinateOrder)
      !== JSON.stringify(policy.coordinateOrder.rdf)) {
    fail("NETWORK_COORDINATE_ORDER_MISMATCH");
  }
  return {
    historyReferenceCount: link.HISTREMARK ? 1 : 0,
    linkCount: 1,
    nodeCount: nodeIds.size,
  };
}
