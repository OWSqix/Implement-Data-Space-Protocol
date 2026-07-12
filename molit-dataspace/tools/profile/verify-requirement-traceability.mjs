#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { DataFactory, Parser, Store } from "n3";
import { readCheckedFile } from "../registries/safe-local-file.mjs";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const DEFAULT_RELEASE = path.join(
  PROJECT_ROOT,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "1.0.0-rc.1",
);
const DEFAULT_REGISTRY = "requirements/profile-requirements.json";
const DEFAULT_CASE_REGISTRY = "requirements/conformance-cases.json";
const DEFAULT_CSV_PROJECTION = "requirements/profile-requirements.csv";
const DEFAULT_SOURCE_OVERRIDES = "requirements/source-overrides.json";
const SCHEMA_PATH = path.join(PROJECT_ROOT, "contracts", "profile-requirements.v1.schema.json");
const decoder = new TextDecoder("utf-8", { fatal: true });

const { namedNode } = DataFactory;
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const SH = "http://www.w3.org/ns/shacl#";
const MOLIT = "https://data.molit.go.kr/def/molit-dcat-ap#";
const RDF_TYPE = namedNode(`${RDF}type`);
const RDF_FIRST = namedNode(`${RDF}first`);
const RDF_REST = namedNode(`${RDF}rest`);
const RDF_NIL = `${RDF}nil`;
const SH_NODE_SHAPE = `${SH}NodeShape`;
const SH_PROPERTY_SHAPE = `${SH}PropertyShape`;
const SH_PROPERTY = namedNode(`${SH}property`);
const REQUIREMENT_ID = namedNode(`${MOLIT}requirementId`);
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_TURTLE_BYTES = 8 * 1024 * 1024;
const MAX_FIXTURE_BYTES = 5 * 1024 * 1024;
const REQUIRED_SOURCE_OVERRIDE_IDS = new Set([
  "MOLIT-AGENT-001-P-NAME-001",
  "MOLIT-CAT-001-P-DESCRIPTION-001",
  "MOLIT-CAT-001-P-PUBLISHER-001",
  "MOLIT-CAT-001-P-TITLE-001",
  "MOLIT-CV-CHECKSUM-001",
  "MOLIT-CV-CHECKSUM-001-P-ALGORITHM-001",
  "MOLIT-CV-CHECKSUM-002",
  "MOLIT-CV-MEDIATYPE-001",
  "MOLIT-CV-MEDIATYPE-001-P-COMPRESSFORMAT-001",
  "MOLIT-CV-MEDIATYPE-001-P-MEDIATYPE-001",
  "MOLIT-CV-MEDIATYPE-001-P-PACKAGEFORMAT-001",
  "MOLIT-CV-MEDIATYPE-001-P-TYPE-001",
  "MOLIT-DS-001-P-ACCESSRIGHTS-001",
  "MOLIT-DS-001-P-DESCRIPTION-001",
  "MOLIT-DS-001-P-PUBLISHER-001",
  "MOLIT-DS-001-P-THEME-001",
  "MOLIT-DS-001-P-THEME-002",
  "MOLIT-DS-001-P-TITLE-001",
  "MOLIT-OFFER-001-P-TITLE-001",
  "MOLIT-QUAL-001-P-QUALITYSTATUS-001",
  "MOLIT-REC-001-P-LANGUAGE-001",
  "MOLIT-REC-001-P-TITLE-001",
  "MOLIT-SVC-001-P-THEME-001",
  "MOLIT-SVC-001-P-TITLE-001",
]);
const CSV_COLUMNS = Object.freeze([
  "requirementId",
  "conformanceClass",
  "resourceClass",
  "property",
  "obligation",
  "minCount",
  "maxCount",
  "range",
  "controlledVocabulary",
  "severity",
  "messages",
  "remediation",
  "sourceStandard",
  "sourceClause",
  "localRationale",
  "shapeId",
  "shapeFile",
  "constraintKey",
  "positiveFixtureId",
  "negativeFixtureId",
]);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvArray(values) {
  return JSON.stringify(values ?? []);
}

export function requirementCsvProjection(registry) {
  const rows = (registry.requirements ?? []).map((item) => ({
    requirementId: item.requirementId,
    conformanceClass: csvArray(item.conformanceClass),
    resourceClass: csvArray(item.resourceClass),
    property: item.property,
    obligation: item.obligation,
    minCount: item.cardinality?.minimum,
    maxCount: item.cardinality?.maximum,
    range: csvArray(item.range),
    controlledVocabulary: csvArray(item.vocabulary),
    severity: item.severity,
    messages: csvArray(item.messages),
    remediation: item.remediation,
    sourceStandard: item.sourceStandard,
    sourceClause: item.sourceClause,
    localRationale: item.localRationale,
    shapeId: item.shapeId,
    shapeFile: item.shapeFile,
    constraintKey: item.constraintKey,
    positiveFixtureId: item.positiveFixtureId,
    negativeFixtureId: item.negativeFixtureId,
  }));
  return `${[
    CSV_COLUMNS.join(","),
    ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(row[column])).join(",")),
  ].join("\n")}\n`;
}

function termKey(term) {
  return `${term.termType}:${term.value}`;
}

function portablePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")
    || value.includes("\0") || path.posix.isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty portable relative path`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")
    || path.posix.normalize(value) !== value) {
    throw new Error(`${label} is not a normalized release-relative path`);
  }
  return value;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (cause) {
    throw new Error(`${label} is not strict UTF-8 JSON`, { cause });
  }
}

async function readReleaseFile(releaseRoot, relativePath, maximumBytes) {
  const relative = portablePath(relativePath, "release artifact path");
  return readCheckedFile(
    releaseRoot,
    path.resolve(releaseRoot, ...relative.split("/")),
    maximumBytes,
  );
}

export async function loadRequirementSourceOverrides({
  profileVersion,
  releaseRoot = DEFAULT_RELEASE,
  requirementIds,
} = {}) {
  const bytes = await readReleaseFile(
    releaseRoot,
    DEFAULT_SOURCE_OVERRIDES,
    MAX_JSON_BYTES,
  );
  const document = parseJson(bytes, "requirement source-override register");
  if (document?.schemaVersion !== "molit.profile-requirement-source-overrides/1"
    || document.profileVersion !== profileVersion
    || !Array.isArray(document.overrides)) {
    throw new Error("requirement source-override register has an invalid identity or structure");
  }
  const known = new Set(requirementIds ?? []);
  const overrides = new Map();
  for (const item of document.overrides) {
    const keys = Object.keys(item ?? {}).sort();
    if (!sameJson(keys, [
      "localRationale",
      "requirementId",
      "sourceClause",
      "sourceStandard",
    ])) {
      throw new Error("source override rows must have exactly four reviewed fields");
    }
    if (typeof item.requirementId !== "string" || !known.has(item.requirementId)
      || overrides.has(item.requirementId)) {
      throw new Error(`source override identifies an unknown or duplicate requirement: ${item.requirementId}`);
    }
    for (const field of ["sourceStandard", "sourceClause", "localRationale"]) {
      if (typeof item[field] !== "string" || item[field].trim().length < 5
        || /\b(?:TBD|TODO)\b/iu.test(item[field])) {
        throw new Error(`source override ${item.requirementId}.${field} is not reviewed text`);
      }
    }
    overrides.set(item.requirementId, {
      sourceStandard: item.sourceStandard,
      sourceClause: item.sourceClause,
      localRationale: item.localRationale,
    });
  }
  const missingRequired = [...REQUIRED_SOURCE_OVERRIDE_IDS]
    .filter((id) => known.has(id) && !overrides.has(id)).sort();
  if (missingRequired.length > 0) {
    throw new Error(`specific source override is missing for: ${missingRequired.join(", ")}`);
  }
  return { document, overrides };
}

function parseInteger(store, subject, predicate) {
  const values = store.getObjects(subject, namedNode(predicate), null);
  if (values.length !== 1 || values[0].termType !== "Literal"
    || !/^(?:0|[1-9][0-9]*)$/u.test(values[0].value)) return null;
  const value = Number(values[0].value);
  return Number.isSafeInteger(value) ? value : null;
}

function readRdfList(store, head, seen = new Set()) {
  if (head.termType === "NamedNode" && head.value === RDF_NIL) return [];
  const key = termKey(head);
  if (head.termType !== "BlankNode" || seen.has(key)) return null;
  seen.add(key);
  const first = store.getObjects(head, RDF_FIRST, null);
  const rest = store.getObjects(head, RDF_REST, null);
  if (first.length !== 1 || rest.length !== 1) return null;
  const tail = readRdfList(store, rest[0], seen);
  return tail === null ? null : [first[0], ...tail];
}

function canonicalPath(store, term, seen = new Set()) {
  if (!term) return null;
  if (term.termType === "NamedNode") return term.value;
  const key = termKey(term);
  if (term.termType !== "BlankNode" || seen.has(key)) return `_:unsupported(${term.value})`;
  const nextSeen = new Set(seen).add(key);
  const sequence = readRdfList(store, term);
  if (sequence) {
    return `(${sequence.map((item) => canonicalPath(store, item, nextSeen)).join("/")})`;
  }
  for (const [predicate, prefix, suffix] of [
    [`${SH}inversePath`, "^", ""],
    [`${SH}zeroOrMorePath`, "(", ")*"],
    [`${SH}oneOrMorePath`, "(", ")+"],
    [`${SH}zeroOrOnePath`, "(", ")?"],
  ]) {
    const values = store.getObjects(term, namedNode(predicate), null);
    if (values.length === 1) {
      return `${prefix}${canonicalPath(store, values[0], nextSeen)}${suffix}`;
    }
  }
  const alternatives = store.getObjects(term, namedNode(`${SH}alternativePath`), null);
  if (alternatives.length === 1) {
    const values = readRdfList(store, alternatives[0]);
    if (values) return `(${values.map((item) => canonicalPath(store, item, nextSeen)).join("|")})`;
  }
  return `_:unsupported(${term.value})`;
}

function inferSeverity(store, subject) {
  const values = store.getObjects(subject, namedNode(`${SH}severity`), null);
  if (values.length === 0) {
    const children = store.getObjects(subject, SH_PROPERTY, null);
    if (children.length === 0) return "Violation";
    const childSeverities = children.map((child) => inferSeverity(store, child));
    if (childSeverities.includes(null) || childSeverities.includes("Violation")) return "Violation";
    if (childSeverities.includes("Warning")) return "Warning";
    return "Info";
  }
  if (values.length !== 1 || values[0].termType !== "NamedNode") return null;
  const value = values[0].value;
  if (value === `${SH}Violation`) return "Violation";
  if (value === `${SH}Warning`) return "Warning";
  if (value === `${SH}Info`) return "Info";
  return null;
}

function inferRange(store, subject) {
  return sortedUnique([
    ...store.getObjects(subject, namedNode(`${SH}class`), null),
    ...store.getObjects(subject, namedNode(`${SH}datatype`), null),
    ...store.getObjects(subject, namedNode(`${SH}nodeKind`), null),
  ].filter((term) => term.termType === "NamedNode").map((term) => term.value));
}

function inferVocabulary(store, subject) {
  const values = store.getObjects(subject, namedNode(`${SH}hasValue`), null)
    .filter((term) => term.termType === "NamedNode")
    .map((term) => term.value);
  for (const head of store.getObjects(subject, namedNode(`${SH}in`), null)) {
    const list = readRdfList(store, head);
    if (list) values.push(...list.filter((term) => term.termType === "NamedNode").map((term) => term.value));
  }
  return sortedUnique(values);
}

function isProhibition(store, subject) {
  const maximum = parseInteger(store, subject, `${SH}maxCount`);
  if (maximum === 0) return true;
  if (store.getObjects(subject, namedNode(`${SH}in`), null)
    .some((term) => term.termType === "NamedNode" && term.value === RDF_NIL)) return true;
  const properties = store.getObjects(subject, SH_PROPERTY, null);
  return properties.length > 0 && properties.every((property) => (
    parseInteger(store, property, `${SH}maxCount`) === 0
  ));
}

function inferObligation(store, subject, severity) {
  if (isProhibition(store, subject)) {
    return severity === "Warning" ? "SHOULD-NOT" : severity === "Info" ? "MAY" : "MUST-NOT";
  }
  return severity === "Warning" ? "SHOULD" : severity === "Info" ? "MAY" : "MUST";
}

function messageRecord(term) {
  if (term.termType !== "Literal") return null;
  return {
    language: term.language || "und",
    text: term.value,
  };
}

function inferMessages(store, term, owner, shapeFile) {
  const direct = store.getObjects(term, namedNode(`${SH}message`), null)
    .map(messageRecord).filter(Boolean);
  const ownerMessages = term.equals(owner) ? [] : store.getObjects(
    owner,
    namedNode(`${SH}message`),
    null,
  ).map(messageRecord).filter(Boolean);
  const collected = [...direct, ...ownerMessages];
  if (collected.length === 0) {
    const queue = [owner];
    const seen = new Set();
    while (queue.length > 0 && seen.size < 2048) {
      const current = queue.shift();
      const key = termKey(current);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(...store.getObjects(current, namedNode(`${SH}message`), null)
        .map(messageRecord).filter(Boolean));
      for (const quad of store.getQuads(current, null, null, null)) {
        if (["BlankNode", "NamedNode"].includes(quad.object.termType)) queue.push(quad.object);
      }
    }
  }
  if (collected.length === 0) {
    collected.push({
      language: "en",
      text: `The target does not satisfy the executable SHACL constraint declared in ${shapeFile}.`,
    });
  }
  return [...new Map(collected.map((item) => (
    [`${item.language}\0${item.text}`, item]
  ))).values()].sort((left, right) => (
    left.language.localeCompare(right.language) || left.text.localeCompare(right.text)
  ));
}

function remediationFor({ cardinality, property, range, shapeId, store, term, vocabulary }) {
  const steps = [];
  if (property) {
    if (cardinality.maximum === 0) {
      steps.push(`Remove every ${property} value from each resource targeted by ${shapeId}.`);
    } else if (cardinality.minimum !== null && cardinality.maximum !== null) {
      steps.push(`Set ${property} to between ${cardinality.minimum} and ${cardinality.maximum} value(s) on each target resource.`);
    } else if (cardinality.minimum !== null) {
      steps.push(`Add ${property} until each target resource has at least ${cardinality.minimum} value(s).`);
    } else if (cardinality.maximum !== null) {
      steps.push(`Reduce ${property} to at most ${cardinality.maximum} value(s) on each target resource.`);
    }
    const requiredValues = store.getObjects(term, namedNode(`${SH}hasValue`), null)
      .map((item) => item.value);
    if (requiredValues.length > 0) {
      steps.push(`Ensure ${property} includes the required value(s): ${requiredValues.join(", ")}.`);
    }
    const allowedValues = [];
    for (const head of store.getObjects(term, namedNode(`${SH}in`), null)) {
      const list = readRdfList(store, head);
      if (list) allowedValues.push(...list.map((item) => item.value));
    }
    if (allowedValues.length > 0) {
      steps.push(`Use only these allowed value(s) for ${property}: ${sortedUnique(allowedValues).join(", ")}.`);
    } else if (vocabulary.length > 0 && requiredValues.length === 0) {
      steps.push(`Use the controlled value IRI(s) declared by ${shapeId}: ${vocabulary.join(", ")}.`);
    }
    if (range.length > 0) {
      steps.push(`Encode every ${property} value with the required class, datatype, or node kind: ${range.join(", ")}.`);
    }
    const patterns = store.getObjects(term, namedNode(`${SH}pattern`), null)
      .filter((item) => item.termType === "Literal").map((item) => item.value);
    if (patterns.length > 0) {
      steps.push(`Make every ${property} lexical form satisfy sh:pattern ${patterns.map((item) => JSON.stringify(item)).join(" and ")}.`);
    }
    if (steps.length === 0) {
      steps.push(`Change ${property} so the target satisfies every comparison, qualified-value, or logical component declared by ${shapeId}.`);
    }
  } else if (isProhibition(store, term)) {
    steps.push(`Remove the class or property that activates prohibited shape ${shapeId}; route spatial content to the geo or network conformance module.`);
  } else {
    const patterns = store.getObjects(term, namedNode(`${SH}pattern`), null)
      .filter((item) => item.termType === "Literal").map((item) => item.value);
    if (range.length > 0) {
      steps.push(`Replace the target value with one encoded as ${range.join(", ")}.`);
    }
    if (patterns.length > 0) {
      steps.push(`Make the target lexical form satisfy sh:pattern ${patterns.map((item) => JSON.stringify(item)).join(" and ")}.`);
    }
    if (steps.length === 0) {
      const queue = [term];
      const seen = new Set();
      const paths = [];
      while (queue.length > 0 && seen.size < 2048) {
        const current = queue.shift();
        const key = termKey(current);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const pathTerm of store.getObjects(current, namedNode(`${SH}path`), null)) {
          paths.push(canonicalPath(store, pathTerm));
        }
        for (const quad of store.getQuads(current, null, null, null)) {
          if (["BlankNode", "NamedNode"].includes(quad.object.termType)) queue.push(quad.object);
        }
      }
      const uniquePaths = sortedUnique(paths.filter(Boolean));
      steps.push(uniquePaths.length > 0
        ? `Correct these constrained path(s) on the target: ${uniquePaths.join(", ")}; then rerun shape ${shapeId}.`
        : `Correct the target so it satisfies every direct or logical branch of ${shapeId}, then rerun its conformance module.`);
    }
  }
  return steps.join(" ");
}

function targetClasses(store, root) {
  return sortedUnique(store.getObjects(root, namedNode(`${SH}targetClass`), null)
    .filter((term) => term.termType === "NamedNode")
    .map((term) => term.value));
}

function encoded(value) {
  return encodeURIComponent(value).replaceAll("'", "%27");
}

function localRoots(store, shapeNamespace) {
  const roots = new Map();
  for (const type of [SH_NODE_SHAPE, SH_PROPERTY_SHAPE]) {
    for (const subject of store.getSubjects(RDF_TYPE, namedNode(type), null)) {
      if (subject.termType === "NamedNode" && subject.value.startsWith(shapeNamespace)) {
        roots.set(termKey(subject), subject);
      }
    }
  }
  for (const predicate of [
    `${SH}targetClass`,
    `${SH}targetNode`,
    `${SH}targetObjectsOf`,
    `${SH}targetSubjectsOf`,
  ]) {
    for (const subject of store.getSubjects(namedNode(predicate), null, null)) {
      if (subject.termType === "NamedNode" && subject.value.startsWith(shapeNamespace)) {
        roots.set(termKey(subject), subject);
      }
    }
  }
  return [...roots.values()].sort((left, right) => left.value.localeCompare(right.value));
}

function constraintKind(store, subject, isDirectProperty) {
  const types = new Set(store.getObjects(subject, RDF_TYPE, null).map((term) => term.value));
  if (types.has(SH_PROPERTY_SHAPE)) return "property-shape";
  if (isDirectProperty) return "direct-property-constraint";
  return "node-shape";
}

function conformanceClasses(manifest, shapeFile) {
  return Object.entries(manifest.profiles ?? {})
    .filter(([, profile]) => (
      profile?.kind !== "diagnostic" && profile?.shapes?.includes(shapeFile)
    ))
    .map(([name]) => name)
    .sort();
}

function draftRequirementId(constraintKey) {
  return `MOLIT-DRAFT-${createHash("sha256").update(constraintKey).digest("hex").slice(0, 12).toUpperCase()}`;
}

async function parseShapeFile(releaseRoot, relativePath) {
  const bytes = await readReleaseFile(releaseRoot, relativePath, MAX_TURTLE_BYTES);
  let quads;
  try {
    quads = new Parser({ baseIRI: `https://data.molit.go.kr/.well-known/release-artifact/${relativePath}` })
      .parse(decoder.decode(bytes));
  } catch (cause) {
    throw new Error(`local SHACL file is not strict Turtle: ${relativePath}`, { cause });
  }
  return { bytes, store: new Store(quads) };
}

