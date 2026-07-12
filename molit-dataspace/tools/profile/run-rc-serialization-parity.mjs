#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import SHACLValidator from "rdf-validate-shacl";
import { DataFactory, Store, Writer } from "n3";
import { loadRdfBytes } from "../../src/profile/rdf-loader.mjs";
import {
  loadProfileRelease,
  resolveReleaseArtifact,
  verifyArtifactLock,
} from "../../src/profile/registry.mjs";
import {
  atomicWriteChecked,
  readCheckedFile,
} from "../registries/safe-local-file.mjs";

const { blankNode, literal, namedNode, quad } = DataFactory;
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const version = "1.0.0-rc.1";
const serializationScript = fileURLToPath(import.meta.url);
const candidatePath = path.join(root, ".local/molit-rc-serialization-parity.candidate.json");
const javaHome = path.join(root, ".local/toolchains/install/jdk-21.0.11+10-jre");
const jenaHome = path.join(root, ".local/toolchains/install/apache-jena-6.1.0");
const maxBuffer = 32 * 1024 * 1024;
const rdfLimits = Object.freeze({
  maxInputBytes: 16 * 1024 * 1024,
  maxInputQuads: 200_000,
  maxLiteralLength: 100_000,
  maxValidationResults: 10_000,
  maxValuesPerSubjectPredicate: 10_000,
});
const formats = Object.freeze([
  Object.freeze({ extension: "ttl", jena: "TURTLE", mediaType: "text/turtle", name: "turtle" }),
  Object.freeze({ extension: "rdf", jena: "RDFXML", mediaType: "application/rdf+xml", name: "rdfxml" }),
  Object.freeze({ extension: "jsonld", jena: "JSONLD", mediaType: "application/ld+json", name: "jsonld" }),
  Object.freeze({ extension: "nt", jena: "NTRIPLES", mediaType: "application/n-triples", name: "ntriples" }),
  Object.freeze({ extension: "nq", jena: "NQUADS", mediaType: "application/n-quads", name: "nquads" }),
]);
const SH = "http://www.w3.org/ns/shacl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";
const OWL_IMPORTS = "http://www.w3.org/2002/07/owl#imports";
const javaRuntimeArguments = Object.freeze([
  "-Dfile.encoding=UTF-8",
  "-Djava.awt.headless=true",
  "-Djava.net.useSystemProxies=false",
]);

function assert(condition, message, code = "RC_SERIALIZATION_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function encode(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

function processFailure(command, result) {
  const summary = (payload) => {
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? "");
    return { bytes: bytes.length, sha256: sha256(bytes) };
  };
  const error = new Error(`${path.basename(command)} failed: ${JSON.stringify({
    errorCode: result.error?.code ?? null,
    signal: result.signal ?? null,
    status: result.status ?? null,
    stderr: summary(result.stderr),
    stdout: summary(result.stdout),
  })}`);
  error.code = result.error?.code ?? "RC_SERIALIZATION_PROCESS_FAILED";
  return error;
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: null,
    maxBuffer,
    shell: false,
    timeout: 180_000,
    windowsHide: true,
    ...options,
  });
  if (result.error || result.status !== 0) throw processFailure(command, result);
  return Buffer.from(result.stdout ?? Buffer.alloc(0));
}

