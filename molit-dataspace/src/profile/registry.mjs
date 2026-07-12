import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PROFILE_ROOT = path.join(PROJECT_ROOT, "profiles", "molit-dcat-ap", "releases");
const LEGACY_DEFAULT_VERSION = "0.1.0";
const LEGACY_MANIFEST_SCHEMA = "molit.application-profile-manifest/1";
const CURRENT_MANIFEST_SCHEMA = "molit.application-profile-manifest/2";
export const profileVersionEnvironmentVariable = "MOLIT_PROFILE_VERSION";
const semanticVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
export const releaseMachineExtensions = Object.freeze([
  ".csv",
  ".json",
  ".jsonld",
  ".nq",
  ".nt",
  ".rdf",
  ".sch",
  ".ttl",
  ".xml",
  ".xsd",
]);
const releaseMachineExtensionSet = new Set(releaseMachineExtensions);

function assert(condition, code, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    throw error;
  }
}

function parseJsonBytes(bytes, filePath) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    const error = new Error(`profile JSON is not valid UTF-8: ${filePath}`, { cause });
    error.code = "INVALID_UTF8";
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch (cause) {
    const error = new Error(`profile JSON is invalid: ${filePath}`, { cause });
    error.code = "INVALID_PROFILE_JSON";
    throw error;
  }
}

async function readJson(filePath, code) {
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") error.code = code;
    throw error;
  }
  return parseJsonBytes(bytes, filePath);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validArtifactPath(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.split(/[\\/]/u).includes("..");
}

export function isPublicationProfile(profile) {
  return profile?.kind === "validation-policy" && profile?.gate === "warning";
}

export function resolveProfileVersion(
  explicitVersion,
  environment = process.env,
) {
  const environmentVersion = environment?.[profileVersionEnvironmentVariable];
  const version = explicitVersion ?? environmentVersion ?? LEGACY_DEFAULT_VERSION;
  assert(
    typeof version === "string" && semanticVersionPattern.test(version),
    "INVALID_PROFILE_VERSION",
    "profile version must be a semantic version",
    {
      environmentVariable: profileVersionEnvironmentVariable,
      version,
    },
  );
  return version;
}

export function resolveProfileReleaseRoot(version) {
  const selectedVersion = resolveProfileVersion(version);
  const releaseRoot = path.resolve(PROFILE_ROOT, selectedVersion);
  assert(
    releaseRoot.startsWith(`${path.resolve(PROFILE_ROOT)}${path.sep}`),
    "PROFILE_PATH_ESCAPE",
    "profile release path escaped the profile root",
  );
  return releaseRoot;
}

