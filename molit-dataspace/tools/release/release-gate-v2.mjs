import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readCheckedFile } from "../registries/safe-local-file.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const decoder = new TextDecoder("utf-8", { fatal: true });
const execFileAsync = promisify(execFile);
const requiredRcAcceptancePolicy = new Map([
  ...[
    "RA-MODULES",
    "RA-REQUIREMENTS",
    "RA-ONTOLOGY",
    "RA-GRAPH-INTEGRITY",
    "RA-DATASET-KEY",
    "RA-ONTOLOGY-MERGE",
    "RA-CRS",
    "RA-DOMAIN-MODULES",
    "RA-NETWORK-SOURCE-SAMPLE",
    "RA-RUNTIME",
    "RA-LOCK",
    "RA-INTEGRITY",
    "RA-GIT",
    "RA-VOCABULARY-REGISTRY",
    "RA-SEMANTIC-DIFF",
    "RA-PUBLICATION-REPRESENTATIONS",
    "RA-MULTI-ENGINE-MATRIX",
    "RA-SERIALIZATION-PARITY",
  ].map((id) => [id, {
    blocksCandidate: false,
    blocksRecommendation: false,
    scope: "profile-core",
    status: "fixed",
  }]),
  ...[
    "RA-INSTITUTIONAL-SIGNATURE",
    "RA-SOURCE-RIGHTS",
    "RA-NAMESPACE",
    "RA-LICENSE",
    "RA-GOVERNANCE",
    "RA-DOMESTIC-CLAUSES",
    "RA-DOMESTIC-REGISTRIES",
  ].map((id) => [id, {
    blocksCandidate: false,
    blocksRecommendation: true,
    scope: "institutional",
    status: "blocked-external-evidence",
  }]),
  ["RA-ONEWINDOW", {
    blocksCandidate: false,
    blocksRecommendation: false,
    scope: "interoperability-pack",
    status: "deferred-nonblocking",
  }],
]);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function failure(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function errorCode(error, fallback) {
  return typeof error?.code === "string" ? error.code : fallback;
}

function portablePath(value, label) {
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\\")
    || value.includes("\0")
    || path.posix.isAbsolute(value)) {
    throw failure("INVALID_RELEASE_GATE_INPUT", `${label} must be a portable relative path`);
  }
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")
    || path.posix.normalize(value) !== value) {
    throw failure("INVALID_RELEASE_GATE_INPUT", `${label} is not normalized`);
  }
  return value;
}

function portableRootPath(absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (cause) {
    throw failure(
      "INVALID_RELEASE_GATE_INPUT",
      `${label} is not strict UTF-8 JSON`,
      { causeCode: cause?.code ?? null },
    );
  }
}

let v2ValidatorsPromise;
async function v2Validators() {
  if (!v2ValidatorsPromise) {
    v2ValidatorsPromise = (async () => {
      const [{ default: Ajv2020 }, { default: addFormats }] = await Promise.all([
        import("ajv/dist/2020.js"),
        import("ajv-formats"),
      ]);
      const [acceptanceBytes, reportBytes] = await Promise.all([
        readCheckedFile(
          root,
          path.join(root, "contracts", "profile-release-acceptance.v1.schema.json"),
          1024 * 1024,
        ),
        readCheckedFile(
          root,
          path.join(root, "contracts", "release-gate-status.v2.schema.json"),
          1024 * 1024,
        ),
      ]);
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      return {
        acceptance: ajv.compile(parseJson(acceptanceBytes, "release acceptance schema")),
        report: ajv.compile(parseJson(reportBytes, "release gate v2 schema")),
      };
    })();
  }
  return v2ValidatorsPromise;
}

function validatorErrors(validator) {
  return validator.errors?.map(({ instancePath, keyword, message, schemaPath }) => ({
    instancePath,
    keyword,
    message,
    schemaPath,
  })) ?? [];
}

