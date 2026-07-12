#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import SHACLValidator from "rdf-validate-shacl";
import { DataFactory, Parser, Store, Writer } from "n3";
import {
  buildDraftRequirementRegistry,
  loadRequirementSourceOverrides,
  requirementCsvProjection,
  scanRequirementConstraints,
} from "./verify-requirement-traceability.mjs";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const DEFAULT_RELEASE = path.join(
  PROJECT_ROOT,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "1.0.0-rc.1",
);
const { literal, namedNode, quad } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const RDF_FIRST = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#first");
const RDF_REST = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#rest");
const RDF_NIL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const SH = "http://www.w3.org/ns/shacl#";
const SHAPE_OWNERSHIP_PREDICATES = new Set([
  `${SH}and`,
  `${SH}node`,
  `${SH}not`,
  `${SH}or`,
  `${SH}property`,
  `${SH}qualifiedValueShape`,
  `${SH}xone`,
  RDF_FIRST.value,
  RDF_REST.value,
]);
const REQUIREMENT_ID = namedNode(
  "https://data.molit.go.kr/def/molit-dcat-ap#requirementId",
);

const POSITIVE_CASES = Object.freeze([
  ["core", "core-catalog.ttl"],
  ["core", "sector-and-service-catalog.ttl"],
  ["core", "traffic-observation-catalog.ttl"],
  ["geo", "geo-catalog.ttl"],
  ["geo", "road-network-catalog.ttl"],
  ["network", "network-catalog.ttl"],
  ["observation", "observation-catalog.ttl"],
  ["quality", "quality-catalog.ttl"],
  ["dataspace-offering", "dataspace-offering-catalog.ttl"],
  ["publication-policy", "publication-offering-qualification.ttl"],
  ["publication-policy", "geo-catalog.ttl"],
  ["publication-policy", "road-network-catalog.ttl"],
]);