function scanFile({ manifest, shapeFile, shapeNamespace, store }) {
  const roots = localRoots(store, shapeNamespace);
  if (roots.length === 0) return { auxiliaryConstraints: [], constraints: [], roots: [] };

  const rootKeys = new Set(roots.map(termKey));
  const directProperties = new Map();
  for (const root of roots) {
    for (const quad of store.getQuads(root, SH_PROPERTY, null, null)) {
      const key = termKey(quad.object);
      if (!directProperties.has(key)) directProperties.set(key, { owners: new Map(), term: quad.object });
      directProperties.get(key).owners.set(termKey(root), root);
    }
  }

  const tracked = new Map();
  for (const root of roots) tracked.set(termKey(root), { owners: new Map([[termKey(root), root]]), term: root });
  for (const [key, value] of directProperties) {
    if (tracked.has(key)) {
      for (const [ownerKey, owner] of value.owners) tracked.get(key).owners.set(ownerKey, owner);
    } else {
      tracked.set(key, value);
    }
  }

  const directOrder = new Map();
  for (const root of roots) {
    let index = 0;
    for (const quad of store.getQuads(root, SH_PROPERTY, null, null)) {
      directOrder.set(`${termKey(root)}\0${termKey(quad.object)}`, ++index);
    }
  }

  const constraints = [...tracked.values()].map(({ owners, term }) => {
    const ownerList = [...owners.values()].sort((left, right) => left.value.localeCompare(right.value));
    const owner = ownerList[0] ?? term;
    const direct = directProperties.has(termKey(term));
    const kind = constraintKind(store, term, direct);
    let constraintKey;
    if (term.termType === "NamedNode") {
      constraintKey = `${shapeFile}#${kind}:${encoded(term.value)}`;
    } else {
      const ordinal = String(directOrder.get(`${termKey(owner)}\0${termKey(term)}`) ?? 0).padStart(4, "0");
      constraintKey = `${shapeFile}#${kind === "property-shape" ? "property-shape" : kind === "node-shape" ? "node-shape" : "property"}:${encoded(owner.value)}:${ordinal}`;
    }
    const requirementTerms = store.getObjects(term, REQUIREMENT_ID, null);
    const requirementIds = requirementTerms
      .filter((item) => item.termType === "Literal")
      .map((item) => item.value);
    const pathTerms = store.getObjects(term, namedNode(`${SH}path`), null);
    const cardinality = {
      maximum: parseInteger(store, term, `${SH}maxCount`),
      minimum: parseInteger(store, term, `${SH}minCount`),
    };
    const property = pathTerms.length === 1 ? canonicalPath(store, pathTerms[0]) : null;
    const range = inferRange(store, term);
    const severity = inferSeverity(store, term);
    const vocabulary = inferVocabulary(store, term);
    const shapeId = term.termType === "NamedNode" ? term.value : owner.value;
    return {
      ambiguousOwners: term.termType === "BlankNode" && ownerList.length > 1
        ? ownerList.map((item) => item.value)
        : [],
      cardinality,
      conformanceClass: conformanceClasses(manifest, shapeFile),
      constraintKey,
      constraintKind: kind,
      messages: inferMessages(store, term, owner, shapeFile),
      obligation: inferObligation(store, term, severity),
      property,
      range,
      remediation: remediationFor({
        cardinality,
        property,
        range,
        shapeId,
        store,
        term,
        vocabulary,
      }),
      requirementIds,
      requirementTermCount: requirementTerms.length,
      resourceClass: sortedUnique(ownerList.flatMap((item) => targetClasses(store, item))),
      severity,
      shapeFile,
      shapeId,
      term,
      vocabulary,
    };
  }).sort((left, right) => left.constraintKey.localeCompare(right.constraintKey));

  const auxiliaryByTerm = new Map();
  for (const root of roots) {
    const queue = [{ inheritedFrom: root, term: root }];
    const visited = new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      const stateKey = `${termKey(current.term)}\0${termKey(current.inheritedFrom)}`;
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      for (const quad of store.getQuads(current.term, null, null, null)) {
        const object = quad.object;
        if (quad.predicate.equals(SH_PROPERTY)) {
          const isDirect = rootKeys.has(termKey(current.term));
          const nextInherited = isDirect ? object : current.inheritedFrom;
          if (!tracked.has(termKey(object))) {
            if (!auxiliaryByTerm.has(termKey(object))) {
              auxiliaryByTerm.set(termKey(object), {
                inheritedFrom: new Map(),
                term: object,
              });
            }
            auxiliaryByTerm.get(termKey(object)).inheritedFrom.set(
              termKey(nextInherited),
              nextInherited,
            );
          }
          if (object.termType === "BlankNode") {
            queue.push({ inheritedFrom: nextInherited, term: object });
          }
        } else if (object.termType === "BlankNode") {
          queue.push({ inheritedFrom: current.inheritedFrom, term: object });
        }
      }
    }
  }
  const auxiliaryConstraints = [...auxiliaryByTerm.values()].map(({ inheritedFrom, term }) => {
    const requirementTerms = store.getObjects(term, REQUIREMENT_ID, null);
    return {
      inheritedFrom: [...inheritedFrom.values()],
      requirementIds: requirementTerms
        .filter((item) => item.termType === "Literal")
        .map((item) => item.value),
      requirementTermCount: requirementTerms.length,
      shapeFile,
      term,
    };
  });
  return { auxiliaryConstraints, constraints, roots };
}