export async function assertReleaseAcceptanceRegister(register, profileVersion) {
  const { acceptance } = await v2Validators();
  const ids = Array.isArray(register?.items)
    ? register.items.map((item) => item?.id)
    : [];
  const itemById = new Map(Array.isArray(register?.items)
    ? register.items.map((item) => [item?.id, item])
    : []);
  const missingRequiredItems = [...requiredRcAcceptancePolicy.keys()]
    .filter((id) => !itemById.has(id));
  const policyMismatches = [...requiredRcAcceptancePolicy]
    .filter(([id, expected]) => {
      const item = itemById.get(id);
      return item && Object.entries(expected).some(([field, value]) => item[field] !== value);
    })
    .map(([id]) => id);
  const structural = acceptance(register)
    && register.profileVersion === profileVersion
    && new Set(ids).size === ids.length
    && missingRequiredItems.length === 0
    && policyMismatches.length === 0;
  if (!structural) {
    throw failure(
      "INVALID_RELEASE_ACCEPTANCE_REGISTER",
      "release acceptance register identity or structure is invalid",
      {
        errors: validatorErrors(acceptance),
        missingRequiredItems,
        policyMismatches,
        profileVersion,
      },
    );
  }

  for (const item of register.items) {
    const unresolved = item.status === "open"
      || item.status === "blocked-external-evidence";
    const resolved = item.status === "fixed" || item.status === "deferred-nonblocking";
    const invalid = item.blocksCandidate && !item.blocksRecommendation
      || (item.status === "deferred-nonblocking" && item.scope !== "interoperability-pack")
      || (resolved && (item.blocksCandidate || item.blocksRecommendation))
      || (item.scope === "interoperability-pack"
        && (item.blocksCandidate || item.blocksRecommendation))
      || (item.scope === "institutional"
        && (item.blocksCandidate || (unresolved && !item.blocksRecommendation)))
      || (item.scope === "profile-core"
        && unresolved
        && (!item.blocksCandidate || !item.blocksRecommendation));
    if (invalid) {
      throw failure(
        "INVALID_RELEASE_ACCEPTANCE_REGISTER",
        "release acceptance scope, status and blocking flags are inconsistent",
        { id: item.id },
      );
    }
  }
  return register;
}

function scopeDefaultBlocking(scope) {
  return {
    blocksCandidate: scope === "profile-core",
    blocksRecommendation: scope !== "interoperability-pack",
  };
}

export function calculateReleaseEligibility(register, {
  extraBlockers = [],
  fixedEvidenceFailures = [],
  statusOverrides = {},
} = {}) {
  const evidenceFailures = new Set(fixedEvidenceFailures);
  const blockers = [];
  for (const item of register.items) {
    const override = statusOverrides[item.id];
    let status = override ?? item.status;
    if (evidenceFailures.has(item.id)) status = "evidence-invalid";
    if (status === "fixed" || status === "deferred-nonblocking") continue;

    let blocksCandidate = item.blocksCandidate;
    let blocksRecommendation = item.blocksRecommendation;
    if (status === "evidence-invalid"
      || (override !== undefined
        && (item.status === "fixed" || item.status === "deferred-nonblocking"))) {
      ({ blocksCandidate, blocksRecommendation } = scopeDefaultBlocking(item.scope));
    }
    if (!blocksCandidate && !blocksRecommendation) continue;
    blockers.push({
      id: item.id,
      scope: item.scope,
      source: "release-acceptance-register",
      status,
      severity: item.severity,
      blocksCandidate,
      blocksRecommendation,
    });
  }
  blockers.push(...extraBlockers);
  blockers.sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ));
  return {
    blockers,
    candidateEligible: !blockers.some((item) => item.blocksCandidate),
    recommendationEligible: !blockers.some((item) => item.blocksRecommendation),
  };
}

async function gitCheck(releaseRoot) {
  try {
    const releasePath = portableRootPath(releaseRoot);
    const [
      { stdout: headOutput },
      { stdout: statusOutput },
      { stdout: ignoredReleaseOutput },
    ] = await Promise.all([
      execFileAsync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
        windowsHide: true,
      }),
      execFileAsync("git", [
        "-C",
        root,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--",
        ".",
      ], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 10_000,
        windowsHide: true,
      }),
      execFileAsync("git", [
        "-C",
        root,
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--",
        releasePath,
      ], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 10_000,
        windowsHide: true,
      }),
    ]);
    const head = headOutput.trim();
    const dirtyPathCount = statusOutput.split(/\r?\n/u).filter(Boolean).length
      + ignoredReleaseOutput.split(/\r?\n/u).filter(Boolean).length;
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(head)) {
      throw failure("INVALID_GIT_HEAD", "Git HEAD is not a recognized object ID");
    }
    return {
      dirtyPathCount,
      errorCode: dirtyPathCount === 0 ? null : "DIRTY_RELEASE_WORKTREE",
      head,
      status: dirtyPathCount === 0 ? "passed" : "failed",
    };
  } catch (error) {
    return {
      dirtyPathCount: 0,
      errorCode: errorCode(error, "GIT_CHECK_FAILED"),
      head: null,
      status: "failed",
    };
  }
}

