import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  composePublicationCheckReport,
} from "../../src/profile/cli.mjs";
import {
  isPublicationProfile,
  listReleaseMachineArtifacts,
  loadProfileRelease,
  profileVersionEnvironmentVariable,
  resolveProfileVersion,
  selectProfileBundle,
  selectPublicationCheckPlan,
  validateProfileManifest,
} from "../../src/profile/registry.mjs";
import { validateProfileDocument } from "../../src/profile/validator.mjs";
import {
  parseBuildArguments,
  profileBundleBuildDefinitions,
} from "../../tools/profile/build-bundles.mjs";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const legacyRelease = await loadProfileRelease("0.1.0");

function arbitraryModuleManifest() {
  const manifest = structuredClone(legacyRelease.manifest);
  manifest.schemaVersion = "molit.application-profile-manifest/2";
  manifest.artifactInventoryPolicy = "all-release-files";
  manifest.publicationContract = "publication/content-negotiation.json";
  manifest.representationArtifacts = {
    ontologyHtml: "ontology.html",
    ontologyJsonLd: "serializations/ontology.jsonld",
    ontologyTurtle: "ontology/ontology.ttl",
    profileHtml: "index.html",
    profileJsonLd: "serializations/profile.jsonld",
    profileTurtle: "profile-description.ttl",
  };
  manifest.version = "1.2.3-rc.4";
  manifest.versionIri = `${manifest.profileIri}/${manifest.version}`;
  manifest.limits.maxValidationMillis = 30_000;
  manifest.limits.maxWorkerHeapMb = 256;
  manifest.publishedBundles = {
    road: "bundles/road.ttl",
    "road-publication": "bundles/road-publication.ttl",
    support: "bundles/support.ttl",
  };
  manifest.publicationPolicyProfile = "road-publication-gate";
  manifest.profiles = {
    "road-audit": {
      ...structuredClone(legacyRelease.manifest.profiles["eu-controlled-audit"]),
      conformanceIri: manifest.versionIri,
    },
    "road-conformance": {
      ...structuredClone(legacyRelease.manifest.profiles.core),
      bundle: "road",
      conformanceIri: manifest.versionIri,
      example: "examples/valid/road-conformance.ttl",
    },
    "road-publication-gate": {
      ...structuredClone(legacyRelease.manifest.profiles["core-publication"]),
      bundle: "road-publication",
      conformanceIri: `${manifest.versionIri}/publication-policy`,
      example: "examples/valid/road-publication.ttl",
    },
  };
  return manifest;
}

test("PROFILE-VERSION-001: an explicit release overrides the environment selector", () => {
  assert.equal(
    resolveProfileVersion("2.0.0", { [profileVersionEnvironmentVariable]: "1.2.3" }),
    "2.0.0",
  );
  assert.equal(
    resolveProfileVersion(undefined, { [profileVersionEnvironmentVariable]: "1.2.3-rc.4" }),
    "1.2.3-rc.4",
  );
  assert.equal(resolveProfileVersion(undefined, {}), "0.1.0");
  assert.throws(
    () => resolveProfileVersion(undefined, { [profileVersionEnvironmentVariable]: "../0.1.0" }),
    (error) => error.code === "INVALID_PROFILE_VERSION",
  );
});

