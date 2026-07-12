import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import SHACLValidator from "rdf-validate-shacl";
import { Store } from "n3";
import {
  computeBundleDigest,
  loadProfileRelease,
  projectRoot,
  selectValidationProfile,
  verifyArtifactLock,
} from "./registry.mjs";
import {
  loadRdfBytes,
  loadRdfFile,
  mergeStores,
  sanitizeDiagnosticValue,
  scanCoreProfileRouting,
  scanPublicGraph,
} from "./rdf-loader.mjs";
import { assertLocalFilesystemPath } from "./local-path.mjs";
import {
  NETWORK_RUNTIME_CONTROL_BY_ERROR_CODE,
  NETWORK_RUNTIME_PATH_FIELD_BY_ERROR_CODE,
  validateNetworkReferenceGraph,
} from "./network-reference-integrity.mjs";
import { parsePublicValuePolicy } from "./public-value-policy.mjs";
import { assertValidationReport } from "./report-contract.mjs";

const SH = "http://www.w3.org/ns/shacl#";
const MOLIT_REQUIREMENT_ID = "https://data.molit.go.kr/def/molit-dcat-ap#requirementId";
const VALID_SEVERITIES = new Set(["Info", "Violation", "Warning"]);
const VALIDATOR_SOURCE_ARTIFACTS = [
  ["contracts/publication-check-report.v1.schema.json", new URL(
    "../../contracts/publication-check-report.v1.schema.json",
    import.meta.url,
  )],
  ["contracts/shacl-validation-report.v1.schema.json", new URL(
    "../../contracts/shacl-validation-report.v1.schema.json",
    import.meta.url,
  )],
  ["package-lock.json", new URL("../../package-lock.json", import.meta.url)],
  ["package.json", new URL("../../package.json", import.meta.url)],
  ["src/profile/cli.mjs", new URL("./cli.mjs", import.meta.url)],
  ["src/profile/isolated-validator.mjs", new URL("./isolated-validator.mjs", import.meta.url)],
  ["src/profile/crs-coordinate-tuple.mjs", new URL("./crs-coordinate-tuple.mjs", import.meta.url)],
  ["src/profile/crs-geometry.mjs", new URL("./crs-geometry.mjs", import.meta.url)],
  ["src/profile/local-path.mjs", new URL("./local-path.mjs", import.meta.url)],
  ["src/profile/network-reference-integrity.mjs", new URL(
    "./network-reference-integrity.mjs",
    import.meta.url,
  )],
  ["src/profile/public-value-policy.mjs", new URL("./public-value-policy.mjs", import.meta.url)],
  ["src/profile/rdf-loader.mjs", new URL("./rdf-loader.mjs", import.meta.url)],
  ["src/profile/registry.mjs", new URL("./registry.mjs", import.meta.url)],
  ["src/profile/report-contract.mjs", new URL("./report-contract.mjs", import.meta.url)],
  ["src/profile/validator.mjs", new URL("./validator.mjs", import.meta.url)],
  ["src/profile/validation-worker.mjs", new URL("./validation-worker.mjs", import.meta.url)],
  ["src/profile/xsd-lexical.mjs", new URL("./xsd-lexical.mjs", import.meta.url)],
];

async function validatorProvenance() {
  const hash = createHash("sha256");
  let reportSchemaDigest = null;
  for (const [label, url] of VALIDATOR_SOURCE_ARTIFACTS) {
    const bytes = await readFile(url);
    hash.update(label, "utf8");
    hash.update("\0", "utf8");
    hash.update(bytes);
    hash.update("\0", "utf8");
    if (label === "contracts/shacl-validation-report.v1.schema.json") {
      reportSchemaDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    }
  }
  return Object.freeze({
    buildDigest: `sha256:${hash.digest("hex")}`,
    reportSchemaDigest,
    sourceArtifactCount: VALIDATOR_SOURCE_ARTIFACTS.length,
  });
}

const VALIDATOR_PROVENANCE = await validatorProvenance();

function termValue(term) {
  return term?.value ?? null;
}

function severityName(value) {
  const name = value?.startsWith(SH) ? value.slice(SH.length) : (value ?? "Violation");
  if (!VALID_SEVERITIES.has(name)) {
    const error = new Error(`unsupported SHACL severity: ${value}`);
    error.code = "UNSUPPORTED_SHACL_SEVERITY";
    throw error;
  }
  return name;
}

function stableAnonymousIri(kind, values) {
  const digest = createHash("sha256")
    .update(JSON.stringify(values), "utf8")
    .digest("hex");
  return `urn:kr:molit:shacl:${kind}:${digest}`;
}

