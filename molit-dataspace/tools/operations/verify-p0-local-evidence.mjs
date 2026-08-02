import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual, promisify } from "node:util";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const execute = promisify(execFile);

const inputPath = path.resolve(argument("--input"));
const schemaPath = new URL("../../contracts/p0-local-verification.v1.schema.json", import.meta.url);
const profilePath = new URL("../../deploy/p0/verification-steps.v1.json", import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceDigestTool = fileURLToPath(new URL("./worktree-source-digest.mjs", import.meta.url));
const [inputBytes, schemaBytes, profileBytes] = await Promise.all([readFile(inputPath), readFile(schemaPath), readFile(profilePath)]);
const report = JSON.parse(inputBytes.toString("utf8"));
const schema = JSON.parse(schemaBytes.toString("utf8"));
const profile = JSON.parse(profileBytes.toString("utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(report)) throw new Error(`P0 evidence schema violation: ${JSON.stringify(validate.errors)}`);
if (report.verificationProfile.sha256 !== sha256(profileBytes)) throw new Error("P0 verification profile digest mismatch");
if (profile.schemaVersion !== "molit.p0-verification-steps/1" || profile.executable !== "npm" || !Array.isArray(profile.steps)) {
  throw new Error("P0 verification profile is invalid");
}

const [currentDigestResult, currentCommitResult, currentStatusResult] = await Promise.all([
  execute(process.execPath, [sourceDigestTool], { cwd: repositoryRoot, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }),
  execute("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, windowsHide: true }),
  execute("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", "."], { cwd: repositoryRoot, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }),
]);
const currentDigest = JSON.parse(currentDigestResult.stdout.trim());
const currentCommit = currentCommitResult.stdout.trim();
const currentStatus = currentStatusResult.stdout.replaceAll("\r\n", "\n");
const currentClean = currentStatus.trim().length === 0;
if (report.source.commit !== currentCommit
  || report.source.digestAlgorithm !== currentDigest.algorithm
  || report.source.worktreeDigest !== currentDigest.digest
  || report.source.fileCount !== currentDigest.fileCount
  || report.source.statusSha256 !== sha256(currentStatus)
  || report.source.worktreeClean !== currentClean
  || report.source.immutableReleaseEvidence !== currentClean) {
  throw new Error("P0 report source binding does not match the current checkout");
}

const profileIds = new Set();
for (const expected of profile.steps) {
  if (!/^[a-z0-9-]+$/u.test(expected.id) || profileIds.has(expected.id)) throw new Error(`invalid P0 profile step id: ${expected.id}`);
  profileIds.add(expected.id);
  if (!Array.isArray(expected.arguments) || !expected.arguments.every((value) => typeof value === "string")) throw new Error(`invalid P0 profile arguments: ${expected.id}`);
  if (!Array.isArray(expected.expectedExitCodes) || expected.expectedExitCodes.length === 0 || !expected.expectedExitCodes.every(Number.isSafeInteger)) throw new Error(`invalid P0 profile exit codes: ${expected.id}`);
  if (typeof expected.skippable !== "boolean") throw new Error(`invalid P0 profile skip policy: ${expected.id}`);
  for (const artifact of expected.artifacts ?? []) {
    if (typeof artifact.pathRelativeToEvidence !== "string" || typeof artifact.schema !== "string") throw new Error(`invalid P0 profile artifact: ${expected.id}`);
  }
}

const evidenceDirectory = path.dirname(inputPath);
const skipped = new Set(report.skipped);
for (const id of skipped) {
  const expected = profile.steps.find((step) => step.id === id);
  if (!expected || expected.skippable !== true) throw new Error(`P0 report skips a mandatory or unknown step: ${id}`);
}
const expectedSteps = profile.steps.filter((step) => !skipped.has(step.id)).map((step) => ({
  ...step,
  arguments: step.arguments.map((value) => value.replaceAll("{{EVIDENCE_DIR}}", evidenceDirectory)),
}));
if (report.steps.length !== expectedSteps.length) throw new Error("P0 report does not contain the exact verification step set");
const expectedArtifacts = expectedSteps.flatMap((step) => (step.artifacts ?? []).map((artifact) => ({ sourceStepId: step.id, ...artifact })));
if (report.artifacts.length !== expectedArtifacts.length) throw new Error("P0 report does not contain the exact nested artifact set");

const ids = new Set();
const logPaths = new Set();
for (let index = 0; index < report.steps.length; index += 1) {
  const step = report.steps[index];
  const expected = expectedSteps[index];
  if (step.id !== expected.id
    || step.command !== profile.executable
    || !isDeepStrictEqual(step.arguments, expected.arguments)
    || !isDeepStrictEqual(step.expectedExitCodes, expected.expectedExitCodes)) {
    throw new Error(`P0 step does not match the verification profile at index ${index}`);
  }
  const expectedStatus = expected.expectedExitCodes.includes(step.exitCode) ? "passed" : "failed";
  if (step.status !== expectedStatus) throw new Error(`P0 step status contradicts its exit code: ${step.id}`);
  if (ids.has(step.id)) throw new Error(`duplicate P0 step id: ${step.id}`);
  ids.add(step.id);
  const logPath = path.resolve(evidenceDirectory, step.log.pathRelativeToEvidence);
  const relative = path.relative(evidenceDirectory, logPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`P0 log escapes its evidence directory: ${step.id}`);
  if (logPaths.has(logPath)) throw new Error(`duplicate P0 log path: ${step.log.pathRelativeToEvidence}`);
  logPaths.add(logPath);
  const bytes = await readFile(logPath);
  if (bytes.length !== step.log.bytes || sha256(bytes) !== step.log.sha256) throw new Error(`P0 log digest mismatch: ${step.id}`);
}

for (let index = 0; index < report.artifacts.length; index += 1) {
  const artifact = report.artifacts[index];
  const expected = expectedArtifacts[index];
  if (artifact.sourceStepId !== expected.sourceStepId
    || artifact.pathRelativeToEvidence !== expected.pathRelativeToEvidence
    || artifact.schema !== expected.schema) {
    throw new Error(`P0 nested artifact does not match the verification profile at index ${index}`);
  }
  const artifactPath = path.resolve(evidenceDirectory, artifact.pathRelativeToEvidence);
  const relative = path.relative(evidenceDirectory, artifactPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`P0 artifact escapes its evidence directory: ${artifact.sourceStepId}`);
  const bytes = await readFile(artifactPath);
  if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) throw new Error(`P0 artifact digest mismatch: ${artifact.sourceStepId}`);
  const nestedSchemaPath = path.resolve(repositoryRoot, artifact.schema);
  const schemaRelative = path.relative(repositoryRoot, nestedSchemaPath);
  if (!schemaRelative || schemaRelative.startsWith("..") || path.isAbsolute(schemaRelative)) throw new Error(`P0 artifact schema escapes the repository: ${artifact.sourceStepId}`);
  const nestedSchema = JSON.parse(await readFile(nestedSchemaPath, "utf8"));
  const validateNested = ajv.compile(nestedSchema);
  const nestedDocument = JSON.parse(bytes.toString("utf8"));
  if (!validateNested(nestedDocument)) throw new Error(`P0 nested artifact schema violation: ${artifact.sourceStepId}: ${JSON.stringify(validateNested.errors)}`);
}

const expectedComplete = report.source.stableDuringRun === true
  && report.skipped.length === 0 && report.steps.every((step) => step.status === "passed");
if (report.complete !== expectedComplete) throw new Error("P0 completion flag does not match step outcomes");
const commercial = report.steps.find((step) => step.id === "commercial-gate-fail-closed");
if (!commercial || commercial.exitCode !== 2 || !commercial.expectedExitCodes.includes(2)) {
  throw new Error("P0 evidence does not prove the commercial gate remained fail-closed");
}
process.stdout.write(`P0 evidence and ${report.steps.length} log digests verified: ${inputPath}\n`);
