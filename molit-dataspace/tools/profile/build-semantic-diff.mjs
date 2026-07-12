#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DataFactory, Parser, Store } from "n3";
import { loadProfileRelease } from "../../src/profile/registry.mjs";

const { namedNode } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const SKOS_CONCEPT = namedNode("http://www.w3.org/2004/02/skos/core#Concept");
const OWL_DEPRECATED = namedNode("http://www.w3.org/2002/07/owl#deprecated");
const DCT_IS_REPLACED_BY = namedNode("http://purl.org/dc/terms/isReplacedBy");
const REQUIREMENT_ID = namedNode("https://data.molit.go.kr/def/molit-dcat-ap#requirementId");
const LOCAL_TERM_PREFIX = "https://data.molit.go.kr/def/molit-dcat-ap#";
const LOCAL_VALUE_PREFIXES = [
  "https://data.molit.go.kr/id/",
  "https://data.molit.go.kr/candidate/",
  "https://data.molit.go.kr/scheme/",
];
const TERM_TYPES = new Set([
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property",
  "http://www.w3.org/2000/01/rdf-schema#Class",
  "http://www.w3.org/2002/07/owl#AnnotationProperty",
  "http://www.w3.org/2002/07/owl#Class",
  "http://www.w3.org/2002/07/owl#DatatypeProperty",
  "http://www.w3.org/2002/07/owl#ObjectProperty",
]);