function blankShapeAnchors(term, shapeStore) {
  if (term?.termType !== "BlankNode") return [];
  const anchors = [];
  const queue = [{ path: [], term }];
  const visited = new Set();
  while (queue.length > 0 && visited.size < 256) {
    const current = queue.shift();
    const key = `${current.term.termType}:${current.term.value}:${current.path.join("|")}`;
    if (visited.has(key) || current.path.length > 32) continue;
    visited.add(key);
    for (const quad of shapeStore.getQuads(null, null, current.term, null)) {
      const nextPath = [quad.predicate.value, ...current.path];
      if (quad.subject.termType === "NamedNode") {
        anchors.push(`${quad.subject.value}|${nextPath.join("|")}`);
      } else if (quad.subject.termType === "BlankNode") {
        queue.push({ path: nextPath, term: quad.subject });
      }
    }
  }
  return [...new Set(anchors)].sort();
}

function buildShapeIdentityIndex(shapeStore) {
  const index = new Map();
  const queue = [];
  for (const quad of shapeStore.getQuads(null, MOLIT_REQUIREMENT_ID, null, null)) {
    if (!(["BlankNode", "NamedNode"].includes(quad.subject.termType))
      || quad.object.termType !== "Literal") continue;
    const identity = {
      requirementId: quad.object.value,
      sourceShape: quad.subject.termType === "NamedNode"
        ? quad.subject.value
        : stableAnonymousIri("shape-id", blankShapeAnchors(quad.subject, shapeStore)),
    };
    index.set(`${quad.subject.termType}:${quad.subject.value}`, identity);
    queue.push({ identity, term: quad.subject });
  }
  const visited = new Set();
  while (queue.length > 0) {
    const { identity, term } = queue.shift();
    const visitKey = `${identity.requirementId}:${term.termType}:${term.value}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    for (const quad of shapeStore.getQuads(term, null, null, null)) {
      if (quad.object.termType !== "BlankNode") continue;
      const objectKey = `${quad.object.termType}:${quad.object.value}`;
      if (!index.has(objectKey)) index.set(objectKey, identity);
      queue.push({ identity: index.get(objectKey), term: quad.object });
    }
  }
  return index;
}

function normalizeResult(result, identityIndex, shapeStore) {
  const rawSourceShape = result.sourceShape;
  const identity = rawSourceShape
    ? identityIndex.get(`${rawSourceShape.termType}:${rawSourceShape.value}`)
    : null;
  const messages = (result.message ?? []).map((message) => ({
      language: message.language || null,
      value: sanitizeDiagnosticValue(message.value),
    }));
  const component = sanitizeDiagnosticValue(termValue(result.sourceConstraintComponent), 4096);
  const rawPath = result.path;
  const pathValue = rawPath?.termType === "BlankNode"
    ? stableAnonymousIri("path", [
      blankShapeAnchors(rawPath, shapeStore),
      component,
      messages,
    ])
    : sanitizeDiagnosticValue(termValue(rawPath), 4096);
  const sourceShape = identity?.sourceShape ?? (
    rawSourceShape?.termType === "BlankNode"
      ? stableAnonymousIri("shape", [
        blankShapeAnchors(rawSourceShape, shapeStore),
        component,
        pathValue,
        messages,
      ])
      : sanitizeDiagnosticValue(termValue(rawSourceShape), 4096)
  );
  return {
    focusNode: sanitizeDiagnosticValue(termValue(result.focusNode), 4096),
    messages,
    path: pathValue,
    requirementId: identity?.requirementId ?? null,
    severity: severityName(termValue(result.severity)),
    sourceConstraintComponent: component,
    sourceShape,
    value: sanitizeDiagnosticValue(termValue(result.value), 20000),
  };
}

function sortResults(results) {
  return results.sort((left, right) => {
    const leftJson = JSON.stringify(left);
    const rightJson = JSON.stringify(right);
    if (leftJson < rightJson) return -1;
    if (leftJson > rightJson) return 1;
    return 0;
  });
}

function countSeverities(results) {
  const counts = { Info: 0, Violation: 0, Warning: 0 };
  for (const result of results) {
    counts[result.severity] = (counts[result.severity] ?? 0) + 1;
  }
  return counts;
}

function networkIntegrityFinding(error, policy) {
  const code = typeof error?.code === "string" ? error.code : "NETWORK_INTEGRITY_INVALID";
  const projection = policy.rdfProjection;
  const requirementId = NETWORK_RUNTIME_CONTROL_BY_ERROR_CODE[code] ?? "MOLIT-NET-REF-001";
  const projectionField = NETWORK_RUNTIME_PATH_FIELD_BY_ERROR_CODE[code];
  const pathValue = projectionField ? projection[projectionField] : error?.path ?? null;
  return {
    focusNode: sanitizeDiagnosticValue(error?.focusNode ?? null, 4096),
    messages: [{
      language: "en",
      value: `Network reference-set integrity failed (${code}). Align edition keys, checksums, lifecycle successors and non-overlapping validity intervals.`,
    }],
    path: sanitizeDiagnosticValue(pathValue, 4096),
    requirementId,
    severity: "Violation",
    sourceConstraintComponent: "urn:kr:molit:profile:NetworkReferenceSetIntegrityConstraint",
    sourceShape: "urn:kr:molit:profile:NetworkReferenceSetIntegrityShape",
    value: null,
  };
}

async function loadMany(relativePaths, limits, artifactBytes) {
  const loaded = [];
  for (const relativePath of relativePaths) {
    const bytes = artifactBytes.get(relativePath);
    if (!bytes) {
      const error = new Error(`validation snapshot is missing: ${relativePath}`);
      error.code = "INCOMPLETE_ARTIFACT_SNAPSHOT";
      throw error;
    }
    loaded.push(await loadRdfBytes(
      bytes,
      relativePath,
      limits,
      { canonicalize: false, trusted: true },
    ));
  }
  return loaded;
}

function assertSupportedShapeSeverities(shapeStore) {
  for (const quad of shapeStore.getQuads(null, `${SH}severity`, null, null)) {
    if (quad.object.termType !== "NamedNode") {
      const error = new Error("SHACL severity must be a standard severity IRI");
      error.code = "UNSUPPORTED_SHACL_SEVERITY";
      throw error;
    }
    severityName(quad.object.value);
  }
}

export async function validateProfileDocument({
  inputPath,
  profileName = "core",
  version,
}) {
  assertLocalFilesystemPath(inputPath, "input path");
  const loadedRelease = await loadProfileRelease(version);
  const lockVerification = await verifyArtifactLock(loadedRelease);
  const release = { ...loadedRelease, manifest: lockVerification.manifest };
  const profile = selectValidationProfile(release, profileName);
  const limits = release.manifest.limits;
  const bundleDigest = await computeBundleDigest(
    release,
    profile,
    lockVerification.artifactBytes,
  );
  const input = await loadRdfFile(path.resolve(inputPath), limits);
  const policyBytes = lockVerification.artifactBytes.get(release.manifest.publicValuePolicy);
  if (!policyBytes) {
    const error = new Error("validation snapshot is missing the public value policy");
    error.code = "INCOMPLETE_ARTIFACT_SNAPSHOT";
    throw error;
  }
  const publicValuePolicy = parsePublicValuePolicy(policyBytes);
  let networkReferencePolicy = null;
  if (profileName === "network") {
    const networkPolicyBytes = lockVerification.artifactBytes.get(
      release.manifest.networkReferencePolicy,
    );
    if (!networkPolicyBytes) {
      const error = new Error("validation snapshot is missing the network reference policy");
      error.code = "INCOMPLETE_ARTIFACT_SNAPSHOT";
      throw error;
    }
    networkReferencePolicy = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(networkPolicyBytes),
    );
  }
  const safetyScan = scanPublicGraph(
    input.store,
    limits,
    limits.maxValidationResults,
    publicValuePolicy,
  );
  const routingScan = safetyScan.findings.length === 0 && !safetyScan.limitReached
    ? scanCoreProfileRouting(input.store, profileName, limits.maxValidationResults)
    : { findings: [], limitReached: false };
  const preflightFindings = [...safetyScan.findings, ...routingScan.findings];
  const preflightLimitReached = safetyScan.limitReached || routingScan.limitReached;

  const background = await loadMany(
    release.manifest.background,
    limits,
    lockVerification.artifactBytes,
  );
  const shapeInputs = await loadMany(profile.shapes, limits, lockVerification.artifactBytes);
  const localImports = new Map();
  for (const [iri, relativePath] of Object.entries(release.manifest.localImportMap ?? {})) {
    const bytes = lockVerification.artifactBytes.get(relativePath);
    if (!bytes) {
      const error = new Error(`validation snapshot is missing: ${relativePath}`);
      error.code = "INCOMPLETE_ARTIFACT_SNAPSHOT";
      throw error;
    }
    const imported = await loadRdfBytes(
      bytes,
      relativePath,
      limits,
      { canonicalize: false, trusted: true },
    );
    localImports.set(iri, imported.store);
  }
  const dataStore = mergeStores(
    new Store(input.store.getQuads(null, null, null, null)),
    background.map((item) => item.store),
  );
  const shapeStore = mergeStores(
    new Store(),
    shapeInputs.map((item) => item.store),
  );
  assertSupportedShapeSeverities(shapeStore);
  const remainingResultBudget = Math.max(
    0,
    limits.maxValidationResults - preflightFindings.length,
  );
  let shaclReport = { conforms: false, results: [] };
  let normalizedShaclResults = [];
  let networkIntegrityResults = [];
  if (preflightFindings.length === 0 && !preflightLimitReached) {
    const validator = new SHACLValidator(shapeStore, {
      importGraph: async (iri) => {
        const imported = localImports.get(iri.value);
        if (!imported) {
          const error = new Error(`SHACL import is not in the local allowlist: ${iri.value}`);
          error.code = "UNAPPROVED_SHACL_IMPORT";
          throw error;
        }
        return imported;
      },
      maxErrors: Math.max(1, remainingResultBudget + 1),
    });
    shaclReport = await validator.validate(dataStore);
    const shapeIdentityIndex = buildShapeIdentityIndex(shapeStore);
    normalizedShaclResults = sortResults(
      shaclReport.results.map((result) => normalizeResult(
        result,
        shapeIdentityIndex,
        shapeStore,
      )),
    );
    if (profileName === "network" && shaclReport.conforms) {
      try {
        validateNetworkReferenceGraph(input.store, networkReferencePolicy);
      } catch (error) {
        networkIntegrityResults = [networkIntegrityFinding(error, networkReferencePolicy)];
      }
    }
  }
  const validationResults = sortResults([
    ...normalizedShaclResults,
    ...networkIntegrityResults,
  ]);
  const resultLimitReached = preflightLimitReached
    || validationResults.length > remainingResultBudget;
  const results = sortResults([
    ...preflightFindings,
    ...validationResults.slice(0, remainingResultBudget),
  ]);
  const counts = countSeverities(results);
  const gatePassed = !resultLimitReached
    && counts.Violation === 0
    && (profile.gate !== "warning" || counts.Warning === 0);
  const relativeInput = path.relative(projectRoot(), path.resolve(inputPath));

  const report = {
    schemaVersion: "molit.shacl-validation-report/1",
    validatedAt: new Date().toISOString(),
    input: {
      byteSha256: input.byteSha256,
      bytes: input.bytes,
      path: sanitizeDiagnosticValue(
        relativeInput.startsWith("..") ? path.basename(inputPath) : relativeInput,
        4096,
      ),
      quads: input.quads.length,
    },
    profile: {
      bundleDigest,
      conformanceIri: profile.conformanceIri,
      gate: profile.gate,
      kind: profile.kind,
      name: profileName,
      namespaceStatus: release.manifest.namespaceStatus,
      status: release.manifest.status,
      version: release.version,
      versionIri: release.manifest.versionIri,
    },
    engine: {
      dynamicImportsAllowed: false,
      implementation: "rdf-validate-shacl",
      implementationVersion: "0.6.5",
      localImportCount: localImports.size,
      molitValidatorBuildDigest: VALIDATOR_PROVENANCE.buildDigest,
      molitValidatorSourceArtifactCount: VALIDATOR_PROVENANCE.sourceArtifactCount,
      molitValidatorVersion: "0.1.0",
      nodeVersion: process.version,
      rdfParser: "n3",
      rdfParserVersion: "2.1.1",
      reportBlankNodesCanonical: false,
      reportSchemaDigest: VALIDATOR_PROVENANCE.reportSchemaDigest,
      shaclSparqlSupported: false,
    },
    artifacts: {
      backgroundQuads: background.reduce((sum, item) => sum + item.quads.length, 0),
      lockedArtifacts: lockVerification.results.length,
      shapeQuads: shapeInputs.reduce((sum, item) => sum + item.quads.length, 0),
    },
    summary: {
      counts,
      gatePassed,
      resultLimitReached,
      resultCount: results.length,
      shaclConforms: shaclReport.conforms
        && preflightFindings.length === 0
        && !resultLimitReached,
    },
    authority: {
      publicationAuthorized: false,
      reasons: [
        `release-status:${release.manifest.status}`,
        `namespace-status:${release.manifest.namespaceStatus}`,
        "detached-release-signature:not-verified",
      ],
      validationScope: "technical-conformance-only",
    },
    results,
  };
  report.decisionDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify({
      artifacts: report.artifacts,
      authority: report.authority,
      engine: report.engine,
      input: {
        byteSha256: report.input.byteSha256,
        bytes: report.input.bytes,
        quads: report.input.quads,
      },
      profile: report.profile,
      results: report.results,
      summary: report.summary,
    }), "utf8")
    .digest("hex")}`;
  return assertValidationReport(report);
}
