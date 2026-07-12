#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import SHACLValidator from "rdf-validate-shacl";
import { DataFactory, Parser, Store, Writer } from "n3";

const {
  blankNode,
  literal,
  namedNode,
  quad,
} = DataFactory;
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(root, "profiles/molit-dcat-ap/releases/1.0.0-rc.1");
const expectedInventoryRelative = "requirements/upstream-requirement-inventory.json";
const expectedCsvRelative = "requirements/upstream-profile-requirements.csv";
const evidenceDirectoryRelative = "requirements/upstream-isolated-evidence";
const evidenceDirectory = path.join(releaseRoot, ...evidenceDirectoryRelative.split("/"));
const SH = "http://www.w3.org/ns/shacl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const EVIDENCE = "https://data.molit.go.kr/.well-known/shacl/upstream-evidence/";
const LOCAL_POLICY = "https://data.molit.go.kr/shape/molit-dcat-ap/upstream-deprecation-policy/";
const RDF_TYPE = namedNode(`${RDF}type`);
const RDF_NIL = `${RDF}nil`;
const RDFS_SEE_ALSO = namedNode(`${RDFS}seeAlso`);
const SH_MESSAGE_PREDICATES = Object.freeze([
  `${SH}message`,
  "https://purl.eu/ns/shacl#message",
]);
const SH_PROPERTY = namedNode(`${SH}property`);
const SH_TARGET_NODE = namedNode(`${SH}targetNode`);
const CASE_PREDICATE = namedNode(`${EVIDENCE}case`);
const MAX_CASES_PER_SHARD = 400;
export const UPSTREAM_CSV_COLUMNS = Object.freeze([
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
  "positiveFixtureId",
  "negativeFixtureId",
]);
const targetPredicates = new Set([
  `${SH}target`,
  `${SH}targetClass`,
  `${SH}targetNode`,
  `${SH}targetObjectsOf`,
  `${SH}targetSubjectsOf`,
]);
const componentPredicates = new Map([
  [`${SH}class`, "class"],
  [`${SH}datatype`, "datatype"],
  [`${SH}hasValue`, "hasValue"],
  [`${SH}maxCount`, "maxCount"],
  [`${SH}minCount`, "minCount"],
  [`${SH}node`, "node"],
  [`${SH}nodeKind`, "nodeKind"],
]);
const sourceFiles = Object.freeze([
  Object.freeze({
    shapeFile: "shacl/upstream/dcat-ap-3.0.1/dcat-ap-SHACL.ttl",
    sourceStandard: "DCAT-AP 3.0.1",
    normativeLayer: "dcat-ap",
    supplements: ["shacl/compatibility/dcat-ap-3.0.1-closure.ttl"],
  }),
  Object.freeze({
    shapeFile: "shacl/upstream/geodcat-ap-3.1.0/geodcat-ap-SHACL.ttl",
    sourceStandard: "GeoDCAT-AP 3.1.0",
    normativeLayer: "geodcat-ap",
  }),
  Object.freeze({
    shapeFile: "shacl/upstream/dcat-ap-3.0.1/shapes_recommended.ttl",
    sourceStandard: "DCAT-AP 3.0.1 recommended constraints",
    normativeLayer: "publication-policy",
  }),
  Object.freeze({
    shapeFile: "shacl/upstream/dcat-ap-3.0.1/deprecateduris.ttl",
    sourceStandard: "DCAT-AP 3.0.1 deprecated URI policy",
    normativeLayer: "publication-policy",
  }),
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sortedUnique = (values) => [...new Set(values)].sort();
const termKey = (term) => `${term.termType}:${term.value}`;

function assert(condition, message, code = "UPSTREAM_EVIDENCE_INVALID") {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function integer(store, subject, predicate) {
  const values = store.getObjects(subject, namedNode(predicate), null);
  if (values.length !== 1 || values[0].termType !== "Literal") return null;
  const parsed = Number(values[0].value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function iriValues(store, subject, predicate) {
  return sortedUnique(store.getObjects(subject, namedNode(predicate), null)
    .filter(({ termType }) => termType === "NamedNode")
    .map(({ value }) => value));
}

function list(store, head) {
  const values = [];
  const seen = new Set();
  let cursor = head;
  while (cursor?.termType !== "NamedNode" || cursor.value !== RDF_NIL) {
    const key = termKey(cursor ?? { termType: "missing", value: "missing" });
    if (!cursor || seen.has(key)) return [];
    seen.add(key);
    const first = store.getObjects(cursor, namedNode(`${RDF}first`), null);
    const rest = store.getObjects(cursor, namedNode(`${RDF}rest`), null);
    if (first.length !== 1 || rest.length !== 1) return [];
    values.push(first[0]);
    cursor = rest[0];
  }
  return values;
}

function vocabulary(store, subject) {
  const heads = store.getObjects(subject, namedNode(`${SH}in`), null);
  return sortedUnique(heads.flatMap((head) => list(store, head))
    .filter(({ termType }) => termType === "NamedNode")
    .map(({ value }) => value));
}

function ownerEntries(store) {
  const byObject = new Map();
  for (const edge of store.getQuads(null, SH_PROPERTY, null, null)) {
    const key = termKey(edge.object);
    if (!byObject.has(key)) byObject.set(key, []);
    byObject.get(key).push(edge.subject);
  }
  return byObject;
}

function pathValue(store, subject) {
  const values = store.getObjects(subject, namedNode(`${SH}path`), null);
  return values.length === 1 && values[0].termType === "NamedNode" ? values[0].value : null;
}

function severity(store, subject, recommended) {
  const values = iriValues(store, subject, `${SH}severity`);
  if (values.includes(`${SH}Warning`) || recommended) return "Warning";
  if (values.includes(`${SH}Info`)) return "Info";
  return "Violation";
}

function constraintSubjects(store) {
  const properties = store.getQuads(null, SH_PROPERTY, null, null).map(({ object }) => object);
  return [...new Map(properties.map((term) => [termKey(term), term])).values()];
}

function sourceClauses(store, subject, owner) {
  const clauses = store.getObjects(subject, RDFS_SEE_ALSO, null)
    .filter(({ termType }) => ["Literal", "NamedNode"].includes(termType))
    .map(({ value }) => value);
  return sortedUnique(clauses.length > 0 ? clauses : [owner.value]);
}

function shapeMessages(store, subject, enforceable, components) {
  const official = [];
  for (const predicate of SH_MESSAGE_PREDICATES) {
    for (const value of store.getObjects(subject, namedNode(predicate), null)) {
      if (value.termType !== "Literal") continue;
      official.push({
        language: value.language || "und",
        text: value.value,
        source: "official-shape",
        predicate,
      });
    }
  }
  const unique = [...new Map(official.map((message) => [
    `${message.predicate}\u0000${message.language}\u0000${message.text}`,
    message,
  ])).values()].sort((left, right) => (
    left.language.localeCompare(right.language)
      || left.text.localeCompare(right.text)
      || left.predicate.localeCompare(right.predicate)
  ));
  if (unique.length > 0) return unique;
  const componentText = components.length > 0
    ? components.map((component) => `sh:${component}`).join(", ")
    : "집행 가능한 SHACL constraint component 없음";
  return [{
    language: "ko",
    text: enforceable
      ? `로컬 격리 증거: 원문 PropertyShape에는 메시지가 없으며 ${componentText} 제약을 검증한다.`
      : "로컬 격리 증거: 원문 deprecated URI row에는 메시지와 경로만 있고 집행 가능한 SHACL constraint component가 없다.",
    source: "local-evidence",
    predicate: null,
  }];
}

function remediationFor(store, subject, property, components, enforceable, messages) {
  const propertyText = property ? `<${property}>` : "해당 property path";
  if (!enforceable) {
    const official = messages.filter(({ source }) => source === "official-shape")
      .map(({ text }) => text)
      .join(" / ");
    return `MOLIT 로컬 적용 가이드(upstream 원문 외): ${propertyText} triple을 제거하고 공식 메시지가 지시한 대체 property로 값을 옮긴다${official ? ` (공식 메시지: ${official})` : ""}. 이 절차의 sh:maxCount 0 규칙은 로컬 publication-policy 운영화다.`;
  }
  const steps = [];
  for (const component of components) {
    if (component === "class") {
      const expected = oneObject(store, subject, "class");
      steps.push(`${propertyText}의 모든 값에 rdf:type <${expected.value}>를 명시한다`);
    } else if (component === "datatype") {
      const expected = oneObject(store, subject, "datatype");
      steps.push(`${propertyText} 값을 <${expected.value}> datatype의 유효한 lexical literal로 직렬화한다`);
    } else if (component === "hasValue") {
      const expected = oneObject(store, subject, "hasValue");
      steps.push(`${propertyText} 값에 정확히 <${expected.value}>를 포함한다`);
    } else if (component === "maxCount") {
      steps.push(`${propertyText} 값을 ${integer(store, subject, `${SH}maxCount`)}개 이하로 줄인다`);
    } else if (component === "minCount") {
      steps.push(`${propertyText} 값을 ${integer(store, subject, `${SH}minCount`)}개 이상 제공한다`);
    } else if (component === "node") {
      const expected = oneObject(store, subject, "node");
      steps.push(`${propertyText}의 각 값이 <${expected.value}> NodeShape를 통과하도록 하위 속성을 보완한다`);
    } else if (component === "nodeKind") {
      const expected = oneObject(store, subject, "nodeKind");
      steps.push(`${propertyText} 값을 <${expected.value}> node kind로 바꾼다`);
    }
  }
  assert(steps.length > 0, `enforceable constraint has no remediation step: ${termKey(subject)}`);
  return `MOLIT 로컬 적용 가이드(upstream 원문 보충 설명): ${steps.join("; ")}. 원문 constraint 값은 변경하지 않는다.`;
}

function rationaleFor(definition, enforceable, evidenceMethod, components) {
  if (!enforceable) {
    return `${definition.sourceStandard} 원문 row에는 SHACL constraint component가 없어 자체 위반을 만들 수 없다. deprecated property 사용을 시험하기 위해 로컬 sh:maxCount 0 policy wrapper로 운영화하며, upstream 원문 제약 984건에는 포함하지 않는다.`;
  }
  const copy = evidenceMethod === "deterministic-skolem-overlay"
    ? "blank PropertyShape의 원문 direct quad를 deterministic named shape로 동일 복제했다"
    : "named PropertyShape의 원문 direct quad를 그대로 채택했다";
  return `${definition.sourceStandard}의 ${components.map((component) => `sh:${component}`).join(", ")} 제약을 변경 없이 채택한다. ${copy}. 추가한 sh:targetNode는 격리 시험용이며 규범 의미를 바꾸지 않는다.`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvArray(value) {
  return JSON.stringify(value ?? []);
}

export function upstreamRequirementCsvProjection(requirements) {
  const rows = requirements.map((item) => ({
    requirementId: item.requirementId,
    conformanceClass: csvArray(item.conformanceClass),
    resourceClass: csvArray(item.resourceClass),
    property: item.property,
    obligation: item.obligation,
    minCount: item.minCount,
    maxCount: item.maxCount,
    range: csvArray(item.range),
    controlledVocabulary: csvArray(item.controlledVocabulary),
    severity: item.severity,
    messages: csvArray(item.messages),
    remediation: item.remediation,
    sourceStandard: item.sourceStandard,
    sourceClause: csvArray(item.sourceClause),
    localRationale: item.localRationale,
    shapeId: item.shapeId,
    positiveFixtureId: item.positiveFixtureId,
    negativeFixtureId: item.negativeFixtureId,
  }));
  return `${[
    UPSTREAM_CSV_COLUMNS.join(","),
    ...rows.map((row) => UPSTREAM_CSV_COLUMNS.map((column) => csvCell(row[column])).join(",")),
  ].join("\n")}\n`;
}

function requirementId(constraintKey, layer) {
  const prefix = layer === "dcat-ap" ? "DCATAP"
    : layer === "geodcat-ap" ? "GEODCATAP" : "PUBPOL";
  return `UPSTREAM-${prefix}-${sha256(Buffer.from(constraintKey)).slice(0, 20).toUpperCase()}`;
}

function canonicalTerm(term) {
  if (term.termType === "NamedNode") return `<${term.value}>`;
  if (term.termType === "BlankNode") return "_:blank";
  if (term.termType === "Literal") {
    const lexical = JSON.stringify(term.value);
    if (term.language) return `${lexical}@${term.language.toLowerCase()}`;
    return `${lexical}^^<${term.datatype.value}>`;
  }
  throw new Error(`unsupported RDF term in upstream evidence: ${term.termType}`);
}

function directQuadSignature(quads) {
  return quads.map(({ predicate, object }) => `${canonicalTerm(predicate)} ${canonicalTerm(object)}`)
    .sort()
    .join("\n");
}

function constraintComponents(store, subject) {
  return sortedUnique(store.getQuads(subject, null, null, null)
    .map(({ predicate }) => componentPredicates.get(predicate.value))
    .filter(Boolean));
}

function supportedSignature(definition, components) {
  const signature = components.join("+");
  if (["class", "datatype", "maxCount", "minCount", "nodeKind"].includes(signature)) return true;
  if (definition.shapeFile.endsWith("deprecateduris.ttl")) {
    return signature === "class+hasValue+minCount+nodeKind" || signature === "node+nodeKind";
  }
  return false;
}

async function scanSource(definition, manifest) {
  const absolute = path.join(releaseRoot, ...definition.shapeFile.split("/"));
  const bytes = await readFile(absolute);
  const store = new Store(new Parser({
    baseIRI: `https://data.molit.go.kr/.well-known/upstream/${encodeURIComponent(definition.shapeFile)}`,
  }).parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const supplementalFiles = [];
  for (const relative of definition.supplements ?? []) {
    const supplementalBytes = await readFile(path.join(releaseRoot, ...relative.split("/")));
    store.addQuads(new Parser({
      baseIRI: `https://data.molit.go.kr/.well-known/upstream/${encodeURIComponent(relative)}`,
    }).parse(new TextDecoder("utf-8", { fatal: true }).decode(supplementalBytes)));
    supplementalFiles.push({ path: relative, sha256: sha256(supplementalBytes) });
  }
  const ownersByObject = ownerEntries(store);
  const recommended = definition.shapeFile.endsWith("shapes_recommended.ttl");
  const requirements = [];
  for (const [ordinal, subject] of constraintSubjects(store).entries()) {
    const owners = ownersByObject.get(termKey(subject)) ?? [];
    const owner = owners.find(({ termType }) => termType === "NamedNode");
    if (!owner) continue;
    const locator = subject.termType === "NamedNode"
      ? subject.value
      : `${owner.value}/blank-property-${String(ordinal + 1).padStart(4, "0")}`;
    const constraintKey = `${definition.shapeFile}#${locator}`;
    const id = requirementId(constraintKey, definition.normativeLayer);
    const level = severity(store, subject, recommended);
    const classes = sortedUnique(owners.flatMap((item) => iriValues(store, item, `${SH}targetClass`)));
    const sourceQuads = store.getQuads(subject, null, null, null);
    assert(sourceQuads.length > 0, `upstream property shape has no definition after closure: ${constraintKey}`);
    assert(sourceQuads.every(({ graph }) => graph.termType === "DefaultGraph"), `named graph found in ${constraintKey}`);
    assert(sourceQuads.every(({ predicate }) => !targetPredicates.has(predicate.value)), `upstream atomic shape already has a target: ${constraintKey}`);
    const components = constraintComponents(store, subject);
    const enforceable = components.length > 0;
    const property = pathValue(store, subject);
    if (enforceable) {
      assert(supportedSignature(definition, components), `unsupported upstream constraint signature ${components.join("+")}: ${constraintKey}`);
    } else {
      assert(
        definition.shapeFile.endsWith("deprecateduris.ttl"),
        `non-enforceable property row is not a deprecated URI policy: ${constraintKey}`,
      );
    }
    const evidenceShapeId = enforceable
      ? subject.termType === "NamedNode" ? subject.value : `${EVIDENCE}shape/${id}`
      : `${LOCAL_POLICY}${id}`;
    const evidenceMethod = !enforceable
      ? "deprecation-policy-wrapper"
      : subject.termType === "BlankNode" ? "deterministic-skolem-overlay" : "exact-target-overlay";
    const messages = shapeMessages(store, subject, enforceable, components);
    const remediation = remediationFor(store, subject, property, components, enforceable, messages);
    const localRationale = rationaleFor(definition, enforceable, evidenceMethod, components);
    const focusNode = `${EVIDENCE}focus/${id}`;
    const caseId = `UPSTREAM-ISO-${id}`;
    requirements.push({
      public: {
        requirementId: id,
        constraintKey,
        normativeLayer: definition.normativeLayer,
        sourceStandard: definition.sourceStandard,
        sourceClause: sourceClauses(store, subject, owner),
        conformanceClass: Object.entries(manifest.profiles)
          .filter(([, profile]) => profile.kind !== "diagnostic"
            && profile.shapes.includes(definition.shapeFile))
          .map(([name]) => name)
          .sort(),
        resourceClass: classes,
        property,
        obligation: level === "Warning" || level === "Info" ? "SHOULD" : "MUST",
        minCount: integer(store, subject, `${SH}minCount`),
        maxCount: integer(store, subject, `${SH}maxCount`),
        range: sortedUnique([
          ...iriValues(store, subject, `${SH}class`),
          ...iriValues(store, subject, `${SH}datatype`),
          ...iriValues(store, subject, `${SH}nodeKind`),
        ]),
        controlledVocabulary: vocabulary(store, subject),
        severity: level,
        messages,
        remediation,
        localRationale,
        shapeId: subject.termType === "NamedNode" ? subject.value : owner.value,
        shapeFile: definition.shapeFile,
        constraintComponents: components,
        sourceConstraintEnforceable: enforceable,
        sourceShapeBlankNode: subject.termType === "BlankNode",
        sourceShapeLocator: locator,
        sourceShapeSha256: sha256(Buffer.from(directQuadSignature(sourceQuads))),
        sourceQuadCount: sourceQuads.length,
        evidenceMethod,
        evidenceShapeId,
        sourceQuadCopy: enforceable ? "exact" : "source-subset-plus-local-policy",
        operationalizedBy: enforceable ? null : evidenceShapeId,
        caseId,
        focusNode,
        shardId: null,
        expectedNegativeSourceShape: evidenceShapeId,
        positiveFixtureId: `UPSTREAM-POS-${id}`,
        negativeFixtureId: `UPSTREAM-NEG-${id}`,
        coverageStatus: "isolated",
      },
      definition,
      store,
      subject,
      owner,
      sourceQuads,
    });
  }
  return {
    constraintSet: {
      shapeFile: definition.shapeFile,
      sourceStandard: definition.sourceStandard,
      normativeLayer: definition.normativeLayer,
      sha256: sha256(bytes),
      supplementalFiles,
    },
    requirements,
  };
}

function oneObject(store, subject, predicate) {
  const values = store.getObjects(subject, namedNode(`${SH}${predicate}`), null);
  assert(values.length === 1, `constraint ${predicate} is not singular for ${termKey(subject)}`);
  return values[0];
}

function evidenceValue(id, suffix = "value") {
  return namedNode(`${EVIDENCE}${suffix}/${id}`);
}

function addMarker(store, item) {
  store.addQuad(namedNode(item.public.focusNode), CASE_PREDICATE, namedNode(`${EVIDENCE}case/${item.public.requirementId}`));
}

function datatypeLiteral(datatype) {
  const lexical = new Map([
    [`${XSD}decimal`, "1.0"],
    [`${XSD}duration`, "P1D"],
    [`${XSD}hexBinary`, "0A"],
    [`${XSD}nonNegativeInteger`, "1"],
  ]).get(datatype.value);
  assert(lexical, `no positive lexical form for datatype ${datatype.value}`);
  return literal(lexical, datatype);
}

function addPositiveForConstraint(item, focus, store, suffix = "value") {
  const { components } = { components: item.public.constraintComponents };
  const property = oneObject(item.store, item.subject, "path");
  assert(property.termType === "NamedNode", `complex upstream path is unsupported: ${item.public.constraintKey}`);
  const unique = evidenceValue(item.public.requirementId, suffix);
  if (components.length === 0) return;
  if (components.includes("node")) {
    store.addQuad(focus, property, unique);
    const nodeShape = oneObject(item.store, item.subject, "node");
    const properties = item.store.getObjects(nodeShape, SH_PROPERTY, null);
    assert(properties.length > 0, `referenced node shape has no property constraints: ${nodeShape.value}`);
    for (const propertyShape of properties) {
      const nested = item.sourceRowsByTerm.get(termKey(propertyShape));
      assert(nested, `referenced property shape is absent from the inventory: ${termKey(propertyShape)}`);
      addPositiveForConstraint(nested, unique, store, `${suffix}-nested`);
    }
    return;
  }
  if (components.includes("hasValue")) {
    const required = oneObject(item.store, item.subject, "hasValue");
    store.addQuad(focus, property, required);
    if (components.includes("class")) {
      store.addQuad(required, RDF_TYPE, oneObject(item.store, item.subject, "class"));
    }
    return;
  }
  if (components.includes("minCount")) {
    store.addQuad(focus, property, unique);
    return;
  }
  if (components.includes("maxCount")) {
    const maximum = integer(item.store, item.subject, `${SH}maxCount`);
    for (let index = 0; index < maximum; index += 1) {
      store.addQuad(focus, property, evidenceValue(item.public.requirementId, `${suffix}-${index + 1}`));
    }
    return;
  }
  if (components.includes("class")) {
    store.addQuad(focus, property, unique);
    store.addQuad(unique, RDF_TYPE, oneObject(item.store, item.subject, "class"));
    return;
  }
  if (components.includes("datatype")) {
    store.addQuad(focus, property, datatypeLiteral(oneObject(item.store, item.subject, "datatype")));
    return;
  }
  if (components.includes("nodeKind")) {
    const kind = oneObject(item.store, item.subject, "nodeKind").value;
    if (kind === `${SH}Literal`) store.addQuad(focus, property, literal(`value-${item.public.requirementId}`));
    else if ([`${SH}BlankNodeOrIRI`, `${SH}IRI`].includes(kind)) store.addQuad(focus, property, unique);
    else if (kind === `${SH}BlankNode`) store.addQuad(focus, property, blankNode(`positive-${item.public.requirementId}`));
    else if (kind === `${SH}IRIOrLiteral`) store.addQuad(focus, property, unique);
    else throw new Error(`unsupported sh:nodeKind ${kind}`);
    return;
  }
  throw new Error(`positive evidence is not implemented for ${item.public.constraintKey}`);
}

function addNegativeForConstraint(item, focus, store) {
  const components = item.public.constraintComponents;
  const property = oneObject(item.store, item.subject, "path");
  assert(property.termType === "NamedNode", `complex upstream path is unsupported: ${item.public.constraintKey}`);
  const wrong = evidenceValue(item.public.requirementId, "wrong-value");
  if (!item.public.sourceConstraintEnforceable) {
    store.addQuad(focus, property, wrong);
    return;
  }
  if (components.includes("node")) {
    store.addQuad(focus, property, wrong);
    return;
  }
  if (components.includes("hasValue")) {
    store.addQuad(focus, property, wrong);
    if (components.includes("class")) {
      store.addQuad(wrong, RDF_TYPE, oneObject(item.store, item.subject, "class"));
    }
    return;
  }
  if (components.includes("minCount")) return;
  if (components.includes("maxCount")) {
    const maximum = integer(item.store, item.subject, `${SH}maxCount`);
    for (let index = 0; index <= maximum; index += 1) {
      store.addQuad(focus, property, evidenceValue(item.public.requirementId, `too-many-${index + 1}`));
    }
    return;
  }
  if (components.includes("class")) {
    store.addQuad(focus, property, wrong);
    store.addQuad(wrong, RDF_TYPE, evidenceValue(item.public.requirementId, "wrong-class"));
    return;
  }
  if (components.includes("datatype")) {
    store.addQuad(focus, property, literal("not-the-required-datatype"));
    return;
  }
  if (components.includes("nodeKind")) {
    const kind = oneObject(item.store, item.subject, "nodeKind").value;
    if (kind === `${SH}Literal`) store.addQuad(focus, property, wrong);
    else if ([`${SH}BlankNodeOrIRI`, `${SH}IRI`, `${SH}BlankNode`].includes(kind)) {
      store.addQuad(focus, property, literal("wrong-node-kind"));
    } else if (kind === `${SH}IRIOrLiteral`) {
      store.addQuad(focus, property, blankNode(`negative-${item.public.requirementId}`));
    } else throw new Error(`unsupported sh:nodeKind ${kind}`);
    return;
  }
  throw new Error(`negative evidence is not implemented for ${item.public.constraintKey}`);
}

function mappedObject(item, object) {
  if (object.termType !== "BlankNode") return object;
  const mapped = item.sourceRowsByTerm.get(termKey(object));
  assert(mapped, `unmapped blank object in evidence shape: ${termKey(object)}`);
  return namedNode(mapped.public.evidenceShapeId);
}

function addEvidenceShape(store, item) {
  const evidenceShape = namedNode(item.public.evidenceShapeId);
  for (const source of item.sourceQuads) {
    store.addQuad(evidenceShape, source.predicate, mappedObject(item, source.object));
  }
  if (!item.public.sourceConstraintEnforceable) {
    store.addQuad(evidenceShape, namedNode(`${SH}maxCount`), literal("0", namedNode(`${XSD}integer`)));
  }
  store.addQuad(evidenceShape, SH_TARGET_NODE, namedNode(item.public.focusNode));
  const copied = store.getQuads(evidenceShape, null, null, null)
    .filter(({ predicate }) => predicate.value !== SH_TARGET_NODE.value
      && !(item.public.evidenceMethod === "deprecation-policy-wrapper" && predicate.value === `${SH}maxCount`));
  assert(
    directQuadSignature(copied) === directQuadSignature(item.sourceQuads),
    `source quad copy differs for ${item.public.requirementId}`,
  );
}

function addReferencedNodeShapes(store, items) {
  const seen = new Set();
  for (const item of items) {
    for (const nodeShape of item.store.getObjects(item.subject, namedNode(`${SH}node`), null)) {
      assert(nodeShape.termType === "NamedNode", `blank sh:node is unsupported: ${item.public.constraintKey}`);
      if (seen.has(nodeShape.value)) continue;
      seen.add(nodeShape.value);
      const quads = item.store.getQuads(nodeShape, null, null, null);
      assert(quads.length > 0, `referenced node shape is undefined: ${nodeShape.value}`);
      for (const source of quads) {
        if (targetPredicates.has(source.predicate.value)) continue;
        store.addQuad(nodeShape, source.predicate, mappedObject(item, source.object));
      }
    }
  }
}

function evidenceNode(term) {
  return term.termType === "BlankNode"
    || (term.termType === "NamedNode" && term.value.startsWith(EVIDENCE));
}

function assertDisconnectedFocusComponents(store, items, label) {
  const adjacency = new Map();
  const connect = (left, right) => {
    const leftKey = termKey(left);
    const rightKey = termKey(right);
    if (!adjacency.has(leftKey)) adjacency.set(leftKey, new Set());
    if (!adjacency.has(rightKey)) adjacency.set(rightKey, new Set());
    adjacency.get(leftKey).add(rightKey);
    adjacency.get(rightKey).add(leftKey);
  };
  for (const edge of store.getQuads(null, null, null, null)) {
    if (evidenceNode(edge.subject) && evidenceNode(edge.object)) connect(edge.subject, edge.object);
    else if (evidenceNode(edge.subject) && !adjacency.has(termKey(edge.subject))) {
      adjacency.set(termKey(edge.subject), new Set());
    }
  }
  const focusKeys = new Set(items.map(({ public: row }) => termKey(namedNode(row.focusNode))));
  const visited = new Set();
  for (const focusKey of focusKeys) {
    assert(adjacency.has(focusKey), `${label} omits focus node ${focusKey}`);
    if (visited.has(focusKey)) continue;
    const component = [];
    const pending = [focusKey];
    while (pending.length > 0) {
      const current = pending.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      for (const next of adjacency.get(current) ?? []) pending.push(next);
    }
    const componentFocus = component.filter((key) => focusKeys.has(key));
    assert(componentFocus.length === 1, `${label} joins multiple generated focus components: ${componentFocus.join(", ")}`);
  }
}

function assertTargetTopology(shapeStore, items) {
  const expectedFocus = new Set(items.map(({ public: row }) => row.focusNode));
  const targets = shapeStore.getQuads(null, SH_TARGET_NODE, null, null);
  assert(targets.length === items.length, "target overlay cardinality differs from shard cases");
  for (const item of items) {
    const focus = namedNode(item.public.focusNode);
    const incoming = shapeStore.getQuads(null, SH_TARGET_NODE, focus, null);
    assert(incoming.length === 1, `focus node is not targeted exactly once: ${item.public.focusNode}`);
    assert(incoming[0].subject.value === item.public.evidenceShapeId, `focus target shape differs: ${item.public.requirementId}`);
  }
  assert(targets.every(({ object }) => object.termType === "NamedNode" && expectedFocus.has(object.value)), "target overlay has an unknown focus");
}

async function writeNTriples(store) {
  const writer = new Writer({ format: "N-Triples" });
  const quads = store.getQuads(null, null, null, null).sort((left, right) => {
    const leftKey = `${canonicalTerm(left.subject)} ${canonicalTerm(left.predicate)} ${canonicalTerm(left.object)}`;
    const rightKey = `${canonicalTerm(right.subject)} ${canonicalTerm(right.predicate)} ${canonicalTerm(right.object)}`;
    return leftKey.localeCompare(rightKey);
  });
  writer.addQuads(quads);
  return new Promise((resolve, reject) => writer.end((error, result) => {
    if (error) reject(error);
    else resolve(result);
  }));
}

async function validateShard(shapeStore, positiveStore, negativeStore, items) {
  const validator = new SHACLValidator(shapeStore);
  const [positive, negative] = await Promise.all([
    validator.validate(positiveStore),
    validator.validate(negativeStore),
  ]);
  assert(positive.conforms && positive.results.length === 0, "upstream isolated positive shard does not conform");
  assert(!negative.conforms, "upstream isolated negative shard unexpectedly conforms");
  assert(negative.results.length === items.length, `negative result count differs: ${negative.results.length} != ${items.length}`);
  const byFocus = new Map();
  for (const result of negative.results) {
    assert(result.focusNode?.termType === "NamedNode", "negative result has no named focus node");
    if (!byFocus.has(result.focusNode.value)) byFocus.set(result.focusNode.value, []);
    byFocus.get(result.focusNode.value).push(result);
  }
  for (const item of items) {
    const results = byFocus.get(item.public.focusNode) ?? [];
    assert(results.length === 1, `negative case does not have one top-level result: ${item.public.requirementId}`);
    assert(
      results[0].sourceShape?.termType === "NamedNode"
        && results[0].sourceShape.value === item.public.expectedNegativeSourceShape,
      `negative sourceShape differs for ${item.public.requirementId}`,
    );
  }
  assert(byFocus.size === items.length, "negative report contains an unknown focus node");
  return { positiveResults: 0, negativeResults: negative.results.length, matchedNegativeCases: items.length };
}

function artifactRecord(relative, bytes) {
  return { path: relative, sha256: sha256(Buffer.from(bytes)), mediaType: "text/turtle" };
}

function shardRows(items) {
  const shards = [];
  for (let offset = 0; offset < items.length; offset += MAX_CASES_PER_SHARD) {
    const number = shards.length + 1;
    const shardId = `upstream-isolated-${String(number).padStart(3, "0")}`;
    const rows = items.slice(offset, offset + MAX_CASES_PER_SHARD);
    for (const item of rows) item.public.shardId = shardId;
    shards.push({ shardId, rows });
  }
  return shards;
}

export async function buildUpstreamRequirementEvidence() {
  const manifest = JSON.parse(await readFile(path.join(releaseRoot, "manifest.json"), "utf8"));
  assert(
    manifest.upstreamRequirementsRegistry === expectedInventoryRelative,
    `manifest upstreamRequirementsRegistry must equal ${expectedInventoryRelative}`,
    "UPSTREAM_REGISTRY_POINTER_INVALID",
  );
  assert(
    manifest.upstreamRequirementsCsv === expectedCsvRelative,
    `manifest upstreamRequirementsCsv must equal ${expectedCsvRelative}`,
    "UPSTREAM_CSV_POINTER_INVALID",
  );
  const scanned = [];
  for (const definition of sourceFiles) scanned.push(await scanSource(definition, manifest));
  const internal = scanned.flatMap(({ requirements }) => requirements)
    .sort((left, right) => left.public.requirementId.localeCompare(right.public.requirementId));
  const ids = new Set(internal.map(({ public: { requirementId: id } }) => id));
  assert(ids.size === internal.length, "upstream requirement IDs are not unique");
  assert(internal.length === 990, `pinned upstream requirement count differs: ${internal.length}`);
  for (const group of scanned) {
    const rowsByTerm = new Map(group.requirements.map((item) => [termKey(item.subject), item]));
    for (const item of group.requirements) item.sourceRowsByTerm = rowsByTerm;
  }

  const artifacts = new Map();
  const evidenceShards = [];
  let positiveResults = 0;
  let negativeResults = 0;
  let matchedNegativeCases = 0;
  for (const { shardId, rows } of shardRows(internal)) {
    const shapes = new Store();
    const positive = new Store();
    const negative = new Store();
    for (const item of rows) {
      addEvidenceShape(shapes, item);
      addMarker(positive, item);
      addMarker(negative, item);
      const focus = namedNode(item.public.focusNode);
      addPositiveForConstraint(item, focus, positive);
      addNegativeForConstraint(item, focus, negative);
    }
    addReferencedNodeShapes(shapes, rows);
    assertTargetTopology(shapes, rows);
    assertDisconnectedFocusComponents(positive, rows, `${shardId} positive`);
    assertDisconnectedFocusComponents(negative, rows, `${shardId} negative`);
    const validation = await validateShard(shapes, positive, negative, rows);
    positiveResults += validation.positiveResults;
    negativeResults += validation.negativeResults;
    matchedNegativeCases += validation.matchedNegativeCases;
    const shapeRelative = `${evidenceDirectoryRelative}/${shardId}-shapes.ttl`;
    const positiveRelative = `${evidenceDirectoryRelative}/${shardId}-positive.ttl`;
    const negativeRelative = `${evidenceDirectoryRelative}/${shardId}-negative.ttl`;
    const [shapeBytes, positiveBytes, negativeBytes] = await Promise.all([
      writeNTriples(shapes), writeNTriples(positive), writeNTriples(negative),
    ]);
    artifacts.set(shapeRelative, shapeBytes);
    artifacts.set(positiveRelative, positiveBytes);
    artifacts.set(negativeRelative, negativeBytes);
    evidenceShards.push({
      shardId,
      cases: rows.length,
      shapes: artifactRecord(shapeRelative, shapeBytes),
      positive: artifactRecord(positiveRelative, positiveBytes),
      negative: artifactRecord(negativeRelative, negativeBytes),
    });
  }

  const requirements = internal.map(({ public: row }) => row);
  const sourceConstraints = requirements.filter(({ sourceConstraintEnforceable }) => sourceConstraintEnforceable).length;
  const localOperationalizations = requirements.length - sourceConstraints;
  const sourceBlankPropertyShapes = requirements.filter(({ sourceShapeBlankNode }) => sourceShapeBlankNode).length;
  const quadEquivalentSkolemCopies = requirements.filter(
    ({ evidenceMethod }) => evidenceMethod === "deterministic-skolem-overlay",
  ).length;
  assert(sourceConstraints === 984 && localOperationalizations === 6, "upstream enforceability partition differs");
  assert(sourceBlankPropertyShapes === 44 && quadEquivalentSkolemCopies === 38, "blank shape partition differs");
  assert(positiveResults === 0 && negativeResults === requirements.length && matchedNegativeCases === requirements.length, "Node isolated validation did not close coverage");
  const csvBytes = upstreamRequirementCsvProjection(requirements);
  const inventory = {
    schemaVersion: "molit.upstream-requirement-inventory/1",
    profileVersion: manifest.version,
    status: "isolated-evidence-complete",
    constraintSets: scanned.map(({ constraintSet }) => constraintSet),
    csvProjection: {
      path: expectedCsvRelative,
      sha256: sha256(Buffer.from(csvBytes)),
      columns: [...UPSTREAM_CSV_COLUMNS],
    },
    evidence: {
      isolationModel: "deterministic-shards-with-one-target-per-generated-focus",
      engine: { name: "rdf-validate-shacl", version: "0.6.5" },
      maxCasesPerShard: MAX_CASES_PER_SHARD,
      shards: evidenceShards,
      validation: { positiveResults, negativeResults, matchedNegativeCases },
      topology: {
        generatedFocusComponentsDisconnected: true,
        externalVocabularyIrisAreComponentBoundaries: true,
        onePropertyShapeTargetPerFocus: true,
      },
      blankPropertyShapes: {
        sourceBlankPropertyShapes,
        quadEquivalentSkolemCopies,
        sourceSubsetPolicyWrappers: requirements.filter(
          ({ evidenceMethod }) => evidenceMethod === "deprecation-policy-wrapper",
        ).length,
      },
    },
    requirements,
    coverage: {
      requirements: requirements.length,
      upstreamSourceConstraints: sourceConstraints,
      localOperationalizations,
      isolatedPositive: requirements.length,
      isolatedNegative: requirements.length,
      publicationPolicyTestCoverage: requirements.length,
      blockers: 0,
    },
  };
  return { artifacts, csvBytes, inventory };
}

export async function buildUpstreamRequirementInventory() {
  return (await buildUpstreamRequirementEvidence()).inventory;
}

const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  const write = arguments_.includes("--write");
  if (arguments_.some((argument) => argument !== "--write")) {
    process.stderr.write(`unknown argument: ${arguments_.find((argument) => argument !== "--write")}\n`);
    process.exitCode = 1;
  } else {
    buildUpstreamRequirementEvidence().then(async ({ artifacts, csvBytes, inventory }) => {
      const bytes = encode(inventory);
      if (write) {
        await mkdir(evidenceDirectory, { recursive: true });
        for (const [relative, artifactBytes] of artifacts) {
          await writeFile(path.join(releaseRoot, ...relative.split("/")), artifactBytes, "utf8");
        }
        await writeFile(path.join(releaseRoot, expectedCsvRelative), csvBytes, "utf8");
        await writeFile(path.join(releaseRoot, expectedInventoryRelative), bytes, "utf8");
      }
      process.stdout.write(write
        ? `${JSON.stringify({
          blockers: inventory.coverage.blockers,
          requirements: inventory.coverage.requirements,
          upstreamSourceConstraints: inventory.coverage.upstreamSourceConstraints,
          localOperationalizations: inventory.coverage.localOperationalizations,
          csvSha256: inventory.csvProjection.sha256,
          shards: inventory.evidence.shards.length,
          sha256: sha256(Buffer.from(bytes)),
          written: true,
        }, null, 2)}\n`
        : bytes);
    }).catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
  }
}
