#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DataFactory } from "n3";
import { Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { loadRdfBytes } from "../../src/profile/rdf-loader.mjs";
import { validateProfileDocument } from "../../src/profile/validator.mjs";
import {
  atomicWriteChecked,
  readCheckedFile,
} from "../registries/safe-local-file.mjs";

const { namedNode } = DataFactory;
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(root, "profiles/molit-dcat-ap/releases/0.1.0");
const evidencePath = path.join(root, "evidence/validators/jena-shacl-differential.v1.json");
const candidatePath = path.join(root, ".local/jena-shacl-differential.candidate.json");
const toolchainScript = path.join(root, "tools/dependencies/jena-toolchain.mjs");
const probeScript = path.join(root, "tools/profile/probe-jena.mjs");
const JAVA_HOME = path.join(root, ".local/toolchains/install/jdk-21.0.11+10-jre");
const JENA_HOME = path.join(root, ".local/toolchains/install/apache-jena-6.1.0");
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const RDF_FIRST = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#first");
const RDF_REST = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#rest");
const RDF_NIL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const SH = "http://www.w3.org/ns/shacl#";
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const RDF_LIMITS = {
  maxInputBytes: 16 * 1024 * 1024,
  maxInputQuads: 200_000,
  maxLiteralLength: 100_000,
  maxValidationResults: 10_000,
  maxValuesPerSubjectPredicate: 10_000,
};
const cases = [
  {
    id: "JENA-SHACL-CORE-VALID",
    profile: "core",
    input: "examples/valid/traffic-observation-catalog.ttl",
    expectedConforms: true,
  },
  {
    id: "JENA-SHACL-GEO-VALID",
    profile: "geo",
    input: "examples/valid/road-network-catalog.ttl",
    expectedConforms: true,
  },
  {
    id: "JENA-SHACL-CORE-INVALID",
    profile: "core",
    input: "examples/invalid/missing-korean-title.ttl",
    expectedConforms: false,
  },
  ...[
    ["UNAPPROVED-GEOMETRY-CRS", "geo", "unapproved-geometry-crs.ttl"],
    ["LITERAL-ACCESS-RIGHTS", "core", "literal-access-rights.ttl"],
    ["NETWORK-VERSION", "geo", "network-reference-without-version.ttl"],
    ["QUALITY-UNIT", "core", "quality-unit-not-qudt.ttl"],
    ["SPOOFED-CONCEPT", "core", "spoofed-controlled-concept.ttl"],
    ["UNAPPROVED-FREQUENCY", "core", "unapproved-frequency.ttl"],
    ["UNAPPROVED-MEDIA-TYPE", "core", "unapproved-iana-media-type.ttl"],
    ["ROGUE-THEME", "core", "rogue-theme.ttl"],
    ["WITHHELD-GEOMETRY", "geo", "withheld-spatial-geometry.ttl"],
    ["WKT-WITHOUT-CRS", "geo", "wkt-without-crs.ttl"],
  ].map(([id, profile, file]) => ({
    id: `JENA-SHACL-${id}`,
    profile,
    input: `examples/invalid/${file}`,
    expectedConforms: false,
  })),
];

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => (
      [key, canonicalValue(value[key])]
    )));
  }
  return value;
}

function encodedJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: 120_000,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(
      `${path.basename(command)} failed (${result.status}): ${result.stderr}`,
    );
  }
  return result.stdout;
}

