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
import { verifyRequirementTraceability } from "./verify-requirement-traceability.mjs";

const { blankNode, literal, namedNode, quad } = DataFactory;
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const version = "1.0.0-rc.1";
const serializationScript = fileURLToPath(import.meta.url);
const pythonScript = fileURLToPath(new URL("./rc_serialization_parity.py", import.meta.url));
const candidatePath = path.join(root, ".local/molit-rc-serialization-parity.candidate.json");
const evidencePath = path.join(root, "evidence/validators/molit-rc-serialization-parity.v1.json");
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
const SH_SHAPES_GRAPH = `${SH}shapesGraph`;
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

export function serializationPythonEnvironment(source = process.env) {
  const environment = { LANG: "C", LC_ALL: "C" };
  for (const key of ["COMSPEC", "PATHEXT", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (source[key]) environment[key] = source[key];
  }
  return {
    ...environment,
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONHASHSEED: "0",
    PYTHONIOENCODING: "utf-8",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
  };
}

const pythonEnvironment = serializationPythonEnvironment;

function selectPython() {
  const candidates = process.platform === "win32"
    ? [
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "Programs/Python/Launcher/py.exe")
        : null,
      process.env.SystemRoot ? path.join(process.env.SystemRoot, "py.exe") : null,
      "py",
    ].filter(Boolean).map((command) => [command, ["-3.12"]])
    : [
      ...(path.isAbsolute(process.env.PYTHON ?? "") ? [[process.env.PYTHON, []]] : []),
      ["/usr/bin/python3", []],
      ["/usr/local/bin/python3", []],
      ["/opt/homebrew/bin/python3", []],
      ["python3", []],
      ["python", []],
    ];
  for (const [launcher, prefix] of candidates) {
    const probe = spawnSync(launcher, [
      ...prefix,
      "-I",
      "-B",
      "-c",
      "import pathlib,sys;import rdflib;print(pathlib.Path(sys.executable).resolve())",
    ], {
      encoding: "utf8",
      env: pythonEnvironment(),
      maxBuffer: 64 * 1024,
      shell: false,
      timeout: 10_000,
      windowsHide: true,
    });
    if (probe.error || probe.status !== 0) continue;
    const command = probe.stdout.trim();
    if (path.isAbsolute(command) && !command.includes("\0")) return command;
  }
  throw new Error("Python 3 with RDFLib is unavailable for full serialization parity");
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

function profileBundlePath(release, profileName) {
  const profile = release.manifest.profiles?.[profileName];
  assert(profile && profile.kind !== "diagnostic", `serialization profile is not executable: ${profileName}`);
  const bundleName = profile.bundle;
  const relative = release.manifest.publishedBundles?.[bundleName];
  assert(typeof relative === "string" && bundleName !== "support", `serialization profile has no published bundle: ${profileName}`);
  return relative;
}

function isExecutableProfile(release, profileName) {
  const profile = release.manifest.profiles?.[profileName];
  return Boolean(profile && profile.kind !== "diagnostic");
}

function executableProfileNames(release) {
  return Object.entries(release.manifest.profiles ?? {})
    .filter(([, profile]) => profile.kind !== "diagnostic")
    .map(([profileName]) => profileName)
    .sort();
}

export function deriveRequirementLinkedSerializationDefinitions(
  release,
  registry,
  caseRegistry,
) {
  assert(Array.isArray(registry?.requirements), "requirement registry has no requirements");
  assert(Array.isArray(caseRegistry?.fixtureCases), "case registry has no fixtures");
  const fixtureById = new Map(caseRegistry.fixtureCases.map((item) => [item.fixtureId, item]));
  assert(fixtureById.size === caseRegistry.fixtureCases.length, "fixture IDs must be unique");
  const references = new Map();
  for (const requirement of registry.requirements) {
    if (!requirement.conformanceClass.some((profileName) => (
      isExecutableProfile(release, profileName)
    ))) continue;
    for (const [field, expectedOutcome] of [
      ["positiveFixtureId", "conforms"],
      ["negativeFixtureId", "violates"],
    ]) {
      const fixtureId = requirement[field];
      if (fixtureId === null) continue;
      const fixture = fixtureById.get(fixtureId);
      assert(fixture?.expectedOutcome === expectedOutcome, `serialization fixture outcome mismatch: ${fixtureId}`);
      const reference = references.get(fixtureId) ?? { fixture, requirements: [] };
      reference.requirements.push(requirement);
      references.set(fixtureId, reference);
    }
  }
  return [...references].sort(([left], [right]) => left.localeCompare(right)).map(([
    fixtureId,
    reference,
  ]) => {
    const commonProfiles = reference.fixture.conformanceClass.filter((profileName) => (
      isExecutableProfile(release, profileName)
        && reference.requirements.every((requirement) => (
          requirement.conformanceClass.includes(profileName)
        ))
    )).sort();
    assert(commonProfiles.length > 0, `serialization fixture has no common profile: ${fixtureId}`);
    const profile = commonProfiles[0];
    profileBundlePath(release, profile);
    return {
      expectedConforms: reference.fixture.expectedOutcome === "conforms",
      expectedSha256: reference.fixture.sha256,
      fixtureId,
      id: `FULL-${fixtureId}`,
      input: reference.fixture.path,
      profile,
      requirementIds: [...new Set(reference.requirements.map((item) => (
        item.requirementId
      )))].sort(),
    };
  });
}

async function nodeDecision(validator, data, support, scope) {
  const merged = new Store([
    ...scopedStore(data, `${scope}-data`).getQuads(null, null, null, null),
    ...scopedStore(support, `${scope}-support`).getQuads(null, null, null, null),
  ]);
  const report = await validator.validate(merged);
  return { conforms: report.conforms, resultCount: report.results.length };
}

async function materializeProfileBundle(release, profileName) {
  const relative = profileBundlePath(release, profileName);
  const bytes = await releaseBytes(release, relative);
  const parsed = await loadRdfBytes(bytes, relative, rdfLimits, { format: "text/turtle" });
  const store = scopedStore(parsed.store, `serialization-shapes-${profileName}`);
  assert(
    store.countQuads(null, namedNode(SH_SHAPES_GRAPH), null, null) === 0,
    `external sh:shapesGraph is not allowed in serialization parity: ${profileName}`,
  );
  const imports = [];
  const visited = new Set();
  while (true) {
    const declarations = store.getQuads(null, namedNode(OWL_IMPORTS), null, null);
    if (declarations.length === 0) break;
    store.removeQuads(declarations);
    for (const declaration of declarations) {
      assert(
        declaration.object.termType === "NamedNode",
        `owl:imports target must be an IRI: ${profileName}`,
      );
      const iri = declaration.object.value;
      if (visited.has(iri)) continue;
      visited.add(iri);
      const importRelative = release.manifest.localImportMap?.[iri];
      assert(
        typeof importRelative === "string",
        `SHACL import is not in the local map: ${iri}`,
      );
      const importBytes = await releaseBytes(release, importRelative);
      const imported = await loadRdfBytes(
        importBytes,
        importRelative,
        rdfLimits,
        { format: "text/turtle" },
      );
      store.addQuads(scopedStore(
        imported.store,
        `serialization-import-${profileName}-${imports.length}`,
      ).getQuads(null, null, null, null));
      imports.push({ iri, path: importRelative, sha256: sha256(importBytes) });
    }
  }
  return { imports, store };
}

function validateWorkerOutput(value, definitions) {
  assert(value?.schemaVersion === "molit.rc-serialization-worker/1", "serialization worker schema differs");
  assert(value.networkPolicy === "python-audit-hook-deny-socket-and-process-spawn", "serialization worker network policy differs");
  assert(Array.isArray(value.results) && value.results.length === definitions.length, "serialization worker case count differs");
  const expectedIds = definitions.map((item) => item.id);
  assert(
    JSON.stringify(value.results.map((item) => item.id)) === JSON.stringify(expectedIds),
    "serialization worker case order differs",
  );
  for (const result of value.results) {
    assert(Array.isArray(result.conversions) && result.conversions.length === formats.length, `serialization conversion count differs: ${result.id}`);
    assert(
      JSON.stringify(result.conversions.map((item) => item.format))
        === JSON.stringify(formats.map((item) => item.name)),
      `serialization format order differs: ${result.id}`,
    );
  }
  return value;
}

async function buildFullRequirementLinkedParity({
  caseRegistryBytes,
  definitions,
  directory,
  python,
  registry,
  registryBytes,
  release,
  support,
  traceability,
}) {
  const request = Buffer.from(JSON.stringify({
    schemaVersion: "molit.rc-serialization-request/1",
    releaseRoot: release.releaseRoot,
    outputRoot: directory,
    cases: definitions.map((item) => ({
      id: item.id,
      input: resolveReleaseArtifact(release, item.input),
    })),
  }));
  assert(request.length <= 4 * 1024 * 1024, "serialization worker request exceeds its byte limit");
  const worker = validateWorkerOutput(parseJson(run(
    python,
    ["-s", "-P", "-B", pythonScript],
    { env: pythonEnvironment(), input: request },
  ), "serialization worker report"), definitions);

  const supportStore = support.store;
  const validators = new Map();
  const profileImports = {};
  for (const profileName of [...new Set(definitions.map((item) => item.profile))]) {
    const materialized = await materializeProfileBundle(release, profileName);
    validators.set(profileName, new SHACLValidator(materialized.store));
    profileImports[profileName] = materialized.imports;
  }

  const cases = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const sourceBytes = await releaseBytes(release, definition.input);
    assert(sha256(sourceBytes) === definition.expectedSha256, `serialization fixture digest differs: ${definition.fixtureId}`);
    const source = await loadRdfBytes(
      sourceBytes,
      definition.input,
      rdfLimits,
      { canonicalize: true, format: "text/turtle" },
    );
    const validator = validators.get(definition.profile);
    const baselineDecision = await nodeDecision(
      validator,
      source.store,
      supportStore,
      `${index}-baseline`,
    );
    assert(
      baselineDecision.conforms === definition.expectedConforms,
      `baseline Node decision differs: ${definition.fixtureId}`,
      "RC_SERIALIZATION_DECISION_MISMATCH",
    );
    const workerCase = worker.results[index];
    const conversions = [];
    for (const conversion of workerCase.conversions) {
      const format = formats.find((item) => item.name === conversion.format);
      assert(format, `unknown serialization worker format: ${conversion.format}`);
      const output = await readCheckedFile(
        directory,
        path.resolve(directory, ...conversion.path.split("/")),
        16 * 1024 * 1024,
      );
      assert(output.length === conversion.bytes && sha256(output) === conversion.sha256, `serialization worker output digest differs: ${definition.fixtureId}/${format.name}`);
      const converted = await loadRdfBytes(
        output,
        `${definition.fixtureId}.${format.extension}`,
        rdfLimits,
        { canonicalize: true, format: format.mediaType },
      );
      const defaultGraphPreserved = converted.store.getQuads(null, null, null, null)
        .every((item) => item.graph.termType === "DefaultGraph");
      assert(defaultGraphPreserved, `serialization moved data out of default graph: ${definition.fixtureId}/${format.name}`);
      assert(
        converted.canonicalGraph.sha256 === source.canonicalGraph.sha256,
        `serialization changed the canonical graph: ${definition.fixtureId}/${format.name}`,
        "RC_SERIALIZATION_GRAPH_MISMATCH",
      );
      const decision = await nodeDecision(
        validator,
        converted.store,
        supportStore,
        `${index}-${format.name}`,
      );
      assert(
        decision.conforms === baselineDecision.conforms,
        `serialization changed the Node decision: ${definition.fixtureId}/${format.name}`,
        "RC_SERIALIZATION_DECISION_MISMATCH",
      );
      conversions.push({
        canonicalGraphSha256: converted.canonicalGraph.sha256,
        defaultGraphPreserved,
        format: format.name,
        node: decision,
        output: {
          bytes: converted.canonicalGraph.canonicalBytes,
          digestScope: "RDFC-1.0-canonical-n-quads",
          sha256: converted.canonicalGraph.sha256,
        },
      });
    }
    cases.push({
      baseline: {
        canonicalGraphSha256: source.canonicalGraph.sha256,
        node: baselineDecision,
      },
      conversions,
      decision: definition.expectedConforms ? "conforms" : "violates",
      fixtureId: definition.fixtureId,
      input: definition.input,
      inputSha256: sha256(sourceBytes),
      profile: definition.profile,
      requirementIds: definition.requirementIds,
    });
  }
  const linkedRequirementIds = new Set(definitions.flatMap((item) => item.requirementIds));
  const executableRequirements = registry.requirements.filter((requirement) => (
    requirement.conformanceClass.some((profileName) => (
      isExecutableProfile(release, profileName)
    ))
  )).length;
  const profileNames = [...new Set(definitions.map((item) => item.profile))].sort();
  const expectedProfileNames = executableProfileNames(release);
  assert(
    JSON.stringify(profileNames) === JSON.stringify(expectedProfileNames),
    `serialization profile coverage differs: expected ${expectedProfileNames.join(", ")}; got ${profileNames.join(", ")}`,
    "RC_SERIALIZATION_PROFILE_COVERAGE_GAP",
  );
  const perProfile = Object.fromEntries(profileNames.map((profileName) => {
    const profileDefinitions = definitions.filter((item) => item.profile === profileName);
    const profileCoverage = {
      fixtureCount: profileDefinitions.length,
      formatConversionCount: profileDefinitions.length * formats.length,
      negativeFixtures: profileDefinitions.filter((item) => !item.expectedConforms).length,
      positiveFixtures: profileDefinitions.filter((item) => item.expectedConforms).length,
      requirementCount: new Set(profileDefinitions.flatMap((item) => item.requirementIds)).size,
    };
    assert(
      profileCoverage.positiveFixtures > 0 && profileCoverage.negativeFixtures > 0,
      `serialization profile needs positive and negative fixtures: ${profileName}`,
      "RC_SERIALIZATION_PROFILE_COVERAGE_GAP",
    );
    return [profileName, profileCoverage];
  }));
  assert(
    linkedRequirementIds.size === executableRequirements,
    `serialization requirement coverage differs: expected ${executableRequirements}; got ${linkedRequirementIds.size}`,
    "RC_SERIALIZATION_REQUIREMENT_COVERAGE_GAP",
  );
  return {
    cases,
    coverage: {
      caseRegistrySha256: sha256(caseRegistryBytes),
      fixtureCount: definitions.length,
      formats: formats.map((item) => item.name),
      linkedRequirements: linkedRequirementIds.size,
      profileCount: profileNames.length,
      profiles: profileNames,
      perProfile,
      profileImports,
      negativeFixtures: definitions.filter((item) => !item.expectedConforms).length,
      positiveFixtures: definitions.filter((item) => item.expectedConforms).length,
      requirementRegistrySha256: sha256(registryBytes),
      executableRequirements,
      excludedDiagnosticRequirements: registry.requirements.length - executableRequirements,
      registryRequirements: registry.requirements.length,
      traceabilityReportSha256: sha256(encode(traceability)),
    },
    worker: worker.engine,
  };
}

