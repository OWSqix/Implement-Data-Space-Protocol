import { createHash } from "node:crypto";
import { DataFactory } from "n3";

const { literal, namedNode } = DataFactory;
const REQUIREMENT_ID = namedNode(
  "https://data.molit.go.kr/def/molit-dcat-ap#requirementId",
);

function assert(condition, message, code = "RC_REQUIREMENT_PROFILE_COVERAGE_GAP") {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function executableRequirementProfiles(release, requirement) {
  assert(
    Array.isArray(requirement?.conformanceClass),
    `requirement has no conformance classes: ${requirement?.requirementId ?? "unknown"}`,
  );
  for (const profileName of requirement.conformanceClass) {
    assert(
      release.manifest.profiles?.[profileName],
      `requirement declares an unknown conformance class: ${requirement.requirementId}/${profileName}`,
    );
  }
  return [...new Set(requirement.conformanceClass.filter((profileName) => {
    const profile = release.manifest.profiles?.[profileName];
    return profile && profile.kind !== "diagnostic";
  }))].sort();
}

export function declaredFixtureProfiles(release, fixture, requirements) {
  assert(Array.isArray(fixture?.conformanceClass), `fixture has no conformance classes: ${fixture?.fixtureId ?? "unknown"}`);
  for (const profileName of fixture.conformanceClass) {
    assert(
      release.manifest.profiles?.[profileName],
      `fixture declares an unknown conformance class: ${fixture.fixtureId}/${profileName}`,
    );
  }
  const declared = [...new Set(fixture.conformanceClass.filter((profileName) => {
    const profile = release.manifest.profiles?.[profileName];
    return profile && profile.kind !== "diagnostic";
  }))].sort();
  assert(declared.length > 0, `fixture has no executable conformance class: ${fixture.fixtureId}`);
  return declared.map((profile) => {
    const requirementIds = requirements
      .filter((requirement) => executableRequirementProfiles(release, requirement).includes(profile))
      .map((requirement) => requirement.requirementId)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort();
    assert(
      requirementIds.length > 0,
      `fixture profile has no linked requirement: ${fixture.fixtureId}/${profile}`,
    );
    return { profile, requirementIds };
  });
}

export function runtimeRequirementCoverage(release, registry, definitions) {
  const requirements = registry.requirements.filter((requirement) => (
    executableRequirementProfiles(release, requirement).length > 0
  ));
  const positive = new Set();
  const negative = new Set();
  const executedPairs = new Set();
  const requirementById = new Map(requirements.map((requirement) => [
    requirement.requirementId,
    requirement,
  ]));
  for (const definition of definitions) {
    assert(
      Array.isArray(definition.requirementIds) && definition.requirementIds.length > 0,
      `runtime definition has no requirement links: ${definition.id ?? definition.fixtureId}`,
    );
    assert(
      typeof definition.expectedConforms === "boolean",
      `runtime definition has no expected decision: ${definition.id ?? definition.fixtureId}`,
    );
    for (const requirementId of definition.requirementIds) {
      const requirement = requirementById.get(requirementId);
      assert(
        requirement,
        `runtime definition links an unknown or diagnostic requirement: ${definition.profile}/${requirementId}`,
      );
      assert(
        executableRequirementProfiles(release, requirement).includes(definition.profile),
        `runtime definition executes a requirement outside its applicable profile: ${definition.profile}/${requirementId}`,
      );
      executedPairs.add(`${definition.profile}\0${requirementId}`);
      (definition.expectedConforms ? positive : negative).add(requirementId);
    }
  }
  for (const requirement of requirements) {
    assert(positive.has(requirement.requirementId), `requirement has no positive runtime fixture: ${requirement.requirementId}`);
    assert(negative.has(requirement.requirementId), `requirement has no negative runtime fixture: ${requirement.requirementId}`);
  }
  return {
    executableRequirements: requirements.length,
    fixtureProfileExecutions: definitions.length,
    negativeRequirements: negative.size,
    positiveRequirements: positive.size,
    requirementProfileExecutions: executedPairs.size,
    uniqueFixtures: new Set(definitions.map(({ fixtureId }) => fixtureId)).size,
  };
}

function markerBelongsToShape(store, shape, markerSubjects) {
  const markers = new Set(markerSubjects.map((term) => term.id));
  const visited = new Set([shape.id]);
  const pending = [shape];
  while (pending.length > 0) {
    const subject = pending.shift();
    if (markers.has(subject.id)) return true;
    for (const object of store.getObjects(subject, null, null)) {
      if (!["BlankNode", "NamedNode"].includes(object.termType) || visited.has(object.id)) {
        continue;
      }
      visited.add(object.id);
      pending.push(object);
    }
  }
  return false;
}

export function materializedRequirementProfileCoverage({
  release,
  registry,
  materializedProfiles,
  sourceShapeDigests,
}) {
  const pairs = [];
  const bundleDigests = new Map();
  const bundleSourceHeaders = new Map();
  for (const requirement of registry.requirements) {
    for (const profileName of executableRequirementProfiles(release, requirement)) {
      const profile = release.manifest.profiles[profileName];
      const materialized = materializedProfiles.get(profileName);
      assert(materialized, `materialized profile bundle is missing: ${profileName}`);
      if (!bundleDigests.has(profileName)) {
        bundleDigests.set(profileName, sha256(materialized.bundleBytes));
        bundleSourceHeaders.set(profileName, new Set(
          Buffer.from(materialized.bundleBytes).toString("utf8")
            .split(/\r?\n/u)
            .filter((line) => line.startsWith("# Source: "))
            .map((line) => line.slice("# Source: ".length)),
        ));
      }
      assert(
        profile.shapes.includes(requirement.shapeFile),
        `applicable profile omits requirement source shape: ${profileName}/${requirement.requirementId}`,
      );
      assert(
        bundleSourceHeaders.get(profileName).has(requirement.shapeFile),
        `materialized bundle omits locked source declaration: ${profileName}/${requirement.shapeFile}`,
      );
      const sourceShapeSha256 = sourceShapeDigests.get(requirement.shapeFile);
      assert(
        typeof sourceShapeSha256 === "string" && /^[0-9a-f]{64}$/u.test(sourceShapeSha256),
        `requirement source shape digest is missing: ${requirement.shapeFile}`,
      );
      const shape = namedNode(requirement.shapeId);
      const markerSubjects = materialized.shapeStore.getSubjects(
        REQUIREMENT_ID,
        literal(requirement.requirementId),
        null,
      );
      assert(
        markerSubjects.length > 0 && markerBelongsToShape(
          materialized.shapeStore,
          shape,
          markerSubjects,
        ),
        `materialized bundle omits requirement marker from its shape: ${profileName}/${requirement.requirementId}`,
      );
      assert(
        materialized.shapeStore.countQuads(shape, null, null, null) > 0,
        `materialized bundle omits requirement shape: ${profileName}/${requirement.requirementId}`,
      );
      pairs.push({
        bundle: materialized.bundleRelative,
        bundleSha256: bundleDigests.get(profileName),
        profile: profileName,
        requirementId: requirement.requirementId,
        shapeFile: requirement.shapeFile,
        shapeFileSha256: sourceShapeSha256,
        shapeId: requirement.shapeId,
      });
    }
  }
  pairs.sort((left, right) => (
    left.profile.localeCompare(right.profile)
      || left.requirementId.localeCompare(right.requirementId)
  ));
  const perProfile = {};
  for (const profileName of [...new Set(pairs.map(({ profile }) => profile))].sort()) {
    const selected = pairs.filter(({ profile }) => profile === profileName);
    perProfile[profileName] = {
      applicableRequirements: selected.length,
      bundle: selected[0].bundle,
      bundleSha256: selected[0].bundleSha256,
    };
  }
  return {
    applicableRequirementProfilePairs: pairs.length,
    pairs,
    pairsSha256: sha256(Buffer.from(JSON.stringify(pairs), "utf8")),
    perProfile,
    sourceShapeFiles: new Set(pairs.map(({ shapeFile }) => shapeFile)).size,
  };
}