test("PROFILE-VERSION-002: CLI list accepts the environment selector", () => {
  const cli = fileURLToPath(new URL("../../src/profile/cli.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "list"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      [profileVersionEnvironmentVariable]: "0.1.0",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).version, "0.1.0");
});

test("PROFILE-MANIFEST-001: arbitrary module names map to published bundle keys", () => {
  const manifest = arbitraryModuleManifest();
  assert.doesNotThrow(() => validateProfileManifest(manifest, manifest.version));

  const release = {
    manifest,
    releaseRoot: legacyRelease.releaseRoot,
    version: manifest.version,
  };
  const profile = manifest.profiles["road-publication-gate"];
  assert.deepEqual(selectProfileBundle(release, profile, "road-publication-gate"), {
    name: "road-publication",
    path: "bundles/road-publication.ttl",
  });
  assert.equal(isPublicationProfile(profile), true);
  assert.equal(isPublicationProfile(manifest.profiles["road-conformance"]), false);
  assert.deepEqual(selectPublicationCheckPlan(release, "road-conformance"), {
    conformanceProfileName: "road-conformance",
    mode: "composite",
    publicationPolicyProfileName: "road-publication-gate",
  });
  assert.throws(
    () => selectPublicationCheckPlan(release, "road-publication-gate"),
    (error) => error.code === "INCOMPLETE_PUBLICATION_CHECK",
  );
  assert.deepEqual(profileBundleBuildDefinitions(release), [
    {
      bundle: { name: "road", path: "bundles/road.ttl" },
      profileName: "road-conformance",
      sources: manifest.profiles["road-conformance"].shapes,
    },
    {
      bundle: {
        name: "road-publication",
        path: "bundles/road-publication.ttl",
      },
      profileName: "road-publication-gate",
      sources: manifest.profiles["road-publication-gate"].shapes,
    },
  ]);
});

test("PROFILE-MANIFEST-002: new conformance and publication profiles must declare bundles", () => {
  for (const profileName of ["road-conformance", "road-publication-gate"]) {
    const manifest = arbitraryModuleManifest();
    delete manifest.profiles[profileName].bundle;
    assert.throws(
      () => validateProfileManifest(manifest, manifest.version),
      (error) => error.code === "INVALID_PROFILE_MANIFEST",
      profileName,
    );
  }

  const diagnosticManifest = arbitraryModuleManifest();
  assert.equal(diagnosticManifest.profiles["road-audit"].bundle, undefined);
  assert.doesNotThrow(() => (
    validateProfileManifest(diagnosticManifest, diagnosticManifest.version)
  ));

  const wrongPolicy = arbitraryModuleManifest();
  wrongPolicy.publicationPolicyProfile = "road-conformance";
  assert.throws(
    () => validateProfileManifest(wrongPolicy, wrongPolicy.version),
    (error) => error.code === "INVALID_PROFILE_MANIFEST",
  );

  const unownedBundle = arbitraryModuleManifest();
  unownedBundle.publishedBundles.unowned = "bundles/unowned.ttl";
  assert.throws(
    () => validateProfileManifest(unownedBundle, unownedBundle.version),
    (error) => error.code === "INVALID_PROFILE_MANIFEST",
  );
});

test("PROFILE-MANIFEST-002A: published profile identities, bundle paths and examples are unique", () => {
  const duplicateIri = arbitraryModuleManifest();
  duplicateIri.profiles["road-publication-gate"].conformanceIri =
    duplicateIri.profiles["road-conformance"].conformanceIri;
  assert.throws(
    () => validateProfileManifest(duplicateIri, duplicateIri.version),
    (error) => error.code === "INVALID_PROFILE_MANIFEST",
  );

  const duplicateBundlePath = arbitraryModuleManifest();
  duplicateBundlePath.publishedBundles["road-publication"] =
    duplicateBundlePath.publishedBundles.road;
  assert.throws(
    () => validateProfileManifest(duplicateBundlePath, duplicateBundlePath.version),
    (error) => error.code === "INVALID_PROFILE_MANIFEST",
  );

  const duplicateExample = arbitraryModuleManifest();
  duplicateExample.profiles["road-publication-gate"].example =
    duplicateExample.profiles["road-conformance"].example;
  assert.throws(
    () => validateProfileManifest(duplicateExample, duplicateExample.version),
    (error) => error.code === "INVALID_PROFILE_MANIFEST",
  );

  for (const invalidExample of [undefined, "examples/invalid/not-positive.ttl", "README.md"]) {
    const missingOrInvalidExample = arbitraryModuleManifest();
    missingOrInvalidExample.profiles["road-conformance"].example = invalidExample;
    assert.throws(
      () => validateProfileManifest(missingOrInvalidExample, missingOrInvalidExample.version),
      (error) => error.code === "INVALID_PROFILE_MANIFEST",
    );
  }
});

test("PROFILE-MANIFEST-003: release 0.1.0 retains its locked bundle inference", async () => {
  const lockedManifestBytes = await readFile(
    path.join(legacyRelease.releaseRoot, "manifest.json"),
  );
  assert.equal(legacyRelease.manifest.profiles.core.bundle, undefined);
  assert.deepEqual(
    selectProfileBundle(legacyRelease, legacyRelease.manifest.profiles.core, "core"),
    { name: "core", path: "bundles/core.ttl" },
  );
  assert.deepEqual(
    selectProfileBundle(
      legacyRelease,
      legacyRelease.manifest.profiles["geo-publication"],
      "geo-publication",
    ),
    { name: "geo", path: "bundles/geo.ttl" },
  );
  assert.equal(JSON.parse(lockedManifestBytes).profiles.core.bundle, undefined);
  assert.deepEqual(selectPublicationCheckPlan(legacyRelease, "geo-publication"), {
    conformanceProfileName: null,
    mode: "legacy",
    publicationPolicyProfileName: "geo-publication",
  });
});

test("PROFILE-LOCK-001: manifest v2 locks normative prose while v1 preserves its machine-only inventory", async () => {
  const candidateRelease = await loadProfileRelease("1.0.0-rc.1");
  const candidateArtifacts = await listReleaseMachineArtifacts(candidateRelease);
  const legacyArtifacts = await listReleaseMachineArtifacts(legacyRelease);
  assert.ok(candidateArtifacts.includes("index.md"));
  assert.ok(candidateArtifacts.includes("docs/ontology/competency-questions.md"));
  assert.ok(!candidateArtifacts.includes(candidateRelease.manifest.lockFile));
  assert.ok(!legacyArtifacts.includes("index.md"));
});

test("PROFILE-PUBLISH-001: composite publication reports require both gates", async () => {
  const inputPath = path.join(
    legacyRelease.releaseRoot,
    "examples",
    "valid",
    "traffic-observation-catalog.ttl",
  );
  const conformance = await validateProfileDocument({
    inputPath,
    profileName: "core",
    version: "0.1.0",
  });
  const validPolicy = await validateProfileDocument({
    inputPath,
    profileName: "core-publication",
    version: "0.1.0",
  });
  const policy = structuredClone(validPolicy);
  policy.summary.counts.Warning = 1;
  policy.summary.gatePassed = false;
  policy.summary.resultCount += 1;
  const report = composePublicationCheckReport(conformance, policy);
  assert.equal(report.schemaVersion, "molit.publication-check-report/1");
  assert.equal(report.summary.conformanceGatePassed, true);
  assert.equal(report.summary.publicationPolicyGatePassed, false);
  assert.equal(report.summary.gatePassed, false);
  assert.equal(report.summary.counts.Warning, 1);
  assert.equal(report.authority.publicationAuthorized, false);
  assert.match(report.decisionDigest, /^sha256:[0-9a-f]{64}$/u);

  const changedInput = structuredClone(validPolicy);
  changedInput.input.byteSha256 = "b".repeat(64);
  assert.throws(
    () => composePublicationCheckReport(conformance, changedInput),
    (error) => error.code === "PROFILE_INPUT_CHANGED_DURING_PUBLICATION_CHECK",
  );
});

test("PROFILE-PUBLISH-002: manifest v2 rejects a policy-only CLI check", () => {
  const cli = fileURLToPath(new URL("../../src/profile/cli.mjs", import.meta.url));
  const inputPath = path.join(
    projectRoot,
    "profiles",
    "molit-dcat-ap",
    "releases",
    "1.0.0-rc.1",
    "examples",
    "valid",
    "traffic-observation-catalog.ttl",
  );
  const result = spawnSync(process.execPath, [
    cli,
    "publish-check",
    "--input",
    inputPath,
    "--profile",
    "publication-policy",
    "--version",
    "1.0.0-rc.1",
  ], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout);
  assert.equal(JSON.parse(result.stderr).code, "INCOMPLETE_PUBLICATION_CHECK");
});

test("PROFILE-BUILD-001: bundle builder accepts one explicit version option", () => {
  assert.deepEqual(parseBuildArguments([]), { version: undefined });
  assert.deepEqual(parseBuildArguments(["--version", "1.2.3-rc.4"]), {
    version: "1.2.3-rc.4",
  });
  assert.throws(
    () => parseBuildArguments(["--version", "1.2.3", "--version", "2.0.0"]),
    (error) => error.code === "INVALID_ARGUMENTS",
  );
});