export function validateProfileManifest(manifest, version) {
  assert(
    isRecord(manifest),
    "INVALID_PROFILE_MANIFEST",
    "profile manifest must be a JSON object",
    { version },
  );
  const limits = manifest.limits;
  const validInteger = (value, minimum, maximum) => (
    Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
  const profiles = isRecord(manifest.profiles) ? manifest.profiles : {};
  const profileEntries = Object.entries(profiles);
  const publishedBundles = isRecord(manifest.publishedBundles)
    ? manifest.publishedBundles
    : {};
  const publishedBundleEntries = Object.entries(publishedBundles);
  const usesLegacyBundleInference = manifest.schemaVersion === LEGACY_MANIFEST_SCHEMA;
  const validProfile = ([name, profile]) => {
    if (name.length === 0
      || name.length > 100
      || !isRecord(profile)
      || !["conformance", "diagnostic", "validation-policy"].includes(profile.kind)
      || !["violation", "warning"].includes(profile.gate)
      || typeof profile.conformanceIri !== "string"
      || !profile.conformanceIri.startsWith("https://")
      || typeof profile.description !== "string"
      || profile.description.length === 0
      || !Array.isArray(profile.shapes)
      || profile.shapes.length === 0
      || !profile.shapes.every(validArtifactPath)) {
      return false;
    }
    if (!usesLegacyBundleInference && profile.kind !== "diagnostic"
      && (typeof profile.example !== "string"
        || !profile.example.startsWith("examples/valid/")
        || !profile.example.endsWith(".ttl")
        || !validArtifactPath(profile.example))) {
      return false;
    }
    if (profile.example !== undefined && !validArtifactPath(profile.example)) return false;
    if (profile.bundle !== undefined) {
      return typeof profile.bundle === "string"
        && profile.bundle.length > 0
        && Object.hasOwn(publishedBundles, profile.bundle)
        && profile.bundle !== "support";
    }
    return profile.kind === "diagnostic" || usesLegacyBundleInference;
  };
  const conformanceProfiles = profileEntries.filter(([, profile]) => (
    profile?.kind === "conformance"
  ));
  const publishedProfiles = profileEntries.filter(([, profile]) => (
    profile?.kind !== "diagnostic"
  ));
  const explicitProfileBundles = profileEntries
    .map(([, profile]) => profile.bundle)
    .filter((bundle) => bundle !== undefined);
  const publishedProfileBundles = publishedBundleEntries
    .map(([bundle]) => bundle)
    .filter((bundle) => bundle !== "support");
  const publishedProfileIris = publishedProfiles.map(([, profile]) => profile.conformanceIri);
  const publishedProfileExamples = publishedProfiles.map(([, profile]) => profile.example);
  const publishedBundlePaths = publishedProfileBundles.map((bundle) => publishedBundles[bundle]);
  const currentBundleMappingIsComplete = usesLegacyBundleInference || (
    new Set(explicitProfileBundles).size === explicitProfileBundles.length
      && explicitProfileBundles.length === publishedProfileBundles.length
      && publishedProfileBundles.every((bundle) => explicitProfileBundles.includes(bundle))
      && new Set(publishedBundlePaths).size === publishedBundlePaths.length
      && new Set(publishedProfileIris).size === publishedProfileIris.length
      && new Set(publishedProfileExamples).size === publishedProfileExamples.length
  );
  const publicationPolicyProfile = profiles[manifest.publicationPolicyProfile];
  const publicationPolicyMappingIsValid = manifest.publicationPolicyProfile === undefined
    ? usesLegacyBundleInference
    : typeof manifest.publicationPolicyProfile === "string"
      && manifest.publicationPolicyProfile.length > 0
      && isPublicationProfile(publicationPolicyProfile);
  const isolationLimitsAreValid = usesLegacyBundleInference
    ? (limits?.maxValidationMillis === undefined
        || validInteger(limits.maxValidationMillis, 100, 120_000))
      && (limits?.maxWorkerHeapMb === undefined
        || validInteger(limits.maxWorkerHeapMb, 32, 1_024))
    : validInteger(limits?.maxValidationMillis, 100, 120_000)
      && validInteger(limits?.maxWorkerHeapMb, 32, 1_024);
  const artifactInventoryPolicyIsValid = usesLegacyBundleInference
    ? manifest.artifactInventoryPolicy === undefined
    : manifest.artifactInventoryPolicy === "all-release-files";
  const representationArtifactsAreValid = usesLegacyBundleInference
    ? manifest.representationArtifacts === undefined
      && manifest.publicationContract === undefined
    : validArtifactPath(manifest.publicationContract)
      && isRecord(manifest.representationArtifacts)
      && [
        "profileHtml",
        "profileTurtle",
        "profileJsonLd",
        "ontologyHtml",
        "ontologyTurtle",
        "ontologyJsonLd",
      ].every((key) => validArtifactPath(manifest.representationArtifacts[key]));
  const currentEvidencePathsAreValid = [
    manifest.approvalProvenance,
    manifest.conformanceCases,
    manifest.domesticStandardsAlignment,
    manifest.domesticStandardsCrosswalk,
    manifest.localNormativeClauses,
    manifest.networkEditionLifecycleCases,
    manifest.networkReferencePolicy,
    manifest.networkRuntimeControls,
    manifest.ontologyTermGovernance,
    manifest.releaseAcceptanceRegister,
    manifest.requirementsRegistry,
    manifest.tombstoneRegistry,
    manifest.upstreamRequirementsRegistry,
    manifest.upstreamRequirementsCsv,
    manifest.vocabularyRegistry,
  ].every((value) => value === undefined || validArtifactPath(value));
  assert(
    [LEGACY_MANIFEST_SCHEMA, CURRENT_MANIFEST_SCHEMA].includes(manifest.schemaVersion)
      && manifest.profileId === "molit-dcat-ap"
      && manifest.version === version
      && manifest.profileIri === "https://data.molit.go.kr/profile/molit-dcat-ap"
      && (manifest.geoProfileIri === undefined
        || (typeof manifest.geoProfileIri === "string"
          && manifest.geoProfileIri.startsWith("https://")))
      && manifest.versionIri === `${manifest.profileIri}/${version}`
      && ["candidate", "deprecated", "recommendation", "working-draft"].includes(manifest.status)
      && ["dereferenceable", "proposed-not-yet-dereferenceable"].includes(manifest.namespaceStatus)
      && Array.isArray(manifest.background)
      && manifest.background.every(validArtifactPath)
      && isRecord(manifest.profiles)
      && profileEntries.length > 0
      && conformanceProfiles.length > 0
      && profileEntries.every(validProfile)
      && currentBundleMappingIsComplete
      && publicationPolicyMappingIsValid
      && artifactInventoryPolicyIsValid
      && representationArtifactsAreValid
      && currentEvidencePathsAreValid
      && isRecord(manifest.localImportMap)
      && Object.entries(manifest.localImportMap).every(([iri, artifact]) => (
        iri.startsWith("https://") && validArtifactPath(artifact)
      ))
      && isRecord(manifest.routingVocabularySources)
      && Object.values(manifest.routingVocabularySources).every(validArtifactPath)
      && isRecord(manifest.publishedBundles)
      && publishedBundleEntries.length > 1
      && publishedBundleEntries.every(([, artifact]) => validArtifactPath(artifact))
      && validArtifactPath(publishedBundles.support)
      && [
        manifest.context,
        manifest.lockFile,
        manifest.ontology,
        manifest.profileDescription,
        manifest.publicValuePolicy,
        manifest.shapeMetaValidation?.shaclShacl,
      ].every(validArtifactPath)
      && validInteger(limits?.maxInputBytes, 1, 5_242_880)
      && validInteger(limits?.maxInputQuads, 1, 100_000)
      && validInteger(limits?.maxValuesPerSubjectPredicate, 1, 1_000)
      && validInteger(limits?.maxValidationResults, 1, 500)
      && validInteger(limits?.maxLiteralLength, 1, 20_000)
      && isolationLimitsAreValid,
    "INVALID_PROFILE_MANIFEST",
    "profile manifest identity, status, paths or limits are invalid",
    { version },
  );
}

export function projectRoot() {
  return PROJECT_ROOT;
}

export async function loadProfileRelease(requestedVersion) {
  const version = resolveProfileVersion(requestedVersion);
  const releaseRoot = resolveProfileReleaseRoot(version);
  const manifestPath = path.join(releaseRoot, "manifest.json");
  const manifest = await readJson(manifestPath, "PROFILE_RELEASE_NOT_FOUND");
  validateProfileManifest(manifest, version);
  return { manifest, manifestPath, releaseRoot, version };
}

export function resolveReleaseArtifact(release, relativePath) {
  assert(
    typeof relativePath === "string" && relativePath.length > 0,
    "INVALID_ARTIFACT_PATH",
    "artifact path must be a non-empty string",
  );
  const resolved = path.resolve(release.releaseRoot, relativePath);
  const relative = path.relative(release.releaseRoot, resolved);
  assert(
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative),
    "ARTIFACT_PATH_ESCAPE",
    "artifact path escaped the release directory",
    { relativePath },
  );
  return resolved;
}

