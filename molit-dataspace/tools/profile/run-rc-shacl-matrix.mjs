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
import { verifyRequirementTraceability } from "./verify-requirement-traceability.mjs";
import {
  atomicWriteChecked,
  readCheckedFile,
} from "../registries/safe-local-file.mjs";

const { blankNode, literal, namedNode, quad } = DataFactory;
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const version = "1.0.0-rc.1";
const evidencePath = path.join(root, "evidence/validators/molit-rc-shacl-matrix.v1.json");
const candidatePaths = Object.freeze({
  full: path.join(root, ".local/molit-rc-shacl-matrix.full.candidate.json"),
  representative: path.join(root, ".local/molit-rc-shacl-matrix.representative.candidate.json"),
});
const matrixScript = fileURLToPath(import.meta.url);
const pythonScript = fileURLToPath(new URL("./rc_shacl_matrix.py", import.meta.url));
const javaHome = path.join(root, ".local/toolchains/install/jdk-21.0.11+10-jre");
const jenaHome = path.join(root, ".local/toolchains/install/apache-jena-6.1.0");
const maxBuffer = 32 * 1024 * 1024;
const maxRequestBytes = 1024 * 1024;
const rdfLimits = Object.freeze({
  maxInputBytes: 16 * 1024 * 1024,
  maxInputQuads: 200_000,
  maxLiteralLength: 100_000,
  maxValidationResults: 10_000,
  maxValuesPerSubjectPredicate: 10_000,
});
const conformanceModules = Object.freeze([
  "core",
  "dataspace-offering",
  "geo",
  "network",
  "observation",
  "quality",
]);
const representativeCases = Object.freeze([
  ["RC-CORE-VALID", "core", "examples/valid/core-catalog.ttl", true],
  ["RC-CORE-SECTOR-SERVICE-VALID", "core", "examples/valid/sector-and-service-catalog.ttl", true],
  ["RC-GEO-VALID", "geo", "examples/valid/geo-catalog.ttl", true],
  ["RC-NETWORK-VALID", "network", "examples/valid/network-catalog.ttl", true],
  ["RC-OBSERVATION-VALID", "observation", "examples/valid/observation-catalog.ttl", true],
  ["RC-QUALITY-VALID", "quality", "examples/valid/quality-catalog.ttl", true],
  ["RC-OFFERING-VALID", "dataspace-offering", "examples/valid/dataspace-offering-catalog.ttl", true],
  ["RC-CORE-RELATION-INVALID", "core", "examples/invalid/catalog-record-dataset-mismatch.ttl", false],
  ["RC-GEO-CRS-INVALID", "geo", "examples/invalid/unapproved-geometry-crs.ttl", false],
  ["RC-NETWORK-CHECKSUM-INVALID", "network", "examples/invalid/network-snapshot-without-checksum.ttl", false],
  ["RC-OBSERVATION-UNIT-INVALID", "observation", "examples/invalid/observation-unit-mismatch.ttl", false],
  ["RC-QUALITY-RELATION-INVALID", "quality", "examples/invalid/quality-measurement-dataset-mismatch.ttl", false],
  ["RC-OFFERING-CLAIM-INVALID", "dataspace-offering", "examples/invalid/offering-operational-claim.ttl", false],
].map(([id, profile, input, expectedConforms]) => Object.freeze({
  expectedConforms,
  fixtureId: null,
  id,
  input,
  profile,
  requirementIds: [],
})));
const nodeOnlyPreflightControls = Object.freeze([
  Object.freeze({
    controlId: "MOLIT-SEC-PUBLIC-001",
    excludedFromCrossEngineMatrix: true,
    implementation: "scanPublicGraph",
    reason: "공개 그래프의 비밀정보·개인정보·내부 주소 차단은 SHACL 입력 전에 실행하는 JavaScript 안전 검사다.",
  }),
  Object.freeze({
    controlId: "MOLIT-PROFILE-SELECTION-001",
    excludedFromCrossEngineMatrix: true,
    implementation: "scanCoreProfileRouting",
    reason: "전체 그래프를 보고 core와 geo 모듈의 오선택을 막는 라우팅 검사다. fixture가 연결된 SHACL routing shape는 별도로 full matrix에 포함한다.",
  }),
  Object.freeze({
    controlId: "MOLIT-GEO-LEXICAL-PREFLIGHT-001",
    excludedFromCrossEngineMatrix: true,
    implementation: "scanPublicGraph",
    requirementIds: [
      "MOLIT-GEO-ENCODING-001",
      "MOLIT-GEO-ENCODING-002",
      "MOLIT-GEO-ENCODING-003",
      "MOLIT-GEO-ENCODING-004",
    ],
    reason: "SHACL은 datatype·CRS·geometry type의 교환 가능한 최소 구문을 판정한다. 닫힌 Polygon, GML 3.2 Point 구조, 2차원·크기 한계와 active XML 차단은 공식 Node publication preflight가 별도로 판정하며 SHACL 3-engine 동일성 주장에 포함하지 않는다.",
  }),
]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";
const SH = "http://www.w3.org/ns/shacl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const OWL_IMPORTS = "http://www.w3.org/2002/07/owl#imports";
const SH_SHAPES_GRAPH = `${SH}shapesGraph`;
const javaRuntimeArguments = Object.freeze([
  "-Dfile.encoding=UTF-8",
  "-Djava.awt.headless=true",
  "-Djava.net.useSystemProxies=false",
]);

function assert(condition, message, code = "RC_MATRIX_INVALID") {
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

function portablePath(value, label = "release path") {
  assert(
    typeof value === "string"
      && value.length > 0
      && value.length <= 240
      && !value.includes("\\")
      && !value.includes("\0")
      && !path.posix.isAbsolute(value)
      && path.posix.normalize(value) === value
      && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    `${label} must be a normalized release-relative path`,
    "INVALID_ARTIFACT_PATH",
  );
  return value;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (cause) {
    throw new Error(`${label} is not strict UTF-8 JSON`, { cause });
  }
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function boundedProcessFailure(command, result) {
  const summary = (payload) => {
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? "");
    return { bytes: bytes.length, sha256: sha256(bytes) };
  };
  const error = new Error(
    `${path.basename(command)} failed: ${JSON.stringify({
      errorCode: result.error?.code ?? null,
      signal: result.signal ?? null,
      status: result.status ?? null,
      stderr: summary(result.stderr),
      stdout: summary(result.stdout),
    })}`,
  );
  error.code = result.error?.code ?? "RC_MATRIX_PROCESS_FAILED";
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
  if (result.error || result.status !== 0) throw boundedProcessFailure(command, result);
  return Buffer.from(result.stdout ?? Buffer.alloc(0));
}

function baseEnvironment() {
  const environment = { LANG: "C", LC_ALL: "C" };
  for (const key of ["COMSPEC", "PATHEXT", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

function javaEnvironment() {
  const environment = { ...baseEnvironment(), JAVA_HOME: javaHome, JENA_HOME: jenaHome };
  environment.PATH = [
    path.join(javaHome, "bin"),
    ...(process.env.SystemRoot ? [path.join(process.env.SystemRoot, "System32")] : []),
  ].join(path.delimiter);
  return environment;
}

function nodeEnvironment() {
  const environment = baseEnvironment();
  environment.PATH = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32")
    : "";
  return environment;
}

function pythonEnvironment() {
  return {
    ...baseEnvironment(),
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
}

function selectPython() {
  const launcherCandidates = process.platform === "win32"
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
  for (const [launcher, prefix] of launcherCandidates) {
    const probe = spawnSync(launcher, [
      ...prefix,
      "-I",
      "-B",
      "-c",
      "import pathlib,sys;print(pathlib.Path(sys.executable).resolve())",
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
    if (!path.isAbsolute(command) || command.includes("\0")) continue;
    const direct = spawnSync(command, ["-I", "-B", "-c", "import sys;assert sys.version_info[:2]==(3,12)"], {
      encoding: "utf8",
      env: pythonEnvironment(),
      maxBuffer: 64 * 1024,
      shell: false,
      timeout: 10_000,
      windowsHide: true,
    });
    if (!direct.error && direct.status === 0) return command;
  }
  throw new Error("Python 3.12 independent SHACL lane is unavailable");
}

async function releaseBytes(release, relativePath, maximumBytes = 16 * 1024 * 1024) {
  const portable = portablePath(relativePath);
  return readCheckedFile(
    release.releaseRoot,
    resolveReleaseArtifact(release, portable),
    maximumBytes,
  );
}

async function artifactLockState(release, requireStableLock) {
  const lockBytes = await releaseBytes(release, release.manifest.lockFile, 16 * 1024 * 1024);
  try {
    const snapshot = await verifyArtifactLock(release);
    return {
      artifactBytes: snapshot.artifactBytes,
      report: { sha256: sha256(snapshot.lockBytes), status: "verified" },
    };
  } catch (error) {
    if (requireStableLock) throw error;
    const expectedPending = new Set([
      "INCOMPLETE_ARTIFACT_LOCK",
      "INVALID_ARTIFACT_LOCK",
      "PROFILE_ARTIFACT_DIGEST_MISMATCH",
      "PROFILE_CHANGED_DURING_VALIDATION",
      "PROFILE_LOCK_NOT_FOUND",
    ]);
    if (!expectedPending.has(error.code)) throw error;
    return {
      artifactBytes: null,
      report: {
        reasonCode: error.code,
        sha256: sha256(lockBytes),
        status: "pending",
      },
    };
  }
}

function assertRepresentativeManifest(release) {
  const actual = Object.entries(release.manifest.profiles)
    .filter(([, profile]) => profile.kind === "conformance")
    .map(([name]) => name)
    .sort();
  assert(
    JSON.stringify(actual) === JSON.stringify([...conformanceModules].sort()),
    "representative matrix must cover exactly the six RC conformance modules",
  );
  for (const module of conformanceModules) {
    const selected = representativeCases.filter((item) => item.profile === module);
    const expectedPositiveCount = module === "core" ? 2 : 1;
    assert(
      selected.length === expectedPositiveCount + 1
        && selected.filter((item) => item.expectedConforms).length === expectedPositiveCount
        && selected.filter((item) => !item.expectedConforms).length === 1,
      `representative matrix has an invalid positive-negative inventory for ${module}`,
    );
  }
}

function assertProfileCanValidate(release, profileName) {
  const profile = release.manifest.profiles?.[profileName];
  assert(profile && profile.kind !== "diagnostic", `matrix profile is not executable: ${profileName}`);
  const bundleName = profile.bundle;
  assert(
    typeof bundleName === "string"
      && Object.hasOwn(release.manifest.publishedBundles, bundleName)
      && bundleName !== "support",
    `matrix profile has no published bundle: ${profileName}`,
  );
  return release.manifest.publishedBundles[bundleName];
}

export function deriveFullMatrixDefinitions(release, registry, caseRegistry) {
  assert(
    registry?.registryStatus === "approved" && caseRegistry?.registryStatus === "approved",
    "full matrix definition requires approved registries",
    "RC_REQUIREMENTS_NOT_APPROVED",
  );
  assert(Array.isArray(registry.requirements), "requirement registry has no requirements");
  assert(Array.isArray(caseRegistry.fixtureCases), "case registry has no fixtures");
  const fixtureById = new Map(caseRegistry.fixtureCases.map((fixture) => [fixture.fixtureId, fixture]));
  assert(fixtureById.size === caseRegistry.fixtureCases.length, "fixture IDs must be unique");

  const references = new Map();
  for (const requirement of registry.requirements) {
    for (const [field, expectedOutcome] of [
      ["positiveFixtureId", "conforms"],
      ["negativeFixtureId", "violates"],
    ]) {
      const fixtureId = requirement[field];
      assert(typeof fixtureId === "string", `approved requirement lacks ${field}: ${requirement.requirementId}`);
      const fixture = fixtureById.get(fixtureId);
      assert(fixture?.expectedOutcome === expectedOutcome, `fixture outcome mismatch: ${fixtureId}`);
      const existing = references.get(fixtureId) ?? {
        fixture,
        requirements: [],
      };
      existing.requirements.push(requirement);
      references.set(fixtureId, existing);
    }
  }

  const definitions = [];
  for (const [fixtureId, reference] of [...references].sort(([left], [right]) => left.localeCompare(right))) {
    const commonProfiles = reference.fixture.conformanceClass.filter((profileName) => (
      release.manifest.profiles?.[profileName]?.kind !== "diagnostic"
      && reference.requirements.every((requirement) => requirement.conformanceClass.includes(profileName))
    )).sort();
    assert(
      commonProfiles.length > 0,
      `deduplicated fixture has no conformance class common to every linked requirement: ${fixtureId}`,
    );
    const profile = commonProfiles[0];
    assertProfileCanValidate(release, profile);
    definitions.push({
      expectedConforms: reference.fixture.expectedOutcome === "conforms",
      expectedSha256: reference.fixture.sha256,
      fixtureId,
      id: `FULL-${fixtureId}`,
      input: portablePath(reference.fixture.path, "fixture path"),
      profile,
      requirementIds: [...new Set(reference.requirements.map((item) => item.requirementId))].sort(),
    });
  }
  assert(definitions.length > 0, "approved requirement registry produced no full matrix cases");
  return definitions;
}

async function fullDefinitions(release, registryBytes, caseRegistryBytes) {
  const traceability = await verifyRequirementTraceability({ releaseRoot: release.releaseRoot });
  assert(
    traceability.gatePassed
      && traceability.registryStatus === "approved"
      && traceability.caseRegistryStatus === "approved",
    `full matrix requires approved requirement traceability (requirements=${traceability.registryStatus}, cases=${traceability.caseRegistryStatus}, errors=${traceability.summary.errors})`,
    "RC_REQUIREMENTS_NOT_APPROVED",
  );
  const registry = parseJson(registryBytes, "requirement registry");
  const caseRegistry = parseJson(caseRegistryBytes, "conformance-case registry");
  return {
    definitions: deriveFullMatrixDefinitions(release, registry, caseRegistry),
    traceability,
  };
}

function assertDefinitions(release, definitions) {
  const identifiers = new Set();
  const fixtureIds = new Set();
  for (const definition of definitions) {
    assert(/^[A-Z0-9][A-Z0-9._-]{0,119}$/u.test(definition.id), `invalid matrix case ID: ${definition.id}`);
    assert(!identifiers.has(definition.id), `duplicate matrix case ID: ${definition.id}`);
    identifiers.add(definition.id);
    portablePath(definition.input, "matrix input");
    assertProfileCanValidate(release, definition.profile);
    if (definition.fixtureId !== null) {
      assert(!fixtureIds.has(definition.fixtureId), `full matrix did not deduplicate fixture: ${definition.fixtureId}`);
      fixtureIds.add(definition.fixtureId);
    }
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
  assert(quads.every((item) => item.graph.termType === "DefaultGraph"), "SHACL data snapshot must use the default graph");
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "N-Triples" });
    writer.addQuads(quads);
    writer.end((error, output) => {
      if (error) reject(error);
      else resolve(Buffer.from(output, "utf8"));
    });
  });
}

async function jenaConforms(output) {
  const parsed = await loadRdfBytes(output, "jena-report.ttl", rdfLimits, {
    format: "text/turtle",
  });
  const reports = parsed.store.getSubjects(namedNode(RDF_TYPE), namedNode(`${SH}ValidationReport`), null);
  assert(reports.length === 1, "Jena emitted an invalid report count");
  const values = parsed.store.getObjects(reports[0], namedNode(`${SH}conforms`), null);
  assert(
    values.length === 1
      && values[0].termType === "Literal"
      && values[0].datatype.value === XSD_BOOLEAN
      && ["true", "false"].includes(values[0].value),
    "Jena report has no exact xsd:boolean sh:conforms value",
  );
  return {
    conforms: values[0].value === "true",
    resultCount: parsed.store.getObjects(reports[0], namedNode(`${SH}result`), null).length,
  };
}

function validatePythonOutput(value, definitions) {
  assert(exactKeys(value, ["engine", "networkPolicy", "results", "schemaVersion"]), "pySHACL output has invalid members");
  assert(value.schemaVersion === "molit.rc-shacl-matrix-python/1", "pySHACL output schema differs");
  assert(value.networkPolicy === "python-audit-hook-deny-socket-and-process-spawn", "pySHACL network policy differs");
  assert(
    exactKeys(value.engine, ["name", "versions"])
      && value.engine.name === "pySHACL"
      && exactKeys(value.engine.versions, ["pyshacl", "rdflib"])
      && value.engine.versions.pyshacl === "0.40.0"
      && value.engine.versions.rdflib === "7.6.0",
    "pySHACL engine identity differs from the reviewed baseline",
  );
  assert(Array.isArray(value.results) && value.results.length === definitions.length, "pySHACL result count differs");
  const expectedIds = definitions.map((item) => item.id);
  const actualIds = value.results.map((item) => item.id);
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), "pySHACL result order or IDs differ");
  for (const result of value.results) {
    assert(
      exactKeys(result, ["conforms", "id", "resultCount"])
        && typeof result.conforms === "boolean"
        && Number.isSafeInteger(result.resultCount)
        && result.resultCount >= 0,
      `pySHACL emitted an invalid result: ${result.id ?? "unknown"}`,
    );
  }
  return new Map(value.results.map((item) => [item.id, item]));
}

async function snapshotCases(release, definitions, artifactBytes, directory) {
  const sources = new Map();
  const read = async (relativePath) => {
    if (!sources.has(relativePath)) {
      const bytes = artifactBytes?.get(relativePath) ?? await releaseBytes(release, relativePath);
      sources.set(relativePath, Buffer.from(bytes));
    }
    return sources.get(relativePath);
  };
  const supportRelative = release.manifest.publishedBundles.support;
  const supportBytes = await read(supportRelative);
  await mkdir(path.join(directory, "bundles"), { recursive: true });
  await mkdir(path.join(directory, "inputs"), { recursive: true });
  await writeFile(path.join(directory, "support.ttl"), supportBytes, { flag: "wx" });

  const bundleSnapshots = new Map();
  for (const profile of [...new Set(definitions.map((item) => item.profile))].sort()) {
    const bundleRelative = assertProfileCanValidate(release, profile);
    const bundleBytes = await read(bundleRelative);
    const loaded = await loadRdfBytes(bundleBytes, bundleRelative, rdfLimits, { format: "text/turtle" });
    const shapeStore = scopedStore(loaded.store, `shapes-${profile}`);
    assert(
      shapeStore.countQuads(null, namedNode(SH_SHAPES_GRAPH), null, null) === 0,
      `external sh:shapesGraph is not allowed in the offline matrix: ${profile}`,
    );
    const localImports = [];
    const visitedImports = new Set();
    while (true) {
      const importQuads = shapeStore.getQuads(null, namedNode(OWL_IMPORTS), null, null);
      if (importQuads.length === 0) break;
      shapeStore.removeQuads(importQuads);
      for (const item of importQuads) {
        assert(item.object.termType === "NamedNode", `owl:imports target must be an IRI: ${profile}`);
        const iri = item.object.value;
        if (visitedImports.has(iri)) continue;
        visitedImports.add(iri);
        const relative = release.manifest.localImportMap?.[iri];
        assert(typeof relative === "string", `SHACL import is not in the local map: ${iri}`);
        const importedBytes = await read(relative);
        const imported = await loadRdfBytes(importedBytes, relative, rdfLimits, { format: "text/turtle" });
        shapeStore.addQuads(scopedStore(imported.store, `import-${profile}-${localImports.length}`)
          .getQuads(null, null, null, null));
        localImports.push({ iri, relative, sha256: sha256(importedBytes) });
      }
    }
    const materializedBytes = await writeNTriples(shapeStore);
    const snapshotRelative = `bundles/${profile}.ttl`;
    await writeFile(path.join(directory, ...snapshotRelative.split("/")), materializedBytes, { flag: "wx" });
    bundleSnapshots.set(profile, {
      bundleBytes,
      bundleRelative,
      localImports,
      materializedBytes,
      shapeStore,
      snapshotRelative,
    });
  }

  const prepared = [];
  for (const [index, definition] of definitions.entries()) {
    const inputBytes = await read(definition.input);
    if (definition.expectedSha256) {
      assert(sha256(inputBytes) === definition.expectedSha256, `fixture digest mismatch: ${definition.fixtureId}`);
    }
    const inputSnapshot = `inputs/${String(index).padStart(3, "0")}.ttl`;
    await writeFile(path.join(directory, ...inputSnapshot.split("/")), inputBytes, { flag: "wx" });
    prepared.push({
      ...definition,
      ...bundleSnapshots.get(definition.profile),
      inputBytes,
      inputSnapshot,
    });
  }
  return { prepared, sources, supportBytes };
}

async function assertSourcesUnchanged(release, sources) {
  for (const [relativePath, initial] of sources) {
    const current = await releaseBytes(release, relativePath);
    assert(
      current.length === initial.length && sha256(current) === sha256(initial),
      `release artifact changed during matrix execution: ${relativePath}`,
      "PROFILE_CHANGED_DURING_VALIDATION",
    );
  }
}

async function executeMatrix(release, definitions, artifactBytes, directory) {
  const { prepared, sources, supportBytes } = await snapshotCases(
    release,
    definitions,
    artifactBytes,
    directory,
  );
  const pythonCases = prepared.map((definition) => ({
    bundle: definition.snapshotRelative,
    id: definition.id,
    input: definition.inputSnapshot,
  }));
  const pythonRequest = Buffer.from(JSON.stringify({
    cases: pythonCases,
    releaseRoot: directory,
    schemaVersion: "molit.rc-shacl-matrix-request/1",
    support: "support.ttl",
  }), "utf8");
  assert(pythonRequest.length <= maxRequestBytes, "pySHACL request exceeds its byte limit");
  const python = selectPython();
  const pythonOutput = parseJson(run(
    python,
    ["-I", "-B", pythonScript],
    { env: pythonEnvironment(), input: pythonRequest },
  ), "pySHACL output");
  const pythonById = validatePythonOutput(pythonOutput, definitions);

  const support = await loadRdfBytes(supportBytes, "support.ttl", rdfLimits, { format: "text/turtle" });
  const scopedSupport = scopedStore(support.store, "support");
  const shapeCache = new Map();
  const java = path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  const executed = [];
  for (const [index, definition] of prepared.entries()) {
    if (!shapeCache.has(definition.profile)) {
      shapeCache.set(definition.profile, definition.shapeStore);
    }
    const input = await loadRdfBytes(definition.inputBytes, definition.input, rdfLimits, { format: "text/turtle" });
    const dataStore = new Store([
      ...scopedStore(input.store, `input-${index}`).getQuads(null, null, null, null),
      ...scopedSupport.getQuads(null, null, null, null),
    ]);
    const nodeReport = await new SHACLValidator(shapeCache.get(definition.profile)).validate(dataStore);
    const combinedPath = path.join(directory, `combined-${String(index).padStart(3, "0")}.nt`);
    await writeFile(combinedPath, await writeNTriples(dataStore), { flag: "wx" });
    const jenaOutput = run(java, [
      ...javaRuntimeArguments,
      "-cp",
      path.join(jenaHome, "lib", "*"),
      "shacl.shacl",
      "validate",
      "--shapes",
      pathToFileURL(path.join(directory, ...definition.snapshotRelative.split("/"))).href,
      "--data",
      pathToFileURL(combinedPath).href,
    ], { env: javaEnvironment() });
    const jena = await jenaConforms(jenaOutput);
    const pyshacl = pythonById.get(definition.id);
    assert(
      nodeReport.conforms === definition.expectedConforms
        && pyshacl.conforms === definition.expectedConforms
        && jena.conforms === definition.expectedConforms,
      `SHACL decision mismatch: ${JSON.stringify({
        expected: definition.expectedConforms,
        id: definition.id,
        jena: jena.conforms,
        node: nodeReport.conforms,
        pyshacl: pyshacl.conforms,
      })}`,
      "RC_SHACL_DECISION_MISMATCH",
    );
    executed.push({
      bundleSha256: sha256(definition.bundleBytes),
      decision: definition.expectedConforms ? "conforms" : "violates",
      engines: {
        jena: { conforms: jena.conforms, resultCount: jena.resultCount },
        node: { conforms: nodeReport.conforms, resultCount: nodeReport.results.length },
        pyshacl: { conforms: pyshacl.conforms, resultCount: pyshacl.resultCount },
      },
      fixtureId: definition.fixtureId,
      id: definition.id,
      input: definition.input,
      inputSha256: sha256(definition.inputBytes),
      localImports: definition.localImports,
      materializedBundleSha256: sha256(definition.materializedBytes),
      profile: definition.profile,
      requirementIds: definition.requirementIds,
    });
  }
  await assertSourcesUnchanged(release, sources);
  return { cases: executed, pythonEngine: pythonOutput.engine };
}

export async function buildRcShaclMatrixCandidate({
  mode = "representative",
  requireStableLock = false,
} = {}) {
  assert(["full", "representative"].includes(mode), `unknown RC matrix mode: ${mode}`);
  const [matrixScriptBytes, pythonScriptBytes] = await Promise.all([
    readCheckedFile(root, matrixScript, 4 * 1024 * 1024),
    readCheckedFile(root, pythonScript, 4 * 1024 * 1024),
  ]);
  const toolchain = parseJson(run(process.execPath, [
    "tools/dependencies/jena-toolchain.mjs",
    "verify",
  ], { env: nodeEnvironment() }), "Jena toolchain report");
  const release = await loadProfileRelease(version);
  if (mode === "representative") assertRepresentativeManifest(release);
  const lock = await artifactLockState(release, requireStableLock);
  const registryRelative = release.manifest.requirementsRegistry;
  const casesRelative = release.manifest.conformanceCases;
  const [manifestBytes, registryBytes, caseRegistryBytes] = await Promise.all([
    lock.artifactBytes?.get("manifest.json") ?? releaseBytes(release, "manifest.json", 8 * 1024 * 1024),
    lock.artifactBytes?.get(registryRelative)
      ?? releaseBytes(release, registryRelative, 8 * 1024 * 1024),
    lock.artifactBytes?.get(casesRelative)
      ?? releaseBytes(release, casesRelative, 8 * 1024 * 1024),
  ]);
  assert(
    JSON.stringify(parseJson(manifestBytes, "release manifest"))
      === JSON.stringify(release.manifest),
    "release manifest changed before matrix snapshot",
    "PROFILE_CHANGED_DURING_VALIDATION",
  );
  const registry = parseJson(registryBytes, "requirement registry");
  const caseRegistry = parseJson(caseRegistryBytes, "conformance-case registry");
  let definitions = representativeCases.map((item) => ({ ...item }));
  let traceability = null;
  if (mode === "full") {
    ({ definitions, traceability } = await fullDefinitions(release, registryBytes, caseRegistryBytes));
  }
  assertDefinitions(release, definitions);

  const directory = await mkdtemp(path.join(tmpdir(), "molit-rc-matrix-"));
  let execution;
  try {
    execution = await executeMatrix(release, definitions, lock.artifactBytes, directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  await assertSourcesUnchanged(release, new Map([
    ["manifest.json", Buffer.from(manifestBytes)],
    [registryRelative, Buffer.from(registryBytes)],
    [casesRelative, Buffer.from(caseRegistryBytes)],
  ]));
  const currentLock = await releaseBytes(release, release.manifest.lockFile);
  assert(sha256(currentLock) === lock.report.sha256, "artifact lock changed during matrix execution", "PROFILE_CHANGED_DURING_VALIDATION");
  const packageMetadata = parseJson(await readCheckedFile(
    root,
    path.join(root, "node_modules/rdf-validate-shacl/package.json"),
    1024 * 1024,
  ), "rdf-validate-shacl package metadata");
  assert(packageMetadata.version === "0.6.5", "rdf-validate-shacl version differs from the reviewed baseline");
  const [currentMatrixScript, currentPythonScript] = await Promise.all([
    readCheckedFile(root, matrixScript, 4 * 1024 * 1024),
    readCheckedFile(root, pythonScript, 4 * 1024 * 1024),
  ]);
  assert(
    sha256(currentMatrixScript) === sha256(matrixScriptBytes)
      && sha256(currentPythonScript) === sha256(pythonScriptBytes),
    "matrix implementation changed during execution",
  );
  const releaseEvidenceEligible = mode === "full"
    && lock.report.status === "verified"
    && registry.registryStatus === "approved"
    && caseRegistry.registryStatus === "approved";
  return {
    artifactLock: lock.report,
    cases: execution.cases,
    engines: {
      jena: { name: "Apache Jena SHACL", version: "6.1.0" },
      node: { name: "rdf-validate-shacl", version: packageMetadata.version },
      python: execution.pythonEngine,
    },
    gatePassed: true,
    implementation: {
      nodeSha256: sha256(matrixScriptBytes),
      pythonSha256: sha256(pythonScriptBytes),
    },
    mode,
    nodeOnlyPreflightControls,
    normativeBoundary: {
      nodePublicationPreflight: "Parser-backed public-graph controls execute before SHACL and may reject a graph that the bounded SHACL regex subset accepts.",
      shaclMatrix: "Node rdf-validate-shacl, pySHACL and Jena execute only the materialized SHACL bundle and locked support graph.",
    },
    offlinePolicy: {
      inheritedClasspath: false,
      inheritedJavaOptions: false,
      javaRuntimeArguments,
      python: "isolated mode plus audit-hook denial of socket and process spawn",
      shapeImports: "localImportMap artifacts materialized into the temporary shape graph; owl:imports removed before every engine executes",
    },
    profileVersion: version,
    releaseEvidenceEligible,
    requirementCoverage: mode === "full" ? {
      caseRegistrySha256: sha256(caseRegistryBytes),
      deduplicatedFixtures: definitions.length,
      requirementRegistrySha256: sha256(registryBytes),
      requirements: registry.requirements.length,
      traceabilityReportSha256: sha256(encode(traceability)),
    } : {
      caseRegistrySha256: sha256(caseRegistryBytes),
      requirementRegistrySha256: sha256(registryBytes),
      status: "representative-smoke-only",
    },
    schemaVersion: "molit.rc-shacl-engine-matrix/1",
    scope: mode === "full"
      ? "Approved SHACL requirement fixtures, deduplicated by fixture ID and executed in a declared conformance class; JavaScript preflight controls are listed separately"
      : "One positive and one representative negative for each of the six RC conformance modules, plus the combined sector-and-service core graph; JavaScript preflight controls are listed separately",
    toolchainManifestSha256: toolchain.manifestSha256,
  };
}

function parseArguments(argv) {
  const [command = "candidate", ...rest] = argv;
  assert(["candidate", "capture", "verify"].includes(command), `unknown command: ${command}`);
  let approval = null;
  let mode = "representative";
  let modeSeen = false;
  for (const argument of rest) {
    const modeMatch = /^--mode=(full|representative)$/u.exec(argument);
    const approvalMatch = /^--approve-evidence=([0-9a-f]{64})$/u.exec(argument);
    if (modeMatch && !modeSeen) {
      mode = modeMatch[1];
      modeSeen = true;
    }
    else if (approvalMatch && approval === null) approval = approvalMatch[1];
    else throw new Error(`invalid or duplicate argument: ${argument}`);
  }
  if (command === "capture" && (mode !== "full" || approval === null)) {
    throw new Error("capture requires --mode=full and --approve-evidence=<sha256>");
  }
  if (command === "verify" && (mode !== "full" || approval !== null)) {
    throw new Error("verify requires --mode=full and accepts no approval digest");
  }
  if (command === "candidate" && approval !== null) {
    throw new Error("candidate accepts no approval digest");
  }
  return { approval, command, mode };
}

async function main() {
  const { approval, command, mode } = parseArguments(process.argv.slice(2));
  const evidence = await buildRcShaclMatrixCandidate({
    mode,
    requireStableLock: command !== "candidate",
  });
  const encoded = encode(evidence);
  const evidenceSha256 = sha256(encoded);
  if (command === "candidate") {
    await mkdir(path.dirname(candidatePaths[mode]), { recursive: true });
    await atomicWriteChecked(root, candidatePaths[mode], encoded);
  } else if (command === "capture") {
    assert(evidence.releaseEvidenceEligible, "full matrix is not eligible for evidence capture");
    if (approval !== evidenceSha256) {
      throw new Error(`capture requires --approve-evidence=${evidenceSha256}`);
    }
    const candidate = await readCheckedFile(root, candidatePaths.full, 32 * 1024 * 1024);
    if (candidate.toString("utf8") !== encoded || sha256(candidate) !== approval) {
      throw new Error("reviewed candidate differs from the current full matrix");
    }
    await atomicWriteChecked(root, evidencePath, encoded);
  } else {
    const approved = await readCheckedFile(root, evidencePath, 32 * 1024 * 1024);
    if (approved.toString("utf8") !== encoded) {
      throw new Error("RC SHACL full matrix differs from approved evidence");
    }
  }
  process.stdout.write(`${JSON.stringify({
    caseCount: evidence.cases.length,
    command,
    evidenceSha256,
    gatePassed: evidence.gatePassed,
    mode,
    releaseEvidenceEligible: evidence.releaseEvidenceEligible,
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
