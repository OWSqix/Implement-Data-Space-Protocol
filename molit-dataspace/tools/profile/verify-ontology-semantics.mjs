#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { checkedPathBelow, readCheckedFile } from "../registries/safe-local-file.mjs";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const DEFAULT_RELEASE_ROOT = path.join(
  PROJECT_ROOT,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "1.0.0-rc.1",
);
const DEFAULT_REGISTRY = "ontology/competency-registry.json";
const REGISTRY_SCHEMA = path.join(
  PROJECT_ROOT,
  "contracts",
  "ontology-competency-registry.v1.schema.json",
);
const TOOLCHAIN_SCRIPT = path.join(PROJECT_ROOT, "tools", "dependencies", "jena-toolchain.mjs");
const OWL_SCRIPT = path.join(PROJECT_ROOT, "tools", "profile", "owl_consistency.py");
const JENA_ROOT = path.join(
  PROJECT_ROOT,
  ".local",
  "toolchains",
  "install",
  "apache-jena-6.1.0",
);
const JAVA_EXECUTABLE = path.join(
  PROJECT_ROOT,
  ".local",
  "toolchains",
  "install",
  "jdk-21.0.11+10-jre",
  "bin",
  process.platform === "win32" ? "java.exe" : "java",
);
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_QUERY_BYTES = 256 * 1024;
const MAX_PROCESS_OUTPUT = 16 * 1024 * 1024;
const EXPECTED_MODULES = Object.freeze([
  "core",
  "dataspace-offering",
  "geo",
  "network",
  "observation",
  "quality",
]);
const EXPECTED_DATASETS = Object.freeze({
  core: ["core-valid", "examples/valid/core-catalog.ttl"],
  "dataspace-offering": [
    "dataspace-offering-valid",
    "examples/valid/dataspace-offering-catalog.ttl",
  ],
  geo: ["geo-valid", "examples/valid/geo-catalog.ttl"],
  network: ["network-valid", "examples/valid/network-catalog.ttl"],
  observation: ["observation-valid", "examples/valid/observation-catalog.ttl"],
  quality: ["quality-valid", "examples/valid/quality-catalog.ttl"],
});
const EXPECTED_CQ_IDS = Object.freeze([
  "CQ-GEO-01",
  "CQ-GOV-01",
  "CQ-GOV-02",
  "CQ-NET-01",
  "CQ-NET-02",
  "CQ-NET-03",
  "CQ-NET-04",
  "CQ-OBS-01",
  "CQ-OBS-02",
  "CQ-OBS-03",
  "CQ-OBS-04",
  "CQ-OFF-01",
  "CQ-OFF-02",
  "CQ-ONTO-TERM-01",
  "CQ-QUAL-01",
  "CQ-QUAL-02",
  "CQ-QUAL-03",
  "CQ-QUAL-04",
  "CQ-TRANSFER-01",
]);
const EXPECTED_ZERO_CQS = new Set(["CQ-NET-03", "CQ-OFF-02", "CQ-QUAL-03"]);
const PROHIBITED_SPARQL = /(?<![?$])\b(?:SERVICE|LOAD|CLEAR|CREATE|DROP|INSERT|DELETE|MOVE|COPY|ADD|FROM|USING|WITH)\b/iu;

function portablePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")
    || value.includes("\0") || path.posix.isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty portable relative path`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")
    || path.posix.normalize(value) !== value) {
    throw new Error(`${label} is not a normalized release-relative path`);
  }
  return value;
}

function releasePath(releaseRoot, relativePath, label = "release path") {
  const relative = portablePath(relativePath, label);
  return path.resolve(releaseRoot, ...relative.split("/"));
}

async function readReleaseFile(releaseRoot, relativePath, maximumBytes) {
  return readCheckedFile(
    releaseRoot,
    releasePath(releaseRoot, relativePath),
    maximumBytes,
  );
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (cause) {
    throw new Error(`${label} is not strict UTF-8 JSON`, { cause });
  }
}

function parseProcessJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new Error(`${label} did not return one JSON document`, { cause });
  }
}

function runProcess(command, arguments_, {
  label,
  timeout = 60_000,
  acceptedStatuses = [0],
} = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: MAX_PROCESS_OUTPUT,
    shell: false,
    timeout,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${label} could not execute: ${result.error.message}`);
  if (result.signal) throw new Error(`${label} terminated by ${result.signal}`);
  if (!acceptedStatuses.includes(result.status)) {
    throw new Error(
      `${label} exited ${result.status}: ${(result.stderr || result.stdout || "no diagnostic").trim()}`,
    );
  }
  return result;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sortedBindings(rows) {
  return [...rows].sort((left, right) => {
    const leftKey = canonicalJson(left);
    const rightKey = canonicalJson(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function normalizeQueryText(value) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n?$/u, "\n");
}

function assertOfflineQuery(queryText, expectedForm, label) {
  if (PROHIBITED_SPARQL.test(queryText)) {
    throw new Error(`${label} contains a network-capable or update SPARQL keyword`);
  }
  const withoutPrefixes = queryText.replace(
    /^(?:\s*(?:PREFIX\s+[^\s:]*:\s*<[^>]+>|BASE\s+<[^>]+>)\s*)+/iu,
    "",
  );
  const expectedKeyword = expectedForm === "ask" ? "ASK" : "SELECT";
  if (!new RegExp(`^\\s*${expectedKeyword}\\b`, "iu").test(withoutPrefixes)) {
    throw new Error(`${label} must be a ${expectedKeyword} query`);
  }
}

export function extractDocumentedQueries(markdown) {
  const headings = [];
  const headingPattern = /^#{1,6}\s+[^\r\n]*\b(CQ-(?:(?:GEO|OBS|NET|OFF|QUAL|GOV|TRANSFER)-[0-9]{2}|ONTO-TERM-[0-9]{2}))\b[^\r\n]*$/gmu;
  for (const match of markdown.matchAll(headingPattern)) {
    headings.push({ id: match[1], start: match.index, bodyStart: match.index + match[0].length });
  }
  const result = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (result.has(heading.id)) throw new Error(`duplicate competency heading: ${heading.id}`);
    const end = headings[index + 1]?.start ?? markdown.length;
    const body = markdown.slice(heading.bodyStart, end);
    const fences = [...body.matchAll(/```sparql\s*\r?\n([\s\S]*?)\r?\n```/giu)];
    if (fences.length !== 1) {
      throw new Error(`${heading.id} must contain exactly one SPARQL fence`);
    }
    result.set(heading.id, normalizeQueryText(fences[0][1]));
  }
  return result;
}

export function verifyQueryDocumentationSync(registry, markdown, queryTexts) {
  const documented = extractDocumentedQueries(markdown);
  const expectedIds = registry.queries.map(({ documentationSection }) => documentationSection);
  const findings = [];
  for (const query of registry.queries) {
    const fileText = queryTexts.get(query.queryFile);
    const documentedText = documented.get(query.documentationSection);
    if (fileText === undefined) {
      findings.push({ code: "CQ_QUERY_FILE_MISSING", queryId: query.id });
      continue;
    }
    if (documentedText === undefined) {
      findings.push({ code: "CQ_DOCUMENTATION_SECTION_MISSING", queryId: query.id });
      continue;
    }
    if (normalizeQueryText(fileText) !== documentedText) {
      findings.push({ code: "CQ_DOCUMENTATION_QUERY_DRIFT", queryId: query.id });
    }
  }
  for (const id of documented.keys()) {
    if (!expectedIds.includes(id)) findings.push({ code: "CQ_UNREGISTERED_DOCUMENTATION", queryId: id });
  }
  return {
    documentedQueryCount: documented.size,
    registeredQueryCount: registry.queries.length,
    findings,
    passed: findings.length === 0,
  };
}

function assertRegistrySemantics(registry, manifest) {
  const datasetIds = registry.datasets.map(({ id }) => id);
  const modules = registry.datasets.map(({ module }) => module).sort();
  const queryIds = registry.queries.map(({ id }) => id);
  const queryFiles = registry.queries.map(({ queryFile }) => queryFile);
  if (new Set(datasetIds).size !== datasetIds.length
    || new Set(modules).size !== modules.length
    || new Set(queryIds).size !== queryIds.length
    || new Set(queryFiles).size !== queryFiles.length) {
    throw new Error("competency registry identifiers, modules and query files must be unique");
  }
  if (canonicalJson([...queryIds].sort()) !== canonicalJson(EXPECTED_CQ_IDS)) {
    throw new Error("competency registry must contain the exact RC.1 CQ identifier set");
  }
  if (canonicalJson(modules) !== canonicalJson(EXPECTED_MODULES)) {
    throw new Error("competency registry must bind exactly the six conformance modules");
  }
  for (const dataset of registry.datasets) {
    const expected = EXPECTED_DATASETS[dataset.module];
    if (!expected || dataset.id !== expected[0] || dataset.fixture !== expected[1]) {
      throw new Error(`unexpected valid fixture binding for module ${dataset.module}`);
    }
  }
  const manifestModules = Object.entries(manifest.profiles ?? {})
    .filter(([, profile]) => profile?.kind === "conformance")
    .map(([module]) => module)
    .sort();
  if (canonicalJson(manifestModules) !== canonicalJson(EXPECTED_MODULES)) {
    throw new Error("manifest conformance modules differ from the ontology test matrix");
  }
  if (canonicalJson(registry.baseGraphs) !== canonicalJson([
    manifest.ontology,
    manifest.publishedBundles?.support,
  ])) {
    throw new Error("competency base graphs differ from manifest ontology/support artifacts");
  }
  const knownDatasets = new Set(datasetIds);
  for (const query of registry.queries) {
    if (query.id !== query.documentationSection || !knownDatasets.has(query.datasetId)) {
      throw new Error(`invalid competency query binding: ${query.id}`);
    }
    for (const row of query.expectedRows) {
      if (Object.keys(row).some((name) => !query.expectedVariables.includes(name))) {
        throw new Error(`unexpected binding variable in ${query.id}`);
      }
    }
    const isEmpty = query.expectedRows.length === 0;
    if (isEmpty !== EXPECTED_ZERO_CQS.has(query.id)) {
      throw new Error(`unexpected zero-result contract for ${query.id}`);
    }
  }
}

export async function loadOntologyCompetencyRegistry({
  releaseRoot = DEFAULT_RELEASE_ROOT,
  registryRelative = DEFAULT_REGISTRY,
} = {}) {
  await checkedPathBelow(PROJECT_ROOT, releaseRoot, "directory");
  const [registryBytes, schemaBytes, manifestBytes] = await Promise.all([
    readReleaseFile(releaseRoot, registryRelative, MAX_JSON_BYTES),
    readCheckedFile(PROJECT_ROOT, REGISTRY_SCHEMA, MAX_JSON_BYTES),
    readReleaseFile(releaseRoot, "manifest.json", MAX_JSON_BYTES),
  ]);
  const registry = parseJson(registryBytes, registryRelative);
  const schema = parseJson(schemaBytes, "ontology competency registry schema");
  const manifest = parseJson(manifestBytes, "release manifest");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(registry)) {
    const details = (validate.errors ?? []).map(({ instancePath, message }) => (
      `${instancePath || "/"} ${message}`
    )).join("; ");
    throw new Error(`ontology competency registry schema validation failed: ${details}`);
  }
  assertRegistrySemantics(registry, manifest);
  return { registry, manifest, registryRelative };
}

