import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PROFILE_ROOT = path.join(PROJECT_ROOT, "profiles", "molit-dcat-ap", "releases");
const DEFAULT_VERSION = "0.1.0";
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

async function readJson(filePath, code) {
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") error.code = code;
    throw error;
  }
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

function validateManifest(manifest, version) {
  const limits = manifest.limits;
  const validInteger = (value, minimum, maximum) => (
    Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
  const validArtifactPath = (value) => (
    typeof value === "string"
      && value.length > 0
      && !path.isAbsolute(value)
      && !value.split(/[\\/]/u).includes("..")
  );
  const requiredProfiles = ["core", "core-publication", "geo", "geo-publication"];
  const profileEntries = Object.entries(manifest.profiles ?? {});
  assert(
    manifest.schemaVersion === "molit.application-profile-manifest/1"
      && manifest.profileId === "molit-dcat-ap"
      && manifest.version === version
      && manifest.profileIri === "https://data.molit.go.kr/profile/molit-dcat-ap"
      && manifest.geoProfileIri === "https://data.molit.go.kr/profile/molit-dcat-ap/geo"
      && manifest.versionIri === `${manifest.profileIri}/${version}`
      && ["candidate", "deprecated", "recommendation", "working-draft"].includes(manifest.status)
      && ["dereferenceable", "proposed-not-yet-dereferenceable"].includes(manifest.namespaceStatus)
      && Array.isArray(manifest.background)
      && manifest.background.every(validArtifactPath)
      && manifest.profiles && typeof manifest.profiles === "object"
      && requiredProfiles.every((name) => manifest.profiles[name])
      && profileEntries.every(([, profile]) => (
        Array.isArray(profile.shapes)
          && profile.shapes.length > 0
          && profile.shapes.every(validArtifactPath)
      ))
      && manifest.localImportMap && typeof manifest.localImportMap === "object"
      && Object.entries(manifest.localImportMap).every(([iri, artifact]) => (
        iri.startsWith("https://") && validArtifactPath(artifact)
      ))
      && [
        manifest.context,
        manifest.lockFile,
        manifest.ontology,
        manifest.profileDescription,
        manifest.publicValuePolicy,
        manifest.routingVocabularySources?.geosparql11,
        manifest.publishedBundles?.core,
        manifest.publishedBundles?.geo,
        manifest.publishedBundles?.support,
        manifest.shapeMetaValidation?.shaclShacl,
      ].every(validArtifactPath)
      && validInteger(limits?.maxInputBytes, 1, 5_242_880)
      && validInteger(limits?.maxInputQuads, 1, 100_000)
      && validInteger(limits?.maxValuesPerSubjectPredicate, 1, 1_000)
      && validInteger(limits?.maxValidationResults, 1, 500)
      && validInteger(limits?.maxLiteralLength, 1, 20_000),
    "INVALID_PROFILE_MANIFEST",
    "profile manifest identity, status, paths or limits are invalid",
    { version },
  );
}

export function projectRoot() {
  return PROJECT_ROOT;
}

export async function loadProfileRelease(version = DEFAULT_VERSION) {
  assert(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version),
    "INVALID_PROFILE_VERSION",
    "profile version must be a semantic version",
    { version },
  );
  const releaseRoot = path.resolve(PROFILE_ROOT, version);
  assert(
    releaseRoot.startsWith(`${path.resolve(PROFILE_ROOT)}${path.sep}`),
    "PROFILE_PATH_ESCAPE",
    "profile release path escaped the profile root",
  );
  const manifestPath = path.join(releaseRoot, "manifest.json");
  const manifest = await readJson(manifestPath, "PROFILE_RELEASE_NOT_FOUND");
  validateManifest(manifest, version);
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

export async function verifyArtifactLock(release) {
  const lockPath = resolveReleaseArtifact(release, release.manifest.lockFile);
  const lock = await readJson(lockPath, "PROFILE_LOCK_NOT_FOUND");
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
  return { artifactBytes, lock, lockPath, results };
}

export async function listReleaseMachineArtifacts(release) {
  const found = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(release.releaseRoot, absolute).split(path.sep).join("/");
        if (relative !== release.manifest.lockFile
          && releaseMachineExtensionSet.has(path.extname(relative).toLowerCase())) {
          found.push(relative);
        }
      }
    }
  }
  await walk(release.releaseRoot);
  return found.sort();
}

export async function computeBundleDigest(release, profile, artifactBytes = null) {
  const paths = [...new Set([
    "manifest.json",
    release.manifest.profileDescription,
    release.manifest.context,
    release.manifest.ontology,
    release.manifest.publicValuePolicy,
    ...Object.values(release.manifest.routingVocabularySources ?? {}),
    ...release.manifest.background,
    ...profile.shapes,
    ...(profile.kind === "diagnostic" ? [] : [
      profile.conformanceIri.endsWith("/geo")
        ? release.manifest.publishedBundles.geo
        : release.manifest.publishedBundles.core,
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
    profiles: Object.entries(release.manifest.profiles).map(([name, value]) => ({
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