async function traceabilityCheck(releaseRoot) {
  try {
    const { verifyRequirementTraceability } = await import(
      "../profile/verify-requirement-traceability.mjs"
    );
    const report = await verifyRequirementTraceability({ releaseRoot });
    return {
      coverageBlockerCount: report.coverageBlockers.length,
      digest: digest(Buffer.from(JSON.stringify(report), "utf8")),
      errorCode: report.gatePassed ? null : "REQUIREMENT_TRACEABILITY_BLOCKED",
      errorCount: report.summary.errors,
      status: report.gatePassed ? "passed" : "failed",
    };
  } catch (error) {
    return {
      coverageBlockerCount: 0,
      digest: digest(Buffer.from(String(error?.code ?? error?.message ?? "error"), "utf8")),
      errorCode: errorCode(error, "REQUIREMENT_TRACEABILITY_FAILED"),
      errorCount: 1,
      status: "failed",
    };
  }
}

async function artifactLockCheck(release) {
  try {
    const { verifyArtifactLock } = await import("../../src/profile/registry.mjs");
    const verification = await verifyArtifactLock(release);
    return {
      check: {
        artifactCount: verification.results.length,
        errorCode: null,
        status: "passed",
      },
      verification,
    };
  } catch (error) {
    return {
      check: {
        artifactCount: 0,
        errorCode: errorCode(error, "ARTIFACT_LOCK_CHECK_FAILED"),
        status: "failed",
      },
      verification: null,
    };
  }
}

const allowedEvidenceCommands = new Map([
  [
    "node --test tests/contract/crs-geometry-transformation.test.mjs",
    [process.execPath, ["--test", "tests/contract/crs-geometry-transformation.test.mjs"]],
  ],
  [
    "node --test tests/unit/isolated-validator.test.mjs",
    [process.execPath, ["--test", "tests/unit/isolated-validator.test.mjs"]],
  ],
  [
    "node --test tests/contract/detached-release-signature.test.mjs",
    [process.execPath, ["--test", "tests/contract/detached-release-signature.test.mjs"]],
  ],
  [
    "npm run profile:ontology:verify",
    [process.execPath, ["tools/profile/verify-ontology-semantics.mjs"]],
  ],
  [
    "npm run profile:vocabulary:verify",
    [process.execPath, [
      "tools/profile/build-vocabulary-registry.mjs",
      "--version",
      "1.0.0-rc.1",
      "--check",
    ]],
  ],
  [
    "npm run profile:semantic-diff:verify",
    [process.execPath, [
      "tools/profile/build-semantic-diff.mjs",
      "--from",
      "0.1.0",
      "--to",
      "1.0.0-rc.1",
      "--check",
    ]],
  ],
  [
    "npm run profile:publication:verify",
    [process.execPath, [
      "tools/profile/build-publication-representations.mjs",
      "--version",
      "1.0.0-rc.1",
      "--check",
    ]],
  ],
  [
    "npm run profile:rc:serialization-parity",
    [process.execPath, ["tools/profile/run-rc-serialization-parity.mjs", "candidate"]],
  ],
]);

