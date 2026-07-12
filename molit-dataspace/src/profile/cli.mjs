#!/usr/bin/env node
import {
  link,
  mkdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  loadProfileRelease,
  publicProfileSummary,
  verifyArtifactLock,
} from "./registry.mjs";
import { assertLocalFilesystemPath } from "./local-path.mjs";
import { validateProfileDocument } from "./validator.mjs";

function usage() {
  return [
    "Usage:",
    "  node src/profile/cli.mjs list [--version 0.1.0]",
    "  node src/profile/cli.mjs verify [--version 0.1.0]",
    "  node src/profile/cli.mjs validate --input FILE [--profile core] [--version 0.1.0] [--report FILE]",
    "  node src/profile/cli.mjs publish-check --input FILE --profile core-publication|geo-publication [--version 0.1.0] [--report FILE]",
  ].join("\n");
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || !["list", "publish-check", "validate", "verify"].includes(command)) {
    const error = new Error(usage());
    error.code = "INVALID_COMMAND";
    throw error;
  }
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      const error = new Error(`invalid option sequence\n${usage()}`);
      error.code = "INVALID_ARGUMENTS";
      throw error;
    }
    const name = flag.slice(2);
    if (!["input", "profile", "report", "version"].includes(name) || options[name]) {
      const error = new Error(`unknown or duplicate option: ${flag}`);
      error.code = "INVALID_ARGUMENTS";
      throw error;
    }
    options[name] = value;
  }
  return { command, options };
}

async function writeAtomicJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await link(temporary, resolved);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function platformPathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function targetIdentity(filePath) {
  const absolute = path.resolve(filePath);
  try {
    const [physical, metadata] = await Promise.all([realpath(absolute), stat(absolute)]);
    return {
      fileId: `${metadata.dev}:${metadata.ino}`,
      isDirectory: metadata.isDirectory(),
      key: platformPathKey(physical),
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const suffix = [];
    let ancestor = absolute;
    while (true) {
      try {
        const physical = await realpath(ancestor);
        return {
          fileId: null,
          isDirectory: false,
          key: platformPathKey(path.join(physical, ...suffix)),
        };
      } catch (ancestorError) {
        if (ancestorError?.code !== "ENOENT") throw ancestorError;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw ancestorError;
        suffix.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
  }
}

async function assertDistinctInputAndReport(inputPath, reportPath) {
  if (!reportPath) return;
  const [input, report] = await Promise.all([
    targetIdentity(inputPath),
    targetIdentity(reportPath),
  ]);
  if (report.isDirectory) {
    const error = new Error("report target must be a new file");
    error.code = "INVALID_REPORT_TARGET";
    throw error;
  }
  if (input.key === report.key || (input.fileId && input.fileId === report.fileId)) {
    const error = new Error("input and report paths must identify distinct files");
    error.code = "PATH_ALIAS";
    throw error;
  }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const version = options.version ?? "0.1.0";
  if (command === "list") {
    const summary = publicProfileSummary(await loadProfileRelease(version));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (command === "verify") {
    const release = await loadProfileRelease(version);
    const verification = await verifyArtifactLock(release);
    process.stdout.write(`${JSON.stringify({
      artifactCount: verification.results.length,
      profileVersion: version,
      valid: true,
    }, null, 2)}\n`);
    return;
  }
  if (!options.input) {
    const error = new Error(`--input is required\n${usage()}`);
    error.code = "INVALID_ARGUMENTS";
    throw error;
  }
  assertLocalFilesystemPath(options.input, "input path");
  if (options.report) assertLocalFilesystemPath(options.report, "report path");
  await assertDistinctInputAndReport(options.input, options.report);
  if (command === "publish-check"
    && !["core-publication", "geo-publication"].includes(options.profile)) {
    const error = new Error("publish-check requires --profile core-publication or geo-publication");
    error.code = "INVALID_PUBLICATION_PROFILE";
    throw error;
  }
  const report = await validateProfileDocument({
    inputPath: options.input,
    profileName: options.profile ?? "core",
    version,
  });
  if (options.report) {
    await assertDistinctInputAndReport(options.input, options.report);
    await writeAtomicJson(options.report, report);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.summary.gatePassed
    || (command === "publish-check" && !report.authority.publicationAuthorized)) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    code: error.code ?? "PROFILE_CLI_FAILURE",
    details: error.details ?? null,
    message: error.message,
  }, null, 2)}\n`);
  process.exitCode = 1;
});
