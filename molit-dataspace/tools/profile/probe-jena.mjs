#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  loadRdfBytes,
} from "../../src/profile/rdf-loader.mjs";

const REQUIRED_JENA_VERSION = "6.1.0";
const REQUIRED_JAVA_MAJOR = 21;
const PROCESS_TIMEOUT_MS = 30_000;
const MAX_PROCESS_OUTPUT_BYTES = 32 * 1024 * 1024;
const limits = {
  maxInputBytes: 5 * 1024 * 1024,
  maxInputQuads: 100_000,
  maxLiteralLength: 20_000,
  maxValidationResults: 500,
  maxValuesPerSubjectPredicate: 1_000,
};
const syntaxByFormat = new Map([
  ["jsonld", "JSONLD"],
  ["nquads", "NQUADS"],
  ["ntriples", "NTRIPLES"],
  ["rdfxml", "RDFXML"],
  ["turtle", "TURTLE"],
]);
const formatByExtension = new Map([
  [".jsonld", "application/ld+json"],
  [".nq", "application/n-quads"],
  [".nt", "application/n-triples"],
  [".owl", "application/rdf+xml"],
  [".rdf", "application/rdf+xml"],
  [".ttl", "text/turtle"],
  [".xml", "application/rdf+xml"],
]);

function requirements() {
  return {
    installation: "https://jena.apache.org/download/",
    java: {
      minimumMajor: REQUIRED_JAVA_MAJOR,
      source: "https://jena.apache.org/download/",
    },
    jena: {
      distribution: "apache-jena binary commands distribution",
      version: REQUIRED_JENA_VERSION,
      verification: "this behavior probe does not verify provenance; the release gate separately verifies publisher checksum snapshots, archive bytes, and installed-tree bytes",
    },
    setup: {
      allPlatforms: "set JENA_HOME to the verified apache-jena-6.1.0 directory",
      windows: "JENA_HOME is required; the probe invokes riotcmd.riot through the pinned Java runtime",
    },
  };
}

function sanitizedJavaEnvironment(source) {
  const environment = {};
  for (const key of ["COMSPEC", "PATHEXT", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (source[key]) environment[key] = source[key];
  }
  if (source.JAVA_HOME) environment.JAVA_HOME = source.JAVA_HOME;
  if (source.JENA_HOME) environment.JENA_HOME = source.JENA_HOME;
  const pathEntries = [];
  if (source.JAVA_HOME) pathEntries.push(path.join(source.JAVA_HOME, "bin"));
  if (source.SystemRoot) pathEntries.push(path.join(source.SystemRoot, "System32"));
  environment.PATH = pathEntries.join(path.delimiter);
  environment.LANG = "C";
  environment.LC_ALL = "C";
  return environment;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--input" && flag !== "--format") {
      const error = new Error(`unknown Jena probe option: ${flag}`);
      error.code = "INVALID_ARGUMENTS";
      throw error;
    }
    if (options[flag.slice(2)] !== undefined || index + 1 >= argv.length) {
      const error = new Error(`missing or duplicate value for ${flag}`);
      error.code = "INVALID_ARGUMENTS";
      throw error;
    }
    options[flag.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (options.format && !options.input) {
    const error = new Error("--format requires --input");
    error.code = "INVALID_ARGUMENTS";
    throw error;
  }
  return options;
}

function javaCommand(env) {
  if (env.JAVA_HOME) {
    return path.join(env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java");
  }
  return "java";
}

function run(command, args, env, maxBuffer = 1024 * 1024) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    maxBuffer,
    shell: false,
    timeout: PROCESS_TIMEOUT_MS,
    windowsHide: true,
  });
}

function javaRuntime(env) {
  const command = javaCommand(env);
  const result = run(command, ["-version"], env);
  if (result.error || result.status !== 0) return { available: false, command };
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const version = /version\s+"([^"]+)"/u.exec(output)?.[1] ?? null;
  const first = Number(version?.split(".")[0]);
  const major = first === 1 ? Number(version?.split(".")[1]) : first;
  return {
    available: Number.isSafeInteger(major),
    command,
    major,
    version,
  };
}

function riotCommand(env, java) {
  if (env.JENA_HOME) {
    const home = path.resolve(env.JENA_HOME);
    const lib = path.join(home, "lib");
    if (!existsSync(lib)) return null;
    return {
      args: ["-cp", path.join(lib, "*"), "riotcmd.riot"],
      command: java.command,
      source: "JENA_HOME",
    };
  }
  if (process.platform === "win32") return null;
  const result = run("riot", ["--version"], env);
  if (result.error || result.status !== 0) return null;
  return { args: [], command: "riot", source: "PATH" };
}

function baseReport() {
  return {
    conforms: null,
    engine: {
      name: "Apache Jena RIOT",
      version: null,
    },
    gatePassed: false,
    requirements: requirements(),
    schemaVersion: "molit.jena-engine-probe/1",
    scope: "rdf-parser-differential",
    status: "unavailable",
  };
}

function emit(report, exitCode) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCode;
}

