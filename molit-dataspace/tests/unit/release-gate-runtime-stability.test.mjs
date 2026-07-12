import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertReleaseAcceptanceRegister,
  evidenceCommandTimeoutMs,
  evaluateReleaseGateV2,
  fixedEvidenceCheck,
  gitCheck,
  reconcileTerminalRuntimeChecks,
  releaseEvidenceMatchesSnapshot,
  validateRequirementCoverageEvidence,
} from "../../tools/release/release-gate-v2.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const profileVersion = "1.0.0-rc.1";
const acceptancePath = path.join(
  root,
  "profiles/molit-dcat-ap/releases/1.0.0-rc.1/release-acceptance.json",
);
const coveragePath = path.join(
  root,
  "profiles/molit-dcat-ap/releases/1.0.0-rc.1/requirements/coverage-blockers.json",
);
const requiredEvidenceCommands = new Map([
  ["RA-GIT", [
    "npm run release:eol:verify",
  ]],
  ["RA-REQUIREMENTS", [
    "npm run profile:requirements:verify",
    "npm run profile:requirements:upstream:verify",
    "npm run profile:requirements:upstream:engines",
  ]],
  ["RA-ONTOLOGY", [
    "npm run profile:ontology:verify",
    "npm run profile:ontology:governance:verify",
  ]],
  ["RA-CRS", [
    "node --test tests/contract/crs-geometry-transformation.test.mjs",
    "node --test tests/contract/rc-geo-preflight-boundary.test.mjs",
  ]],
  ["RA-DOMAIN-MODULES", [
    "npm run profile:network:verify",
    "node --test tests/profile/quality-result-kind.test.mjs",
  ]],
  ["RA-RUNTIME", ["node --test tests/unit/isolated-validator.test.mjs"]],
  ["RA-INTEGRITY", ["node --test tests/contract/detached-release-signature.test.mjs"]],
  ["RA-VOCABULARY-REGISTRY", ["npm run profile:vocabulary:verify"]],
  ["RA-SEMANTIC-DIFF", ["npm run profile:semantic-diff:verify"]],
  ["RA-PUBLICATION-REPRESENTATIONS", ["npm run profile:publication:verify"]],
  ["RA-MULTI-ENGINE-MATRIX", ["npm run profile:rc:shacl-matrix:verify"]],
  ["RA-SERIALIZATION-PARITY", [
    "npm run profile:rc:serialization-parity:verify",
  ]],
]);

function passedLock(identity) {
  return {
    check: { artifactCount: 1, errorCode: null, status: "passed" },
    verification: { lockBytes: Buffer.from(identity, "utf8") },
  };
}

function passedGit(head = "a".repeat(40)) {
  return { dirtyPathCount: 0, errorCode: null, head, status: "passed" };
}

test("release acceptance binds each critical claim to its intended command", async () => {
  const register = JSON.parse(await readFile(acceptancePath, "utf8"));
  await assertReleaseAcceptanceRegister(register, profileVersion);

  for (const [id, commands] of requiredEvidenceCommands) {
    for (const command of commands) {
      const missingCommand = structuredClone(register);
      const item = missingCommand.items.find((candidate) => candidate.id === id);
      item.evidence = item.evidence.filter(({ value }) => value !== command);
      await assert.rejects(
        assertReleaseAcceptanceRegister(missingCommand, profileVersion),
        (error) => error.code === "INVALID_RELEASE_ACCEPTANCE_REGISTER"
          && error.details.evidenceCommandMismatches.some((mismatch) => (
            mismatch.id === id && mismatch.missingCommands.includes(command)
          )),
        `${id} must remain bound to ${command}`,
      );
    }
  }

  const duplicateCommand = structuredClone(register);
  const serialization = duplicateCommand.items.find(({ id }) => (
    id === "RA-SERIALIZATION-PARITY"
  ));
  serialization.evidence.push(structuredClone(
    serialization.evidence.find(({ kind }) => kind === "command"),
  ));
  await assert.rejects(
    assertReleaseAcceptanceRegister(duplicateCommand, profileVersion),
    (error) => error.code === "INVALID_RELEASE_ACCEPTANCE_REGISTER"
      && error.details.duplicateEvidenceItems.some(({ id }) => (
        id === "RA-SERIALIZATION-PARITY"
      )),
  );
});

