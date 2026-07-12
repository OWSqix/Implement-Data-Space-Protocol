import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  legacyValidationIsolationLimits,
  runValidationWorker,
  validateProfileDocumentIsolated,
  validationIsolationLimits,
} from "../../src/profile/isolated-validator.mjs";
import {
  loadProfileRelease,
  validateProfileManifest,
} from "../../src/profile/registry.mjs";

const fixtureWorker = new URL("../fixtures/validation-worker-fixture.mjs", import.meta.url);

function runFixture(action, overrides = {}) {
  return runValidationWorker({
    maxValidationMillis: 2_000,
    maxWorkerHeapMb: 64,
    workerData: { action },
    workerUrl: fixtureWorker,
    ...overrides,
  });
}

test("PROFILE-ISOLATION-001: a wall-clock timeout terminates a hung worker", async () => {
  await assert.rejects(
    runFixture("hang", { maxValidationMillis: 50 }),
    (error) => error.code === "PROFILE_VALIDATION_TIMEOUT"
      && error.details.maxValidationMillis === 50,
  );
});

test("PROFILE-ISOLATION-002: a worker crash does not poison the next validation", async () => {
  await assert.rejects(
    runFixture("crash"),
    (error) => error.code === "PROFILE_VALIDATION_WORKER_CRASH",
  );
  assert.deepEqual(await runFixture("alive"), { alive: true });
});

test("PROFILE-ISOLATION-003: the worker receives the configured V8 heap limit", async () => {
  const observed = await runFixture("limits", { maxWorkerHeapMb: 96 });
  assert.equal(observed.maxOldGenerationSizeMb, 96);
  assert.equal(observed.stackSizeMb, 4);
});

test("PROFILE-ISOLATION-004: manifest v1 uses safe fallback limits and v2 pins limits", async () => {
  const legacy = await loadProfileRelease("0.1.0");
  assert.deepEqual(
    validationIsolationLimits(legacy.manifest),
    legacyValidationIsolationLimits,
  );
  const candidate = await loadProfileRelease("1.0.0-rc.1");
  assert.deepEqual(validationIsolationLimits(candidate.manifest), {
    maxValidationMillis: 30_000,
    maxWorkerHeapMb: 512,
  });
  for (const field of ["maxValidationMillis", "maxWorkerHeapMb"]) {
    const missing = structuredClone(candidate.manifest);
    delete missing.limits[field];
    assert.throws(
      () => validateProfileManifest(missing, candidate.version),
      (error) => error.code === "INVALID_PROFILE_MANIFEST",
      field,
    );
  }
});

test("PROFILE-ISOLATION-005: real validation completes in the isolated worker", async () => {
  const inputPath = path.join(
    fileURLToPath(new URL("../../", import.meta.url)),
    "profiles",
    "molit-dcat-ap",
    "releases",
    "0.1.0",
    "examples",
    "valid",
    "traffic-observation-catalog.ttl",
  );
  const report = await validateProfileDocumentIsolated({
    inputPath,
    profileName: "core",
    version: "0.1.0",
  });
  assert.equal(report.profile.name, "core");
  assert.equal(report.summary.gatePassed, true);
  assert.match(report.engine.molitValidatorBuildDigest, /^sha256:[0-9a-f]{64}$/u);
});