function javaEnvironment() {
  const environment = {
    JAVA_HOME: javaHome,
    JENA_HOME: jenaHome,
    LANG: "C",
    LC_ALL: "C",
  };
  for (const key of ["COMSPEC", "PATHEXT", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  environment.PATH = [
    path.join(javaHome, "bin"),
    ...(process.env.SystemRoot ? [path.join(process.env.SystemRoot, "System32")] : []),
  ].join(path.delimiter);
  return environment;
}

function nodeEnvironment() {
  const environment = { LANG: "C", LC_ALL: "C" };
  for (const key of ["COMSPEC", "PATHEXT", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  environment.PATH = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32")
    : "";
  return environment;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new Error(`${label} is not strict UTF-8 JSON`, { cause });
  }
}

async function releaseBytes(release, relativePath, maximumBytes = 16 * 1024 * 1024) {
  return readCheckedFile(
    release.releaseRoot,
    resolveReleaseArtifact(release, relativePath),
    maximumBytes,
  );
}

async function artifactLockReport(release) {
  const lockBytes = await releaseBytes(release, release.manifest.lockFile);
  try {
    const snapshot = await verifyArtifactLock(release);
    return { sha256: sha256(snapshot.lockBytes), status: "verified" };
  } catch (error) {
    const expectedPending = new Set([
      "INCOMPLETE_ARTIFACT_LOCK",
      "INVALID_ARTIFACT_LOCK",
      "PROFILE_ARTIFACT_DIGEST_MISMATCH",
      "PROFILE_CHANGED_DURING_VALIDATION",
      "PROFILE_LOCK_NOT_FOUND",
    ]);
    if (!expectedPending.has(error.code)) throw error;
    return { reasonCode: error.code, sha256: sha256(lockBytes), status: "pending" };
  }
}

function remapTerm(term, scope, identifiers) {
  if (term.termType === "BlankNode") {
    if (!identifiers.has(term.value)) identifiers.set(term.value, `${scope}-${identifiers.size}`);
    return blankNode(identifiers.get(term.value));
  }
  if (term.termType === "Literal") {
    return term.language
      ? literal(term.value, term.language)
      : literal(term.value, namedNode(term.datatype.value));
  }
  if (term.termType === "Quad") {
    return quad(
      remapTerm(term.subject, scope, identifiers),
      remapTerm(term.predicate, scope, identifiers),
      remapTerm(term.object, scope, identifiers),
      remapTerm(term.graph, scope, identifiers),
    );
  }
  return term;
}

function scopedStore(store, scope) {
  const identifiers = new Map();
  return new Store(store.getQuads(null, null, null, null).map((item) => quad(
    remapTerm(item.subject, scope, identifiers),
    remapTerm(item.predicate, scope, identifiers),
    remapTerm(item.object, scope, identifiers),
    remapTerm(item.graph, scope, identifiers),
  )));
}

function writeNTriples(store) {
  const quads = store.getQuads(null, null, null, null);
  assert(quads.every((item) => item.graph.termType === "DefaultGraph"), "validation snapshot must remain in the default graph");
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "N-Triples" });
    writer.addQuads(quads);
    writer.end((error, output) => {
      if (error) reject(error);
      else resolve(Buffer.from(output, "utf8"));
    });
  });
}

async function jenaDecision(output) {
  const report = await loadRdfBytes(output, "jena-report.ttl", rdfLimits, { format: "text/turtle" });
  const reports = report.store.getSubjects(namedNode(RDF_TYPE), namedNode(`${SH}ValidationReport`), null);
  assert(reports.length === 1, "Jena emitted an invalid SHACL report count");
  const conforms = report.store.getObjects(reports[0], namedNode(`${SH}conforms`), null);
  assert(
    conforms.length === 1
      && conforms[0].termType === "Literal"
      && conforms[0].datatype.value === XSD_BOOLEAN
      && ["true", "false"].includes(conforms[0].value),
    "Jena SHACL report has no exact xsd:boolean sh:conforms",
  );
  return {
    conforms: conforms[0].value === "true",
    resultCount: report.store.getObjects(reports[0], namedNode(`${SH}result`), null).length,
  };
}

async function validateGraph({ data, shapes, support, java, shapesPath, directory, label }) {
  const merged = new Store([
    ...scopedStore(data, `${label}-data`).getQuads(null, null, null, null),
    ...support.getQuads(null, null, null, null),
  ]);
  const node = await new SHACLValidator(shapes).validate(merged);
  const dataPath = path.join(directory, `${label}-validation.nt`);
  await writeFile(dataPath, await writeNTriples(merged), { flag: "wx" });
  const jena = await jenaDecision(run(java, [
    ...javaRuntimeArguments,
    "-cp",
    path.join(jenaHome, "lib", "*"),
    "shacl.shacl",
    "validate",
    "--shapes",
    pathToFileURL(shapesPath).href,
    "--data",
    pathToFileURL(dataPath).href,
  ], { env: javaEnvironment() }));
  return {
    jena,
    node: { conforms: node.conforms, resultCount: node.results.length },
  };
}