test("RA-REQUIREMENTS executes every declared evidence command", async () => {
  const commands = [
    "npm run profile:requirements:verify",
    "npm run profile:requirements:upstream:verify",
    "npm run profile:requirements:upstream:engines",
  ];
  const calls = [];
  const result = await fixedEvidenceCheck({
    profileVersion,
    items: [{
      id: "RA-REQUIREMENTS",
      status: "fixed",
      evidence: commands.map((value) => ({ kind: "command", value })),
    }],
  }, {
    requirementTraceability: { status: "passed" },
  }, {}, {
    runCommand: async (command) => {
      calls.push(command);
      return true;
    },
  });

  assert.deepEqual(calls, commands);
  assert.deepEqual(result.invalidItems, []);
});

test("RA-GIT executes EOL policy evidence and fails closed", async () => {
  const calls = [];
  const register = {
    profileVersion,
    items: [{
      id: "RA-GIT",
      status: "fixed",
      evidence: [
        { kind: "git-control", value: "tracked and clean" },
        { kind: "command", value: "npm run release:eol:verify" },
      ],
    }],
  };
  const passed = await fixedEvidenceCheck(register, { git: { status: "passed" } }, {}, {
    runCommand: async (command) => {
      calls.push(command);
      return true;
    },
  });
  assert.deepEqual(calls, ["npm run release:eol:verify"]);
  assert.deepEqual(passed.invalidItems, []);

  const failed = await fixedEvidenceCheck(register, { git: { status: "passed" } }, {}, {
    runCommand: async () => false,
  });
  assert.deepEqual(failed.invalidItems, ["RA-GIT"]);
});

test("RA-REQUIREMENTS still evaluates declared commands after traceability fails", async () => {
  const calls = [];
  const result = await fixedEvidenceCheck({
    profileVersion,
    items: [{
      id: "RA-REQUIREMENTS",
      status: "fixed",
      evidence: [
        { kind: "command", value: "npm run profile:requirements:upstream:verify" },
        { kind: "command", value: "npm run profile:requirements:upstream:engines" },
      ],
    }],
  }, {
    requirementTraceability: { status: "failed" },
  }, {}, {
    runCommand: async (command) => {
      calls.push(command);
      return true;
    },
  });

  assert.deepEqual(calls, [
    "npm run profile:requirements:upstream:verify",
    "npm run profile:requirements:upstream:engines",
  ]);
  assert.deepEqual(result.invalidItems, ["RA-REQUIREMENTS"]);
});

test("fixed evidence evaluation executes serialization parity verification exactly once", async () => {
  let callCount = 0;
  const result = await fixedEvidenceCheck({
    profileVersion,
    items: [{
      id: "RA-SERIALIZATION-PARITY",
      status: "fixed",
      evidence: [{
        kind: "command",
        value: "npm run profile:rc:serialization-parity:verify",
      }],
    }],
  }, {}, {}, {
    runCommand: async () => {
      callCount += 1;
      return true;
    },
  });

  assert.equal(callCount, 1);
  assert.deepEqual(result.invalidItems, []);
  assert.equal(evidenceCommandTimeoutMs(
    "npm run profile:rc:serialization-parity:verify",
  ), 600_000);

  let duplicateCallCount = 0;
  const duplicateResult = await fixedEvidenceCheck({
    profileVersion,
    items: [{
      id: "RA-SERIALIZATION-PARITY",
      status: "fixed",
      evidence: [
        { kind: "command", value: "npm run profile:rc:serialization-parity:verify" },
        { kind: "command", value: "npm run profile:rc:serialization-parity:verify" },
      ],
    }],
  }, {}, {}, {
    runCommand: async () => {
      duplicateCallCount += 1;
      return true;
    },
  });
  assert.equal(duplicateCallCount, 1);
  assert.deepEqual(duplicateResult.invalidItems, ["RA-SERIALIZATION-PARITY"]);
});