export function selectValidationProfile(release, profileName) {
  const profile = release.manifest.profiles?.[profileName];
  assert(
    profile && Array.isArray(profile.shapes),
    "UNKNOWN_VALIDATION_PROFILE",
    `unknown validation profile: ${profileName}`,
    { available: Object.keys(release.manifest.profiles ?? {}).sort() },
  );
  assert(
    profile.gate === "violation" || profile.gate === "warning",
    "INVALID_VALIDATION_GATE",
    "profile gate must be violation or warning",
    { profileName },
  );
  assert(
    ["conformance", "diagnostic", "validation-policy"].includes(profile.kind)
      && typeof profile.conformanceIri === "string"
      && profile.conformanceIri.startsWith("https://"),
    "INVALID_VALIDATION_PROFILE",
    "profile kind and conformance IRI must be declared",
    { profileName },
  );
  return profile;
}

export function selectProfileBundle(release, profile, profileName = null) {
  if (profile?.kind === "diagnostic" && profile.bundle === undefined) return null;

  let bundle = profile?.bundle;
  if (bundle === undefined
    && release.manifest.schemaVersion === LEGACY_MANIFEST_SCHEMA) {
    if (profileName && Object.hasOwn(release.manifest.publishedBundles, profileName)) {
      bundle = profileName;
    } else if (profileName?.endsWith("-publication")) {
      const conformanceName = profileName.slice(0, -"-publication".length);
      if (Object.hasOwn(release.manifest.publishedBundles, conformanceName)) {
        bundle = conformanceName;
      }
    }
    if (bundle === undefined) {
      bundle = profile?.conformanceIri?.endsWith("/geo") ? "geo" : "core";
    }
  }

  assert(
    typeof bundle === "string"
      && bundle.length > 0
      && bundle !== "support"
      && Object.hasOwn(release.manifest.publishedBundles ?? {}, bundle),
    "INVALID_PROFILE_BUNDLE",
    "profile bundle must name a published bundle",
    {
      available: Object.keys(release.manifest.publishedBundles ?? {}).sort(),
      bundle: bundle ?? null,
      profileName,
    },
  );
  return {
    name: bundle,
    path: release.manifest.publishedBundles[bundle],
  };
}