async function loadManifest(releaseRoot) {
  const bytes = await readReleaseFile(releaseRoot, "manifest.json", MAX_JSON_BYTES);
  const manifest = parseJson(bytes, "release manifest");
  if (!/^molit[.]application-profile-manifest\/[12]$/u.test(manifest?.schemaVersion ?? "")
    || typeof manifest.version !== "string"
    || !/^[0-9]+[.][0-9]+[.][0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)
    || typeof manifest.profiles !== "object" || manifest.profiles === null) {
    throw new Error("release manifest does not identify an application-profile release");
  }
  const shapeFiles = sortedUnique(Object.values(manifest.profiles).flatMap((profile) => (
    Array.isArray(profile?.shapes) ? profile.shapes : []
  )));
  for (const shapeFile of shapeFiles) {
    portablePath(shapeFile, "manifest shape path");
    if (!shapeFile.endsWith(".ttl")) throw new Error(`SHACL artifact is not Turtle: ${shapeFile}`);
  }
  return { manifest, shapeFiles };
}

export async function scanRequirementConstraints({ releaseRoot = DEFAULT_RELEASE } = {}) {
  const absoluteRelease = path.resolve(releaseRoot);
  const { manifest, shapeFiles } = await loadManifest(absoluteRelease);
  const shapeNamespace = `https://data.molit.go.kr/shape/molit-dcat-ap/${manifest.version}#`;
  const constraints = [];
  const auxiliaryConstraints = [];
  const localShapeFiles = [];
  const stores = new Map();
  for (const shapeFile of shapeFiles) {
    const parsed = await parseShapeFile(absoluteRelease, shapeFile);
    const scanned = scanFile({ manifest, shapeFile, shapeNamespace, store: parsed.store });
    if (scanned.roots.length > 0) {
      constraints.push(...scanned.constraints);
      auxiliaryConstraints.push(...scanned.auxiliaryConstraints);
      localShapeFiles.push(shapeFile);
      stores.set(shapeFile, parsed.store);
    }
  }
  if (constraints.length === 0) throw new Error("release contains no local SHACL constraints");
  return {
    auxiliaryConstraints,
    constraints: constraints.sort((left, right) => left.constraintKey.localeCompare(right.constraintKey)),
    localShapeFiles: localShapeFiles.sort(),
    manifest,
    releaseRoot: absoluteRelease,
    shapeNamespace,
    stores,
  };
}

