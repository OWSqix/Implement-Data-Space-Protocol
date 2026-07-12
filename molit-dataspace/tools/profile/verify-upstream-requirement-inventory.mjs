#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { DataFactory, Parser, Store } from "n3";
import {
  buildUpstreamRequirementEvidence,
  UPSTREAM_CSV_COLUMNS,
  upstreamRequirementCsvProjection,
} from "./build-upstream-requirement-inventory.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(root, "profiles/molit-dcat-ap/releases/1.0.0-rc.1");
const manifestPath = path.join(releaseRoot, "manifest.json");
const schemaPath = path.join(root, "contracts/upstream-requirement-inventory.v1.schema.json");
const pythonScript = path.join(root, "tools/profile/upstream_isolated_batch.py");
const javaHome = path.join(root, ".local/toolchains/install/jdk-21.0.11+10-jre");
const jenaHome = path.join(root, ".local/toolchains/install/apache-jena-6.1.0");
const toolchainScript = path.join(root, "tools/dependencies/jena-toolchain.mjs");
const expectedRegistry = "requirements/upstream-requirement-inventory.json";
const expectedCsv = "requirements/upstream-profile-requirements.csv";
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const { namedNode } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const SH = "http://www.w3.org/ns/shacl#";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function exactUnique(values) {
  return new Set(values).size === values.length;
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: 180_000,
    shell: false,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
    const error = new Error(`${path.basename(command)} failed: ${detail}`);
    error.code = "UPSTREAM_EXTERNAL_VALIDATOR_FAILED";
    throw error;
  }
  return result.stdout;
}

function portableArtifact(relative) {
  if (typeof relative !== "string"
    || !/^requirements\/upstream-isolated-evidence\/[A-Za-z0-9._-]+[.]ttl$/u.test(relative)
    || relative.split("/").some((segment) => ["", ".", ".."].includes(segment))) {
    throw new Error(`invalid upstream evidence artifact path: ${relative}`);
  }
  return path.join(releaseRoot, ...relative.split("/"));
}