export function selectPublicationCheckPlan(release, profileName) {
  const selectedProfile = selectValidationProfile(release, profileName);
  const policyProfileName = release.manifest.publicationPolicyProfile;
  if (policyProfileName === undefined) {
    assert(
      isPublicationProfile(selectedProfile),
      "INVALID_PUBLICATION_PROFILE",
      "legacy publish-check requires a warning-gated validation-policy profile",
      {
        gate: selectedProfile.gate,
        kind: selectedProfile.kind,
        profile: profileName,
      },
    );
    return {
      conformanceProfileName: null,
      mode: "legacy",
      publicationPolicyProfileName: profileName,
    };
  }

  const policyProfile = selectValidationProfile(release, policyProfileName);
  assert(
    isPublicationProfile(policyProfile),
    "INVALID_PROFILE_MANIFEST",
    "publicationPolicyProfile must identify a warning-gated validation-policy profile",
    { publicationPolicyProfile: policyProfileName },
  );
  assert(
    selectedProfile.kind === "conformance" && selectedProfile.gate === "violation",
    "INCOMPLETE_PUBLICATION_CHECK",
    "publish-check requires a violation-gated conformance module; the publication policy is added automatically",
    {
      gate: selectedProfile.gate,
      kind: selectedProfile.kind,
      profile: profileName,
      publicationPolicyProfile: policyProfileName,
    },
  );
  return {
    conformanceProfileName: profileName,
    mode: "composite",
    publicationPolicyProfileName: policyProfileName,
  };
}

