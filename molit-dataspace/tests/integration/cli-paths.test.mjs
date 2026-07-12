import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execute = promisify(execFile);
const root = new URL("../../", import.meta.url);
const cli = new URL("../../src/cli.mjs", import.meta.url);
const batch = new URL("../../fixtures/discovery/baseline.json", import.meta.url);
const config = new URL("../../fixtures/discovery/config.json", import.meta.url);
const approvalsFixture = new URL("../../fixtures/discovery/approvals.json", import.meta.url);

async function testApprovals(state, approvalDirectory = dirname(state)) {
  const target = join(approvalDirectory, "test-approvals.json");
  await mkdir(dirname(target), { recursive: true });
  const registry = JSON.parse(await readFile(approvalsFixture, "utf8"));
  for (const entry of registry.entries) {
    entry.approvedAt = "2020-01-01T00:00:00Z";
    entry.validUntil = "2099-01-01T00:00:00Z";
  }
  await writeFile(target, JSON.stringify(registry));
  return target;
}

async function runWith(state, report, approvalDirectory = dirname(state)) {
  const approvalPath = await testApprovals(state, approvalDirectory);
  return execute(process.execPath, [
    fileURLToPath(cli),
    "sync",
    "--batch",
    fileURLToPath(batch),
    "--state",
    state,
    "--config",
    fileURLToPath(config),
    "--approvals",
    approvalPath,
    "--report",
    report,
  ], { cwd: fileURLToPath(root) });
}

async function runReview(state, report) {
  const approvalPath = await testApprovals(state);
  return execute(process.execPath, [
    fileURLToPath(cli),
    "review",
    "--state",
    state,
    "--config",
    fileURLToPath(config),
    "--approvals",
    approvalPath,
    "--report",
    report,
  ], { cwd: fileURLToPath(root) });
}

test("ST-SEC-002: CLI rejects state/report alias and reserved lock path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-cli-path-"));
  const state = join(directory, "state.json");
  try {
    await assert.rejects(
      runWith(state, state),
      (error) => error.code === 2 && error.stderr.includes("PATH_ALIAS"),
    );
    await assert.rejects(
      runWith(state, `${state}.lock`),
      (error) => error.code === 2 && error.stderr.includes("RESERVED_STATE_PATH"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ST-SEC-002: CLI resolves junction aliases through missing output directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-cli-junction-alias-"));
  const real = join(directory, "real");
  const alias = join(directory, "alias");
  await mkdir(real);
  await symlink(real, alias, process.platform === "win32" ? "junction" : "dir");
  const state = join(real, "new", "state.json");
  try {
    await assert.rejects(
      runWith(state, join(alias, "new", "state.json"), real),
      (error) => error.code === 2 && error.stderr.includes("PATH_ALIAS"),
    );
    await assert.rejects(readFile(state), (error) => error.code === "ENOENT");

    await assert.rejects(
      runWith(join(real, "state.json"), join(alias, "state.json.lock"), real),
      (error) => error.code === 2 && error.stderr.includes("RESERVED_STATE_PATH"),
    );
    await assert.rejects(
      readFile(join(real, "state.json.lock")),
      (error) => error.code === "ENOENT",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("NFR-REL-003: CLI rejects an existing report directory before state commit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-cli-report-directory-"));
  const state = join(directory, "state.json");
  try {
    await assert.rejects(
      runWith(state, directory),
      (error) => error.code === 2 && error.stderr.includes("INVALID_REPORT_TARGET"),
    );
    await assert.rejects(readFile(state), (error) => error.code === "ENOENT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("NFR-REL-003: report failure after commit has a distinct exit and preserves stdout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-cli-report-failure-"));
  const state = join(directory, "state.json");
  const report = join(directory, `${"r".repeat(240)}.json`);
  try {
    const error = await runWith(state, report).then(
      () => assert.fail("report write was expected to fail"),
      (failure) => failure,
    );
    assert.equal(error.code, 3);
    const failure = JSON.parse(error.stderr);
    assert.equal(failure.error, "REPORT_WRITE_FAILED_AFTER_STATE_COMMIT");
    assert.equal(failure.details.stateCommitted, true);
    assert.ok(report.startsWith(failure.details.path));

    const authoritativeReport = JSON.parse(error.stdout);
    assert.equal(authoritativeReport.schemaVersion, "molit.discovery-sync-report/1");
    assert.equal(authoritativeReport.applied, 4);
    const persisted = JSON.parse(await readFile(state, "utf8"));
    assert.equal(Object.keys(persisted.processedEvents).length, 4);
    const residue = (await readdir(directory)).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(residue, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ST-POL-003: CLI review revalidates and exports only reviewable pending commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-cli-review-"));
  const state = join(directory, "state.json");
  const syncReport = join(directory, "sync-report.json");
  const reviewReport = join(directory, "review-report.json");
  try {
    await runWith(state, syncReport);
    await assert.rejects(
      execute(process.execPath, [
        fileURLToPath(cli),
        "review",
        "--state",
        state,
        "--config",
        fileURLToPath(config),
        "--approvals",
        join(directory, "test-approvals.json"),
      ], { cwd: fileURLToPath(root) }),
      (error) => error.code === 2 && error.stderr.includes("MISSING_ARGUMENT"),
    );
    assert.equal(JSON.parse(await readFile(state, "utf8")).lastReviewAt, null);
    const result = await runReview(state, reviewReport);
    const summary = JSON.parse(result.stdout);
    const assessment = JSON.parse(await readFile(reviewReport, "utf8"));
    assert.equal(summary.schemaVersion, "molit.review-queue-summary/1");
    assert.equal(summary.reconciliationRequired, false);
    assert.equal(summary.blockedCount, 0);
    assert.ok(summary.reviewableCount > 0);
    assert.equal(summary.assessmentDigest, assessment.assessmentDigest);
    assert.ok(assessment.reviewable.every((event) => (
      event.automaticDispatchAllowed === false
    )));
    const persisted = JSON.parse(await readFile(state, "utf8"));
    assert.equal(persisted.lastReviewAt, assessment.evaluatedAt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("NFR-REL-003: review report failure preserves the committed clock watermark", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-cli-review-report-failure-"));
  const state = join(directory, "state.json");
  const syncReport = join(directory, "sync-report.json");
  const report = join(directory, `${"q".repeat(240)}.json`);
  try {
    await runWith(state, syncReport);
    const error = await runReview(state, report).then(
      () => assert.fail("review report write was expected to fail"),
      (failure) => failure,
    );
    assert.equal(error.code, 3);
    const failure = JSON.parse(error.stderr);
    assert.equal(failure.error, "REVIEW_REPORT_WRITE_FAILED_AFTER_STATE_COMMIT");
    assert.equal(failure.details.stateCommitted, true);
    const summary = JSON.parse(error.stdout);
    const persisted = JSON.parse(await readFile(state, "utf8"));
    assert.equal(persisted.lastReviewAt, summary.evaluatedAt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
