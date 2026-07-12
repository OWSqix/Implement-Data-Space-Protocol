#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DataFactory, Parser, Store } from "n3";
import { loadProfileRelease } from "../../src/profile/registry.mjs";

const { namedNode } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const SKOS_CONCEPT = namedNode("http://www.w3.org/2004/02/skos/core#Concept");
const SKOS_SCHEME = namedNode("http://www.w3.org/2004/02/skos/core#ConceptScheme");
const SKOS_IN_SCHEME = namedNode("http://www.w3.org/2004/02/skos/core#inScheme");
const SKOS_NOTATION = namedNode("http://www.w3.org/2004/02/skos/core#notation");
const SKOS_PREF_LABEL = namedNode("http://www.w3.org/2004/02/skos/core#prefLabel");
const ADMS_STATUS = namedNode("http://www.w3.org/ns/adms#status");
const DCT_ISSUED = namedNode("http://purl.org/dc/terms/issued");
const DCT_SOURCE = namedNode("http://purl.org/dc/terms/source");
const DCT_IS_REPLACED_BY = namedNode("http://purl.org/dc/terms/isReplacedBy");

const LOCAL_VALID_FROM = "2026-07-13";
const sources = Object.freeze([
  {
    artifact: "vocabulary/domestic-candidate-registries.ttl",
    authority: "https://data.molit.go.kr/candidate/scheme/",
    category: "domestic-identifiers-and-licences",
    status: "candidate",
  },
  {
    artifact: "vocabulary/molit-domain.ttl",
    authority: "https://data.molit.go.kr/scheme/domain",
    category: "molit-domain",
    status: "candidate",
  },
  {
    artifact: "vocabulary/network-edition.ttl",
    authority: "https://www.its.go.kr/nodelink/nodelinkRef",
    category: "network-edition",
    status: "candidate",
  },
  {
    artifact: "vocabulary/network-element-type.ttl",
    authority: "https://data.molit.go.kr/scheme/network-element-type",
    category: "network-element-type",
    status: "candidate",
  },
  {
    artifact: "vocabulary/network-lifecycle-status.ttl",
    authority: "https://data.molit.go.kr/scheme/network-lifecycle-status",
    category: "network-lifecycle",
    status: "candidate",
  },
  {
    artifact: "vocabulary/observation-semantics.ttl",
    authority: "https://data.molit.go.kr/scheme/",
    category: "transport-observation",
    status: "candidate",
  },
  {
    artifact: "vocabulary/offering-readiness-status.ttl",
    authority: "https://data.molit.go.kr/scheme/offering-readiness-status",
    category: "dataspace-offering-readiness",
    status: "candidate",
  },
  {
    artifact: "vocabulary/quality-semantics.ttl",
    authority: "https://data.molit.go.kr/scheme/",
    category: "quality-semantics",
    status: "candidate",
  },
  {
    artifact: "vocabulary/quality.ttl",
    authority: "https://data.molit.go.kr/scheme/",
    category: "quality-status-and-metric",
    status: "candidate",
  },
  {
    artifact: "vocabulary/spatial-disclosure-level.ttl",
    authority: "https://data.molit.go.kr/scheme/spatial-disclosure-level",
    category: "spatial-disclosure",
    status: "candidate",
  },
  {
    artifact: "vocabulary/term-status.ttl",
    authority: "https://data.molit.go.kr/scheme/term-status",
    category: "term-governance",
    status: "candidate",
  },
  {
    artifact: "vocabulary/transport-unit.ttl",
    authority: "https://data.molit.go.kr/scheme/transport-unit",
    category: "transport-measurement-unit",
    status: "candidate",
  },
  {
    artifact: "vocabulary/ogc-crs-allowlist.ttl",
    authority: "https://www.opengis.net/def/crs/",
    category: "coordinate-reference-system",
    defaultScheme: "http://www.opengis.net/def/crs",
    status: "externally-maintained",
  },
  {
    artifact: "vocabulary/qudt-unit-allowlist.ttl",
    authority: "https://qudt.org/3.4.0/vocab/unit",
    category: "qudt-measurement-unit",
    defaultScheme: "http://qudt.org/vocab/unit",
    status: "externally-maintained",
  },
]);

function usage() {
  return "usage: node tools/profile/build-vocabulary-registry.mjs [--version VERSION] (--write|--check)";
}

function parseArguments(argv) {
  let version = "1.0.0-rc.1";
  let mode = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--version" && index + 1 < argv.length) {
      version = argv[index + 1];
      index += 1;
    } else if (argument === "--write" || argument === "--check") {
      if (mode !== null) throw new Error(usage());
      mode = argument.slice(2);
    } else {
      throw new Error(usage());
    }
  }
  if (mode === null) throw new Error(usage());
  return { mode, version };
}

function oneOrNull(store, subject, predicate) {
  const values = store.getObjects(subject, predicate, null);
  if (values.length > 1) {
    throw new Error(`${subject.value} has more than one ${predicate.value}`);
  }
  return values[0] ?? null;
}