export async function verifyUpstreamRequirementInventory() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const pointerValid = manifest.upstreamRequirementsRegistry === expectedRegistry;
  if (!pointerValid) {
    const error = new Error(`manifest upstreamRequirementsRegistry must equal ${expectedRegistry}`);
    error.code = "UPSTREAM_REGISTRY_POINTER_INVALID";
    throw error;
  }
  const csvPointerValid = manifest.upstreamRequirementsCsv === expectedCsv;
  if (!csvPointerValid) {
    const error = new Error(`manifest upstreamRequirementsCsv must equal ${expectedCsv}`);
    error.code = "UPSTREAM_CSV_POINTER_INVALID";
    throw error;
  }
  const inventoryPath = path.join(releaseRoot, ...manifest.upstreamRequirementsRegistry.split("/"));
  const csvPath = path.join(releaseRoot, ...manifest.upstreamRequirementsCsv.split("/"));
  const [schemaBytes, inventoryBytes, csvBytes, expected] = await Promise.all([
    readFile(schemaPath),
    readFile(inventoryPath),
    readFile(csvPath),
    buildUpstreamRequirementEvidence(),
  ]);
  const schema = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(schemaBytes));
  const actual = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inventoryBytes));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const schemaValid = validate(actual);
  const deterministic = JSON.stringify(actual) === JSON.stringify(expected.inventory);
  const csvDeterministic = csvBytes.toString("utf8") === expected.csvBytes
    && csvBytes.toString("utf8") === upstreamRequirementCsvProjection(actual.requirements)
    && actual.csvProjection.path === manifest.upstreamRequirementsCsv
    && actual.csvProjection.sha256 === sha256(csvBytes)
    && JSON.stringify(actual.csvProjection.columns) === JSON.stringify(UPSTREAM_CSV_COLUMNS);

  const referencedArtifacts = actual.evidence?.shards?.flatMap((shard) => [
    shard.shapes, shard.positive, shard.negative,
  ]) ?? [];
  const expectedArtifactPaths = [...expected.artifacts.keys()].sort();
  const referencedPaths = referencedArtifacts.map(({ path: relative }) => relative).sort();
  let artifactsDeterministic = JSON.stringify(expectedArtifactPaths) === JSON.stringify(referencedPaths);
  const artifactErrors = [];
  if (artifactsDeterministic) {
    for (const artifact of referencedArtifacts) {
      try {
        const bytes = await readFile(portableArtifact(artifact.path));
        const generated = expected.artifacts.get(artifact.path);
        if (!generated || bytes.toString("utf8") !== generated || sha256(bytes) !== artifact.sha256) {
          artifactsDeterministic = false;
          artifactErrors.push(`artifact differs: ${artifact.path}`);
        }
      } catch (error) {
        artifactsDeterministic = false;
        artifactErrors.push(`${artifact.path}: ${error.message}`);
      }
    }
  }

  const requirementIds = actual.requirements.map(({ requirementId }) => requirementId);
  const caseIds = actual.requirements.map(({ caseId }) => caseId);
  const focusNodes = actual.requirements.map(({ focusNode }) => focusNode);
  const evidenceShapes = actual.requirements.map(({ evidenceShapeId }) => evidenceShapeId);
  const uniqueIds = exactUnique(requirementIds)
    && exactUnique(caseIds)
    && exactUnique(focusNodes)
    && exactUnique(evidenceShapes);
  const enforceable = actual.requirements.filter(({ sourceConstraintEnforceable }) => sourceConstraintEnforceable).length;
  const operationalized = actual.requirements.length - enforceable;
  const isolatedPositive = actual.requirements.filter(({ positiveFixtureId }) => typeof positiveFixtureId === "string").length;
  const isolatedNegative = actual.requirements.filter(({ negativeFixtureId }) => typeof negativeFixtureId === "string").length;
  const countsMatch = actual.coverage.requirements === actual.requirements.length
    && actual.coverage.upstreamSourceConstraints === enforceable
    && actual.coverage.localOperationalizations === operationalized
    && actual.coverage.isolatedPositive === isolatedPositive
    && actual.coverage.isolatedNegative === isolatedNegative
    && actual.coverage.publicationPolicyTestCoverage === actual.requirements.length
    && actual.coverage.blockers === actual.requirements.filter(({ coverageStatus }) => coverageStatus !== "isolated").length
    && actual.evidence.validation.positiveResults === 0
    && actual.evidence.validation.negativeResults === actual.requirements.length
    && actual.evidence.validation.matchedNegativeCases === actual.requirements.length
    && actual.evidence.shards.reduce((sum, { cases }) => sum + cases, 0) === actual.requirements.length
    && actual.evidence.shards.every(({ cases }) => cases <= actual.evidence.maxCasesPerShard);
  const sourcePartitionValid = enforceable === 984
    && operationalized === 6
    && actual.requirements.filter(({ sourceShapeBlankNode }) => sourceShapeBlankNode).length === 44
    && actual.requirements.filter(({ evidenceMethod }) => evidenceMethod === "exact-target-overlay").length === 946
    && actual.requirements.filter(({ evidenceMethod }) => evidenceMethod === "deterministic-skolem-overlay").length === 38
    && actual.requirements.filter(({ evidenceMethod }) => evidenceMethod === "deprecation-policy-wrapper").length === 6;
  const gatePassed = pointerValid
    && csvPointerValid
    && schemaValid
    && deterministic
    && csvDeterministic
    && artifactsDeterministic
    && uniqueIds
    && countsMatch
    && sourcePartitionValid
    && actual.status === "isolated-evidence-complete"
    && actual.coverage.blockers === 0;
  return {
    schemaVersion: "molit.upstream-requirement-inventory-verification/1",
    profileVersion: actual.profileVersion,
    registryPath: manifest.upstreamRequirementsRegistry,
    csvPath: manifest.upstreamRequirementsCsv,
    inventorySha256: sha256(inventoryBytes),
    csvSha256: sha256(csvBytes),
    schemaSha256: sha256(schemaBytes),
    requirements: actual.requirements.length,
    upstreamSourceConstraints: enforceable,
    localOperationalizations: operationalized,
    shards: actual.evidence.shards.length,
    artifactCount: referencedArtifacts.length,
    blockers: actual.coverage.blockers,
    pointerValid,
    csvPointerValid,
    schemaValid,
    deterministic,
    csvDeterministic,
    artifactsDeterministic,
    uniqueIds,
    countsMatch,
    sourcePartitionValid,
    gatePassed,
    schemaErrors: validate.errors ?? [],
    artifactErrors,
  };
}

function selectPython() {
  const candidates = process.platform === "win32"
    ? [{ command: "py", prefix: ["-3.12"] }]
    : [
      ...(process.env.PYTHON ? [{ command: process.env.PYTHON, prefix: [] }] : []),
      { command: "python3", prefix: [] },
      { command: "python", prefix: [] },
    ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [
      ...candidate.prefix,
      "-I",
      "-B",
      "-c",
      "import pyshacl, rdflib; raise SystemExit(0)",
    ], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      windowsHide: true,
      shell: false,
    });
    if (!probe.error && probe.status === 0) return candidate;
  }
  const error = new Error("pySHACL 0.40.0 and rdflib 7.6.0 are required for --engines");
  error.code = "UPSTREAM_PYSHACL_TOOLCHAIN_MISSING";
  throw error;
}

