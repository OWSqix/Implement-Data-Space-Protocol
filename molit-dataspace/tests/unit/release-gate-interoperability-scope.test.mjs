import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertKoreanInteroperabilityRegister,
  interoperabilityReleaseBlockers,
  releaseGateV2ExitCode,
} from "../../tools/release/release-gate-v2.mjs";
import { parseReleaseGateArguments } from "../../tools/release/release-gate.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const version = "1.0.0-rc.1";
const registerBytes = await readFile(
  path.join(root, "standards/korean-interoperability-register.json"),
);
const register = JSON.parse(registerBytes.toString("utf8"));

test("interoperability register requires release-blocking scope and affected modules", async () => {
  await assert.doesNotReject(assertKoreanInteroperabilityRegister(
    register,
    version,
    registerBytes,
  ));

  const missingScope = structuredClone(register);
  delete missingScope.blindspots[0].blockingScope;
  await assert.rejects(
    assertKoreanInteroperabilityRegister(
      missingScope,
      version,
      Buffer.from(JSON.stringify(missingScope), "utf8"),
    ),
    { code: "INVALID_KOREAN_INTEROPERABILITY_REGISTER" },
  );

  const invalidBridgeModules = structuredClone(register);
  const bridge = invalidBridgeModules.blindspots.find(
    ({ blockingScope }) => blockingScope === "bridge-runtime",
  );
  bridge.affectedModules = ["core"];
  await assert.rejects(
    assertKoreanInteroperabilityRegister(
      invalidBridgeModules,
      version,
      Buffer.from(JSON.stringify(invalidBridgeModules), "utf8"),
    ),
    { code: "INVALID_KOREAN_INTEROPERABILITY_REGISTER" },
  );
});

test("a status-only fixed claim cannot replace the independently reviewed bytes", async () => {
  const mutated = structuredClone(register);
  const unresolved = mutated.blindspots.find(({ status }) => (
    status === "blocked-external-evidence"
  ));
  unresolved.status = "fixed";
  const mutatedBytes = Buffer.from(`${JSON.stringify(mutated, null, 2)}\n`, "utf8");

  await assert.rejects(
    assertKoreanInteroperabilityRegister(mutated, version, mutatedBytes),
    (error) => error.code === "INVALID_KOREAN_INTEROPERABILITY_REGISTER"
      && error.details.actualSha256 !== error.details.expectedSha256,
  );
});

test("interoperability blocking policy separates profile, external, and bridge work", () => {
  const blockers = interoperabilityReleaseBlockers({
    blindspots: [
      {
        id: "BS-CORE-OPEN",
        severity: "P0",
        status: "open",
        releaseGateRequired: true,
        blockingScope: "standard-core",
        affectedModules: ["core"],
      },
      {
        id: "BS-MODULE-EXTERNAL",
        severity: "P1",
        status: "blocked-external-evidence",
        releaseGateRequired: true,
        blockingScope: "module-conditional",
        affectedModules: ["quality"],
      },
      {
        id: "BS-BRIDGE-OPEN",
        severity: "P0",
        status: "open",
        releaseGateRequired: true,
        blockingScope: "bridge-runtime",
        affectedModules: ["bridge-runtime"],
      },
      {
        id: "BS-CORE-FIXED",
        severity: "P1",
        status: "fixed",
        releaseGateRequired: true,
        blockingScope: "standard-core",
        affectedModules: ["core"],
      },
    ],
  });

  assert.deepEqual(blockers.map(({ id }) => id), ["BS-CORE-OPEN", "BS-MODULE-EXTERNAL"]);
  assert.deepEqual(blockers[0], {
    id: "BS-CORE-OPEN",
    scope: "profile-core",
    source: "korean-interoperability-register",
    status: "open",
    severity: "P0",
    blocksCandidate: true,
    blocksRecommendation: true,
    blockingScope: "standard-core",
    affectedModules: ["core"],
  });
  assert.equal(blockers[1].scope, "institutional");
  assert.equal(blockers[1].blocksCandidate, false);
  assert.equal(blockers[1].blocksRecommendation, true);
});

test("current external standards block Recommendation without leaking bridge blockers", () => {
  const blockers = interoperabilityReleaseBlockers(register);
  assert.ok(blockers.some(({ id }) => id === "BS-ISO19115-KS-CLAUSE"));
  assert.ok(blockers.some(({ id }) => id === "BS-QUALITY-LOSS"));
  assert.equal(blockers.some(({ id }) => id === "BS-ISO19115-XML-TECH"), false);
  assert.equal(blockers.some(({ id }) => id === "BS-AUTHORITY-REGISTRY"), false);
  assert.ok(blockers.every(({ blocksCandidate }) => blocksCandidate === false));
  assert.ok(blockers.every(({ blocksRecommendation }) => blocksRecommendation === true));
});

test("candidate target is explicit while Recommendation remains the default", () => {
  const decision = { candidateEligible: true, recommendationEligible: false };
  assert.equal(releaseGateV2ExitCode(decision), 2);
  assert.equal(releaseGateV2ExitCode(decision, "recommendation"), 2);
  assert.equal(releaseGateV2ExitCode(decision, "candidate"), 0);
  assert.throws(
    () => releaseGateV2ExitCode(decision, "bridge"),
    { code: "INVALID_ARGUMENTS" },
  );

  assert.deepEqual(parseReleaseGateArguments(["--version", version]), {
    target: "recommendation",
    version,
  });
  assert.deepEqual(parseReleaseGateArguments([
    `--target=candidate`,
    "--version",
    version,
  ]), { target: "candidate", version });
  assert.deepEqual(parseReleaseGateArguments([
    "--version",
    version,
    "--target",
    "recommendation",
  ]), { target: "recommendation", version });
  assert.throws(
    () => parseReleaseGateArguments(["--version", version, "--target=bridge"]),
    { code: "INVALID_ARGUMENTS" },
  );
  assert.throws(
    () => parseReleaseGateArguments(["--version", version, "--version", version]),
    { code: "INVALID_ARGUMENTS" },
  );
});

test("package scripts keep Recommendation default and expose a candidate lane", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["release:status:rc"],
    "node tools/release/release-gate.mjs --version 1.0.0-rc.1",
  );
  assert.match(packageJson.scripts["release:status:rc:candidate"], /--target=candidate$/u);
  assert.equal(
    packageJson.scripts["release:gate:win32-x64:candidate"],
    "npm run verify:release:win32-x64 && npm run release:status:rc:candidate",
  );
});
