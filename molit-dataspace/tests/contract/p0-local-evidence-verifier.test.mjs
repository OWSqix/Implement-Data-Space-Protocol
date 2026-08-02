import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const verifier = fileURLToPath(new URL("../../tools/operations/verify-p0-local-evidence.mjs", import.meta.url));
const profilePath = fileURLToPath(new URL("../../deploy/p0/verification-steps.v1.json", import.meta.url));
const sourceDigestTool = fileURLToPath(new URL("../../tools/operations/worktree-source-digest.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const digestImage = (name, fill) => `registry.invalid/${name}@sha256:${fill.repeat(64)}`;

function kubernetesArtifact() {
  const baseline = digestImage("baseline", "1");
  const upgrade = digestImage("upgrade", "2");
  const journal = [];
  const operations = [
    ["PROVISIONED", null, true, baseline],
    ["SUSPENDED", null, true, baseline],
    ["PROVISIONED", "UPGRADE", true, upgrade],
    ["PROVISIONED", "ROLLBACK", true, baseline],
    ["DELETED", null, false, baseline],
  ];
  for (let cycle = 1; cycle <= 30; cycle += 1) {
    operations.forEach(([state, transition, exists, controlPlaneImage], index) => journal.push({
      cycle,
      sequence: index + 1,
      tenantId: `rp-deadbeef-${String(cycle).padStart(3, "0")}`,
      state,
      transition,
      fencingToken: String(index + 1),
      durationMs: 1,
      exists,
      planDigest: "3".repeat(64),
      controlPlaneImage,
    }));
  }
  return {
    schemaVersion: "molit.kubernetes-lifecycle-evidence/1",
    startedAt: "2026-07-14T00:00:00.000Z",
    completedAt: "2026-07-14T00:01:00.000Z",
    cyclesRequested: 30,
    cyclesCompleted: 30,
    operationsCompleted: 150,
    cluster: { gitVersion: "v1.35.0", platform: "linux/amd64" },
    images: { baseline: { controlPlane: baseline, dataPlane: baseline }, upgrade: { controlPlane: upgrade, dataPlane: upgrade } },
    latencyMs: { p50: 1, p95: 2, max: 3 },
    inventory: { managedNamespaces: 0, retainedFenceRecords: 30, orphanNamespaces: 0 },
    eventJournal: journal,
    bootstrap: {
      kindVersion: "kind v0.31.0 go1.25.0 windows/amd64",
      kindExecutableSha256: "2c3a9ff954de16244380778683cf99e271bfc2fac9c6c4e797e4623c45e59d9d",
      kubectlVersion: "v1.35.0",
      kubectlExecutableSha256: "4c5d14b8673bd55f813a8965ad70d5150e3960ee5f274025e2286aea3a0fa8b6",
      nodeImage: "kindest/node:v1.35.0@sha256:452d707d4862f52530247495d180205e029056831160e22870e37e3f6c1ac31f",
      webhookImage: digestImage("webhook", "4"),
      baselineWorkloadImage: baseline,
      upgradeWorkloadImage: upgrade,
      clusterName: "molit-p0-gate",
    },
  };
}

function haArtifact() {
  return {
    schemaVersion: "molit.postgres-ha-pitr-run/1",
    status: "pass",
    sourceCommit: "a".repeat(40),
    startedAt: "2026-07-14T00:00:00.000Z",
    finishedAt: "2026-07-14T00:01:00.000Z",
    image: digestImage("postgres", "5"),
    topology: {
      primary: 1,
      standby: 1,
      walArchive: true,
      synchronousCommit: true,
      synchronousStandbyNames: "FIRST 1 (walreceiver)",
      failureInjection: "primary-sigkill-after-synchronous-commit",
      fencingMethod: "isolated-standby-restart-write-rejection",
      evidenceScope: "local-container-failover-only",
    },
    rollingRestart: { seconds: 1, dataLoss: 0 },
    rollback: { seconds: 1, dataLoss: 0 },
    failover: { rpoSeconds: 1, rtoSeconds: 1, missingCommits: 0, splitBrainCommits: 0, queueEventPreserved: true, oldPrimaryRestarted: true, oldPrimaryInRecovery: true, oldPrimaryNetworkMode: "none", oldPrimaryWriteRejected: true, oldPrimaryProbeErrorClass: "postgresql-read-only-recovery", promotedPrimaryUnaffected: true },
    pitr: { restorePoint: "molit_before_destructive_change", rtoSeconds: 1, expectedDigest: "6".repeat(64), restoredDigest: "6".repeat(64), semanticExpectedDigest: "7".repeat(64), semanticRestoredDigest: "7".repeat(64), semanticState: { migrationCount: 4, modeRows: 2, rootsMatch: true, scopedStateRows: 2, outboxPendingRows: 1, outboxAcknowledgedRows: 1, usageEventRows: 1 }, destructiveRows: 0 },
  };
}

function runtimeImageArtifact() {
  const services = [
    ["caas", "caas-control-plane", "true"],
    ["dsaas", "dsaas-control-plane", "true"],
    ["fencing-webhook", "fencing-webhook", "true"],
    ["edc-control-plane", "edc-control-plane", "false"],
    ["edc-data-plane", "edc-data-plane", "false"],
    ["edc-schema-migration", "schema-migration", "true"],
  ];
  return {
    schemaVersion: "molit.runtime-image-local-verification/1",
    startedAt: "2026-07-14T00:00:00.000Z",
    finishedAt: "2026-07-14T00:01:00.000Z",
    durationMs: 60_000,
    status: "passed",
    operatingRegistryEvidence: false,
    inventory: { path: "deploy/supply-chain/runtime-image-inventory.v1.json", sha256: "7".repeat(64), schemaValidated: true },
    images: services.map(([service, runtimeClassLabel, productionEligibleLabel], index) => ({
      service,
      imageId: `sha256:${String(index + 1).repeat(64)}`,
      user: "10001:10001",
      healthcheck: [],
      readOnlyNonRootRuntimeProbe: true,
      productionEligibleLabel,
      runtimeClassLabel,
    })),
    externalAdoptions: ["postgres-operand", "otel-collector"].map((service, index) => ({
      service,
      runtimeClass: service,
      upstreamImage: digestImage(service, String(index + 8)),
      provenanceMode: "external-adoption",
      productionEligible: true,
      releasePathContractDeclared: true,
      operatingRegistryEvidence: false,
    })),
    failureCode: null,
    failureMessage: null,
  };
}

function edcSchemaArtifact() {
  return {
    schemaVersion: "molit.edc-schema-postgres-verification/1",
    status: "pass",
    sourceCommit: "a".repeat(40),
    startedAt: "2026-07-14T00:00:00.000Z",
    finishedAt: "2026-07-14T00:01:00.000Z",
    artifact: {
      dockerTarget: "schema-migration",
      localImageId: `sha256:${"1".repeat(64)}`,
      dockerfileSha256: "2".repeat(64),
      migrationRunnerSha256: "3".repeat(64),
      migrationManifestSha256: "4".repeat(64),
      verificationScriptSha256: "5".repeat(64),
      sourceTreeSha256: "6".repeat(64),
      sourceFileCount: 10,
      requiredVersion: "edc-0.18.0-sql-v1",
    },
    database: {
      image: `postgres:17.10-alpine3.24@sha256:${"7".repeat(64)}`,
      tlsMode: "verify-full",
      serverNameVerified: "molit-edc-schema-postgres-1-deadbeef",
      caCertificateSha256: "8".repeat(64),
    },
    execution: {
      cycles: 2,
      components: [
        { name: "control-plane", successfulRuns: 2, requiredTableCount: 12, versionMarkerCount: 1 },
        { name: "data-plane", successfulRuns: 2, requiredTableCount: 2, versionMarkerCount: 1 },
      ],
      totalSuccessfulRuns: 4,
      markerSummary: "2:control-plane=edc-0.18.0-sql-v1,data-plane=edc-0.18.0-sql-v1",
      idempotentRepeat: true,
      sourceStableDuringRun: true,
      negativeTls: { wrongHostnameRejected: true, wrongCaRejected: true },
    },
    productionGate: {
      policyName: "molit-verify-release-images",
      attestationPredicateType: "https://data.molit.go.kr/attestations/release-bundle/v1",
      localImageIsNotReleaseAuthorization: true,
    },
  };
}

function artifactDocument(pathRelativeToEvidence) {
  if (pathRelativeToEvidence === "kubernetes-lifecycle-repeat.json") return kubernetesArtifact();
  if (pathRelativeToEvidence === "postgres-ha-pitr-run.json") return haArtifact();
  if (pathRelativeToEvidence === "runtime-images.json") return runtimeImageArtifact();
  if (pathRelativeToEvidence === "edc-schema-postgres.json") return edcSchemaArtifact();
  throw new Error(`missing test artifact: ${pathRelativeToEvidence}`);
}

test("P0 evidence verifier requires the exact profile and rejects contradictory or changed evidence", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-p0-evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "logs"));
  const profileBytes = await readFile(profilePath);
  const profile = JSON.parse(profileBytes.toString("utf8"));
  const [digestResult, commitResult, statusResult] = await Promise.all([
    execute(process.execPath, [sourceDigestTool], { cwd: repositoryRoot }),
    execute("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
    execute("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", "."], { cwd: repositoryRoot }),
  ]);
  const currentDigest = JSON.parse(digestResult.stdout.trim());
  const currentStatus = statusResult.stdout.replaceAll("\r\n", "\n");
  const currentClean = currentStatus.trim().length === 0;
  const at = "2026-07-14T00:00:00.000Z";
  const steps = [];
  const artifacts = [];
  for (const expected of profile.steps) {
    const log = Buffer.from(`${expected.id}\n`, "utf8");
    const relativeLogPath = `logs/${expected.id}.log`;
    await writeFile(path.join(directory, relativeLogPath), log);
    steps.push({
      id: expected.id,
      command: profile.executable,
      arguments: expected.arguments.map((value) => value.replaceAll("{{EVIDENCE_DIR}}", directory)),
      expectedExitCodes: expected.expectedExitCodes,
      exitCode: expected.expectedExitCodes[0],
      status: "passed",
      startedAt: at,
      finishedAt: at,
      durationMs: 0,
      log: { pathRelativeToEvidence: relativeLogPath, sha256: sha256(log), bytes: log.length },
    });
    for (const artifact of expected.artifacts ?? []) {
      const bytes = Buffer.from(`${JSON.stringify(artifactDocument(artifact.pathRelativeToEvidence))}\n`, "utf8");
      await writeFile(path.join(directory, artifact.pathRelativeToEvidence), bytes);
      artifacts.push({ sourceStepId: expected.id, ...artifact, sha256: sha256(bytes), bytes: bytes.length });
    }
  }
  const report = {
    schemaVersion: "molit.p0-local-verification/1",
    startedAt: at,
    finishedAt: at,
    durationMs: 0,
    source: {
      commit: commitResult.stdout.trim(),
      worktreeClean: currentClean,
      immutableReleaseEvidence: currentClean,
      statusSha256: sha256(currentStatus),
      digestAlgorithm: currentDigest.algorithm,
      worktreeDigest: currentDigest.digest,
      fileCount: currentDigest.fileCount,
      stableDuringRun: true,
    },
    environment: { operatingSystem: "test", architecture: "x64", node: "v24", npm: "11", docker: null, kubectl: null, kind: null },
    verificationProfile: { path: "deploy/p0/verification-steps.v1.json", sha256: sha256(profileBytes) },
    complete: true,
    skipped: [],
    steps,
    artifacts,
    externalOperatingEvidence: "not-evaluated-as-pass",
  };
  const reportPath = path.join(directory, "local-verification.json");
  await writeFile(reportPath, `${JSON.stringify(report)}\n`);

  await execute(process.execPath, [verifier, "--input", reportPath]);
  const sourceDigest = report.source.worktreeDigest;
  report.source.worktreeDigest = "0".repeat(64);
  await writeFile(reportPath, `${JSON.stringify(report)}\n`);
  await assert.rejects(execute(process.execPath, [verifier, "--input", reportPath]), /source binding does not match/u);
  report.source.worktreeDigest = sourceDigest;
  const missing = report.steps.pop();
  await writeFile(reportPath, `${JSON.stringify(report)}\n`);
  await assert.rejects(execute(process.execPath, [verifier, "--input", reportPath]), /exact verification step set/u);
  report.steps.push(missing);

  report.steps[0].exitCode = 1;
  await writeFile(reportPath, `${JSON.stringify(report)}\n`);
  await assert.rejects(execute(process.execPath, [verifier, "--input", reportPath]), /status contradicts its exit code/u);
  report.steps[0].exitCode = 0;

  report.source.stableDuringRun = false;
  await writeFile(reportPath, `${JSON.stringify(report)}\n`);
  await assert.rejects(execute(process.execPath, [verifier, "--input", reportPath]), /completion flag does not match/u);
  report.source.stableDuringRun = true;
  await writeFile(reportPath, `${JSON.stringify(report)}\n`);
  const nestedArtifactPath = path.join(directory, report.artifacts[0].pathRelativeToEvidence);
  const originalArtifact = await readFile(nestedArtifactPath);
  await writeFile(nestedArtifactPath, "{}\n");
  await assert.rejects(execute(process.execPath, [verifier, "--input", reportPath]), /P0 artifact digest mismatch/u);
  await writeFile(nestedArtifactPath, originalArtifact);
  await writeFile(path.join(directory, report.steps[0].log.pathRelativeToEvidence), "tampered\n");
  await assert.rejects(execute(process.execPath, [verifier, "--input", reportPath]), /P0 log digest mismatch/u);
});
