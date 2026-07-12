#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import jsonld from "jsonld";
import MarkdownIt from "markdown-it";
import { DataFactory, Parser, Store, Writer } from "n3";
import {
  loadProfileRelease,
  resolveReleaseArtifact,
  resolveProfileVersion,
} from "../../src/profile/registry.mjs";

const { namedNode } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const RDFS_LABEL = namedNode("http://www.w3.org/2000/01/rdf-schema#label");
const SKOS_DEFINITION = namedNode("http://www.w3.org/2004/02/skos/core#definition");
const MOLIT_NAMESPACE = "https://data.molit.go.kr/def/molit-dcat-ap#";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlDocument(title, body, version) {
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="dcterms.conformsTo" content="https://data.molit.go.kr/profile/molit-dcat-ap/${escapeHtml(version)}">`,
    `<title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((left, right) => {
      const a = JSON.stringify(left);
      const b = JSON.stringify(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function toNQuads(quads) {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "N-Quads" });
    writer.addQuads(quads);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

async function turtleToJsonLd(source) {
  const quads = new Parser({ format: "text/turtle" }).parse(source);
  const expanded = await jsonld.fromRDF(await toNQuads(quads), {
    format: "application/n-quads",
    useNativeTypes: false,
  });
  return `${JSON.stringify(canonical({ "@graph": expanded }), null, 2)}\n`;
}

function ontologyTable(source) {
  const store = new Store(new Parser({ format: "text/turtle" }).parse(source));
  const terms = [...new Map(
    store.getSubjects(null, null, null)
      .filter(({ termType, value }) => termType === "NamedNode" && value.startsWith(MOLIT_NAMESPACE))
      .map((term) => [term.value, term]),
  ).values()].sort((left, right) => left.value.localeCompare(right.value));
  const rows = terms.map((term) => {
    const types = store.getObjects(term, RDF_TYPE, null).map(({ value }) => value).sort();
    const labels = store.getObjects(term, RDFS_LABEL, null)
      .map((value) => `${value.value}${value.language ? `@${value.language}` : ""}`)
      .sort();
    const definitions = store.getObjects(term, SKOS_DEFINITION, null)
      .map(({ value }) => value)
      .sort();
    return [
      "<tr>",
      `<td><code>${escapeHtml(term.value)}</code></td>`,
      `<td>${escapeHtml(labels.join(" / "))}</td>`,
      `<td>${escapeHtml(types.join(" / "))}</td>`,
      `<td>${escapeHtml(definitions.join(" / "))}</td>`,
      "</tr>",
    ].join("");
  }).join("\n");
  return [
    "<main>",
    "<h1>MOLIT-DCAT-AP ontology</h1>",
    "<p>This candidate rendering is generated from the locked Turtle ontology. Turtle remains the RDF source representation.</p>",
    "<table>",
    "<thead><tr><th>IRI</th><th>label</th><th>type</th><th>definition</th></tr></thead>",
    `<tbody>${rows}</tbody>`,
    "</table>",
    "</main>",
  ].join("\n");
}

function publicationContract(release) {
  const representations = release.manifest.representationArtifacts;
  const profileIris = [...new Set([
    release.manifest.profileIri,
    release.manifest.versionIri,
    ...(release.manifest.geoProfileIri ? [release.manifest.geoProfileIri] : []),
    ...Object.entries(release.manifest.profiles)
      .filter(([, profile]) => profile.kind !== "diagnostic")
      .map(([name]) => (name === "core"
        ? release.manifest.profileIri
        : `${release.manifest.profileIri}/${name}`)),
    ...Object.values(release.manifest.profiles).map(({ conformanceIri }) => conformanceIri),
  ])].sort();
  return {
    schemaVersion: "molit.content-negotiation-contract/1",
    profileVersion: release.version,
    status: "candidate-deployment-contract",
    namespaceStatus: release.manifest.namespaceStatus,
    responseRules: {
      unsupportedAccept: 406,
      vary: ["Accept"],
      dynamicNetworkImports: false,
      exactByteArtifacts: true,
    },
    resources: [
      {
        iris: profileIris,
        representations: {
          "application/ld+json": representations.profileJsonLd,
          "text/html": representations.profileHtml,
          "text/turtle": representations.profileTurtle,
        },
      },
      {
        iris: ["https://data.molit.go.kr/def/molit-dcat-ap"],
        representations: {
          "application/ld+json": representations.ontologyJsonLd,
          "text/html": representations.ontologyHtml,
          "text/turtle": representations.ontologyTurtle,
        },
      },
    ],
    deploymentGate: "RA-NAMESPACE",
    notes: [
      "This file specifies representation selection; it does not claim that data.molit.go.kr is already deployed.",
      "The operating authority must publish these exact locked bytes or record a new release.",
    ],
  };
}

export async function buildPublicationArtifacts({ check = false, version } = {}) {
  const release = await loadProfileRelease(resolveProfileVersion(version));
  if (release.manifest.schemaVersion !== "molit.application-profile-manifest/2") {
    throw new Error("publication representation builder requires manifest v2");
  }
  const representations = release.manifest.representationArtifacts;
  const [markdown, profileTurtle, ontologyTurtle] = await Promise.all([
    readFile(resolveReleaseArtifact(release, "index.md"), "utf8"),
    readFile(resolveReleaseArtifact(release, representations.profileTurtle), "utf8"),
    readFile(resolveReleaseArtifact(release, representations.ontologyTurtle), "utf8"),
  ]);
  const renderer = new MarkdownIt({ breaks: false, html: false, linkify: false, typographer: false });
  const outputs = new Map([
    [representations.profileHtml, htmlDocument(
      `MOLIT-DCAT-AP ${release.version}`,
      `<main>\n${renderer.render(markdown)}</main>`,
      release.version,
    )],
    [representations.ontologyHtml, htmlDocument(
      `MOLIT-DCAT-AP ontology ${release.version}`,
      ontologyTable(ontologyTurtle),
      release.version,
    )],
    [representations.profileJsonLd, await turtleToJsonLd(profileTurtle)],
    [representations.ontologyJsonLd, await turtleToJsonLd(ontologyTurtle)],
    [release.manifest.publicationContract, `${JSON.stringify(
      canonical(publicationContract(release)),
      null,
      2,
    )}\n`],
  ]);
  for (const [relative, expected] of outputs) {
    const target = resolveReleaseArtifact(release, relative);
    if (check) {
      const actual = await readFile(target, "utf8");
      if (actual !== expected) throw new Error(`generated publication artifact is stale: ${relative}`);
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, expected, "utf8");
    }
  }
  return { checked: check, outputs: [...outputs.keys()].sort(), version: release.version };
}

function parseArguments(argv) {
  let check = false;
  let version;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--check" && !check) check = true;
    else if (argv[index] === "--version" && !version && argv[index + 1]) {
      version = argv[index + 1];
      index += 1;
    } else throw new Error(`unknown or duplicate argument: ${argv[index]}`);
  }
  return { check, version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildPublicationArtifacts(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