function parseArguments(argv) {
  let from = "0.1.0";
  let to = "1.0.0-rc.1";
  let mode = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if ((argument === "--from" || argument === "--to") && index + 1 < argv.length) {
      if (argument === "--from") from = argv[index + 1];
      else to = argv[index + 1];
      index += 1;
    } else if (argument === "--write" || argument === "--check") {
      if (mode !== null) throw new Error("choose exactly one of --write or --check");
      mode = argument.slice(2);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (mode === null) throw new Error("choose exactly one of --write or --check");
  return { from, mode, to };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

async function parseTurtle(absolute) {
  return new Store(new Parser().parse(await readFile(absolute, "utf8")));
}

function profilesByKind(manifest, kind) {
  return Object.entries(manifest.profiles)
    .filter(([, profile]) => profile.kind === kind)
    .map(([name]) => name)
    .sort();
}

function termSignature(store, term, stack = []) {
  if (term.termType === "Literal") {
    return ["Literal", term.value, term.language || null, term.datatype.value];
  }
  if (term.termType !== "BlankNode") return [term.termType, term.value];
  const cycleIndex = stack.indexOf(term.value);
  if (cycleIndex !== -1) return ["BlankNodeCycle", stack.length - cycleIndex];
  const nextStack = [...stack, term.value];
  return ["BlankNode", store.getQuads(term, null, null, null)
    .map((item) => [item.predicate.value, termSignature(store, item.object, nextStack)])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"))];
}

function constraintSignature(store, subject) {
  return store.getQuads(subject, null, null, null)
    .map((item) => [item.predicate.value, termSignature(store, item.object)])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
}

async function requirementStates(release) {
  const files = new Set(Object.values(release.manifest.profiles)
    .flatMap((profile) => profile.shapes)
    .filter((relative) => !relative.includes("/upstream/")));
  const carriers = new Map();
  for (const relative of files) {
    const store = await parseTurtle(path.join(release.releaseRoot, relative));
    for (const item of store.getQuads(null, REQUIREMENT_ID, null, null)) {
      if (item.object.termType !== "Literal") continue;
      const list = carriers.get(item.object.value) ?? [];
      list.push({ relative, store, subject: item.subject });
      carriers.set(item.object.value, list);
    }
  }
  const states = new Map();
  for (const [requirementId, owned] of [...carriers].sort(([left], [right]) => (
    left.localeCompare(right, "en")
  ))) {
    const signatures = owned.map(({ relative, store, subject }) => ({
      shapeFile: relative,
      signature: constraintSignature(store, subject),
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
    states.set(requirementId, {
      constraintCount: owned.length,
      graphSha256: sha256(Buffer.from(JSON.stringify(signatures), "utf8")),
      shapeFiles: [...new Set(owned.map(({ relative }) => relative))].sort(),
    });
  }
  return states;
}

async function ontologyTerms(release) {
  const store = await parseTurtle(path.join(release.releaseRoot, release.manifest.ontology));
  const terms = new Map();
  for (const subject of store.getSubjects(RDF_TYPE, null, null)) {
    if (subject.termType !== "NamedNode" || !subject.value.startsWith(LOCAL_TERM_PREFIX)) continue;
    const types = store.getObjects(subject, RDF_TYPE, null)
      .filter((term) => term.termType === "NamedNode" && TERM_TYPES.has(term.value))
      .map((term) => term.value)
      .sort();
    if (types.length === 0) continue;
    const deprecated = store.getObjects(subject, OWL_DEPRECATED, null)
      .some((term) => term.termType === "Literal" && term.value === "true");
    const replacements = store.getObjects(subject, DCT_IS_REPLACED_BY, null)
      .filter((term) => term.termType === "NamedNode")
      .map((term) => term.value)
      .sort();
    terms.set(subject.value, { deprecated, replacements, types });
  }
  return terms;
}

async function localVocabularyValues(release) {
  const values = new Set();
  for (const relative of release.manifest.background.filter((item) => (
    item.startsWith("vocabulary/") && item.endsWith(".ttl")
  ))) {
    const store = await parseTurtle(path.join(release.releaseRoot, relative));
    for (const concept of store.getSubjects(RDF_TYPE, SKOS_CONCEPT, null)) {
      if (concept.termType === "NamedNode"
        && LOCAL_VALUE_PREFIXES.some((prefix) => concept.value.startsWith(prefix))) {
        values.add(concept.value);
      }
    }
  }
  return values;
}

async function releaseDigest(release) {
  return sha256(await readFile(path.join(release.releaseRoot, "manifest.json")));
}

export async function buildSemanticDiff(fromVersion = "0.1.0", toVersion = "1.0.0-rc.1") {
  const [fromRelease, toRelease] = await Promise.all([
    loadProfileRelease(fromVersion),
    loadProfileRelease(toVersion),
  ]);
  const [
    fromRequirements,
    toRequirements,
    fromTerms,
    toTerms,
    fromValues,
    toValues,
    fromManifestSha256,
    toManifestSha256,
  ] = await Promise.all([
    requirementStates(fromRelease),
    requirementStates(toRelease),
    ontologyTerms(fromRelease),
    ontologyTerms(toRelease),
    localVocabularyValues(fromRelease),
    localVocabularyValues(toRelease),
    releaseDigest(fromRelease),
    releaseDigest(toRelease),
  ]);
  const fromRequirementIds = new Set(fromRequirements.keys());
  const toRequirementIds = new Set(toRequirements.keys());
  const changedRequirements = [...fromRequirementIds]
    .filter((requirementId) => toRequirements.has(requirementId))
    .map((requirementId) => ({
      from: fromRequirements.get(requirementId),
      requirementId,
      to: toRequirements.get(requirementId),
    }))
    .filter(({ from, to }) => JSON.stringify(from) !== JSON.stringify(to))
    .sort((left, right) => left.requirementId.localeCompare(right.requirementId, "en"));
  const fromTermIds = new Set(fromTerms.keys());
  const toTermIds = new Set(toTerms.keys());
  const retainedTermChanges = [...fromTermIds].filter((iri) => toTerms.has(iri))
    .map((iri) => ({
      iri,
      from: fromTerms.get(iri),
      to: toTerms.get(iri),
    }))
    .filter(({ from, to }) => JSON.stringify(from) !== JSON.stringify(to))
    .sort((left, right) => left.iri.localeCompare(right.iri, "en"));
  return {
    schemaVersion: "molit.profile-semantic-diff/1",
    from: {
      manifestSha256: fromManifestSha256,
      version: fromVersion,
    },
    to: {
      manifestSha256: toManifestSha256,
      version: toVersion,
    },
    profileModules: {
      conformance: {
        added: setDifference(
          new Set(profilesByKind(toRelease.manifest, "conformance")),
          new Set(profilesByKind(fromRelease.manifest, "conformance")),
        ),
        from: profilesByKind(fromRelease.manifest, "conformance"),
        removed: setDifference(
          new Set(profilesByKind(fromRelease.manifest, "conformance")),
          new Set(profilesByKind(toRelease.manifest, "conformance")),
        ),
        to: profilesByKind(toRelease.manifest, "conformance"),
      },
      validationPolicy: {
        from: profilesByKind(fromRelease.manifest, "validation-policy"),
        to: profilesByKind(toRelease.manifest, "validation-policy"),
      },
    },
    requirements: {
      added: setDifference(toRequirementIds, fromRequirementIds),
      changed: changedRequirements,
      fromCount: fromRequirements.size,
      removed: setDifference(fromRequirementIds, toRequirementIds),
      toCount: toRequirements.size,
    },
    ontology: {
      added: setDifference(toTermIds, fromTermIds),
      changed: retainedTermChanges,
      deprecatedInTarget: [...toTerms]
        .filter(([, value]) => value.deprecated)
        .map(([iri, value]) => ({ iri, replacements: value.replacements }))
        .sort((left, right) => left.iri.localeCompare(right.iri, "en")),
      removed: setDifference(fromTermIds, toTermIds),
    },
    controlledValues: {
      added: setDifference(toValues, fromValues),
      fromCount: fromValues.size,
      removed: setDifference(fromValues, toValues),
      toCount: toValues.size,
    },
    reviewedBreakingChanges: [
      {
        id: "BREAK-MODULE-SELECTION",
        migrationSection: "MIGRATION.md#4-module-선택",
        statement: "A 0.1.0 core or geo marker does not determine the RC domain module; publishers must select and declare each applicable module.",
      },
      {
        id: "BREAK-TRANSFERABLE-DEPRECATION",
        migrationSection: "MIGRATION.md#5-deprecated-제공-유형-이행",
        statement: "TransferableDataset and TransferDistribution are deprecated; offering metadata and operational DSP qualification are separate assertions.",
      },
      {
        id: "BREAK-DOMESTIC-THEME",
        migrationSection: "MIGRATION.md#9-core와-주제-이관",
        statement: "A MOLIT domain theme is mandatory; EU TRAN and REGI are optional exchange mappings checked by the diagnostic audit.",
      },
      {
        id: "BREAK-CRS-COVERAGE",
        migrationSection: "MIGRATION.md#2-먼저-확인할-변경",
        statement: "The spatial CRS allowlist and axis policy expand beyond the 0.1.0 CRS84 and EPSG:5179 subset; publishers must preserve source coordinate order and declare the authority tuple separately.",
      },
      {
        id: "BREAK-INSTANCE-GRAPH-BOUNDARY",
        migrationSection: "MIGRATION.md#10-validation-dataset-정리",
        statement: "Candidate graphs contain instance data only; the exact support bundle is supplied separately with no entailment.",
      },
    ],
  };
}

async function main() {
  const { from, mode, to } = parseArguments(process.argv.slice(2));
  const targetRelease = await loadProfileRelease(to);
  const target = path.join(targetRelease.releaseRoot, targetRelease.manifest.semanticDiff);
  const output = `${JSON.stringify(await buildSemanticDiff(from, to), null, 2)}\n`;
  if (mode === "write") {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, output, "utf8");
    process.stdout.write(`${path.relative(process.cwd(), target)}\n`);
    return;
  }
  const actual = await readFile(target, "utf8");
  if (actual !== output) {
    process.stderr.write("semantic diff is stale; regenerate it with --write\n");
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify({ gatePassed: true, from, to })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