async function verifyPinnedJena(registry) {
  await Promise.all([
    checkedPathBelow(PROJECT_ROOT, TOOLCHAIN_SCRIPT, "file"),
    checkedPathBelow(PROJECT_ROOT, JAVA_EXECUTABLE, "file"),
    checkedPathBelow(PROJECT_ROOT, JENA_ROOT, "directory"),
  ]);
  const verification = runProcess(process.execPath, [TOOLCHAIN_SCRIPT, "verify"], {
    label: "pinned Jena toolchain verification",
    timeout: 120_000,
  });
  const verificationJson = parseProcessJson(verification.stdout, "Jena toolchain verification");
  if (verificationJson.valid !== true) throw new Error("Jena toolchain verification did not pass");
  const version = runProcess(JAVA_EXECUTABLE, [
    `-Dlog4j.configurationFile=${path.join(JENA_ROOT, "log4j2.properties")}`,
    "-cp",
    path.join(JENA_ROOT, "lib", "*"),
    "arq.arq",
    "--version",
  ], { label: "Jena ARQ version probe" });
  const versionText = `${version.stdout}\n${version.stderr}`.trim();
  if (versionText !== `Apache Jena version ${registry.toolchain.jena}`) {
    throw new Error(`unexpected Jena ARQ version: ${versionText}`);
  }
  return {
    jenaVersion: registry.toolchain.jena,
    javaVersion: registry.toolchain.java,
    toolchainId: verificationJson.toolchainId,
    verified: true,
  };
}