function javaEnvironment() {
  const environment = { JAVA_HOME: javaHome, JENA_HOME: jenaHome, LANG: "C", LC_ALL: "C" };
  for (const key of ["COMSPEC", "PATHEXT", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  environment.PATH = [
    path.join(javaHome, "bin"),
    ...(process.env.SystemRoot ? [path.join(process.env.SystemRoot, "System32")] : []),
  ].join(path.delimiter);
  return environment;
}

function parseJenaReport(source) {
  const store = new Store(new Parser({ format: "text/turtle" }).parse(source));
  const reports = store.getSubjects(RDF_TYPE, namedNode(`${SH}ValidationReport`), null);
  if (reports.length !== 1) throw new Error("Jena emitted an invalid validation report count");
  const conforms = store.getObjects(reports[0], namedNode(`${SH}conforms`), null);
  if (conforms.length !== 1 || conforms[0].termType !== "Literal" || !["true", "false"].includes(conforms[0].value)) {
    throw new Error("Jena report has no exact boolean sh:conforms");
  }
  return {
    conforms: conforms[0].value === "true",
    resultCount: store.getObjects(reports[0], namedNode(`${SH}result`), null).length,
  };
}

function assertEngineDecisions(engine, results, shards) {
  if (!Array.isArray(results) || results.length !== shards.length) {
    throw new Error(`${engine} did not return every upstream evidence shard`);
  }
  for (let index = 0; index < shards.length; index += 1) {
    const result = results[index];
    const shard = shards[index];
    if (result.shardId !== shard.shardId
      || result.positive.conforms !== true
      || result.positive.resultCount !== 0
      || result.negative.conforms !== false
      || result.negative.resultCount !== shard.cases) {
      throw new Error(`${engine} decision/count mismatch for ${shard.shardId}: ${JSON.stringify(result)}`);
    }
  }
}

export async function verifyUpstreamRequirementEngines() {
  const node = await verifyUpstreamRequirementInventory();
  if (!node.gatePassed) throw new Error("Node upstream inventory/evidence gate must pass before --engines");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const inventory = JSON.parse(await readFile(
    path.join(releaseRoot, ...manifest.upstreamRequirementsRegistry.split("/")),
    "utf8",
  ));
  const shards = inventory.evidence.shards;

  const python = selectPython();
  const pythonRequest = JSON.stringify({
    schemaVersion: "molit.upstream-isolated-batch-request/1",
    releaseRoot,
    shards: shards.map((shard) => ({
      shardId: shard.shardId,
      shapes: shard.shapes.path,
      positive: shard.positive.path,
      negative: shard.negative.path,
    })),
  });
  const pythonOutput = JSON.parse(run(python.command, [
    ...python.prefix,
    "-I",
    "-B",
    pythonScript,
  ], {
    input: pythonRequest,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  }));
  if (pythonOutput.schemaVersion !== "molit.upstream-isolated-batch-python/1"
    || pythonOutput.engine?.name !== "pySHACL"
    || pythonOutput.engine?.versions?.pyshacl !== "0.40.0"
    || pythonOutput.engine?.versions?.rdflib !== "7.6.0") {
    throw new Error("pySHACL upstream evidence output has an unapproved identity");
  }
  assertEngineDecisions("pySHACL", pythonOutput.results, shards);

  const java = path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!existsSync(java) || !existsSync(path.join(jenaHome, "lib"))) {
    const error = new Error("pinned JDK 21 and Apache Jena 6.1.0 are required for --engines");
    error.code = "UPSTREAM_JENA_TOOLCHAIN_MISSING";
    throw error;
  }
  const toolchain = JSON.parse(run(process.execPath, [toolchainScript, "verify"]));
  const jenaResults = [];
  for (const shard of shards) {
    const execute = (data) => parseJenaReport(run(java, [
      "-cp",
      path.join(jenaHome, "lib", "*"),
      "shacl.shacl",
      "validate",
      "--shapes",
      pathToFileURL(portableArtifact(shard.shapes.path)).href,
      "--data",
      pathToFileURL(portableArtifact(data.path)).href,
    ], { env: javaEnvironment() }));
    jenaResults.push({
      shardId: shard.shardId,
      positive: execute(shard.positive),
      negative: execute(shard.negative),
    });
  }
  assertEngineDecisions("Apache Jena", jenaResults, shards);
  return {
    schemaVersion: "molit.upstream-requirement-engine-verification/1",
    profileVersion: inventory.profileVersion,
    requirements: inventory.requirements.length,
    shards: shards.length,
    validationsPerEngine: shards.length * 2,
    engines: {
      node: { name: "rdf-validate-shacl", version: "0.6.5", gatePassed: node.gatePassed },
      pyshacl: { ...pythonOutput.engine, results: pythonOutput.results },
      jena: { name: "Apache Jena SHACL", version: "6.1.0", toolchainId: toolchain.toolchainId, results: jenaResults },
    },
    gatePassed: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  const engines = arguments_.length === 1 && arguments_[0] === "--engines";
  if (arguments_.length > (engines ? 1 : 0)) {
    process.stderr.write(`usage: node ${path.basename(process.argv[1])} [--engines]\n`);
    process.exitCode = 1;
  } else {
    (engines ? verifyUpstreamRequirementEngines() : verifyUpstreamRequirementInventory())
      .then((report) => {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (!report.gatePassed) process.exitCode = 2;
      }).catch((error) => {
        process.stderr.write(`${error.code ? `${error.code}: ` : ""}${error.stack ?? error.message}\n`);
        process.exitCode = 1;
      });
  }
}
