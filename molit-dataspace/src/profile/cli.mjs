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
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  computeBundleDigest,
  isPublicationProfile,
  loadProfileRelease,
  profileVersionEnvironmentVariable,
  publicProfileSummary,
  resolveProfileVersion,
  selectPublicationCheckPlan,
  selectValidationProfile,
  verifyArtifactLock,
} from "./registry.mjs";
import { assertLocalFilesystemPath } from "./local-path.mjs";
import { assertPublicationCheckReport } from "./report-contract.mjs";
import { validateProfileDocumentIsolated } from "./isolated-validator.mjs";

function usage() {
  return [
    "Usage:",
    "  node src/profile/cli.mjs list [--version VERSION]",
    "  node src/profile/cli.mjs verify [--version VERSION]",
    "  node src/profile/cli.mjs validate --input FILE [--profile PROFILE] [--version VERSION] [--report FILE]",
    "  node src/profile/cli.mjs publish-check --input FILE --profile PROFILE [--version VERSION] [--report FILE]",
    "",
    "For manifest v2, publish-check PROFILE is a conformance module; its publication policy is added automatically.",
    "For manifest v1, publish-check PROFILE is the legacy publication profile.",
    `If --version is omitted, ${profileVersionEnvironmentVariable} selects the release.`,
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
    if (!["input", "profile", "report", "version"].includes(name)
      || Object.hasOwn(options, name)) {
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

function publicationCheckError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

export function composePublicationCheckReport(
  conformanceReport,
  publicationPolicyReport,
) {
  const inputDigest = conformanceReport?.input?.byteSha256;
  const sameInput = typeof inputDigest === "string"
    && /^[0-9a-f]{64}$/u.test(inputDigest)
    && inputDigest === publicationPolicyReport?.input?.byteSha256
    && conformanceReport?.input?.bytes === publicationPolicyReport?.input?.bytes
    && conformanceReport?.input?.quads === publicationPolicyReport?.input?.quads;
  if (!sameInput) {
    throw publicationCheckError(
      "PROFILE_INPUT_CHANGED_DURING_PUBLICATION_CHECK",
      "publication-check input changed between conformance and policy validation",
    );
  }
  if (conformanceReport?.profile?.kind !== "conformance"
    || conformanceReport?.profile?.gate !== "violation"
    || !isPublicationProfile(publicationPolicyReport?.profile)
    || conformanceReport.profile.version !== publicationPolicyReport.profile.version
    || conformanceReport.profile.versionIri !== publicationPolicyReport.profile.versionIri) {
    throw publicationCheckError(
      "PROFILE_CHANGED_DURING_VALIDATION",
      "publication-check profiles changed during validation",
    );
  }

  const counts = Object.fromEntries(
    ["Info", "Violation", "Warning"].map((severity) => [
      severity,
      conformanceReport.summary.counts[severity]
        + publicationPolicyReport.summary.counts[severity],
    ]),
  );
  const gatePassed = conformanceReport.summary.gatePassed
    && publicationPolicyReport.summary.gatePassed;
  const publicationAuthorized = gatePassed
    && conformanceReport.authority.publicationAuthorized
    && publicationPolicyReport.authority.publicationAuthorized;
  const authorityReasons = [...new Set([
    ...conformanceReport.authority.reasons.map((reason) => `conformance:${reason}`),
    ...publicationPolicyReport.authority.reasons.map((reason) => `policy:${reason}`),
  ])];
  const decisionDigest = `sha256:${createHash("sha256").update(JSON.stringify({
    conformanceDecisionDigest: conformanceReport.decisionDigest,
    conformanceProfile: conformanceReport.profile.name,
    profileVersion: conformanceReport.profile.version,
    publicationAuthorized,
    publicationPolicyDecisionDigest: publicationPolicyReport.decisionDigest,
    publicationPolicyProfile: publicationPolicyReport.profile.name,
  })).digest("hex")}`;

  return assertPublicationCheckReport({
    schemaVersion: "molit.publication-check-report/1",
    validatedAt: publicationPolicyReport.validatedAt,
    input: conformanceReport.input,
    profileVersion: conformanceReport.profile.version,
    profiles: {
      conformance: conformanceReport.profile.name,
      publicationPolicy: publicationPolicyReport.profile.name,
    },
    summary: {
      conformanceGatePassed: conformanceReport.summary.gatePassed,
      counts,
      gatePassed,
      publicationPolicyGatePassed: publicationPolicyReport.summary.gatePassed,
      resultCount: conformanceReport.summary.resultCount
        + publicationPolicyReport.summary.resultCount,
    },
    authority: {
      publicationAuthorized,
      reasons: authorityReasons,
      validationScope: "composite-technical-conformance-and-publication-policy",
    },
    reports: {
      conformance: conformanceReport,
      publicationPolicy: publicationPolicyReport,
    },
    decisionDigest,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  const version = resolveProfileVersion(options.version);
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
  if (command === "publish-check" && !options.profile) {
    const error = new Error("publish-check requires --profile");
    error.code = "INVALID_PUBLICATION_PROFILE";
    throw error;
  }
  let publicationPlan = null;
  if (command === "publish-check") {
    const release = await loadProfileRelease(version);
    publicationPlan = selectPublicationCheckPlan(release, options.profile);
    const snapshot = await verifyArtifactLock(release);
    const profileNames = publicationPlan.mode === "composite"
      ? [
        publicationPlan.conformanceProfileName,
        publicationPlan.publicationPolicyProfileName,
      ]
      : [publicationPlan.publicationPolicyProfileName];
    publicationPlan.bundleDigests = Object.fromEntries(await Promise.all(
      profileNames.map(async (profileName) => [
        profileName,
        await computeBundleDigest(
          release,
          selectValidationProfile(release, profileName),
          snapshot.artifactBytes,
        ),
      ]),
    ));
  }
  let report;
  if (publicationPlan?.mode === "composite") {
    const conformanceReport = await validateProfileDocumentIsolated({
      inputPath: options.input,
      profileName: publicationPlan.conformanceProfileName,
      version,
    });
    const publicationPolicyReport = await validateProfileDocumentIsolated({
      inputPath: options.input,
      profileName: publicationPlan.publicationPolicyProfileName,
      version,
    });
    if (conformanceReport.profile.name !== publicationPlan.conformanceProfileName
      || publicationPolicyReport.profile.name
        !== publicationPlan.publicationPolicyProfileName
      || conformanceReport.profile.bundleDigest
        !== publicationPlan.bundleDigests[publicationPlan.conformanceProfileName]
      || publicationPolicyReport.profile.bundleDigest
        !== publicationPlan.bundleDigests[publicationPlan.publicationPolicyProfileName]) {
      throw publicationCheckError(
        "PROFILE_CHANGED_DURING_VALIDATION",
        "publication-check profile selection changed during validation",
      );
    }
    report = composePublicationCheckReport(conformanceReport, publicationPolicyReport);
  } else {
    report = await validateProfileDocumentIsolated({
      inputPath: options.input,
      profileName: options.profile ?? "core",
      version,
    });
    if (publicationPlan?.mode === "legacy"
      && (!isPublicationProfile(report.profile)
        || report.profile.name !== publicationPlan.publicationPolicyProfileName
        || report.profile.bundleDigest
          !== publicationPlan.bundleDigests[publicationPlan.publicationPolicyProfileName])) {
      throw publicationCheckError(
        "PROFILE_CHANGED_DURING_VALIDATION",
        "publication profile changed during validation",
      );
    }
  }
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

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      code: error.code ?? "PROFILE_CLI_FAILURE",
      details: error.details ?? null,
      message: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