function runArq(dataPaths, queryPath, label) {
  const arguments_ = [
    `-Dlog4j.configurationFile=${path.join(JENA_ROOT, "log4j2.properties")}`,
    "-cp",
    path.join(JENA_ROOT, "lib", "*"),
    "arq.arq",
  ];
  for (const dataPath of dataPaths) arguments_.push("--data", dataPath);
  arguments_.push("--query", queryPath, "--results", "JSON");
  const result = runProcess(JAVA_EXECUTABLE, arguments_, {
    label,
    timeout: 60_000,
  });
  return parseProcessJson(result.stdout, label);
}

function exactSelectResult(query, actual) {
  const variables = actual?.head?.vars;
  const bindings = actual?.results?.bindings;
  if (!Array.isArray(variables) || !Array.isArray(bindings)) {
    return { passed: false, reason: "ARQ did not return SPARQL SELECT JSON" };
  }
  const actualRows = sortedBindings(bindings);
  const expectedRows = sortedBindings(query.expectedRows);
  if (canonicalJson(variables) !== canonicalJson(query.expectedVariables)) {
    return { passed: false, reason: "result variables differ", actualVariables: variables };
  }
  if (canonicalJson(actualRows) !== canonicalJson(expectedRows)) {
    return {
      passed: false,
      reason: "exact result bindings differ",
      actualRows,
      expectedRows,
    };
  }
  return { passed: true, rowCount: actualRows.length };
}

function pythonCandidates() {
  if (process.platform === "win32") return [{ command: "py", prefix: ["-3.12"] }];
  return [
    ...(process.env.PYTHON ? [{ command: process.env.PYTHON, prefix: [] }] : []),
    { command: "python3", prefix: [] },
    { command: "python", prefix: [] },
  ];
}

export function runOwlConsistencyGate({ releaseRoot, registryPath }) {
  let selected = null;
  for (const candidate of pythonCandidates()) {
    const probe = spawnSync(
      candidate.command,
      [...candidate.prefix, "-I", "-B", "-c", "import sys; raise SystemExit(0)"],
      { encoding: "utf8", shell: false, timeout: 10_000, windowsHide: true },
    );
    if (!probe.error && probe.status === 0) {
      selected = candidate;
      break;
    }
  }
  if (!selected) throw new Error("no Python 3.12 launcher is available for the OWL-RL gate");
  const result = runProcess(selected.command, [
    ...selected.prefix,
    "-I",
    "-B",
    OWL_SCRIPT,
    "--release-root",
    releaseRoot,
    "--registry",
    registryPath,
  ], {
    label: "OWL-RL consistency gate",
    timeout: 120_000,
    acceptedStatuses: [0, 1],
  });
  const report = parseProcessJson(result.stdout, "OWL-RL consistency gate");
  if (report.schemaVersion !== "molit.owl-consistency-report/1"
    || typeof report.gatePassed !== "boolean") {
    throw new Error("OWL-RL consistency gate returned an invalid report");
  }
  return report;
}