async function runEvidenceCommand(command) {
  const definition = allowedEvidenceCommands.get(command);
  if (!definition) return false;
  try {
    await execFileAsync(definition[0], definition[1], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function validateRcMatrixEvidence(bytes, runtime) {
  try {
    const report = parseJson(bytes, "RC SHACL matrix evidence");
    const [
      { deriveFullMatrixDefinitions },
      { loadProfileRelease, resolveReleaseArtifact },
      nodeBytes,
      pythonBytes,
      toolchainBytes,
    ] = await Promise.all([
      import("../profile/run-rc-shacl-matrix.mjs"),
      import("../../src/profile/registry.mjs"),
      readCheckedFile(
        root,
        path.join(root, "tools", "profile", "run-rc-shacl-matrix.mjs"),
        2 * 1024 * 1024,
      ),
      readCheckedFile(
        root,
        path.join(root, "tools", "profile", "rc_shacl_matrix.py"),
        2 * 1024 * 1024,
      ),
      readCheckedFile(
        root,
        path.join(root, "standards", "toolchains", "jena-parser-lane.win32-x64.json"),
        2 * 1024 * 1024,
      ),
    ]);
    const release = await loadProfileRelease("1.0.0-rc.1");
    const registryPath = resolveReleaseArtifact(
      release,
      release.manifest.requirementsRegistry,
    );
    const caseRegistryPath = resolveReleaseArtifact(
      release,
      release.manifest.conformanceCases,
    );
    const [registryBytes, caseRegistryBytes] = await Promise.all([
      readCheckedFile(release.releaseRoot, registryPath, 16 * 1024 * 1024),
      readCheckedFile(release.releaseRoot, caseRegistryPath, 16 * 1024 * 1024),
    ]);
    const registry = parseJson(registryBytes, "requirement registry");
    const caseRegistry = parseJson(caseRegistryBytes, "conformance case registry");
    const definitions = deriveFullMatrixDefinitions(release, registry, caseRegistry);
    const cases = Array.isArray(report.cases) ? report.cases : [];
    const caseByFixtureId = new Map(cases.map((item) => [item?.fixtureId, item]));
    const artifactDigestCache = new Map();
    const artifactDigest = async (relative) => {
      if (!artifactDigestCache.has(relative)) {
        artifactDigestCache.set(relative, readCheckedFile(
          release.releaseRoot,
          resolveReleaseArtifact(release, relative),
          32 * 1024 * 1024,
        ).then(digest));
      }
      return artifactDigestCache.get(relative);
    };
    const decisionsMatch = cases.length > 0 && cases.every((item) => {
      const expected = item?.decision === "conforms";
      const engines = item?.engines && Object.values(item.engines);
      return (item?.decision === "conforms" || item?.decision === "violates")
        && Array.isArray(engines)
        && engines.length === 3
        && JSON.stringify(Object.keys(item.engines).sort())
          === JSON.stringify(["jena", "node", "pyshacl"])
        && engines.every((engine) => engine?.conforms === expected);
    });
    const engineIdentityMatches = JSON.stringify(report.engines) === JSON.stringify({
      jena: { name: "Apache Jena SHACL", version: "6.1.0" },
      node: { name: "rdf-validate-shacl", version: "0.6.5" },
      python: {
        name: "pySHACL",
        versions: { pyshacl: "0.40.0", rdflib: "7.6.0" },
      },
    });
    const offlinePolicyMatches = JSON.stringify(report.offlinePolicy) === JSON.stringify({
      inheritedClasspath: false,
      inheritedJavaOptions: false,
      javaRuntimeArguments: [
        "-Dfile.encoding=UTF-8",
        "-Djava.awt.headless=true",
        "-Djava.net.useSystemProxies=false",
      ],
      python: "isolated mode plus audit-hook denial of socket and process spawn",
      shapeImports: "localImportMap artifacts materialized into the temporary shape graph; owl:imports removed before every engine executes",
    });
    const definitionsMatch = cases.length === definitions.length
      && caseByFixtureId.size === definitions.length
      && (await Promise.all(definitions.map(async (definition) => {
        const item = caseByFixtureId.get(definition.fixtureId);
        const bundleRelative = release.manifest.publishedBundles[definition.profile];
        if (!item || typeof bundleRelative !== "string") return false;
        const [inputSha256, bundleSha256] = await Promise.all([
          artifactDigest(definition.input),
          artifactDigest(bundleRelative),
        ]);
        return item.id === definition.id
          && item.input === definition.input
          && item.profile === definition.profile
          && item.decision === (definition.expectedConforms ? "conforms" : "violates")
          && item.inputSha256 === definition.expectedSha256
          && item.inputSha256 === inputSha256
          && item.bundleSha256 === bundleSha256
          && /^[0-9a-f]{64}$/u.test(item.materializedBundleSha256 ?? "")
          && Array.isArray(item.localImports)
          && JSON.stringify(item.requirementIds) === JSON.stringify(definition.requirementIds);
      }))).every(Boolean);
    return report.schemaVersion === "molit.rc-shacl-engine-matrix/1"
      && report.profileVersion === "1.0.0-rc.1"
      && report.mode === "full"
      && report.gatePassed === true
      && report.releaseEvidenceEligible === true
      && report.artifactLock?.status === "verified"
      && report.artifactLock?.sha256 === runtime.artifactLockSha256
      && report.requirementCoverage?.caseRegistrySha256 === digest(caseRegistryBytes)
      && report.requirementCoverage?.requirementRegistrySha256 === digest(registryBytes)
      && report.requirementCoverage?.deduplicatedFixtures === definitions.length
      && report.requirementCoverage?.requirements === registry.requirements.length
      && report.implementation?.nodeSha256 === digest(nodeBytes)
      && report.implementation?.pythonSha256 === digest(pythonBytes)
      && report.toolchainManifestSha256 === digest(toolchainBytes)
      && decisionsMatch
      && engineIdentityMatches
      && offlinePolicyMatches
      && definitionsMatch;
  } catch {
    return false;
  }
}

async function fixedEvidenceCheck(register, runtime, inputEvidence) {
  const invalidItems = [];
  let itemCount = 0;
  for (const item of register.items.filter(({ status }) => status === "fixed")) {
    itemCount += 1;
    if (item.id === "RA-LOCK") {
      if (runtime.artifactLock.status !== "passed") invalidItems.push(item.id);
      continue;
    }
    if (item.id === "RA-GIT") {
      if (runtime.git.status !== "passed") invalidItems.push(item.id);
      continue;
    }
    if (item.id === "RA-REQUIREMENTS") {
      if (runtime.requirementTraceability.status !== "passed") invalidItems.push(item.id);
      continue;
    }
    let supported = 0;
    let valid = true;
    for (const evidence of item.evidence) {
      if (evidence.kind === "repository-file") {
        supported += 1;
        try {
          const relative = portablePath(evidence.value, "repository evidence path");
          const bytes = await readCheckedFile(
            root,
            path.resolve(root, ...relative.split("/")),
            32 * 1024 * 1024,
          );
          if (bytes.length === 0) valid = false;
          else {
            inputEvidence[relative] = digest(bytes);
            if (item.id === "RA-MULTI-ENGINE-MATRIX"
              && relative === "evidence/validators/molit-rc-shacl-matrix.v1.json"
              && !await validateRcMatrixEvidence(bytes, runtime)) valid = false;
          }
        } catch {
          valid = false;
        }
      } else if (evidence.kind === "command") {
        supported += 1;
        if (!await runEvidenceCommand(evidence.value)) valid = false;
      } else {
        valid = false;
      }
    }
    if (item.id === "RA-SERIALIZATION-PARITY"
      && !await runEvidenceCommand("npm run profile:rc:serialization-parity")) valid = false;
    if (supported === 0 || !valid) invalidItems.push(item.id);
  }
  return {
    invalidItems,
    check: {
      errorCode: invalidItems.length === 0 ? null : "FIXED_EVIDENCE_INVALID",
      invalidItemCount: invalidItems.length,
      itemCount,
      status: invalidItems.length === 0 ? "passed" : "failed",
    },
  };
}

async function assertV2Report(report) {
  const { report: validate } = await v2Validators();
  if (validate(report)) return report;
  throw failure(
    "INVALID_RELEASE_GATE_REPORT",
    "generated release gate v2 report violates its machine schema",
    { errors: validatorErrors(validate) },
  );
}

function withDecisionDigest(report) {
  return {
    ...report,
    decisionDigest: `sha256:${digest(Buffer.from(JSON.stringify(report), "utf8"))}`,
  };
}

export async function evaluateReleaseGateV2(version) {
  const { loadProfileRelease, resolveReleaseArtifact } = await import(
    "../../src/profile/registry.mjs"
  );
  const release = await loadProfileRelease(version);
  if (release.manifest.schemaVersion !== "molit.application-profile-manifest/2") {
    throw failure(
      "INVALID_RELEASE_GATE_INPUT",
      "release gate v2 requires an application-profile manifest v2 release",
    );
  }
  const registerRelative = portablePath(
    release.manifest.releaseAcceptanceRegister,
    "releaseAcceptanceRegister",
  );
  const registerPath = resolveReleaseArtifact(release, registerRelative);
  const registerBytes = await readCheckedFile(
    release.releaseRoot,
    registerPath,
    2 * 1024 * 1024,
  );
  const register = parseJson(registerBytes, "release acceptance register");
  await assertReleaseAcceptanceRegister(register, release.version);

  const inputEvidence = {
    [portableRootPath(registerPath)]: digest(registerBytes),
  };
  const [lock, git, requirementTraceability] = await Promise.all([
    artifactLockCheck(release),
    gitCheck(release.releaseRoot),
    traceabilityCheck(release.releaseRoot),
  ]);
  if (lock.verification) {
    inputEvidence[portableRootPath(release.manifestPath)] = digest(
      lock.verification.artifactBytes.get("manifest.json"),
    );
    const lockBytes = await readCheckedFile(
      release.releaseRoot,
      lock.verification.lockPath,
      32 * 1024 * 1024,
    );
    inputEvidence[portableRootPath(lock.verification.lockPath)] = digest(lockBytes);
  }
  const fixedEvidence = await fixedEvidenceCheck(
    register,
    {
      artifactLock: lock.check,
      artifactLockSha256: lock.verification ? digest(lock.verification.lockBytes) : null,
      git,
      requirementTraceability,
    },
    inputEvidence,
  );
  const statusOverrides = {
    "RA-GIT": git.status === "passed" ? "fixed" : "open",
    "RA-REQUIREMENTS": requirementTraceability.status === "passed" ? "fixed" : "open",
  };
  const hasRegisterLockItem = register.items.some(({ id }) => id === "RA-LOCK");
  if (hasRegisterLockItem) {
    statusOverrides["RA-LOCK"] = lock.check.status === "passed" ? "fixed" : "open";
  }
  const extraBlockers = lock.check.status === "passed" || hasRegisterLockItem ? [] : [{
    id: "RA-LOCK",
    scope: "profile-core",
    source: "artifact-lock",
    status: "check-failed",
    severity: "P0",
    blocksCandidate: true,
    blocksRecommendation: true,
  }];
  const eligibility = calculateReleaseEligibility(register, {
    extraBlockers,
    fixedEvidenceFailures: fixedEvidence.invalidItems,
    statusOverrides,
  });
  const report = withDecisionDigest({
    schemaVersion: "molit.release-gate-status/2",
    profileVersion: release.version,
    targetLane: "win32-x64",
    candidateEligible: eligibility.candidateEligible,
    recommendationEligible: eligibility.recommendationEligible,
    candidateDecision: eligibility.candidateEligible ? "eligible" : "blocked",
    recommendationDecision: eligibility.recommendationEligible ? "eligible" : "blocked",
    blockers: eligibility.blockers,
    checks: {
      acceptanceRegister: {
        errorCode: null,
        itemCount: register.items.length,
        path: registerRelative,
        sha256: digest(registerBytes),
        status: "passed",
      },
      artifactLock: lock.check,
      fixedEvidence: fixedEvidence.check,
      git,
      requirementTraceability,
    },
    inputEvidence: Object.fromEntries(Object.entries(inputEvidence).sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    ))),
  });
  return assertV2Report(report);
}

export function invalidV2Report(version, error) {
  const profileVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version ?? "")
    ? version
    : "0.0.0-invalid-input";
  return withDecisionDigest({
    schemaVersion: "molit.release-gate-status/2",
    profileVersion,
    targetLane: "win32-x64",
    candidateEligible: false,
    recommendationEligible: false,
    candidateDecision: "indeterminate",
    recommendationDecision: "indeterminate",
    blockers: [{
      id: "RELEASE-GATE-INPUT",
      scope: "profile-core",
      source: "release-gate",
      status: "invalid-input",
      blocksCandidate: true,
      blocksRecommendation: true,
    }],
    checks: {
      acceptanceRegister: { status: "not-run" },
      artifactLock: { status: "not-run" },
      fixedEvidence: { status: "not-run" },
      git: { status: "not-run" },
      requirementTraceability: { status: "not-run" },
    },
    inputEvidence: {},
    reason: String(error?.message ?? "invalid release gate input").slice(0, 1000),
  });
}

export function releaseGateV2ExitCode(report) {
  return report.recommendationEligible ? 0 : 2;
}