export async function buildRcSerializationParityCandidate() {
  const [implementationBytes, pythonImplementationBytes] = await Promise.all([
    readCheckedFile(root, serializationScript, 4 * 1024 * 1024),
    readCheckedFile(root, pythonScript, 4 * 1024 * 1024),
  ]);
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
  const registryRelative = release.manifest.requirementsRegistry;
  const caseRegistryRelative = release.manifest.conformanceCases;
  const [
    manifestBytes,
    sourceBytes,
    shapesBytes,
    supportBytes,
    registryBytes,
    caseRegistryBytes,
    lock,
    traceability,
  ] = await Promise.all([
    releaseBytes(release, "manifest.json"),
    releaseBytes(release, sourceRelative),
    releaseBytes(release, shapesRelative),
    releaseBytes(release, supportRelative),
    releaseBytes(release, registryRelative),
    releaseBytes(release, caseRegistryRelative),
    artifactLockReport(release),
    verifyRequirementTraceability({ releaseRoot: release.releaseRoot }),
  ]);
  const registry = parseJson(registryBytes, "requirement registry");
  const caseRegistry = parseJson(caseRegistryBytes, "conformance-case registry");
  const definitions = deriveRequirementLinkedSerializationDefinitions(
    release,
    registry,
    caseRegistry,
  );
  assert(definitions.length > 0, "requirement-linked serialization coverage is empty");
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
  const python = selectPython();
  const inputPath = path.join(directory, "source.ttl");
  const shapesPath = path.join(directory, "core-shapes.ttl");
  await Promise.all([
    writeFile(inputPath, sourceBytes, { flag: "wx" }),
    writeFile(shapesPath, shapesBytes, { flag: "wx" }),
  ]);
  let baseline;
  let fullCoverage;
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
    fullCoverage = await buildFullRequirementLinkedParity({
      caseRegistryBytes,
      definitions,
      directory,
      python,
      registry,
      registryBytes,
      release,
      support,
      traceability,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  for (const [relativePath, initial] of [
    ["manifest.json", manifestBytes],
    [sourceRelative, sourceBytes],
    [shapesRelative, shapesBytes],
    [supportRelative, supportBytes],
    [registryRelative, registryBytes],
    [caseRegistryRelative, caseRegistryBytes],
  ]) {
    const current = await releaseBytes(release, relativePath);
    assert(current.length === initial.length && sha256(current) === sha256(initial), `release artifact changed during serialization parity: ${relativePath}`);
  }
  for (const item of fullCoverage.cases) {
    const current = await releaseBytes(release, item.input);
    assert(sha256(current) === item.inputSha256, `requirement-linked fixture changed during serialization parity: ${item.fixtureId}`);
  }
  const currentLock = await releaseBytes(release, release.manifest.lockFile);
  assert(sha256(currentLock) === lock.sha256, "artifact lock changed during serialization parity");
  const nodePackage = parseJson(await readCheckedFile(
    root,
    path.join(root, "node_modules/rdf-validate-shacl/package.json"),
    1024 * 1024,
  ), "rdf-validate-shacl package metadata");
  assert(nodePackage.version === "0.6.5", "rdf-validate-shacl version differs from the reviewed baseline");
  const [currentImplementation, currentPythonImplementation] = await Promise.all([
    readCheckedFile(root, serializationScript, 4 * 1024 * 1024),
    readCheckedFile(root, pythonScript, 4 * 1024 * 1024),
  ]);
  assert(
    sha256(currentImplementation) === sha256(implementationBytes),
    "serialization parity implementation changed during execution",
  );
  assert(
    sha256(currentPythonImplementation) === sha256(pythonImplementationBytes),
    "serialization worker implementation changed during execution",
  );
  const executableRequirementCount = registry.requirements.filter((requirement) => (
    requirement.conformanceClass.some((profileName) => (
      isExecutableProfile(release, profileName)
    ))
  )).length;
  const releaseEvidenceEligible = lock.status === "verified"
    && traceability.gatePassed
    && registry.registryStatus === "approved"
    && caseRegistry.registryStatus === "approved"
    && fullCoverage.coverage.linkedRequirements === executableRequirementCount;
  return {
    artifactLock: lock,
    baseline: {
      canonicalGraphSha256: source.canonicalGraph.sha256,
      input: sourceRelative,
      inputSha256: sha256(sourceBytes),
      validation: baseline,
    },
    conversions: results,
    fullCoverage,
    engines: {
      jena: { name: "Apache Jena RIOT/SHACL", version: "6.1.0" },
      node: { canonicalization: "RDFC-1.0", validation: `rdf-validate-shacl@${nodePackage.version}` },
    },
    gatePassed: true,
    implementation: {
      nodeSha256: sha256(implementationBytes),
      pythonSha256: sha256(pythonImplementationBytes),
    },
    offlinePolicy: {
      inheritedClasspath: false,
      inheritedJavaOptions: false,
      javaRuntimeArguments,
      shapeBundle: "localImportMap artifacts are materialized; owl:imports are removed and sh:shapesGraph is rejected",
    },
    profile: "core",
    profileVersion: version,
    requirementTraceability: {
      caseRegistryStatus: traceability.caseRegistryStatus,
      coverage: traceability.coverage,
      gatePassed: traceability.gatePassed,
      registryStatus: traceability.registryStatus,
    },
    releaseEvidenceEligible,
    schemaVersion: "molit.rc-serialization-parity/1",
    scope: "Jena representative smoke plus five-format canonical graph and Node decision parity for every requirement-linked fixture in all seven non-diagnostic profiles, including publication-policy",
    toolchainManifestSha256: toolchain.manifestSha256,
  };
}

async function main() {
  const [command = "candidate", ...rest] = process.argv.slice(2);
  assert(["candidate", "capture", "verify"].includes(command), "unknown serialization parity command");
  const approval = rest.length === 1
    ? /^--approve-evidence=([a-f0-9]{64})$/u.exec(rest[0])?.[1] ?? null
    : null;
  if (command === "candidate") assert(rest.length === 0, "candidate accepts no arguments");
  if (command === "capture") assert(approval !== null, "capture requires --approve-evidence=<sha256>");
  if (command === "verify") assert(rest.length === 0, "verify accepts no arguments");
  const report = await buildRcSerializationParityCandidate();
  const encoded = encode(report);
  const reportSha256 = sha256(encoded);
  if (command === "candidate") {
    await mkdir(path.dirname(candidatePath), { recursive: true });
    await atomicWriteChecked(root, candidatePath, encoded);
  } else if (command === "capture") {
    assert(report.releaseEvidenceEligible, "serialization parity is not eligible for evidence capture");
    assert(approval === reportSha256, `capture requires --approve-evidence=${reportSha256}`);
    const candidate = await readCheckedFile(root, candidatePath, 32 * 1024 * 1024);
    assert(candidate.toString("utf8") === encoded, "reviewed serialization candidate differs");
    await atomicWriteChecked(root, evidencePath, encoded);
  } else {
    const evidence = await readCheckedFile(root, evidencePath, 32 * 1024 * 1024);
    assert(evidence.toString("utf8") === encoded, "serialization parity differs from approved evidence");
  }
  process.stdout.write(`${JSON.stringify({
    command,
    evidenceSha256: reportSha256,
    fullFixtureCount: report.fullCoverage.coverage.fixtureCount,
    representativeConversionCount: report.conversions.length,
    gatePassed: report.gatePassed,
    releaseEvidenceEligible: report.releaseEvidenceEligible,
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
