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
const requiredRcEvidenceCommands = new Map([
  ["RA-REQUIREMENTS", [
    "npm run profile:requirements:verify",
    "npm run profile:requirements:upstream:verify",
    "npm run profile:requirements:upstream:engines",
  ]],
  ["RA-ONTOLOGY", [
    "npm run profile:ontology:verify",
    "npm run profile:ontology:governance:verify",
  ]],
  ["RA-ONTOLOGY-MERGE", [
    "node --test tests/profile/ontology-dataset-boundary.test.mjs",
  ]],
  ["RA-CRS", [
    "node --test tests/contract/crs-geometry-transformation.test.mjs",
    "node --test tests/contract/rc-geo-preflight-boundary.test.mjs",
  ]],
  ["RA-DOMAIN-MODULES", [
    "npm run profile:network:verify",
    "node --test tests/profile/quality-result-kind.test.mjs",
  ]],
  ["RA-RUNTIME", [
    "node --test tests/unit/isolated-validator.test.mjs",
  ]],
  ["RA-INTEGRITY", [
    "node --test tests/contract/detached-release-signature.test.mjs",
  ]],
  ["RA-GIT", [
    "npm run release:eol:verify",
  ]],
  ["RA-VOCABULARY-REGISTRY", [
    "npm run profile:vocabulary:verify",
  ]],
  ["RA-SEMANTIC-DIFF", [
    "npm run profile:semantic-diff:verify",
  ]],
  ["RA-PUBLICATION-REPRESENTATIONS", [
    "npm run profile:publication:verify",
  ]],
  ["RA-MULTI-ENGINE-MATRIX", [
    "npm run profile:rc:shacl-matrix:verify",
  ]],
  ["RA-SERIALIZATION-PARITY", [
    "npm run profile:rc:serialization-parity:verify",
  ]],
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
  const evidenceCommandMismatches = [...requiredRcEvidenceCommands]
    .flatMap(([id, expectedCommands]) => {
      const item = itemById.get(id);
      if (!item) return [];
      const actualCommands = new Set((Array.isArray(item.evidence) ? item.evidence : [])
        .filter((evidence) => evidence?.kind === "command")
        .map((evidence) => evidence.value));
      const missingCommands = expectedCommands.filter((command) => !actualCommands.has(command));
      return missingCommands.length === 0 ? [] : [{ id, missingCommands }];
    });
  const duplicateEvidenceItems = (Array.isArray(register?.items) ? register.items : [])
    .flatMap((item) => {
      if (!Array.isArray(item?.evidence)) return [];
      const seen = new Set();
      const duplicates = [];
      for (const evidence of item.evidence) {
        const key = JSON.stringify([evidence?.kind, evidence?.value]);
        if (seen.has(key)) duplicates.push({
          kind: evidence?.kind ?? null,
          value: evidence?.value ?? null,
        });
        else seen.add(key);
      }
      return duplicates.length === 0 ? [] : [{ id: item.id ?? null, duplicates }];
    });
  const structural = acceptance(register)
    && register.profileVersion === profileVersion
    && new Set(ids).size === ids.length
    && missingRequiredItems.length === 0
    && policyMismatches.length === 0
    && evidenceCommandMismatches.length === 0
    && duplicateEvidenceItems.length === 0;
  if (!structural) {
    throw failure(
      "INVALID_RELEASE_ACCEPTANCE_REGISTER",
      "release acceptance register identity or structure is invalid",
      {
        errors: validatorErrors(acceptance),
        duplicateEvidenceItems,
        evidenceCommandMismatches,
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

export async function gitCheck(releaseRoot, { execute = execFileAsync } = {}) {
  try {
    const releasePath = portableRootPath(releaseRoot);
    const { stdout: prefixOutput } = await execute("git", [
      "-C",
      root,
      "rev-parse",
      "--show-prefix",
    ], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
      windowsHide: true,
    });
    const gitPrefix = prefixOutput.replace(/\r?\n$/u, "");
    if (gitPrefix.includes("\\")
      || gitPrefix.includes("\0")
      || (gitPrefix !== "" && !gitPrefix.endsWith("/"))
      || gitPrefix.split("/").some((part) => part === "." || part === "..")) {
      throw failure("INVALID_GIT_PREFIX", "Git working-directory prefix is invalid");
    }
    const releaseGitPath = `${gitPrefix}${releasePath}`;
    const { stdout: statusOutput } = await execute("git", [
      "-C",
      root,
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "--untracked-files=all",
      "--ignored=matching",
      "--",
      ".",
    ], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 10_000,
      windowsHide: true,
    });
    const statusRecords = statusOutput.split("\0").filter(Boolean);
    const head = statusRecords.find((record) => record.startsWith("# branch.oid "))
      ?.slice("# branch.oid ".length) ?? "";
    let dirtyPathCount = 0;
    for (let index = 0; index < statusRecords.length; index += 1) {
      const record = statusRecords[index];
      if (record.startsWith("# ")) continue;
      if (record.startsWith("2 ")) {
        dirtyPathCount += 1;
        index += 1;
        continue;
      }
      if (record.startsWith("! ")) {
        const ignoredPath = record.slice(2).replace(/\/$/u, "");
        if (ignoredPath === releaseGitPath
          || ignoredPath.startsWith(`${releaseGitPath}/`)) dirtyPathCount += 1;
        continue;
      }
      dirtyPathCount += 1;
    }
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

function failedArtifactLockCheck(check, code) {
  return {
    artifactCount: Number.isInteger(check?.artifactCount) ? check.artifactCount : 0,
    errorCode: code,
    status: "failed",
  };
}

function failedGitCheck(check, code) {
  return {
    dirtyPathCount: Number.isInteger(check?.dirtyPathCount) ? check.dirtyPathCount : 0,
    errorCode: code,
    head: typeof check?.head === "string" ? check.head : null,
    status: "failed",
  };
}

function artifactLockIdentity(lock) {
  const bytes = lock?.verification?.lockBytes;
  return bytes === undefined || bytes === null ? null : digest(bytes);
}

export function reconcileTerminalRuntimeChecks(initial, terminal) {
  const initialLock = initial?.artifactLock;
  const terminalLock = terminal?.artifactLock;
  let artifactLock;
  if (terminalLock?.check?.status !== "passed") {
    artifactLock = failedArtifactLockCheck(
      terminalLock?.check,
      terminalLock?.check?.errorCode ?? "TERMINAL_ARTIFACT_LOCK_CHECK_FAILED",
    );
  } else if (initialLock?.check?.status !== "passed") {
    artifactLock = failedArtifactLockCheck(
      terminalLock.check,
      "ARTIFACT_LOCK_STATE_CHANGED_DURING_GATE",
    );
  } else {
    const initialIdentity = artifactLockIdentity(initialLock);
    const terminalIdentity = artifactLockIdentity(terminalLock);
    if (initialIdentity === null || terminalIdentity === null) {
      artifactLock = failedArtifactLockCheck(
        terminalLock.check,
        "ARTIFACT_LOCK_IDENTITY_UNAVAILABLE",
      );
    } else if (initialIdentity !== terminalIdentity) {
      artifactLock = failedArtifactLockCheck(
        terminalLock.check,
        "ARTIFACT_LOCK_CHANGED_DURING_GATE",
      );
    } else {
      artifactLock = terminalLock.check;
    }
  }

  const initialGit = initial?.git;
  const terminalGit = terminal?.git;
  let git;
  if (terminalGit?.status !== "passed") {
    git = failedGitCheck(
      terminalGit,
      terminalGit?.errorCode ?? "TERMINAL_GIT_CHECK_FAILED",
    );
  } else if (initialGit?.status !== "passed") {
    git = failedGitCheck(terminalGit, "GIT_STATE_CHANGED_DURING_GATE");
  } else if (typeof initialGit.head !== "string" || typeof terminalGit.head !== "string") {
    git = failedGitCheck(terminalGit, "GIT_STATE_IDENTITY_UNAVAILABLE");
  } else if (initialGit.head !== terminalGit.head) {
    git = failedGitCheck(terminalGit, "GIT_STATE_CHANGED_DURING_GATE");
  } else {
    git = terminalGit;
  }

  return { artifactLock, git };
}

const DEFAULT_EVIDENCE_TIMEOUT_MS = 300_000;
const allowedEvidenceCommands = new Map([
  [
    "node --test tests/profile/ontology-dataset-boundary.test.mjs",
    [process.execPath, ["--test", "tests/profile/ontology-dataset-boundary.test.mjs"]],
  ],
  [
    "node --test tests/contract/crs-geometry-transformation.test.mjs",
    [process.execPath, ["--test", "tests/contract/crs-geometry-transformation.test.mjs"]],
  ],
  [
    "node --test tests/contract/rc-geo-preflight-boundary.test.mjs",
    [process.execPath, ["--test", "tests/contract/rc-geo-preflight-boundary.test.mjs"]],
  ],
  [
    "node --test tests/profile/quality-result-kind.test.mjs",
    [process.execPath, ["--test", "tests/profile/quality-result-kind.test.mjs"]],
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
    "npm run profile:ontology:governance:verify",
    [process.execPath, ["tools/profile/verify-ontology-term-governance.mjs"]],
  ],
  [
    "npm run profile:network:verify",
    [process.execPath, ["tools/profile/verify-network-reference-policy.mjs"]],
  ],
  [
    "npm run release:eol:verify",
    [process.execPath, ["tools/release/verify-release-eol-policy.mjs"]],
  ],
  [
    "npm run profile:requirements:upstream:engines",
    [process.execPath, [
      "tools/profile/verify-upstream-requirement-inventory.mjs",
      "--engines",
    ], 600_000],
  ],
  [
    "npm run profile:requirements:verify",
    [process.execPath, ["tools/profile/verify-requirement-traceability.mjs"]],
  ],
  [
    "npm run profile:requirements:upstream:verify",
    [process.execPath, ["tools/profile/verify-upstream-requirement-inventory.mjs"]],
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
    "npm run profile:rc:shacl-matrix:verify",
    [process.execPath, [
      "tools/profile/run-rc-shacl-matrix.mjs",
      "verify",
      "--mode=full",
    ], 600_000],
  ],
  [
    "npm run profile:rc:serialization-parity:verify",
    [
      process.execPath,
      ["tools/profile/run-rc-serialization-parity.mjs", "verify"],
      600_000,
    ],
  ],
]);

export function evidenceCommandTimeoutMs(command) {
  const definition = allowedEvidenceCommands.get(command);
  return definition ? definition[2] ?? DEFAULT_EVIDENCE_TIMEOUT_MS : null;
}

async function runEvidenceCommand(command) {
  const definition = allowedEvidenceCommands.get(command);
  if (!definition) return false;
  try {
    await execFileAsync(definition[0], definition[1], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: evidenceCommandTimeoutMs(command),
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

export function validateRequirementCoverageEvidence(bytes, profileVersion) {
  try {
    const report = parseJson(bytes, "requirement coverage evidence");
    const counts = report?.counts;
    return report?.schemaVersion === "molit.profile-requirement-coverage/1"
      && report.profileVersion === profileVersion
      && report.releaseAcceptanceItem === "RA-REQUIREMENTS"
      && Number.isInteger(counts?.blockers)
      && counts.blockers === 0
      && Number.isInteger(counts?.integratedBlockers)
      && counts.integratedBlockers === 0
      && Number.isInteger(counts?.integratedRequirements)
      && counts.integratedRequirements > 0
      && Number.isInteger(counts?.integratedFullyCovered)
      && counts.integratedFullyCovered === counts.integratedRequirements
      && Array.isArray(report.blockers)
      && report.blockers.length === 0;
  } catch {
    return false;
  }
}

export function releaseEvidenceMatchesSnapshot(relative, bytes, snapshot) {
  if (!snapshot) return true;
  const prefix = `${snapshot.releaseRootRelative}/`;
  if (!relative.startsWith(prefix)) return true;
  const artifactRelative = relative.slice(prefix.length);
  const lockedBytes = snapshot.artifactBytes?.get(artifactRelative);
  return lockedBytes !== undefined && digest(lockedBytes) === digest(bytes);
}

export async function fixedEvidenceCheck(
  register,
  runtime,
  inputEvidence,
  { runCommand = runEvidenceCommand } = {},
) {
  const invalidItems = [];
  let itemCount = 0;
  for (const item of register.items.filter(({ status }) => status === "fixed")) {
    itemCount += 1;
    if (item.id === "RA-LOCK") {
      if (runtime.artifactLock.status !== "passed") invalidItems.push(item.id);
      continue;
    }
    if (item.id === "RA-GIT") {
      // Keep evaluating the declared evidence after the runtime Git check.
      // RA-GIT also owns the repository EOL policy command.
    }
    let supported = 0;
    let valid = true;
    if (item.id === "RA-GIT" && runtime.git.status !== "passed") valid = false;
    if (item.id === "RA-REQUIREMENTS"
      && runtime.requirementTraceability.status !== "passed") valid = false;
    const seenEvidence = new Set();
    for (const evidence of item.evidence) {
      const evidenceKey = JSON.stringify([evidence.kind, evidence.value]);
      if (seenEvidence.has(evidenceKey)) {
        valid = false;
        continue;
      }
      seenEvidence.add(evidenceKey);
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
            if (!releaseEvidenceMatchesSnapshot(
              relative,
              bytes,
              runtime.releaseSnapshot,
            )) valid = false;
            if (item.id === "RA-MULTI-ENGINE-MATRIX"
              && relative === "evidence/validators/molit-rc-shacl-matrix.v1.json"
              && !await validateRcMatrixEvidence(bytes, runtime)) valid = false;
          }
        } catch {
          valid = false;
        }
      } else if (evidence.kind === "requirement-coverage") {
        supported += 1;
        try {
          const relative = portablePath(evidence.value, "requirement coverage evidence path");
          const bytes = await readCheckedFile(
            root,
            path.resolve(root, ...relative.split("/")),
            32 * 1024 * 1024,
          );
          inputEvidence[relative] = digest(bytes);
          if (!releaseEvidenceMatchesSnapshot(
            relative,
            bytes,
            runtime.releaseSnapshot,
          )) valid = false;
          if (!validateRequirementCoverageEvidence(bytes, register.profileVersion)) valid = false;
        } catch {
          valid = false;
        }
      } else if (evidence.kind === "command") {
        supported += 1;
        try {
          if (!await runCommand(evidence.value)) valid = false;
        } catch {
          valid = false;
        }
      } else if (evidence.kind === "git-control" && item.id === "RA-GIT") {
        supported += 1;
        if (runtime.git.status !== "passed") valid = false;
      } else {
        valid = false;
      }
    }
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

export async function evaluateReleaseGateV2(version, {
  checkArtifactLock = artifactLockCheck,
  checkFixedEvidence = fixedEvidenceCheck,
  checkGit = gitCheck,
  checkTraceability = traceabilityCheck,
} = {}) {
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
    checkArtifactLock(release),
    checkGit(release.releaseRoot),
    checkTraceability(release.releaseRoot),
  ]);
  const lockedRegisterBytes = lock.verification?.artifactBytes?.get(registerRelative);
  const registerMatchesInitialSnapshot = lock.check.status === "passed"
    && lockedRegisterBytes !== undefined
    && digest(lockedRegisterBytes) === digest(registerBytes);
  if (lock.verification) {
    inputEvidence[portableRootPath(release.manifestPath)] = digest(
      lock.verification.artifactBytes.get("manifest.json"),
    );
    inputEvidence[portableRootPath(lock.verification.lockPath)] = digest(
      lock.verification.lockBytes,
    );
  }
  const fixedEvidence = await checkFixedEvidence(
    register,
    {
      artifactLock: lock.check,
      artifactLockSha256: lock.verification ? digest(lock.verification.lockBytes) : null,
      git,
      releaseSnapshot: {
        artifactBytes: lock.verification?.artifactBytes ?? null,
        releaseRootRelative: portableRootPath(release.releaseRoot),
      },
      requirementTraceability,
    },
    inputEvidence,
  );
  const terminalLock = await checkArtifactLock(release);
  const terminalGit = await checkGit(release.releaseRoot);
  let terminalRuntime = reconcileTerminalRuntimeChecks(
    { artifactLock: lock, git },
    { artifactLock: terminalLock, git: terminalGit },
  );
  if (!registerMatchesInitialSnapshot && terminalRuntime.artifactLock.status === "passed") {
    terminalRuntime = {
      ...terminalRuntime,
      artifactLock: failedArtifactLockCheck(
        terminalRuntime.artifactLock,
        "RELEASE_ACCEPTANCE_SNAPSHOT_MISMATCH",
      ),
    };
  }
  const fixedEvidenceInvalidItems = new Set(fixedEvidence.invalidItems);
  if (terminalRuntime.artifactLock.status !== "passed") {
    fixedEvidenceInvalidItems.add("RA-LOCK");
  }
  if (terminalRuntime.git.status !== "passed") fixedEvidenceInvalidItems.add("RA-GIT");
  const finalFixedEvidenceInvalidItems = [...fixedEvidenceInvalidItems].sort();
  const finalFixedEvidence = {
    invalidItems: finalFixedEvidenceInvalidItems,
    check: {
      errorCode: finalFixedEvidenceInvalidItems.length === 0
        ? null
        : "FIXED_EVIDENCE_INVALID",
      invalidItemCount: finalFixedEvidenceInvalidItems.length,
      itemCount: fixedEvidence.check.itemCount,
      status: finalFixedEvidenceInvalidItems.length === 0 ? "passed" : "failed",
    },
  };
  const statusOverrides = {
    "RA-GIT": terminalRuntime.git.status === "passed" ? "fixed" : "open",
    "RA-REQUIREMENTS": requirementTraceability.status === "passed" ? "fixed" : "open",
  };
  const hasRegisterLockItem = register.items.some(({ id }) => id === "RA-LOCK");
  if (hasRegisterLockItem) {
    statusOverrides["RA-LOCK"] = terminalRuntime.artifactLock.status === "passed"
      ? "fixed"
      : "open";
  }
  const extraBlockers = terminalRuntime.artifactLock.status === "passed" || hasRegisterLockItem
    ? []
    : [{
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
    fixedEvidenceFailures: finalFixedEvidence.invalidItems,
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
      artifactLock: terminalRuntime.artifactLock,
      fixedEvidence: finalFixedEvidence.check,
      git: terminalRuntime.git,
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