export async function verifyOntologySemantics({
  releaseRoot = DEFAULT_RELEASE_ROOT,
  registryRelative = DEFAULT_REGISTRY,
  verifyToolchain = true,
  runOwl = true,
} = {}) {
  const root = path.resolve(releaseRoot);
  const { registry } = await loadOntologyCompetencyRegistry({
    releaseRoot: root,
    registryRelative,
  });
  const registryPath = releasePath(root, registryRelative);
  const queryPaths = new Map();
  const queryTexts = new Map();
  for (const relative of [
    registry.moduleProbe.queryFile,
    ...registry.queries.map(({ queryFile }) => queryFile),
  ]) {
    const bytes = await readReleaseFile(root, relative, MAX_QUERY_BYTES);
    const text = decoder.decode(bytes);
    assertOfflineQuery(
      text,
      relative === registry.moduleProbe.queryFile ? "ask" : "select",
      relative,
    );
    queryPaths.set(relative, releasePath(root, relative));
    queryTexts.set(relative, text);
  }
  const markdown = decoder.decode(await readReleaseFile(
    root,
    registry.documentation,
    MAX_MARKDOWN_BYTES,
  ));
  const documentation = verifyQueryDocumentationSync(registry, markdown, queryTexts);
  const toolchain = verifyToolchain
    ? await verifyPinnedJena(registry)
    : { verified: false, reason: "explicitly skipped by caller" };
  if (!verifyToolchain) {
    await Promise.all([
      checkedPathBelow(PROJECT_ROOT, JAVA_EXECUTABLE, "file"),
      checkedPathBelow(PROJECT_ROOT, JENA_ROOT, "directory"),
    ]);
  }

  const basePaths = registry.baseGraphs.map((relative) => releasePath(root, relative));
  for (const relative of registry.baseGraphs) {
    await readReleaseFile(root, relative, 32 * 1024 * 1024);
  }
  const datasets = new Map(registry.datasets.map((dataset) => [dataset.id, dataset]));
  const modules = [];
  for (const dataset of registry.datasets) {
    await readReleaseFile(root, dataset.fixture, 8 * 1024 * 1024);
    const result = runArq(
      [...basePaths, releasePath(root, dataset.fixture)],
      queryPaths.get(registry.moduleProbe.queryFile),
      `module ASK ${dataset.module}`,
    );
    const passed = result.boolean === registry.moduleProbe.expectedBoolean;
    modules.push({
      datasetId: dataset.id,
      module: dataset.module,
      expectedBoolean: registry.moduleProbe.expectedBoolean,
      actualBoolean: result.boolean,
      passed,
    });
  }

  const queries = [];
  for (const query of registry.queries) {
    const dataset = datasets.get(query.datasetId);
    const result = runArq(
      [...basePaths, releasePath(root, dataset.fixture)],
      queryPaths.get(query.queryFile),
      `competency query ${query.id}`,
    );
    queries.push({ id: query.id, datasetId: query.datasetId, ...exactSelectResult(query, result) });
  }
  const owlConsistency = runOwl
    ? runOwlConsistencyGate({ releaseRoot: root, registryPath })
    : { schemaVersion: "molit.owl-consistency-report/1", gatePassed: false, skipped: true };
  const findings = [
    ...documentation.findings,
    ...modules.filter(({ passed }) => !passed).map(({ module }) => ({
      code: "MODULE_ASK_MISMATCH",
      module,
    })),
    ...queries.filter(({ passed }) => !passed).map(({ id, reason }) => ({
      code: "COMPETENCY_RESULT_MISMATCH",
      queryId: id,
      reason,
    })),
    ...(owlConsistency.findings ?? []),
  ];
  const gatePassed = documentation.passed
    && modules.every(({ passed }) => passed)
    && queries.every(({ passed }) => passed)
    && owlConsistency.gatePassed === true;
  return {
    schemaVersion: "molit.ontology-semantics-report/1",
    profileVersion: registry.profileVersion,
    registry: {
      path: registryRelative,
      datasetCount: registry.datasets.length,
      queryCount: registry.queries.length,
      passed: true,
    },
    toolchain,
    documentation,
    modules,
    queries,
    owlConsistency,
    findings,
    gatePassed,
  };
}

function isMainModule() {
  return process.argv[1]
    && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  try {
    const report = await verifyOntologySemantics();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.gatePassed ? 0 : 1;
  } catch (error) {
    const report = {
      schemaVersion: "molit.ontology-semantics-report/1",
      gatePassed: false,
      findings: [{
        code: "ONTOLOGY_SEMANTICS_EXECUTION_ERROR",
        message: error.message,
      }],
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
  }
}