export async function buildRcSerializationParityCandidate() {
  const implementationBytes = await readCheckedFile(
    root,
    serializationScript,
    4 * 1024 * 1024,
  );
  const toolchain = parseJson(run(process.execPath, [
    "tools/dependencies/jena-toolchain.mjs",
    "verify",
  ], { env: nodeEnvironment() }), "Jena toolchain report");
  const release = await loadProfileRelease(version);
  const coreProfile = release.manifest.profiles?.core;
  assert(coreProfile?.kind === "conformance" && coreProfile.bundle === "core", "RC core profile bundle mapping differs");
  const sourceRelative = "examples/valid/core-catalog.ttl";
  const shapesRelative = release.manifest.publishedBundles.core;
  const supportRelative = release.manifest.publishedBundles.support;
  const [manifestBytes, sourceBytes, shapesBytes, supportBytes, lock] = await Promise.all([
    releaseBytes(release, "manifest.json"),
    releaseBytes(release, sourceRelative),
    releaseBytes(release, shapesRelative),
    releaseBytes(release, supportRelative),
    artifactLockReport(release),
  ]);
  assert(
    JSON.stringify(parseJson(manifestBytes, "release manifest"))
      === JSON.stringify(release.manifest),
    "release manifest changed before serialization snapshot",
  );
  const [source, shapes, support] = await Promise.all([
    loadRdfBytes(sourceBytes, sourceRelative, rdfLimits, { canonicalize: true, format: "text/turtle" }),
    loadRdfBytes(shapesBytes, shapesRelative, rdfLimits, { format: "text/turtle" }),
    loadRdfBytes(supportBytes, supportRelative, rdfLimits, { format: "text/turtle" }),
  ]);
  assert(
    shapes.store.countQuads(null, namedNode(OWL_IMPORTS), null, null) === 0
      && shapes.store.countQuads(null, namedNode(`${SH}shapesGraph`), null, null) === 0,
    "RC core serialization lane requires a self-contained offline shape bundle",
  );
  assert(source.store.getQuads(null, null, null, null).every((item) => (
    item.graph.termType === "DefaultGraph"
  )), "RC core source must be a default-graph document");

  const directory = await mkdtemp(path.join(tmpdir(), "molit-rc-serialization-"));
  const java = path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  const inputPath = path.join(directory, "source.ttl");
  const shapesPath = path.join(directory, "core-shapes.ttl");
  await Promise.all([
    writeFile(inputPath, sourceBytes, { flag: "wx" }),
    writeFile(shapesPath, shapesBytes, { flag: "wx" }),
  ]);
  let baseline;
  const results = [];
  try {
    baseline = await validateGraph({
      data: source.store,
      directory,
      java,
      label: "source",
      shapes: shapes.store,
      shapesPath,
      support: scopedStore(support.store, "support"),
    });
    assert(baseline.node.conforms && baseline.jena.conforms, "RC core source does not conform before conversion");
    for (const format of formats) {
      const output = run(java, [
        ...javaRuntimeArguments,
        "-cp",
        path.join(jenaHome, "lib", "*"),
        "riotcmd.riot",
        "--syntax=TURTLE",
        "--strict",
        "--check",
        `--output=${format.jena}`,
        inputPath,
      ], { env: javaEnvironment() });
      assert(output.length > 0 && output.length <= maxBuffer, `Jena emitted invalid ${format.name} output size`);
      const converted = await loadRdfBytes(
        output,
        `converted.${format.extension}`,
        rdfLimits,
        { canonicalize: true, format: format.mediaType },
      );
      const defaultGraphPreserved = converted.store.getQuads(null, null, null, null).every((item) => (
        item.graph.termType === "DefaultGraph"
      ));
      assert(defaultGraphPreserved, `${format.name} conversion moved data out of the default graph`);
      assert(
        converted.canonicalGraph.sha256 === source.canonicalGraph.sha256,
        `${format.name} conversion changed the canonical RDF graph`,
        "RC_SERIALIZATION_GRAPH_MISMATCH",
      );
      const decision = await validateGraph({
        data: converted.store,
        directory,
        java,
        label: format.name,
        shapes: shapes.store,
        shapesPath,
        support: scopedStore(support.store, `support-${format.name}`),
      });
      assert(
        decision.node.conforms === baseline.node.conforms
          && decision.jena.conforms === baseline.jena.conforms
          && decision.node.conforms === decision.jena.conforms,
        `${format.name} conversion changed the core module validation decision`,
        "RC_SERIALIZATION_DECISION_MISMATCH",
      );
      results.push({
        canonicalGraphSha256: converted.canonicalGraph.sha256,
        defaultGraphPreserved,
        format: format.name,
        jenaOutput: {
          bytes: output.length,
          sha256: sha256(output),
        },
        validation: decision,
      });
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  for (const [relativePath, initial] of [
    ["manifest.json", manifestBytes],
    [sourceRelative, sourceBytes],
    [shapesRelative, shapesBytes],
    [supportRelative, supportBytes],
  ]) {
    const current = await releaseBytes(release, relativePath);
    assert(current.length === initial.length && sha256(current) === sha256(initial), `release artifact changed during serialization parity: ${relativePath}`);
  }
  const currentLock = await releaseBytes(release, release.manifest.lockFile);
  assert(sha256(currentLock) === lock.sha256, "artifact lock changed during serialization parity");
  const nodePackage = parseJson(await readCheckedFile(
    root,
    path.join(root, "node_modules/rdf-validate-shacl/package.json"),
    1024 * 1024,
  ), "rdf-validate-shacl package metadata");
  assert(nodePackage.version === "0.6.5", "rdf-validate-shacl version differs from the reviewed baseline");
  const currentImplementation = await readCheckedFile(
    root,
    serializationScript,
    4 * 1024 * 1024,
  );
  assert(
    sha256(currentImplementation) === sha256(implementationBytes),
    "serialization parity implementation changed during execution",
  );
  return {
    artifactLock: lock,
    baseline: {
      canonicalGraphSha256: source.canonicalGraph.sha256,
      input: sourceRelative,
      inputSha256: sha256(sourceBytes),
      validation: baseline,
    },
    conversions: results,
    engines: {
      jena: { name: "Apache Jena RIOT/SHACL", version: "6.1.0" },
      node: { canonicalization: "RDFC-1.0", validation: `rdf-validate-shacl@${nodePackage.version}` },
    },
    gatePassed: true,
    implementationSha256: sha256(implementationBytes),
    offlinePolicy: {
      inheritedClasspath: false,
      inheritedJavaOptions: false,
      javaRuntimeArguments,
      shapeBundle: "self-contained; owl:imports and sh:shapesGraph are rejected",
    },
    profile: "core",
    profileVersion: version,
    releaseEvidenceEligible: false,
    schemaVersion: "molit.rc-serialization-parity/1",
    scope: "Jena serialization conversion followed by Node canonical graph comparison and Node/Jena core-module decision parity",
    toolchainManifestSha256: toolchain.manifestSha256,
  };
}

async function main() {
  const [command = "candidate", ...rest] = process.argv.slice(2);
  assert(command === "candidate" && rest.length === 0, "serialization parity currently supports candidate only");
  const report = await buildRcSerializationParityCandidate();
  const encoded = encode(report);
  await mkdir(path.dirname(candidatePath), { recursive: true });
  await atomicWriteChecked(root, candidatePath, encoded);
  process.stdout.write(`${JSON.stringify({
    candidateSha256: sha256(encoded),
    conversionCount: report.conversions.length,
    gatePassed: report.gatePassed,
    valid: true,
  }, null, 2)}\n`);
}

if (process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