test("terminal runtime checks reject lock and Git state changes", () => {
  const stable = reconcileTerminalRuntimeChecks({
    artifactLock: passedLock("lock-a"),
    git: passedGit(),
  }, {
    artifactLock: passedLock("lock-a"),
    git: passedGit(),
  });
  assert.equal(stable.artifactLock.status, "passed");
  assert.equal(stable.git.status, "passed");

  const changedLock = reconcileTerminalRuntimeChecks({
    artifactLock: passedLock("lock-a"),
    git: passedGit(),
  }, {
    artifactLock: passedLock("lock-b"),
    git: passedGit(),
  });
  assert.equal(changedLock.artifactLock.status, "failed");
  assert.equal(changedLock.artifactLock.errorCode, "ARTIFACT_LOCK_CHANGED_DURING_GATE");

  const changedHead = reconcileTerminalRuntimeChecks({
    artifactLock: passedLock("lock-a"),
    git: passedGit("a".repeat(40)),
  }, {
    artifactLock: passedLock("lock-a"),
    git: passedGit("b".repeat(40)),
  });
  assert.equal(changedHead.git.status, "failed");
  assert.equal(changedHead.git.errorCode, "GIT_STATE_CHANGED_DURING_GATE");

  const becameValid = reconcileTerminalRuntimeChecks({
    artifactLock: {
      check: {
        artifactCount: 0,
        errorCode: "PROFILE_ARTIFACT_DIGEST_MISMATCH",
        status: "failed",
      },
      verification: null,
    },
    git: {
      dirtyPathCount: 1,
      errorCode: "DIRTY_RELEASE_WORKTREE",
      head: "a".repeat(40),
      status: "failed",
    },
  }, {
    artifactLock: passedLock("lock-a"),
    git: passedGit(),
  });
  assert.equal(
    becameValid.artifactLock.errorCode,
    "ARTIFACT_LOCK_STATE_CHANGED_DURING_GATE",
  );
  assert.equal(becameValid.git.errorCode, "GIT_STATE_CHANGED_DURING_GATE");

  const dirtyTerminal = reconcileTerminalRuntimeChecks({
    artifactLock: passedLock("lock-a"),
    git: passedGit(),
  }, {
    artifactLock: passedLock("lock-a"),
    git: {
      dirtyPathCount: 1,
      errorCode: "DIRTY_RELEASE_WORKTREE",
      head: "a".repeat(40),
      status: "failed",
    },
  });
  assert.equal(dirtyTerminal.git.status, "failed");
  assert.equal(dirtyTerminal.git.errorCode, "DIRTY_RELEASE_WORKTREE");
});