function probeEnvironment() {
  const environment = { JAVA_HOME, JENA_HOME, LANG: "C", LC_ALL: "C" };
  for (const key of ["COMSPEC", "PATHEXT", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  environment.PATH = [
    path.join(JAVA_HOME, "bin"),
    ...(process.env.SystemRoot ? [path.join(process.env.SystemRoot, "System32")] : []),
  ].join(path.delimiter);
  return environment;
}

function termIdentity(term) {
  if (!term) return null;
  if (term.termType === "Literal") {
    return {
      termType: "Literal",
      value: term.value,
      language: term.language || null,
      datatype: term.datatype.value,
    };
  }
  if (term.termType === "BlankNode") return { termType: "BlankNode" };
  return { termType: term.termType, value: term.value };
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rdfList(head, store, depth) {
  const values = [];
  const visited = new Set();
  let current = head;
  while (current?.value !== RDF_NIL) {
    if (current?.termType !== "BlankNode" || visited.has(current.value) || values.length >= 32) {
      throw new Error("SHACL result path has an invalid RDF list");
    }
    visited.add(current.value);
    const first = store.getObjects(current, RDF_FIRST, null);
    const rest = store.getObjects(current, RDF_REST, null);
    if (first.length !== 1 || rest.length !== 1) {
      throw new Error("SHACL result path list cardinality is invalid");
    }
    values.push(canonicalPath(first[0], store, depth + 1));
    [current] = rest;
  }
  return values;
}

function canonicalPath(term, store, depth = 0) {
  if (!term) return null;
  if (depth > 32) throw new Error("SHACL result path depth limit exceeded");
  if (term.termType === "NamedNode") return { predicate: term.value };
  if (term.termType !== "BlankNode") throw new Error("SHACL result path term is invalid");
  const operators = [
    ["inverse", "inversePath"],
    ["alternative", "alternativePath"],
    ["zeroOrMore", "zeroOrMorePath"],
    ["oneOrMore", "oneOrMorePath"],
    ["zeroOrOne", "zeroOrOnePath"],
  ];
  for (const [name, local] of operators) {
    const objects = store.getObjects(term, namedNode(`${SH}${local}`), null);
    if (objects.length === 1) {
      if (name === "alternative") {
        const flattened = [];
        for (const member of rdfList(objects[0], store, depth + 1)) {
          if (member?.alternative) flattened.push(...member.alternative);
          else flattened.push(member);
        }
        flattened.sort((left, right) => lexicalCompare(encodedJson(left), encodedJson(right)));
        return { alternative: flattened };
      }
      return { [name]: canonicalPath(objects[0], store, depth + 1) };
    }
    if (objects.length > 1) throw new Error(`SHACL result path repeats ${local}`);
  }
  if (store.countQuads(term, RDF_FIRST, null, null) === 1) {
    return { sequence: rdfList(term, store, depth + 1) };
  }
  throw new Error("SHACL result path blank node has no recognized path expression");
}

function normalizedSignature(result, store) {
  return {
    focusNode: termIdentity(result.focusNode),
    path: canonicalPath(result.path, store),
    severity: termIdentity(result.severity),
    sourceConstraintComponent: termIdentity(result.sourceConstraintComponent),
    sourceShape: termIdentity(result.sourceShape),
    value: termIdentity(result.value),
  };
}

function nodeSignatures(report, shapeStore) {
  return report.results
    .map((result) => normalizedSignature(result, shapeStore))
    .sort((left, right) => lexicalCompare(encodedJson(left), encodedJson(right)));
}

async function jenaReport(output) {
  const loaded = await loadRdfBytes(
    Buffer.from(output, "utf8"),
    "jena-shacl-report.ttl",
    {
      maxInputBytes: MAX_OUTPUT_BYTES,
      maxInputQuads: 100_000,
      maxLiteralLength: 100_000,
      maxValidationResults: 10_000,
      maxValuesPerSubjectPredicate: 10_000,
    },
    { format: "text/turtle" },
  );
  const store = loaded.store;
  const reports = store.getSubjects(RDF_TYPE, namedNode(`${SH}ValidationReport`), null);
  if (reports.length !== 1) throw new Error("Jena emitted an invalid SHACL report count");
  const [report] = reports;
  const conformsTerms = store.getObjects(report, namedNode(`${SH}conforms`), null);
  if (conformsTerms.length !== 1
    || conformsTerms[0].termType !== "Literal"
    || !["true", "false"].includes(conformsTerms[0].value)) {
    throw new Error("Jena SHACL report has no exact boolean sh:conforms");
  }
  const results = [];
  for (const result of store.getObjects(report, namedNode(`${SH}result`), null)) {
    const one = (predicate, required = true) => {
      const values = store.getObjects(result, namedNode(`${SH}${predicate}`), null);
      if (required && values.length !== 1) {
        throw new Error(`Jena SHACL result has invalid ${predicate} cardinality`);
      }
      if (!required && values.length > 1) {
        throw new Error(`Jena SHACL result has repeated ${predicate}`);
      }
      return values[0] ?? null;
    };
    const severity = one("resultSeverity");
    if (severity.termType !== "NamedNode" || !severity.value.startsWith(SH)) {
      throw new Error("Jena result severity is not a SHACL IRI");
    }
    const component = one("sourceConstraintComponent");
    const focus = one("focusNode");
    const resultPath = one("resultPath", false);
    const sourceShape = one("sourceShape");
    const value = one("value", false);
    results.push(normalizedSignature({
      focusNode: focus,
      path: resultPath,
      severity,
      sourceConstraintComponent: component,
      sourceShape,
      value,
    }, store));
  }
  results.sort((left, right) => lexicalCompare(encodedJson(left), encodedJson(right)));
  return {
    conforms: conformsTerms[0].value === "true",
    results,
  };
}

async function executeCase(definition, directory) {
  const inputPath = path.join(releaseRoot, ...definition.input.split("/"));
  const bundlePath = path.join(releaseRoot, `bundles/${definition.profile}.ttl`);
  const supportPath = path.join(releaseRoot, "bundles/support.ttl");
  const [inputBytes, supportBytes, bundleBytes] = await Promise.all([
    readFile(inputPath),
    readFile(supportPath),
    readFile(bundlePath),
  ]);
  const combinedPath = path.join(directory, `${definition.id}-data.ttl`);
  await writeFile(combinedPath, Buffer.concat([inputBytes, Buffer.from("\n"), supportBytes]));
  const java = path.join(JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java");
  const classpath = path.join(JENA_HOME, "lib", "*");
  const output = run(java, [
    "-cp",
    classpath,
    "shacl.shacl",
    "validate",
    "--shapes",
    pathToFileURL(bundlePath).href,
    "--data",
    pathToFileURL(combinedPath).href,
  ], { env: probeEnvironment() });
  const [node, jena, inputGraph, supportGraph, shapeGraph] = await Promise.all([
    validateProfileDocument({
      inputPath,
      profileName: definition.profile,
      version: "0.1.0",
    }),
    jenaReport(output),
    loadRdfBytes(inputBytes, definition.input, RDF_LIMITS, { format: "text/turtle" }),
    loadRdfBytes(supportBytes, "support.ttl", RDF_LIMITS, { format: "text/turtle" }),
    loadRdfBytes(bundleBytes, `${definition.profile}-bundle.ttl`, RDF_LIMITS, { format: "text/turtle" }),
  ]);
  const dataStore = new Store([
    ...inputGraph.store.getQuads(null, null, null, null),
    ...supportGraph.store.getQuads(null, null, null, null),
  ]);
  const directNode = await new SHACLValidator(shapeGraph.store).validate(dataStore);
  const expected = definition.expectedConforms;
  const signatures = nodeSignatures(directNode, shapeGraph.store);
  if (node.summary.shaclConforms !== expected
    || directNode.conforms !== expected
    || node.results.length !== directNode.results.length
    || jena.conforms !== expected
    || encodedJson(signatures) !== encodedJson(jena.results)) {
    throw new Error(`${definition.id} differs between rdf-validate-shacl and Apache Jena: ${JSON.stringify({
      nodeConforms: node.summary.shaclConforms,
      directNodeConforms: directNode.conforms,
      jenaConforms: jena.conforms,
      node: signatures,
      jena: jena.results,
    })}`);
  }
  return {
    id: definition.id,
    profile: definition.profile,
    input: definition.input,
    inputSha256: sha256(inputBytes),
    shapeBundleSha256: sha256(bundleBytes),
    supportBundleSha256: sha256(supportBytes),
    bundleDigest: node.profile.bundleDigest,
    conforms: expected,
    resultCount: signatures.length,
    normalizedResultsSha256: sha256(encodedJson(signatures)),
  };
}

async function currentEvidence() {
  const toolchain = JSON.parse(run(process.execPath, [toolchainScript, "verify"]));
  const parserProbe = JSON.parse(run(process.execPath, [probeScript], {
    env: probeEnvironment(),
  }));
  if (!parserProbe.gatePassed || parserProbe.status !== "matched") {
    throw new Error("Jena parser differential did not pass");
  }
  const directory = await mkdtemp(path.join(tmpdir(), "molit-jena-shacl-"));
  try {
    const executed = [];
    for (const definition of cases) executed.push(await executeCase(definition, directory));
    return {
      schemaVersion: "molit.jena-shacl-differential/1",
      scope: "SHACL Core/Geo positive-negative differential; preflight remains a separate gate",
      gatePassed: true,
      toolchain: {
        toolchainId: toolchain.toolchainId,
        manifestSha256: toolchain.manifestSha256,
        javaVersion: parserProbe.runtime.javaVersion,
        jenaVersion: parserProbe.engine.version,
      },
      engines: {
        primary: "rdf-validate-shacl@0.6.5",
        differential: "Apache Jena SHACL@6.1.0",
        parserDifferentialSha256: parserProbe.result.nodeGraphSha256,
      },
      normalization: {
        compared: [
          "focusNode RDF term",
          "resultPath expression",
          "severity RDF term",
          "sourceConstraintComponent RDF term",
          "sourceShape named IRI or blank-node kind",
          "value RDF term",
        ],
        excludedAsEngineSpecific: ["message", "blankNodeLabel"],
        duplicateResultsPreserved: true,
      },
      environmentPolicy: {
        inheritedJavaOptions: false,
        inheritedClasspath: false,
        allowedVariables: Object.keys(probeEnvironment()).sort(),
      },
      cases: executed,
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function parseCommand(argv) {
  const [command = "verify", ...arguments_] = argv;
  if (!["candidate", "capture", "verify"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }
  const options = {};
  for (const argument of arguments_) {
    const match = /^--(review-toolchain|approve-evidence)=([a-f0-9]{64})$/u.exec(argument);
    if (!match || Object.hasOwn(options, match[1])) {
      throw new Error(`unknown, malformed, or duplicate option: ${argument}`);
    }
    options[match[1]] = match[2];
  }
  if (command === "verify" && Object.keys(options).length !== 0) {
    throw new Error("verify accepts no approval options");
  }
  if (command === "candidate" && (
    !options["review-toolchain"] || options["approve-evidence"]
  )) throw new Error("candidate requires only --review-toolchain=<sha256>");
  if (command === "capture" && (
    !options["review-toolchain"] || !options["approve-evidence"]
  )) {
    throw new Error(
      "capture requires --review-toolchain=<sha256> and --approve-evidence=<sha256>",
    );
  }
  return { command, options };
}

try {
  const { command, options } = parseCommand(process.argv.slice(2));
  const evidence = await currentEvidence();
  const encodedEvidence = encodedJson(evidence);
  const evidenceSha256 = sha256(encodedEvidence);
  if (command === "candidate" || command === "capture") {
    if (options["review-toolchain"] !== evidence.toolchain.manifestSha256) {
      throw new Error(`capture requires --review-toolchain=${evidence.toolchain.manifestSha256}`);
    }
  }
  if (command === "candidate") {
    await atomicWriteChecked(root, candidatePath, encodedEvidence);
  } else if (command === "capture") {
    if (options["approve-evidence"] !== evidenceSha256) {
      throw new Error(`capture requires --approve-evidence=${evidenceSha256}`);
    }
    const candidate = await readCheckedFile(root, candidatePath, 8 * 1024 * 1024);
    if (candidate.toString("utf8") !== encodedEvidence
      || sha256(candidate) !== options["approve-evidence"]) {
      throw new Error("reviewed Jena SHACL candidate differs from current evidence");
    }
    await atomicWriteChecked(root, evidencePath, encodedEvidence);
  } else if (command === "verify") {
    const approved = await readCheckedFile(root, evidencePath, 8 * 1024 * 1024);
    if (approved.toString("utf8") !== encodedEvidence) {
      throw new Error("Jena SHACL differential differs from approved evidence");
    }
  }
  process.stdout.write(`${JSON.stringify({
    valid: true,
    command,
    gatePassed: evidence.gatePassed,
    caseCount: evidence.cases.length,
    evidenceSha256,
    toolchainManifestSha256: evidence.toolchain.manifestSha256,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