async function prepareInput(options) {
  if (options.input) {
    const originalPath = path.resolve(options.input);
    const metadata = await stat(originalPath);
    if (!metadata.isFile() || metadata.size > limits.maxInputBytes) {
      const error = new Error("Jena probe input is not a bounded regular file");
      error.code = "RDF_INPUT_SIZE_LIMIT";
      throw error;
    }
    const bytes = await readFile(originalPath);
    if (bytes.length > limits.maxInputBytes) {
      const error = new Error("Jena probe input grew beyond its byte limit");
      error.code = "RDF_INPUT_SIZE_LIMIT";
      throw error;
    }
    const format = options.format ?? formatByExtension.get(path.extname(originalPath).toLowerCase());
    if (!format) {
      const error = new Error("Jena probe input extension is not an approved RDF serialization");
      error.code = "UNSUPPORTED_RDF_FORMAT";
      throw error;
    }
    const loaded = await loadRdfBytes(bytes, originalPath, limits, {
      canonicalize: true,
      format,
    });
    const directory = await mkdtemp(path.join(tmpdir(), "molit-jena-probe-"));
    const extension = path.extname(originalPath).toLowerCase() || ".rdf";
    const inputPath = path.join(directory, `snapshot${extension}`);
    await writeFile(inputPath, bytes);
    return {
      cleanup: () => rm(directory, { force: true, recursive: true }),
      inputPath,
      loaded,
      source: path.basename(originalPath),
    };
  }
  const directory = await mkdtemp(path.join(tmpdir(), "molit-jena-probe-"));
  const inputPath = path.join(directory, "smoke.ttl");
  const source = `
    @prefix dct: <http://purl.org/dc/terms/> .
    <https://example.org/dataset> dct:title "Jena parser differential"@en ;
      dct:publisher [ dct:title "publisher"@en ] .
  `;
  await writeFile(inputPath, source, "utf8");
  return {
    cleanup: () => rm(directory, { force: true, recursive: true }),
    inputPath,
    loaded: await loadRdfBytes(
      Buffer.from(source),
      inputPath,
      limits,
      { canonicalize: true, format: "text/turtle" },
    ),
    source: "built-in-smoke.ttl",
  };
}

async function main() {
  const report = baseReport();
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    emit({ ...report, reason: error.message, status: "invalid-arguments" }, 2);
    return;
  }

  const runtimeEnvironment = sanitizedJavaEnvironment(process.env);
  const java = javaRuntime(runtimeEnvironment);
  report.runtime = {
    javaAvailable: java.available,
    javaMajor: java.major ?? null,
    javaVersion: java.version ?? null,
  };
  const riot = riotCommand(runtimeEnvironment, java);
  if (!java.available || java.major < REQUIRED_JAVA_MAJOR || !riot) {
    const reasons = [];
    if (!java.available) reasons.push("Java runtime not found");
    else if (java.major < REQUIRED_JAVA_MAJOR) {
      reasons.push(`Java ${java.major} is below the required major ${REQUIRED_JAVA_MAJOR}`);
    }
    if (!riot) reasons.push("verified JENA_HOME or RIOT command not found");
    emit({ ...report, reason: reasons.join("; ") }, 2);
    return;
  }

  const versionResult = run(riot.command, [...riot.args, "--version"], runtimeEnvironment);
  const versionOutput = `${versionResult.stdout ?? ""}\n${versionResult.stderr ?? ""}`;
  if (versionResult.error || versionResult.status !== 0) {
    emit({ ...report, reason: "RIOT --version failed", status: "execution-error" }, 1);
    return;
  }
  const reviewedVersionPattern = new RegExp(
    `(?:^|[^0-9.])${REQUIRED_JENA_VERSION.replaceAll(".", "[.]")}(?:$|[^0-9.])`,
    "u",
  );
  const detectedVersion = reviewedVersionPattern.test(versionOutput)
    ? REQUIRED_JENA_VERSION
    : null;
  report.engine.version = detectedVersion;
  report.engine.toolchainVerified = false;
  report.environmentPolicy = {
    inheritedJavaOptions: false,
    inheritedClasspath: false,
    allowedVariables: Object.keys(runtimeEnvironment).sort(),
  };
  if (!detectedVersion) {
    emit({ ...report, reason: "installed Jena version is not the reviewed baseline", status: "version-mismatch" }, 2);
    return;
  }

  let prepared;
  try {
    prepared = await prepareInput(options);
    const syntax = syntaxByFormat.get(prepared.loaded.rdfFormat);
    const parsed = run(
      riot.command,
      [...riot.args, `--syntax=${syntax}`, "--strict", "--check", "--output=NQUADS", prepared.inputPath],
      runtimeEnvironment,
      MAX_PROCESS_OUTPUT_BYTES,
    );
    if (parsed.error || parsed.status !== 0) {
      emit({
        ...report,
        input: { format: prepared.loaded.rdfFormat, source: prepared.source },
        reason: "Jena RIOT rejected the preflighted local input",
        status: "execution-error",
      }, 1);
      return;
    }
    const jenaOutput = await loadRdfBytes(
      Buffer.from(parsed.stdout, "utf8"),
      "jena-output.nq",
      { ...limits, maxInputBytes: MAX_PROCESS_OUTPUT_BYTES },
      { canonicalize: true, format: "application/n-quads" },
    );
    const nodeDigest = prepared.loaded.canonicalGraph.sha256;
    const jenaDigest = jenaOutput.canonicalGraph.sha256;
    const matched = nodeDigest === jenaDigest;
    emit({
      ...report,
      conforms: matched,
      engine: { ...report.engine, invocation: riot.source },
      gatePassed: matched,
      input: {
        byteSha256: prepared.loaded.byteSha256,
        format: prepared.loaded.rdfFormat,
        source: prepared.source,
      },
      result: {
        canonicalizationAlgorithm: "RDFC-1.0",
        jenaGraphSha256: jenaDigest,
        nodeGraphSha256: nodeDigest,
        quadCount: prepared.loaded.store.size,
      },
      status: matched ? "matched" : "graph-mismatch",
    }, matched ? 0 : 1);
  } catch (error) {
    emit({
      ...report,
      reason: error.code ?? error.message,
      status: "preflight-error",
    }, 1);
  } finally {
    await prepared?.cleanup();
  }
}

await main();