const CURATED_NEGATIVE_CASES = Object.freeze([
  ["core", "catalog-record-dataset-mismatch.ttl"],
  ["core", "literal-access-rights.ttl"],
  ["core", "missing-korean-title.ttl"],
  ["core", "rogue-theme.ttl"],
  ["core", "unapproved-frequency.ttl"],
  ["core", "unapproved-iana-media-type.ttl"],
  ["geo", "unapproved-geometry-crs.ttl"],
  ["geo", "withheld-spatial-geometry.ttl"],
  ["geo", "wkt-without-crs.ttl"],
  ["network", "network-reference-without-version.ttl"],
  ["network", "network-snapshot-without-checksum.ttl"],
  ["observation", "observation-unit-mismatch.ttl"],
  ["quality", "quality-measurement-dataset-mismatch.ttl"],
  ["quality", "quality-unit-not-qudt.ttl"],
  ["quality", "spoofed-controlled-concept.ttl"],
  ["dataspace-offering", "offering-operational-claim.ttl"],
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function slug(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function cloneStore(store) {
  return new Store(store.getQuads(null, null, null, null));
}

function parseStore(source) {
  return new Store(new Parser().parse(source));
}

function mergeStores(...stores) {
  const merged = new Store();
  for (const store of stores) merged.addQuads(store.getQuads(null, null, null, null));
  return merged;
}

function readList(store, head, seen = new Set()) {
  if (head.termType === "NamedNode" && head.value === RDF_NIL) return [];
  const key = `${head.termType}:${head.value}`;
  if (head.termType !== "BlankNode" || seen.has(key)) return null;
  seen.add(key);
  const first = store.getObjects(head, RDF_FIRST, null);
  const rest = store.getObjects(head, RDF_REST, null);
  if (first.length !== 1 || rest.length !== 1) return null;
  const tail = readList(store, rest[0], seen);
  return tail === null ? null : [first[0], ...tail];
}

function pathDefinition(shapeStore, constraint) {
  const paths = shapeStore.getObjects(constraint.term, namedNode(`${SH}path`), null);
  if (paths.length !== 1) return null;
  const pathTerm = paths[0];
  if (pathTerm.termType === "NamedNode") {
    return { kind: "simple", predicates: [pathTerm] };
  }
  const inverse = shapeStore.getObjects(pathTerm, namedNode(`${SH}inversePath`), null);
  if (inverse.length === 1 && inverse[0].termType === "NamedNode") {
    return { kind: "inverse", predicates: inverse };
  }
  const sequence = readList(shapeStore, pathTerm);
  if (sequence?.length && sequence.every((term) => term.termType === "NamedNode")) {
    return { kind: "sequence", predicates: sequence };
  }
  return null;
}

function terminalEdges(store, focus, definition) {
  if (definition.kind === "simple") {
    return store.getQuads(focus, definition.predicates[0], null, null).map((edge) => ({
      edge,
      value: edge.object,
    }));
  }
  if (definition.kind === "inverse") {
    return store.getQuads(null, definition.predicates[0], focus, null).map((edge) => ({
      edge,
      value: edge.subject,
    }));
  }
  let frontier = [{ term: focus }];
  for (let index = 0; index < definition.predicates.length; index += 1) {
    const predicate = definition.predicates[index];
    const last = index === definition.predicates.length - 1;
    const next = [];
    for (const current of frontier) {
      for (const edge of store.getQuads(current.term, predicate, null, null)) {
        next.push(last ? { edge, term: edge.object, value: edge.object } : { term: edge.object });
      }
    }
    frontier = next;
  }
  return frontier.filter((item) => item.edge);
}

function focusNodes(candidate, shapeStore, shapeId) {
  const shape = namedNode(shapeId);
  const values = [];
  for (const targetClass of shapeStore.getObjects(shape, namedNode(`${SH}targetClass`), null)) {
    values.push(...candidate.getSubjects(RDF_TYPE, targetClass, null));
  }
  for (const target of shapeStore.getObjects(shape, namedNode(`${SH}targetNode`), null)) {
    if (candidate.countQuads(target, null, null, null) > 0
      || candidate.countQuads(null, null, target, null) > 0) values.push(target);
  }
  for (const predicate of shapeStore.getObjects(shape, namedNode(`${SH}targetSubjectsOf`), null)) {
    values.push(...candidate.getSubjects(predicate, null, null));
  }
  for (const predicate of shapeStore.getObjects(shape, namedNode(`${SH}targetObjectsOf`), null)) {
    values.push(...candidate.getObjects(null, predicate, null));
  }
  return [...new Map(values.map((term) => [`${term.termType}:${term.value}`, term])).values()];
}

function integerValue(store, subject, predicate) {
  const values = store.getObjects(subject, namedNode(predicate), null);
  if (values.length !== 1 || values[0].termType !== "Literal") return null;
  const parsed = Number(values[0].value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isZeroMaximum(store, term) {
  return integerValue(store, term, `${SH}maxCount`) === 0;
}

function isAbsenceRuleSatisfied(candidate, shapeStore, constraint) {
  const emptyLists = shapeStore.getObjects(
    constraint.term,
    namedNode(`${SH}in`),
    null,
  ).some((term) => term.termType === "NamedNode" && term.value === RDF_NIL);
  if (emptyLists) return focusNodes(candidate, shapeStore, constraint.shapeId).length === 0;

  if (constraint.constraintKind === "direct-property-constraint"
    && isZeroMaximum(shapeStore, constraint.term)) {
    const definition = pathDefinition(shapeStore, constraint);
    return definition?.kind === "simple"
      && candidate.countQuads(null, definition.predicates[0], null, null) === 0;
  }

  if (constraint.constraintKind !== "node-shape") return false;
  const shape = namedNode(constraint.shapeId);
  const properties = shapeStore.getObjects(shape, namedNode(`${SH}property`), null);
  return properties.length > 0
    && properties.every((property) => isZeroMaximum(shapeStore, property))
    && focusNodes(candidate, shapeStore, constraint.shapeId).length === 0;
}

function mutationFocuses(candidate, shapeStore, constraint) {
  const activated = focusNodes(candidate, shapeStore, constraint.shapeId);
  if (activated.length > 0 || constraint.constraintKind !== "direct-property-constraint"
    || !isZeroMaximum(shapeStore, constraint.term)) return activated;

  const preferredPredicates = [
    namedNode("http://www.opengis.net/ont/geosparql#asWKT"),
    namedNode("http://www.opengis.net/ont/geosparql#asGML"),
  ];
  const preferred = preferredPredicates.flatMap((predicate) => (
    candidate.getSubjects(predicate, null, null)
  ));
  const fallback = candidate.getSubjects(null, null, null)
    .filter((term) => ["BlankNode", "NamedNode"].includes(term.termType));
  return [...new Map([...preferred, ...fallback].map((term) => (
    [`${term.termType}:${term.value}`, term]
  ))).values()];
}

function explicitRequirementIds(shapeStore, term) {
  return shapeStore.getObjects(term, REQUIREMENT_ID, null)
    .filter((item) => item.termType === "Literal")
    .map((item) => item.value);
}

function ancestorRequirementIds(shapeStore, sourceShape) {
  let frontier = [sourceShape];
  const visited = new Set();
  const collected = new Set();
  for (let depth = 0; frontier.length > 0 && depth < 32; depth += 1) {
    const next = [];
    for (const term of frontier) {
      const key = `${term.termType}:${term.value}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const id of explicitRequirementIds(shapeStore, term)) collected.add(id);
      for (const incoming of shapeStore.getQuads(null, null, term, null)) {
        if (SHAPE_OWNERSHIP_PREDICATES.has(incoming.predicate.value)
          && ["BlankNode", "NamedNode"].includes(incoming.subject.termType)) {
          next.push(incoming.subject);
        }
      }
    }
    frontier = next;
  }
  return [...collected].sort();
}

function localResultIds(report, shapeStore, approvedIds) {
  return [...new Set(report.results.flatMap((result) => (
    ancestorRequirementIds(shapeStore, result.sourceShape)
  )).filter((id) => approvedIds.has(id)))].sort();
}

function prefixesFrom(source) {
  return Object.fromEntries([...source.matchAll(
    /^@prefix\s+([^:]+):\s+<([^>]+)>\s*\./gmu,
  )].map((match) => [match[1], match[2]]));
}

async function serialize(store, prefixes) {
  const writer = new Writer({ prefixes });
  writer.addQuads(store.getQuads(null, null, null, null));
  return new Promise((resolve, reject) => writer.end((error, output) => (
    error ? reject(error) : resolve(output)
  )));
}

function replacementTerm(shapeStore, constraint, seed) {
  const nodeKinds = shapeStore.getObjects(constraint.term, namedNode(`${SH}nodeKind`), null)
    .map((term) => term.value);
  const datatypes = shapeStore.getObjects(constraint.term, namedNode(`${SH}datatype`), null);
  const patterns = shapeStore.getObjects(constraint.term, namedNode(`${SH}pattern`), null);
  if (patterns.length > 0) return literal(" mutation value with spaces ");
  if (nodeKinds.includes(`${SH}IRI`) || datatypes.length > 0) return literal(`mutation-${seed}`);
  if (nodeKinds.includes(`${SH}Literal`)) return namedNode(`urn:molit:mutation:${seed}`);
  return namedNode(`urn:molit:mutation:${seed}`);
}

function addTerminal(store, focus, definition, value, existing) {
  if (definition.kind === "simple") {
    store.addQuad(quad(focus, definition.predicates[0], value));
    return true;
  }
  if (definition.kind === "inverse") {
    if (value.termType !== "NamedNode" && value.termType !== "BlankNode") return false;
    store.addQuad(quad(value, definition.predicates[0], focus));
    return true;
  }
  if (existing.length === 0) return false;
  const edge = existing[0].edge;
  store.addQuad(quad(edge.subject, edge.predicate, value));
  return true;
}

function mutationCandidates(candidate, focus, definition, shapeStore, constraint) {
  const edges = terminalEdges(candidate, focus, definition);
  const seed = createHash("sha256").update(constraint.requirementIds[0]).digest("hex").slice(0, 12);
  const replacement = replacementTerm(shapeStore, constraint, seed);
  const attempts = [];
  if (edges.length > 0) {
    const requiredValues = shapeStore.getObjects(
      constraint.term,
      namedNode(`${SH}hasValue`),
      null,
    );
    const requiredEdges = edges.filter(({ value }) => (
      requiredValues.some((required) => required.equals(value))
    ));
    if (requiredEdges.length > 0 && requiredEdges.length < edges.length) {
      const removedRequired = cloneStore(candidate);
      for (const { edge } of requiredEdges) removedRequired.removeQuad(edge);
      attempts.push({ kind: "remove-required-value", store: removedRequired });
    }
    const removed = cloneStore(candidate);
    for (const { edge } of edges) removed.removeQuad(edge);
    attempts.push({ kind: "remove-path-values", store: removed });

    const replaced = cloneStore(candidate);
    for (const { edge } of edges) replaced.removeQuad(edge);
    if (addTerminal(replaced, focus, definition, replacement, edges)) {
      attempts.push({ kind: "replace-path-value", store: replaced });
    }
  }
  const added = cloneStore(candidate);
  const extra = replacementTerm(shapeStore, constraint, `${seed}-extra`);
  if (addTerminal(added, focus, definition, extra, edges)) {
    attempts.push({ kind: "add-path-value", store: added });
  }
  return attempts;
}

function nodeMutationTerms(requirementId, focus) {
  const WKT = namedNode("http://www.opengis.net/ont/geosparql#wktLiteral");
  const GML = namedNode("http://www.opengis.net/ont/geosparql#gmlLiteral");
  const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
  const tailored = {
    "MOLIT-GEO-ENCODING-001": literal("POINT (128 36)", WKT),
    "MOLIT-GEO-TYPE-001": literal(`<${CRS84}> MULTIPOINT((128 36))`, WKT),
    "MOLIT-GEO-TYPE-004": literal(`<${CRS84}> LINESTRING(127 35,128 36)`, WKT),
    "MOLIT-GEO-ENCODING-002": literal(
      "<gml:Point xmlns:gml=\"http://www.opengis.net/gml/3.2\"><gml:pos>128 36</gml:pos></gml:Point>",
      GML,
    ),
    "MOLIT-GEO-TYPE-002": literal(
      `<gml:LineString srsName="${CRS84}" xmlns:gml="http://www.opengis.net/gml/3.2"><gml:posList>127 35 128 36</gml:posList></gml:LineString>`,
      GML,
    ),
    "MOLIT-GEO-ENCODING-004": literal("not-a-supported-geometry"),
  };
  const terms = [];
  if (tailored[requirementId]) terms.push(tailored[requirementId]);
  if (focus?.termType === "Literal") {
    terms.push(focus.datatype?.value
      ? literal("targeted-invalid-value", focus.datatype)
      : literal("targeted-invalid-value"));
  } else {
    terms.push(literal("targeted-invalid-value"));
  }
  return terms;
}

function directNodeMutationCandidates(candidate, shapeStore, constraint) {
  const attempts = [];
  if (constraint.requirementIds[0] === "MOLIT-GEO-DISCLOSURE-001") {
    const disclosure = namedNode(
      "https://data.molit.go.kr/def/molit-dcat-ap#spatialDisclosureLevel",
    );
    const withheld = namedNode(
      "https://data.molit.go.kr/id/concept/spatial-disclosure-level/withheld",
    );
    for (const focus of focusNodes(candidate, shapeStore, constraint.shapeId)) {
      const existing = candidate.getQuads(focus, disclosure, null, null);
      if (existing.length === 0) continue;
      const changed = cloneStore(candidate);
      for (const edge of existing) changed.removeQuad(edge);
      changed.addQuad(quad(focus, disclosure, withheld));
      attempts.push({ kind: "replace-disclosure-with-withheld", store: changed });
    }
  }
  const emptyIn = shapeStore.getObjects(
    constraint.term,
    namedNode(`${SH}in`),
    null,
  ).some((term) => term.termType === "NamedNode" && term.value === RDF_NIL);
  if (emptyIn) {
    const targets = shapeStore.getObjects(
      constraint.term,
      namedNode(`${SH}targetClass`),
      null,
    ).filter((term) => term.termType === "NamedNode");
    const preferred = candidate.getSubjects(
      RDF_TYPE,
      namedNode("http://www.w3.org/ns/dcat#Dataset"),
      null,
    );
    const anchors = preferred.length > 0 ? preferred : candidate.getSubjects(null, null, null)
      .filter((term) => ["BlankNode", "NamedNode"].includes(term.termType));
    if (targets.length > 0 && anchors.length > 0) {
      const activated = cloneStore(candidate);
      activated.addQuad(quad(anchors[0], RDF_TYPE, targets[0]));
      attempts.push({ kind: "activate-prohibited-target", store: activated });
    }
  }

  const targetPredicates = shapeStore.getObjects(
    constraint.term,
    namedNode(`${SH}targetObjectsOf`),
    null,
  ).filter((term) => term.termType === "NamedNode");
  const focuses = focusNodes(candidate, shapeStore, constraint.shapeId);
  for (const focus of focuses) {
    const incoming = targetPredicates.flatMap((predicate) => (
      candidate.getQuads(null, predicate, focus, null)
    ));
    if (incoming.length === 0) continue;
    for (const value of nodeMutationTerms(constraint.requirementIds[0], focus)) {
      const added = cloneStore(candidate);
      added.addQuad(quad(incoming[0].subject, incoming[0].predicate, value));
      attempts.push({ kind: "add-target-object", store: added });
    }
  }
  return attempts;
}

function sourceFields(requirement, overrides) {
  const reviewed = overrides.get(requirement.requirementId);
  if (reviewed) return reviewed;
  const moduleName = requirement.shapeFile
    .replace(/^shacl\/molit-/u, "")
    .replace(/[.]ttl$/u, "")
    .replaceAll("-", " ");
  return {
    localRationale: `Executable local constraint in ${requirement.shapeFile}; the source clause and fixture links are reviewed separately.`,
    sourceClause: requirement.requirementId,
    sourceStandard: `MOLIT DCAT-AP 1.0 ${moduleName} module`,
  };
}

async function loadRuntime(releaseRoot) {
  const manifest = JSON.parse(await readFile(path.join(releaseRoot, "manifest.json"), "utf8"));
  const background = new Store();
  for (const relative of manifest.background) {
    background.addQuads(new Parser().parse(await readFile(path.join(releaseRoot, relative), "utf8")));
  }
  const imports = new Map();
  for (const [iri, relative] of Object.entries(manifest.localImportMap ?? {})) {
    imports.set(iri, parseStore(await readFile(path.join(releaseRoot, relative), "utf8")));
  }
  const profiles = new Map();
  for (const [name, profile] of Object.entries(manifest.profiles)) {
    if (profile.kind === "diagnostic") continue;
    const shapeStore = new Store();
    for (const relative of profile.shapes) {
      shapeStore.addQuads(new Parser().parse(await readFile(
        path.join(releaseRoot, relative),
        "utf8",
      )));
    }
    profiles.set(name, {
      profile,
      shapeStore,
      validator: new SHACLValidator(shapeStore, {
        importGraph: async (iri) => {
          const imported = imports.get(iri.value);
          if (!imported) throw new Error(`unapproved local import: ${iri.value}`);
          return imported;
        },
        maxErrors: 1000,
      }),
    });
  }
  return { background, manifest, profiles };
}

async function validateCandidate(runtimeProfile, background, candidate, approvedIds) {
  const data = mergeStores(background, candidate);
  const report = await runtimeProfile.validator.validate(data);
  return {
    localIds: localResultIds(report, runtimeProfile.shapeStore, approvedIds),
    report,
  };
}

function caseRecord({ description, expectedIds, fixtureId, path: relativePath, profile, source }) {
  return {
    fixtureId,
    path: relativePath,
    sha256: sha256(Buffer.from(source)),
    description,
    conformanceClass: [profile],
    expectedOutcome: fixtureId.startsWith("POS-") ? "conforms" : "violates",
    coversRequirementIds: [...expectedIds].sort(),
    expectedRequirementIds: fixtureId.startsWith("POS-") ? [] : [...expectedIds].sort(),
  };
}

export async function buildRequirementEvidence({ releaseRoot = DEFAULT_RELEASE, write = false } = {}) {
  const scan = await scanRequirementConstraints({ releaseRoot });
  const registry = await buildDraftRequirementRegistry({ releaseRoot });
  const { overrides: sourceOverrides } = await loadRequirementSourceOverrides({
    profileVersion: registry.profileVersion,
    releaseRoot,
    requirementIds: registry.requirements.map((item) => item.requirementId),
  });
  const runtime = await loadRuntime(releaseRoot);
  const approvedIds = new Set(registry.requirements.map((item) => item.requirementId));
  const constraintById = new Map(scan.constraints.map((item) => [item.requirementIds[0], item]));
  const cases = [];
  const positiveSources = new Map();

  for (const [profile, name] of POSITIVE_CASES) {
    const relative = `examples/valid/${name}`;
    const source = await readFile(path.join(releaseRoot, relative), "utf8");
    const candidate = parseStore(source);
    const runtimeProfile = runtime.profiles.get(profile);
    if (!runtimeProfile) throw new Error(`positive profile is absent: ${profile}`);
    const validation = await validateCandidate(runtimeProfile, runtime.background, candidate, approvedIds);
    if (!validation.report.conforms || validation.report.results.length !== 0) {
      throw new Error(`positive fixture does not conform: ${profile}/${name}`);
    }
    const covered = registry.requirements.filter((requirement) => {
      if (!requirement.conformanceClass.includes(profile)) return false;
      const constraint = constraintById.get(requirement.requirementId);
      const constraintStore = constraint ? scan.stores.get(constraint.shapeFile) : null;
      return constraint && constraintStore && (
        focusNodes(candidate, constraintStore, constraint.shapeId).length > 0
        || isAbsenceRuleSatisfied(candidate, constraintStore, constraint)
      );
    }).map((item) => item.requirementId).sort();
    if (covered.length === 0) continue;
    const fixtureId = `POS-${slug(profile)}-${slug(path.basename(name, ".ttl"))}`;
    cases.push(caseRecord({
      description: `Conforming ${profile} fixture used as positive evidence for activated local shapes.`,
      expectedIds: covered,
      fixtureId,
      path: relative,
      profile,
      source,
    }));
    positiveSources.set(fixtureId, { candidate, name, prefixes: prefixesFrom(source), profile, source });
  }

  for (const [profile, name] of CURATED_NEGATIVE_CASES) {
    const relative = `examples/invalid/${name}`;
    const source = await readFile(path.join(releaseRoot, relative), "utf8");
    const candidate = parseStore(source);
    const runtimeProfile = runtime.profiles.get(profile);
    const validation = await validateCandidate(runtimeProfile, runtime.background, candidate, approvedIds);
    if (validation.localIds.length === 0) continue;
    cases.push(caseRecord({
      description: `Reviewed ${profile} negative fixture; expected IDs were observed from the local SHACL graph.`,
      expectedIds: validation.localIds,
      fixtureId: `NEG-${slug(profile)}-${slug(path.basename(name, ".ttl"))}`,
      path: relative,
      profile,
      source,
    }));
  }

  const positiveByRequirement = new Map();
  for (const item of cases.filter((candidate) => candidate.expectedOutcome === "conforms")) {
    for (const id of item.coversRequirementIds) {
      if (!positiveByRequirement.has(id)) positiveByRequirement.set(id, item.fixtureId);
    }
  }
  const generated = [];
  const attempts = [];
  for (const requirement of registry.requirements) {
    const positiveFixtureId = positiveByRequirement.get(requirement.requirementId);
    const base = positiveSources.get(positiveFixtureId);
    const constraint = constraintById.get(requirement.requirementId);
    if (!base || !constraint || ![
      "direct-property-constraint",
      "node-shape",
      "property-shape",
    ].includes(constraint.constraintKind)) {
      attempts.push({
        outcome: !base ? "no-positive-base" : "unsupported-node-constraint",
        requirementId: requirement.requirementId,
      });
      continue;
    }
    const runtimeProfile = runtime.profiles.get(base.profile);
    const constraintStore = scan.stores.get(constraint.shapeFile);
    const definition = constraint.constraintKind === "direct-property-constraint"
      ? pathDefinition(constraintStore, constraint)
      : null;
    const candidates = definition
      ? mutationFocuses(base.candidate, constraintStore, constraint).flatMap((focus) => (
        mutationCandidates(
          base.candidate,
          focus,
          definition,
          constraintStore,
          constraint,
        )
      ))
      : directNodeMutationCandidates(base.candidate, constraintStore, constraint);
    let accepted = null;
    for (const mutation of candidates) {
      const validation = await validateCandidate(
        runtimeProfile,
        runtime.background,
        mutation.store,
        approvedIds,
      );
      if (!validation.localIds.includes(requirement.requirementId)) continue;
      accepted = { ...mutation, ids: validation.localIds };
      break;
    }
    if (!accepted) {
      attempts.push({ outcome: "no-triggering-mutation", requirementId: requirement.requirementId });
      continue;
    }
    const fileName = `mutation-${requirement.requirementId.toLowerCase()}.ttl`;
    const relative = `examples/invalid/${fileName}`;
    const source = await serialize(accepted.store, base.prefixes);
    const fixtureId = `NEG-MUT-${requirement.requirementId.slice("MOLIT-".length)}`;
    const item = caseRecord({
      description: `Generated ${accepted.kind} mutation targeting ${requirement.requirementId}; expected IDs were observed by the ${base.profile} SHACL lane.`,
      expectedIds: accepted.ids,
      fixtureId,
      path: relative,
      profile: base.profile,
      source,
    });
    cases.push(item);
    generated.push({ path: relative, source });
    attempts.push({
      additionalRequirementIds: accepted.ids.filter((id) => id !== requirement.requirementId),
      mutation: accepted.kind,
      outcome: "generated",
      requirementId: requirement.requirementId,
    });
  }

  const negativeCases = cases.filter((candidate) => candidate.expectedOutcome === "violates");
  const negativeByRequirement = new Map();
  for (const requirement of registry.requirements) {
    const exactFixtureId = `NEG-MUT-${requirement.requirementId.slice("MOLIT-".length)}`;
    const eligible = negativeCases.filter((item) => (
      item.expectedRequirementIds.includes(requirement.requirementId)
    )).sort((left, right) => (
      Number(right.fixtureId === exactFixtureId) - Number(left.fixtureId === exactFixtureId)
        || Number(right.fixtureId.startsWith("NEG-MUT-"))
          - Number(left.fixtureId.startsWith("NEG-MUT-"))
        || left.expectedRequirementIds.length - right.expectedRequirementIds.length
        || left.fixtureId.localeCompare(right.fixtureId)
    ));
    if (eligible.length > 0) {
      negativeByRequirement.set(requirement.requirementId, eligible[0].fixtureId);
    }
  }

  for (const requirement of registry.requirements) {
    Object.assign(requirement, sourceFields(requirement, sourceOverrides));
    requirement.positiveFixtureId = positiveByRequirement.get(requirement.requirementId) ?? null;
    requirement.negativeFixtureId = negativeByRequirement.get(requirement.requirementId) ?? null;
  }
  const blockers = registry.requirements.flatMap((requirement) => {
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
  registry.registryStatus = blockers.length === 0 ? "approved" : "draft";
  const caseRegistry = {
    schemaVersion: "molit.profile-conformance-cases/1",
    profileVersion: runtime.manifest.version,
    registryStatus: "approved",
    fixtureCases: cases.sort((left, right) => left.fixtureId.localeCompare(right.fixtureId)),
  };
  const coverage = {
    schemaVersion: "molit.profile-requirement-coverage/1",
    profileVersion: runtime.manifest.version,
    releaseAcceptanceItem: "RA-REQUIREMENTS",
    counts: {
      blockers: blockers.length,
      fixtureCases: caseRegistry.fixtureCases.length,
      fullyCovered: registry.requirements.filter((item) => (
        item.positiveFixtureId !== null && item.negativeFixtureId !== null
      )).length,
      generatedMutations: generated.length,
      negativeCovered: registry.requirements.filter((item) => item.negativeFixtureId !== null).length,
      normativeRequirements: registry.requirements.length,
      positiveCovered: registry.requirements.filter((item) => item.positiveFixtureId !== null).length,
    },
    blockers,
    mutationAttempts: attempts,
  };

  if (write) {
    const invalidDirectory = path.join(releaseRoot, "examples", "invalid");
    for (const name of await readdir(invalidDirectory)) {
      if (/^mutation-molit-[a-z0-9-]+[.]ttl$/u.test(name)) {
        await unlink(path.join(invalidDirectory, name));
      }
    }
    await Promise.all(generated.map((item) => writeFile(
      path.join(releaseRoot, ...item.path.split("/")),
      item.source,
      "utf8",
    )));
    const requirementsDirectory = path.join(releaseRoot, "requirements");
    await Promise.all([
      writeFile(
        path.join(requirementsDirectory, "profile-requirements.json"),
        `${JSON.stringify(registry, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(requirementsDirectory, "profile-requirements.csv"),
        requirementCsvProjection(registry),
        "utf8",
      ),
      writeFile(
        path.join(requirementsDirectory, "conformance-cases.json"),
        `${JSON.stringify(caseRegistry, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(requirementsDirectory, "coverage-blockers.json"),
        `${JSON.stringify(coverage, null, 2)}\n`,
        "utf8",
      ),
    ]);
  }
  return { caseRegistry, coverage, registry };
}

function parseArguments(argv) {
  let releaseRoot = DEFAULT_RELEASE;
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--write") write = true;
    else if (argv[index] === "--release" && argv[index + 1]) {
      releaseRoot = path.resolve(argv[++index]);
    } else throw new Error(`unknown or incomplete argument: ${argv[index]}`);
  }
  return { releaseRoot, write };
}

async function main() {
  const result = await buildRequirementEvidence(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    blockers: result.coverage.counts.blockers,
    fixtureCases: result.coverage.counts.fixtureCases,
    fullyCovered: result.coverage.counts.fullyCovered,
    generatedMutations: result.coverage.counts.generatedMutations,
    negativeCovered: result.coverage.counts.negativeCovered,
    normativeRequirements: result.coverage.counts.normativeRequirements,
    positiveCovered: result.coverage.counts.positiveCovered,
    registryStatus: result.registry.registryStatus,
    write: process.argv.includes("--write"),
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