test("terminal Git snapshot includes Unicode ignored files inside the release", async () => {
  const releaseRoot = path.join(
    root,
    "profiles/molit-dcat-ap/releases/1.0.0-rc.1",
  );
  const calls = [];
  const result = await gitCheck(releaseRoot, {
    execute: async (command, args) => {
      calls.push({ args, command });
      if (args.includes("--show-prefix")) return { stdout: "molit-dataspace/\n" };
      return {
        stdout: [
          `# branch.oid ${"a".repeat(40)}`,
          "# branch.head main",
          "! node_modules/",
          "! molit-dataspace/profiles/molit-dcat-ap/releases/1.0.0-rc.1/늦은-파일.tmp",
          "",
        ].join("\0"),
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.ok(calls[1].args.includes("--ignored=matching"));
  assert.ok(calls[1].args.includes("-z"));
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "DIRTY_RELEASE_WORKTREE");
  assert.equal(result.dirtyPathCount, 1);
});

test("evaluator runs artifact-lock and Git checks again after fixed evidence", async () => {
  const [manifestBytes, acceptanceBytes] = await Promise.all([
    readFile(path.join(
      root,
      "profiles/molit-dcat-ap/releases/1.0.0-rc.1/manifest.json",
    )),
    readFile(acceptancePath),
  ]);
  const artifactBytes = new Map([
    ["manifest.json", manifestBytes],
    ["release-acceptance.json", acceptanceBytes],
  ]);
  const lockPath = path.join(
    root,
    "profiles/molit-dcat-ap/releases/1.0.0-rc.1/artifact-lock.json",
  );
  const events = [];
  let lockCalls = 0;
  let gitCalls = 0;
  const report = await evaluateReleaseGateV2(profileVersion, {
    checkArtifactLock: () => {
      lockCalls += 1;
      events.push(`lock-${lockCalls}`);
      return {
        check: { artifactCount: 2, errorCode: null, status: "passed" },
        verification: {
          artifactBytes,
          lockBytes: Buffer.from(`lock-${lockCalls}`, "utf8"),
          lockPath,
        },
      };
    },
    checkFixedEvidence: async (register) => {
      events.push("fixed-evidence");
      return {
        invalidItems: [],
        check: {
          errorCode: null,
          invalidItemCount: 0,
          itemCount: register.items.filter(({ status }) => status === "fixed").length,
          status: "passed",
        },
      };
    },
    checkGit: () => {
      gitCalls += 1;
      events.push(`git-${gitCalls}`);
      return passedGit(gitCalls === 1 ? "a".repeat(40) : "b".repeat(40));
    },
    checkTraceability: () => ({
      coverageBlockerCount: 0,
      digest: "0".repeat(64),
      errorCode: null,
      errorCount: 0,
      status: "passed",
    }),
  });

  assert.equal(lockCalls, 2);
  assert.equal(gitCalls, 2);
  assert.ok(events.indexOf("fixed-evidence") < events.indexOf("lock-2"));
  assert.ok(events.indexOf("lock-2") < events.indexOf("git-2"));
  assert.equal(report.checks.artifactLock.errorCode, "ARTIFACT_LOCK_CHANGED_DURING_GATE");
  assert.equal(report.checks.git.errorCode, "GIT_STATE_CHANGED_DURING_GATE");
  assert.equal(report.candidateEligible, false);
});

test("release evidence bytes must match the initial locked snapshot", async () => {
  const [manifestBytes, acceptanceBytes] = await Promise.all([
    readFile(path.join(
      root,
      "profiles/molit-dcat-ap/releases/1.0.0-rc.1/manifest.json",
    )),
    readFile(acceptancePath),
  ]);
  const releaseRootRelative = "profiles/molit-dcat-ap/releases/1.0.0-rc.1";
  const snapshot = {
    artifactBytes: new Map([["release-acceptance.json", acceptanceBytes]]),
    releaseRootRelative,
  };
  assert.equal(releaseEvidenceMatchesSnapshot(
    `${releaseRootRelative}/release-acceptance.json`,
    acceptanceBytes,
    snapshot,
  ), true);
  assert.equal(releaseEvidenceMatchesSnapshot(
    `${releaseRootRelative}/release-acceptance.json`,
    Buffer.from("{}", "utf8"),
    snapshot,
  ), false);
  assert.equal(releaseEvidenceMatchesSnapshot(
    "tools/release/release-gate-v2.mjs",
    Buffer.from("outside release", "utf8"),
    snapshot,
  ), true);

  const artifactBytes = new Map([
    ["manifest.json", manifestBytes],
    ["release-acceptance.json", Buffer.from("{}", "utf8")],
  ]);
  const lockPath = path.join(root, releaseRootRelative, "artifact-lock.json");
  const report = await evaluateReleaseGateV2(profileVersion, {
    checkArtifactLock: () => ({
      check: { artifactCount: 2, errorCode: null, status: "passed" },
      verification: {
        artifactBytes,
        lockBytes: Buffer.from("stable-lock", "utf8"),
        lockPath,
      },
    }),
    checkFixedEvidence: async (register) => ({
      invalidItems: [],
      check: {
        errorCode: null,
        invalidItemCount: 0,
        itemCount: register.items.filter(({ status }) => status === "fixed").length,
        status: "passed",
      },
    }),
    checkGit: () => passedGit(),
    checkTraceability: () => ({
      coverageBlockerCount: 0,
      digest: "0".repeat(64),
      errorCode: null,
      errorCount: 0,
      status: "passed",
    }),
  });
  assert.equal(report.checks.artifactLock.status, "failed");
  assert.equal(
    report.checks.artifactLock.errorCode,
    "RELEASE_ACCEPTANCE_SNAPSHOT_MISMATCH",
  );
  assert.equal(report.candidateEligible, false);
});

test("requirement coverage evidence must report complete integrated coverage", async () => {
  const bytes = await readFile(coveragePath);
  assert.equal(validateRequirementCoverageEvidence(bytes, profileVersion), true);

  const incomplete = JSON.parse(bytes.toString("utf8"));
  incomplete.counts.integratedFullyCovered -= 1;
  assert.equal(validateRequirementCoverageEvidence(
    Buffer.from(JSON.stringify(incomplete), "utf8"),
    profileVersion,
  ), false);

  const coverageRelative = "requirements/coverage-blockers.json";
  const evidenceValue = [
    "profiles/molit-dcat-ap/releases/1.0.0-rc.1",
    coverageRelative,
  ].join("/");
  const register = {
    profileVersion,
    items: [{
      id: "RA-REQUIREMENTS",
      status: "fixed",
      evidence: [{ kind: "requirement-coverage", value: evidenceValue }],
    }],
  };
  const runtime = {
    releaseSnapshot: {
      artifactBytes: new Map([[coverageRelative, bytes]]),
      releaseRootRelative: "profiles/molit-dcat-ap/releases/1.0.0-rc.1",
    },
    requirementTraceability: { status: "passed" },
  };
  assert.deepEqual(
    (await fixedEvidenceCheck(register, runtime, {})).invalidItems,
    [],
  );
  runtime.releaseSnapshot.artifactBytes.set(coverageRelative, Buffer.from("{}", "utf8"));
  assert.deepEqual(
    (await fixedEvidenceCheck(register, runtime, {})).invalidItems,
    ["RA-REQUIREMENTS"],
  );
});