export async function verifyArtifactLock(release) {
  const lockPath = resolveReleaseArtifact(release, release.manifest.lockFile);
  let lockBytes;
  try {
    lockBytes = await readFile(lockPath);
  } catch (error) {
    if (error.code === "ENOENT") error.code = "PROFILE_LOCK_NOT_FOUND";
    throw error;
  }
  const lock = parseJsonBytes(lockBytes, lockPath);
  assert(
    lock.schemaVersion === "molit.profile-artifact-lock/1"
      && lock.profileVersion === release.version
      && Array.isArray(lock.artifacts),
    "INVALID_ARTIFACT_LOCK",
    "artifact lock has an invalid identity or structure",
  );
  const artifactPaths = lock.artifacts.map((artifact) => artifact.path);
  const duplicates = artifactPaths.filter((item, index) => artifactPaths.indexOf(item) !== index);
  const expectedPaths = await listReleaseMachineArtifacts(release);
  const expected = new Set(expectedPaths);
  const locked = new Set(artifactPaths);
  const missing = expectedPaths.filter((item) => !locked.has(item));
  const extra = artifactPaths.filter((item) => !expected.has(item));
  assert(
    duplicates.length === 0 && missing.length === 0 && extra.length === 0,
    "INCOMPLETE_ARTIFACT_LOCK",
    "artifact lock must enumerate every machine-readable release artifact exactly once",
    { duplicates, extra, missing },
  );
  const results = [];
  const artifactBytes = new Map();
  for (const artifact of lock.artifacts) {
    assert(
      typeof artifact.sha256 === "string" && /^[0-9a-f]{64}$/u.test(artifact.sha256),
      "INVALID_ARTIFACT_LOCK",
      "artifact SHA-256 must be a lowercase hexadecimal digest",
      { path: artifact.path },
    );
    const artifactPath = resolveReleaseArtifact(release, artifact.path);
    const bytes = await readFile(artifactPath);
    artifactBytes.set(artifact.path, bytes);
    const actual = createHash("sha256").update(bytes).digest("hex");
    results.push({
      actualSha256: actual,
      expectedSha256: artifact.sha256,
      path: artifact.path,
      valid: actual === artifact.sha256,
    });
  }
  const invalid = results.filter((item) => !item.valid);
  assert(
    invalid.length === 0,
    "PROFILE_ARTIFACT_DIGEST_MISMATCH",
    "one or more locked profile artifacts have changed",
    { invalid },
  );
  const manifestBytes = artifactBytes.get("manifest.json");
  assert(
    manifestBytes !== undefined,
    "INCOMPLETE_ARTIFACT_SNAPSHOT",
    "validation snapshot is missing the profile manifest",
  );
  const manifest = parseJsonBytes(manifestBytes, release.manifestPath);
  assert(
    JSON.stringify(manifest) === JSON.stringify(release.manifest),
    "PROFILE_CHANGED_DURING_VALIDATION",
    "profile manifest changed while the artifact snapshot was created",
  );
  return { artifactBytes, lock, lockBytes, lockPath, manifest, results };
}

export async function listReleaseMachineArtifacts(release) {
  const found = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(release.releaseRoot, absolute).split(path.sep).join("/");
      assert(
        !entry.isSymbolicLink(),
        "PROFILE_RELEASE_SYMLINK_NOT_ALLOWED",
        "profile release inventory must not contain symbolic links or reparse-point entries",
        { path: relative },
      );
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const inventoryIncludesAllFiles = release.manifest.artifactInventoryPolicy
          === "all-release-files";
        if (relative !== release.manifest.lockFile
          && (inventoryIncludesAllFiles
            || releaseMachineExtensionSet.has(path.extname(relative).toLowerCase()))) {
          found.push(relative);
        }
      }
    }
  }
  await walk(release.releaseRoot);
  return found.sort();
}

export async function computeBundleDigest(release, profile, artifactBytes = null) {
  const bundle = selectProfileBundle(release, profile);
  const paths = [...new Set([
    "manifest.json",
    release.manifest.profileDescription,
    release.manifest.context,
    release.manifest.ontology,
    release.manifest.publicValuePolicy,
    ...Object.values(release.manifest.routingVocabularySources ?? {}),
    ...release.manifest.background,
    ...profile.shapes,
    ...(bundle === null ? [] : [
      bundle.path,
      release.manifest.publishedBundles.support,
    ]),
  ])].sort();
  const hash = createHash("sha256");
  for (const relativePath of paths) {
    let bytes;
    if (artifactBytes) {
      assert(
        artifactBytes.has(relativePath),
        "INCOMPLETE_ARTIFACT_SNAPSHOT",
        "validation snapshot is missing a profile artifact",
        { relativePath },
      );
      bytes = artifactBytes.get(relativePath);
    } else {
      bytes = await readFile(resolveReleaseArtifact(release, relativePath));
    }
    hash.update(relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(bytes);
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function publicProfileSummary(release) {
  return {
    geoProfileIri: release.manifest.geoProfileIri,
    namespaceStatus: release.manifest.namespaceStatus,
    profileId: release.manifest.profileId,
    profileIri: release.manifest.profileIri,
    publicationPolicyProfile: release.manifest.publicationPolicyProfile ?? null,
    profiles: Object.entries(release.manifest.profiles).map(([name, value]) => ({
      bundle: selectProfileBundle(release, value, name)?.name ?? null,
      conformanceIri: value.conformanceIri,
      description: value.description,
      gate: value.gate,
      kind: value.kind,
      name,
    })),
    status: release.manifest.status,
    version: release.version,
    versionIri: release.manifest.versionIri,
  };
}