function fixtureId(relativePath, conforms) {
  const basename = path.posix.basename(relativePath, path.posix.extname(relativePath));
  const slug = basename.toUpperCase().replace(/[^A-Z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return `${conforms ? "POS" : "NEG"}-${slug}`;
}

async function draftFixtureCases(scan) {
  const cases = [];
  const profileNames = Object.entries(scan.manifest.profiles)
    .filter(([, profile]) => profile?.kind !== "diagnostic")
    .map(([name]) => name)
    .sort();
  for (const directory of ["valid", "invalid"]) {
    const absolute = path.join(scan.releaseRoot, "examples", directory);
    const names = (await readdir(absolute, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      const relative = `examples/${directory}/${name}`;
      const bytes = await readReleaseFile(scan.releaseRoot, relative, MAX_FIXTURE_BYTES);
      const conforms = directory === "valid";
      cases.push({
        fixtureId: fixtureId(relative, conforms),
        path: relative,
        sha256: digest(bytes),
        description: "TODO: review the profiles and requirement coverage represented by this fixture.",
        conformanceClass: profileNames,
        expectedOutcome: conforms ? "conforms" : "violates",
        coversRequirementIds: [],
        expectedRequirementIds: [],
      });
    }
  }
  return cases.sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));
}

export async function buildDraftRequirementArtifacts({ releaseRoot = DEFAULT_RELEASE } = {}) {
  const scan = await scanRequirementConstraints({ releaseRoot });
  const used = new Set();
  const requirements = scan.constraints.map((constraint) => {
    let requirementId = constraint.requirementIds.length === 1
      ? constraint.requirementIds[0]
      : draftRequirementId(constraint.constraintKey);
    if (used.has(requirementId)) requirementId = draftRequirementId(constraint.constraintKey);
    used.add(requirementId);
    return {
      requirementId,
      constraintKey: constraint.constraintKey,
      constraintKind: constraint.constraintKind,
      conformanceClass: constraint.conformanceClass,
      resourceClass: constraint.resourceClass,
      property: constraint.property,
      obligation: constraint.obligation,
      cardinality: constraint.cardinality,
      range: constraint.range,
      vocabulary: constraint.vocabulary,
      severity: constraint.severity ?? "Violation",
      messages: constraint.messages,
      remediation: constraint.remediation,
      sourceStandard: "TODO",
      sourceClause: "TBD",
      localRationale: "TODO: confirm the normative source, obligation, and local policy rationale.",
      shapeId: constraint.shapeId,
      shapeFile: constraint.shapeFile,
      positiveFixtureId: null,
      negativeFixtureId: null,
    };
  });
  const fixtureCaseRegistry = scan.manifest.conformanceCases ?? DEFAULT_CASE_REGISTRY;
  portablePath(fixtureCaseRegistry, "manifest conformanceCases path");
  return {
    caseRegistry: {
      schemaVersion: "molit.profile-conformance-cases/1",
      profileVersion: scan.manifest.version,
      registryStatus: "draft",
      fixtureCases: await draftFixtureCases(scan),
    },
    requirementsRegistry: {
      schemaVersion: "molit.profile-requirements/1",
      profileVersion: scan.manifest.version,
      registryStatus: "draft",
      shapeNamespace: scan.shapeNamespace,
      shapeFiles: scan.localShapeFiles,
      fixtureCaseRegistry,
      requirements,
    },
  };
}

export async function buildDraftRequirementRegistry(options = {}) {
  return (await buildDraftRequirementArtifacts(options)).requirementsRegistry;
}

export async function buildDraftConformanceCaseRegistry(options = {}) {
  return (await buildDraftRequirementArtifacts(options)).caseRegistry;
}

function finding(findings, code, message, details = {}) {
  findings.push({ code, message, ...details });
}

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([value]) => value).sort();
}

async function loadSchema() {
  return parseJson(await readFile(SCHEMA_PATH), "requirement-register schema");
}