function tailNotation(iri) {
  const withoutQuery = iri.split(/[?#]/u).filter(Boolean).at(-1) ?? iri;
  const tail = withoutQuery.split("/").filter(Boolean).at(-1) ?? withoutQuery;
  return decodeURIComponent(tail);
}

function preferredLabels(store, concept) {
  const labels = store.getObjects(concept, SKOS_PREF_LABEL, null)
    .filter((term) => term.termType === "Literal")
    .map((term) => ({ language: term.language || null, value: term.value }))
    .sort((left, right) => (
      `${left.language ?? ""}\0${left.value}`.localeCompare(
        `${right.language ?? ""}\0${right.value}`,
        "en",
      )
    ));
  if (labels.length === 0) throw new Error(`${concept.value} has no skos:prefLabel`);
  return labels;
}

function statusValue(store, concept, fallback) {
  const value = oneOrNull(store, concept, ADMS_STATUS);
  if (value === null) return fallback;
  if (value.termType !== "NamedNode") throw new Error(`${concept.value} has a literal status`);
  return tailNotation(value.value);
}

function dateValue(store, concept) {
  const issued = oneOrNull(store, concept, DCT_ISSUED);
  if (issued === null) return LOCAL_VALID_FROM;
  if (issued.termType !== "Literal" || !/^\d{4}-\d{2}-\d{2}$/u.test(issued.value)) {
    throw new Error(`${concept.value} has a non-date dct:issued value`);
  }
  return issued.value;
}

function sourceAuthorities(store, concept, configuredAuthority) {
  const sourcesForConcept = store.getObjects(concept, DCT_SOURCE, null);
  if (sourcesForConcept.some((source) => source.termType !== "NamedNode")) {
    throw new Error(`${concept.value} has a non-IRI dct:source`);
  }
  return [...new Set([
    configuredAuthority,
    ...sourcesForConcept.map((source) => source.value),
  ])].sort();
}

function replacementValue(store, concept) {
  const replacement = oneOrNull(store, concept, DCT_IS_REPLACED_BY);
  if (replacement === null) return null;
  if (replacement.termType !== "NamedNode") {
    throw new Error(`${concept.value} has a non-IRI dct:isReplacedBy value`);
  }
  return replacement.value;
}

async function registryProjection(release) {
  const entries = [];
  const registries = new Map();
  for (const source of sources) {
    const absolute = path.join(release.releaseRoot, source.artifact);
    const store = new Store(new Parser().parse(await readFile(absolute, "utf8")));
    if (source.defaultScheme && !registries.has(source.defaultScheme)) {
      registries.set(source.defaultScheme, {
        iri: source.defaultScheme,
        source: {
          artifact: source.artifact,
          authorities: [source.authority],
        },
        status: source.status,
      });
    }
    for (const scheme of store.getSubjects(RDF_TYPE, SKOS_SCHEME, null)) {
      if (scheme.termType !== "NamedNode") continue;
      registries.set(scheme.value, {
        iri: scheme.value,
        source: {
          artifact: source.artifact,
          authorities: sourceAuthorities(store, scheme, source.authority),
        },
        status: statusValue(store, scheme, source.status),
      });
    }
    for (const concept of store.getSubjects(RDF_TYPE, SKOS_CONCEPT, null)) {
      if (concept.termType !== "NamedNode") continue;
      const schemeTerm = oneOrNull(store, concept, SKOS_IN_SCHEME);
      const scheme = schemeTerm?.value ?? source.defaultScheme;
      if (typeof scheme !== "string" || !scheme.startsWith("http")) {
        throw new Error(`${concept.value} has no unambiguous scheme`);
      }
      const notationTerm = oneOrNull(store, concept, SKOS_NOTATION);
      if (notationTerm !== null && notationTerm.termType !== "Literal") {
        throw new Error(`${concept.value} has a non-literal notation`);
      }
      entries.push({
        category: source.category,
        iri: concept.value,
        notation: notationTerm?.value ?? tailNotation(concept.value),
        preferredLabel: preferredLabels(store, concept),
        replacedBy: replacementValue(store, concept),
        scheme,
        source: {
          artifact: source.artifact,
          authorities: sourceAuthorities(store, concept, source.authority),
        },
        status: statusValue(store, concept, source.status),
        validFrom: dateValue(store, concept),
        validTo: null,
      });
    }
  }
  entries.sort((left, right) => left.iri.localeCompare(right.iri, "en"));
  const duplicate = entries.find((entry, index) => index > 0 && entry.iri === entries[index - 1].iri);
  if (duplicate) throw new Error(`duplicate vocabulary entry: ${duplicate.iri}`);
  const categoryCounts = Object.fromEntries([...new Set(entries.map((entry) => entry.category))]
    .sort()
    .map((category) => [category, entries.filter((entry) => entry.category === category).length]));
  return {
    schemaVersion: "molit.controlled-vocabulary-registry/1",
    profileVersion: release.version,
    registryStatus: "candidate-pending-authority-approval",
    asOf: LOCAL_VALID_FROM,
    lifecycleSemantics: {
      validFrom: "Date on which the entry was admitted to this profile registry; it is not an assertion about the authority's original issue date unless the source record supplies dct:issued.",
      nullValidTo: "No end date is recorded in this candidate snapshot.",
      nullReplacedBy: "No replacement is recorded; this does not prevent later deprecation.",
    },
    categoryCounts,
    registries: [...registries.values()].sort((left, right) => left.iri.localeCompare(right.iri, "en")),
    entries,
  };
}

export async function buildVocabularyRegistry(version = "1.0.0-rc.1") {
  const release = await loadProfileRelease(version);
  return registryProjection(release);
}

async function main() {
  const { mode, version } = parseArguments(process.argv.slice(2));
  const release = await loadProfileRelease(version);
  const output = `${JSON.stringify(await registryProjection(release), null, 2)}\n`;
  const target = path.join(release.releaseRoot, release.manifest.vocabularyRegistry);
  if (mode === "write") {
    await writeFile(target, output, "utf8");
    process.stdout.write(`${path.relative(process.cwd(), target)}\n`);
    return;
  }
  const actual = await readFile(target, "utf8");
  if (actual !== output) {
    process.stderr.write("vocabulary registry projection is stale; run with --write\n");
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify({
    entries: JSON.parse(actual).entries.length,
    gatePassed: true,
    profileVersion: version,
  })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