function validateSchema(schema, value, definition = null) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv, { mode: "full" });
  let validate;
  if (definition === null) validate = ajv.compile(schema);
  else {
    ajv.addSchema(schema);
    validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${definition}` });
  }
  return validate(value)
    ? []
    : (validate.errors ?? []).map((error) => ({
      instancePath: error.instancePath,
      keyword: error.keyword,
      message: error.message,
    }));
}

async function verifyFixtures({ caseRegistry, findings, registry, scan }) {
  const requirementIds = new Set(registry.requirements.map((item) => item.requirementId));
  const cases = new Map();
  for (const fixture of caseRegistry.fixtureCases) {
    if (cases.has(fixture.fixtureId)) {
      finding(findings, "DUPLICATE_FIXTURE_ID", "fixture case ID is not unique", {
        fixtureId: fixture.fixtureId,
      });
      continue;
    }
    cases.set(fixture.fixtureId, fixture);
    for (const requirementId of [
      ...fixture.coversRequirementIds,
      ...fixture.expectedRequirementIds,
    ]) {
      if (!requirementIds.has(requirementId)) {
        finding(findings, "UNKNOWN_FIXTURE_REQUIREMENT", "fixture case refers to an unknown requirement", {
          fixtureId: fixture.fixtureId,
          requirementId,
        });
      }
    }
    const covered = new Set(fixture.coversRequirementIds);
    for (const requirementId of fixture.expectedRequirementIds) {
      if (!covered.has(requirementId)) {
        finding(findings, "EXPECTED_REQUIREMENT_NOT_COVERED", "negative expectation is absent from coversRequirementIds", {
          fixtureId: fixture.fixtureId,
          requirementId,
        });
      }
    }
    try {
      const bytes = await readReleaseFile(scan.releaseRoot, fixture.path, MAX_FIXTURE_BYTES);
      const actual = digest(bytes);
      if (actual !== fixture.sha256) {
        finding(findings, "FIXTURE_DIGEST_MISMATCH", "fixture bytes do not match the case registry", {
          actualSha256: actual,
          expectedSha256: fixture.sha256,
          fixtureId: fixture.fixtureId,
          path: fixture.path,
        });
      }
    } catch (error) {
      finding(findings, "FIXTURE_UNREADABLE", "fixture path is absent, unsafe, or unreadable", {
        fixtureId: fixture.fixtureId,
        path: fixture.path,
        reason: error.message,
      });
    }
  }

  for (const requirement of registry.requirements) {
    for (const [field, outcome] of [
      ["positiveFixtureId", "conforms"],
      ["negativeFixtureId", "violates"],
    ]) {
      const fixtureIdValue = requirement[field];
      if (fixtureIdValue === null) {
        finding(
          findings,
          field === "positiveFixtureId"
            ? "REQUIREMENT_POSITIVE_FIXTURE_MISSING"
            : "REQUIREMENT_NEGATIVE_FIXTURE_MISSING",
          "normative requirement has no approved fixture evidence",
          { field, requirementId: requirement.requirementId },
        );
        continue;
      }
      const fixture = cases.get(fixtureIdValue);
      if (!fixture) {
        finding(findings, "UNKNOWN_REQUIREMENT_FIXTURE", "requirement refers to an unknown fixture case", {
          field,
          fixtureId: fixtureIdValue,
          requirementId: requirement.requirementId,
        });
      } else if (fixture.expectedOutcome !== outcome) {
        finding(findings, "FIXTURE_OUTCOME_MISMATCH", "requirement fixture has the wrong expected outcome", {
          actual: fixture.expectedOutcome,
          expected: outcome,
          field,
          fixtureId: fixtureIdValue,
          requirementId: requirement.requirementId,
        });
      } else if (!fixture.coversRequirementIds.includes(requirement.requirementId)) {
        finding(findings, "FIXTURE_COVERAGE_LINK_MISSING", "fixture does not link back to the requirement", {
          field,
          fixtureId: fixtureIdValue,
          requirementId: requirement.requirementId,
        });
      } else if (!requirement.conformanceClass.some((name) => (
        fixture.conformanceClass.includes(name)
      ))) {
        finding(findings, "FIXTURE_CONFORMANCE_CLASS_MISMATCH", "fixture does not exercise a conformance class of the requirement", {
          fixtureConformanceClass: fixture.conformanceClass,
          fixtureId: fixtureIdValue,
          requirementConformanceClass: requirement.conformanceClass,
          requirementId: requirement.requirementId,
        });
      } else if (outcome === "violates"
        && !fixture.expectedRequirementIds.includes(requirement.requirementId)) {
        finding(findings, "NEGATIVE_EXPECTATION_LINK_MISSING", "negative fixture does not expect the requirement ID", {
          fixtureId: fixtureIdValue,
          requirementId: requirement.requirementId,
        });
      }
    }
  }
}

function coverageBlockers(registry) {
  if (!Array.isArray(registry?.requirements)) return [];
  return registry.requirements.flatMap((requirement) => {
    const missing = [];
    if (requirement.positiveFixtureId === null) missing.push("positive-fixture");
    if (requirement.negativeFixtureId === null) missing.push("negative-fixture");
    return missing.length === 0 ? [] : [{
      id: `RA-REQUIREMENTS-${createHash("sha256")
        .update(requirement.requirementId)
        .digest("hex")
        .slice(0, 12)
        .toUpperCase()}`,
      missing,
      releaseAcceptanceItem: "RA-REQUIREMENTS",
      requirementId: requirement.requirementId,
      severity: "P0",
    }];
  });
}

function coverageSummary(registry) {
  const requirements = Array.isArray(registry?.requirements) ? registry.requirements : [];
  return {
    fullyCovered: requirements.filter((item) => (
      item.positiveFixtureId !== null && item.negativeFixtureId !== null
    )).length,
    negativeCovered: requirements.filter((item) => item.negativeFixtureId !== null).length,
    positiveCovered: requirements.filter((item) => item.positiveFixtureId !== null).length,
    requirements: requirements.length,
  };
}

function verifyConstraintRows({ findings, registry, scan }) {
  const rowsByKey = new Map();
  for (const row of registry.requirements) {
    if (rowsByKey.has(row.constraintKey)) {
      finding(findings, "DUPLICATE_CONSTRAINT_KEY", "constraintKey is not unique", {
        constraintKey: row.constraintKey,
      });
    } else rowsByKey.set(row.constraintKey, row);
  }
  for (const requirementId of duplicateValues(registry.requirements.map((item) => item.requirementId))) {
    finding(findings, "DUPLICATE_REGISTRY_REQUIREMENT_ID", "registry requirementId is not unique", { requirementId });
  }

  const shapeIds = [];
  for (const constraint of scan.constraints) {
    if (constraint.requirementTermCount !== 1 || constraint.requirementIds.length !== 1) {
      finding(findings, "SHAPE_REQUIREMENT_ID_CARDINALITY", "local SHACL constraint must carry exactly one literal requirementId", {
        constraintKey: constraint.constraintKey,
        literalRequirementIds: constraint.requirementIds,
        requirementTermCount: constraint.requirementTermCount,
      });
    } else shapeIds.push(constraint.requirementIds[0]);
    if (constraint.ambiguousOwners.length > 0) {
      finding(findings, "AMBIGUOUS_CONSTRAINT_OWNER", "blank local constraint is reachable from more than one named local shape", {
        constraintKey: constraint.constraintKey,
        owners: constraint.ambiguousOwners,
      });
    }
    if (constraint.severity === null) {
      finding(findings, "INVALID_SHACL_SEVERITY", "local SHACL constraint has an unsupported or repeated severity", {
        constraintKey: constraint.constraintKey,
      });
    }
    const row = rowsByKey.get(constraint.constraintKey);
    if (!row) {
      finding(findings, "MISSING_REQUIREMENT_ROW", "local SHACL constraint is absent from the requirement register", {
        constraintKey: constraint.constraintKey,
      });
      continue;
    }
    const expected = {
      cardinality: constraint.cardinality,
      conformanceClass: constraint.conformanceClass,
      constraintKind: constraint.constraintKind,
      messages: constraint.messages,
      obligation: constraint.obligation,
      property: constraint.property,
      range: constraint.range,
      remediation: constraint.remediation,
      resourceClass: constraint.resourceClass,
      severity: constraint.severity,
      shapeFile: constraint.shapeFile,
      shapeId: constraint.shapeId,
      vocabulary: constraint.vocabulary,
    };
    for (const [field, value] of Object.entries(expected)) {
      const actual = Array.isArray(row[field]) ? [...row[field]].sort() : row[field];
      const normalizedExpected = Array.isArray(value) ? [...value].sort() : value;
      if (!sameJson(actual, normalizedExpected)) {
        finding(findings, "REQUIREMENT_FIELD_MISMATCH", "requirement row differs from the SHACL graph", {
          actual: row[field],
          constraintKey: constraint.constraintKey,
          expected: value,
          field,
          requirementId: row.requirementId,
        });
      }
    }
    if (constraint.requirementIds.length === 1
      && row.requirementId !== constraint.requirementIds[0]) {
      finding(findings, "REQUIREMENT_ID_MISMATCH", "registry and SHACL requirement IDs differ", {
        constraintKey: constraint.constraintKey,
        registryRequirementId: row.requirementId,
        shapeRequirementId: constraint.requirementIds[0],
      });
    }
  }
  for (const requirementId of duplicateValues(shapeIds)) {
    finding(findings, "DUPLICATE_SHAPE_REQUIREMENT_ID", "one requirementId is attached to more than one local SHACL constraint", {
      requirementId,
    });
  }
  const requirementByTerm = new Map(scan.constraints
    .filter((item) => item.requirementIds.length === 1 && item.requirementTermCount === 1)
    .map((item) => [termKey(item.term), item.requirementIds[0]]));
  for (const auxiliary of scan.auxiliaryConstraints) {
    const inheritedIds = sortedUnique(auxiliary.inheritedFrom
      .map((term) => requirementByTerm.get(termKey(term)))
      .filter(Boolean));
    if (inheritedIds.length !== 1) {
      finding(findings, "AUXILIARY_REQUIREMENT_AMBIGUOUS", "logical helper property does not resolve to one direct normative requirement", {
        inheritedRequirementIds: inheritedIds,
        shapeFile: auxiliary.shapeFile,
        term: termKey(auxiliary.term),
      });
      continue;
    }
    if (auxiliary.requirementTermCount === 0) continue;
    if (auxiliary.requirementTermCount !== 1 || auxiliary.requirementIds.length !== 1
      || auxiliary.requirementIds[0] !== inheritedIds[0]) {
      finding(findings, "AUXILIARY_REQUIREMENT_OVERRIDE", "logical helper property may only inherit its closest direct requirementId", {
        actualRequirementIds: auxiliary.requirementIds,
        expectedRequirementId: inheritedIds[0],
        requirementTermCount: auxiliary.requirementTermCount,
        shapeFile: auxiliary.shapeFile,
        term: termKey(auxiliary.term),
      });
    }
  }
  const scannedKeys = new Set(scan.constraints.map((item) => item.constraintKey));
  for (const row of registry.requirements) {
    if (!scannedKeys.has(row.constraintKey)) {
      finding(findings, "EXTRA_REQUIREMENT_ROW", "requirement row does not resolve to a local SHACL constraint", {
        constraintKey: row.constraintKey,
        requirementId: row.requirementId,
      });
    }
  }
}

export async function verifyRequirementTraceability({
  allowDraft = false,
  registryPath = null,
  releaseRoot = DEFAULT_RELEASE,
} = {}) {
  const scan = await scanRequirementConstraints({ releaseRoot });
  const schema = await loadSchema();
  const effectiveRegistryPath = registryPath
    ?? scan.manifest.requirementsRegistry
    ?? DEFAULT_REGISTRY;
  const registryBytes = await readReleaseFile(
    scan.releaseRoot,
    effectiveRegistryPath,
    MAX_JSON_BYTES,
  );
  const registry = parseJson(registryBytes, "profile requirement register");
  const findings = [];
  for (const error of validateSchema(schema, registry)) {
    finding(findings, "REGISTRY_SCHEMA", "requirement register violates its JSON Schema", error);
  }
  if (findings.length > 0) {
    return {
      coverageBlockers: coverageBlockers(registry),
      coverage: coverageSummary(registry),
      schemaVersion: "molit.profile-requirement-traceability-report/1",
      gatePassed: false,
      profileVersion: scan.manifest.version,
      caseRegistryStatus: null,
      registryStatus: registry?.registryStatus ?? null,
      summary: {
        auxiliaryPropertyConstraints: scan.auxiliaryConstraints.length,
        errors: findings.length,
        fixtureCases: 0,
        localShapeFiles: scan.localShapeFiles.length,
        registryRequirements: Array.isArray(registry?.requirements) ? registry.requirements.length : 0,
        trackedConstraints: scan.constraints.length,
      },
      findings,
    };
  }

  if (scan.manifest.requirementsRegistry
    && effectiveRegistryPath !== scan.manifest.requirementsRegistry) {
    finding(findings, "REQUIREMENT_REGISTRY_PATH_MISMATCH", "verification did not use the manifest requirement registry", {
      actual: effectiveRegistryPath,
      expected: scan.manifest.requirementsRegistry,
    });
  }
  if (scan.manifest.conformanceCases
    && registry.fixtureCaseRegistry !== scan.manifest.conformanceCases) {
    finding(findings, "CASE_REGISTRY_PATH_MISMATCH", "requirement register and manifest identify different case registries", {
      actual: registry.fixtureCaseRegistry,
      expected: scan.manifest.conformanceCases,
    });
  }
  try {
    const { overrides } = await loadRequirementSourceOverrides({
      profileVersion: scan.manifest.version,
      releaseRoot: scan.releaseRoot,
      requirementIds: registry.requirements.map((item) => item.requirementId),
    });
    const rows = new Map(registry.requirements.map((item) => [item.requirementId, item]));
    for (const [requirementId, expected] of overrides) {
      const row = rows.get(requirementId);
      for (const [field, value] of Object.entries(expected)) {
        if (row[field] !== value) {
          finding(findings, "SOURCE_OVERRIDE_MISMATCH", "reviewed source override and requirement row differ", {
            actual: row[field],
            expected: value,
            field,
            requirementId,
          });
        }
      }
    }
  } catch (error) {
    finding(findings, "SOURCE_OVERRIDE_INVALID", "requirement source overrides are missing, stale, or incomplete", {
      message: error.message,
      path: DEFAULT_SOURCE_OVERRIDES,
    });
  }
  try {
    const projectionBytes = await readReleaseFile(
      scan.releaseRoot,
      DEFAULT_CSV_PROJECTION,
      MAX_JSON_BYTES,
    );
    const actualProjection = decoder.decode(projectionBytes);
    const expectedProjection = requirementCsvProjection(registry);
    if (actualProjection !== expectedProjection) {
      finding(findings, "CSV_PROJECTION_MISMATCH", "CSV requirement projection is not an exact row-and-field projection of the JSON register", {
        actualSha256: digest(projectionBytes),
        expectedSha256: digest(Buffer.from(expectedProjection)),
        path: DEFAULT_CSV_PROJECTION,
      });
    }
  } catch (error) {
    finding(findings, "CSV_PROJECTION_UNREADABLE", "CSV requirement projection is missing, unsafe, oversized, or not valid UTF-8", {
      message: error.message,
      path: DEFAULT_CSV_PROJECTION,
    });
  }
  const caseRegistryBytes = await readReleaseFile(
    scan.releaseRoot,
    registry.fixtureCaseRegistry,
    MAX_JSON_BYTES,
  );
  const caseRegistry = parseJson(caseRegistryBytes, "profile conformance-case register");
  for (const error of validateSchema(schema, caseRegistry, "fixtureCaseRegistryDocument")) {
    finding(findings, "CASE_REGISTRY_SCHEMA", "conformance-case register violates its JSON Schema", error);
  }
  if (findings.some((item) => item.code === "CASE_REGISTRY_SCHEMA")) {
    return {
      coverageBlockers: coverageBlockers(registry),
      coverage: coverageSummary(registry),
      schemaVersion: "molit.profile-requirement-traceability-report/1",
      gatePassed: false,
      profileVersion: scan.manifest.version,
      caseRegistryStatus: caseRegistry?.registryStatus ?? null,
      registryStatus: registry.registryStatus,
      summary: {
        auxiliaryPropertyConstraints: scan.auxiliaryConstraints.length,
        errors: findings.length,
        fixtureCases: Array.isArray(caseRegistry?.fixtureCases) ? caseRegistry.fixtureCases.length : 0,
        localShapeFiles: scan.localShapeFiles.length,
        registryRequirements: registry.requirements.length,
        trackedConstraints: scan.constraints.length,
      },
      findings,
    };
  }

  if (registry.profileVersion !== scan.manifest.version) {
    finding(findings, "PROFILE_VERSION_MISMATCH", "register profileVersion differs from the release manifest", {
      actual: registry.profileVersion,
      expected: scan.manifest.version,
    });
  }
  if (registry.shapeNamespace !== scan.shapeNamespace) {
    finding(findings, "SHAPE_NAMESPACE_MISMATCH", "register shapeNamespace differs from the versioned local namespace", {
      actual: registry.shapeNamespace,
      expected: scan.shapeNamespace,
    });
  }
  if (!sameJson([...registry.shapeFiles].sort(), scan.localShapeFiles)) {
    finding(findings, "LOCAL_SHAPE_FILE_SET_MISMATCH", "register shapeFiles must exactly cover local SHACL source files", {
      actual: [...registry.shapeFiles].sort(),
      expected: scan.localShapeFiles,
    });
  }
  if (caseRegistry.profileVersion !== scan.manifest.version) {
    finding(findings, "CASE_PROFILE_VERSION_MISMATCH", "case-register profileVersion differs from the release manifest", {
      actual: caseRegistry.profileVersion,
      expected: scan.manifest.version,
    });
  }
  if (!allowDraft
    && (registry.registryStatus !== "approved" || caseRegistry.registryStatus !== "approved")) {
    finding(findings, "REGISTRY_NOT_APPROVED", "strict traceability Gate requires both registries to be approved", {
      caseRegistryStatus: caseRegistry.registryStatus,
      requirementRegistryStatus: registry.registryStatus,
    });
  }
  verifyConstraintRows({ findings, registry, scan });
  await verifyFixtures({ caseRegistry, findings, registry, scan });
  findings.sort((left, right) => (
    left.code.localeCompare(right.code)
      || JSON.stringify(left).localeCompare(JSON.stringify(right))
  ));
  return {
    coverageBlockers: coverageBlockers(registry),
    coverage: coverageSummary(registry),
    schemaVersion: "molit.profile-requirement-traceability-report/1",
    gatePassed: findings.length === 0,
    profileVersion: scan.manifest.version,
    caseRegistryStatus: caseRegistry.registryStatus,
    registryStatus: registry.registryStatus,
    summary: {
      auxiliaryPropertyConstraints: scan.auxiliaryConstraints.length,
      errors: findings.length,
      fixtureCases: caseRegistry.fixtureCases.length,
      localShapeFiles: scan.localShapeFiles.length,
      registryRequirements: registry.requirements.length,
      trackedConstraints: scan.constraints.length,
    },
    findings,
  };
}

function parseArguments(argv) {
  const options = {
    allowDraft: false,
    draft: false,
    draftCases: false,
    registryPath: null,
    releaseRoot: DEFAULT_RELEASE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-draft") options.allowDraft = true;
    else if (argument === "--draft") options.draft = true;
    else if (argument === "--draft-cases") options.draftCases = true;
    else if (argument === "--release" && argv[index + 1]) {
      options.releaseRoot = path.resolve(argv[++index]);
    } else if (argument === "--registry" && argv[index + 1]) {
      options.registryPath = portablePath(argv[++index], "registry path");
    } else throw new Error(`unknown or incomplete argument: ${argument}`);
  }
  if (Number(options.draft) + Number(options.draftCases) + Number(options.allowDraft) > 1) {
    throw new Error("--draft, --draft-cases and --allow-draft are mutually exclusive");
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.draft || options.draftCases) {
    const artifacts = await buildDraftRequirementArtifacts({ releaseRoot: options.releaseRoot });
    const document = options.draftCases ? artifacts.caseRegistry : artifacts.requirementsRegistry;
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    return;
  }
  const report = await verifyRequirementTraceability(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.gatePassed ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
