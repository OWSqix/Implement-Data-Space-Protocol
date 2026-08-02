import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { canonicalJson, sha256 } from "../../src/observability/stable-json.mjs";

const DIGEST = /^sha256:([0-9a-f]{64})$/u;
const BLOCKING_SEVERITIES = Object.freeze(["UNKNOWN", "HIGH", "CRITICAL"]);
export const RELEASE_ARTIFACTS = Object.freeze({
  caas: Object.freeze({ runtimeClass: "caas-control-plane", productionEligible: true, provenanceMode: "source-build" }),
  dsaas: Object.freeze({ runtimeClass: "dsaas-control-plane", productionEligible: true, provenanceMode: "source-build" }),
  "fencing-webhook": Object.freeze({ runtimeClass: "fencing-webhook", productionEligible: true, provenanceMode: "source-build" }),
  "edc-control-plane": Object.freeze({ runtimeClass: "edc-control-plane", productionEligible: false, provenanceMode: "source-build" }),
  "edc-data-plane": Object.freeze({ runtimeClass: "edc-data-plane", productionEligible: false, provenanceMode: "source-build" }),
  "edc-schema-migration": Object.freeze({ runtimeClass: "schema-migration", productionEligible: true, provenanceMode: "source-build" }),
  "postgres-operand": Object.freeze({ runtimeClass: "postgres-operand", productionEligible: true, provenanceMode: "external-adoption" }),
  "otel-collector": Object.freeze({ runtimeClass: "otel-collector", productionEligible: true, provenanceMode: "external-adoption" }),
});

export class SupplyChainError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "SupplyChainError";
    this.code = code;
  }
}

function required(condition, code, message) {
  if (!condition) throw new SupplyChainError(code, message);
}

function exactKeys(value, keys, code = "SUP_BUNDLE_INVALID") {
  required(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(","), code, "supply-chain object contains missing or unknown fields");
}

function assertPinnedImage(value, code = "SUP_TOOL_IMAGE_INVALID") {
  required(typeof value === "string" && /^[^@\s]+@sha256:[0-9a-f]{64}$/u.test(value), code, "toolchain image must use an immutable sha256 reference");
  return value;
}

export function assertReleaseArtifact(value) {
  exactKeys(value, ["service", "runtimeClass", "productionEligible"], "SUP_ARTIFACT_IDENTITY_INVALID");
  const registered = RELEASE_ARTIFACTS[value.service];
  required(registered && value.runtimeClass === registered.runtimeClass
    && value.productionEligible === registered.productionEligible,
  "SUP_ARTIFACT_IDENTITY_INVALID", "release artifact identity is absent or differs from the reviewed runtime class register");
  return Object.freeze({ service: value.service, runtimeClass: value.runtimeClass, productionEligible: value.productionEligible });
}

export function assertImageDigest(value) {
  required(typeof value === "string" && DIGEST.test(value), "SUP_IMAGE_DIGEST_INVALID", "image digest must be sha256:<64 lowercase hex>");
  return value;
}

export function decorateSpdx(document, imageDigest, at = new Date().toISOString()) {
  assertImageDigest(imageDigest);
  required(document?.spdxVersion === "SPDX-2.3" && Array.isArray(document.packages) && document.packages.length > 0, "SUP_SPDX_INVALID", "SPDX 2.3 document with packages is required");
  return { ...document, annotations: [...(document.annotations ?? []).filter((item) => item?.comment !== undefined && !String(item.comment).startsWith("molit:imageDigest=")), { annotationType: "OTHER", annotator: "Tool: molit-supply-chain/1", annotationDate: at, comment: `molit:imageDigest=${imageDigest}` }] };
}

export function decorateCycloneDx(document, imageDigest) {
  assertImageDigest(imageDigest);
  required(document?.bomFormat === "CycloneDX" && /^1\.(?:5|6)$/u.test(document.specVersion) && Array.isArray(document.components), "SUP_CYCLONEDX_INVALID", "CycloneDX 1.5 or 1.6 document is required");
  const properties = (document.metadata?.properties ?? []).filter((item) => item?.name !== "molit:imageDigest");
  return { ...document, metadata: { ...(document.metadata ?? {}), properties: [...properties, { name: "molit:imageDigest", value: imageDigest }] } };
}

function dbUpdatedAt(version, databaseMetadata) {
  const candidates = [databaseMetadata?.UpdatedAt, databaseMetadata?.updatedAt, version?.VulnerabilityDB?.UpdatedAt, version?.VulnerabilityDB?.DownloadedAt, version?.DB?.UpdatedAt, version?.db?.updatedAt];
  const value = candidates.find((candidate) => typeof candidate === "string" && Number.isFinite(Date.parse(candidate)));
  required(value, "SUP_SCANNER_DB_TIME_MISSING", "Trivy database update time is required");
  return new Date(value).toISOString();
}

export function sanitizeTrivyReport(report) {
  required(report?.SchemaVersion >= 2 && Array.isArray(report.Results), "SUP_TRIVY_REPORT_INVALID", "Trivy JSON report is invalid");
  return {
    SchemaVersion: report.SchemaVersion,
    ArtifactName: report.ArtifactName,
    ArtifactType: report.ArtifactType,
    Metadata: {
      ImageID: report.Metadata?.ImageID,
      RepoTags: report.Metadata?.RepoTags,
      RepoDigests: report.Metadata?.RepoDigests,
      OS: report.Metadata?.OS,
    },
    Results: report.Results.map((result) => ({
      Target: result.Target,
      Class: result.Class,
      Type: result.Type,
      Vulnerabilities: (result.Vulnerabilities ?? []).map((item) => ({ VulnerabilityID: item.VulnerabilityID, PkgName: item.PkgName, PkgIdentifier: item.PkgIdentifier, InstalledVersion: item.InstalledVersion, FixedVersion: item.FixedVersion, Status: item.Status, Severity: item.Severity, PrimaryURL: item.PrimaryURL, References: item.References })),
      Misconfigurations: (result.Misconfigurations ?? []).map((item) => ({ ID: item.ID, AVDID: item.AVDID, Title: item.Title, Description: item.Description, Message: item.Message, Namespace: item.Namespace, Resolution: item.Resolution, Severity: item.Severity, PrimaryURL: item.PrimaryURL, References: item.References, Status: item.Status })),
      Secrets: (result.Secrets ?? []).map((item) => ({ RuleID: item.RuleID, Category: item.Category, Severity: item.Severity, Title: item.Title, StartLine: item.StartLine, EndLine: item.EndLine })),
    })),
  };
}

export function normalizeTrivy(report, version, { imageDigest, scannerImage, databaseMetadata, scannedAt = new Date().toISOString() } = {}) {
  assertImageDigest(imageDigest);
  required(typeof scannerImage === "string" && scannerImage.includes("@"), "SUP_SCANNER_IMAGE_INVALID", "pinned scanner image is required");
  assertImageDigest(scannerImage.split("@").at(-1));
  required(report?.SchemaVersion >= 2 && Array.isArray(report.Results), "SUP_TRIVY_REPORT_INVALID", "Trivy JSON report is invalid");
  const scannerVersion = version?.Version ?? version?.version;
  required(typeof scannerVersion === "string" && /^\d+\.\d+\.\d+(?:[-+].+)?$/u.test(scannerVersion), "SUP_SCANNER_VERSION_INVALID", "Trivy semantic version is required");
  const reportDigest = report?.Metadata?.ImageID;
  const repoDigests = report?.Metadata?.RepoDigests ?? [];
  required(reportDigest === imageDigest || repoDigests.some((value) => value.endsWith(`@${imageDigest}`)), "SUP_SCAN_SUBJECT_MISMATCH", "Trivy report does not identify the requested image digest");
  const findings = [];
  for (const result of report.Results) {
    for (const vulnerability of result.Vulnerabilities ?? []) findings.push({ scanner: "vulnerability", target: result.Target, id: vulnerability.VulnerabilityID, severity: String(vulnerability.Severity ?? "UNKNOWN").toUpperCase(), installedVersion: vulnerability.InstalledVersion, fixedVersion: vulnerability.FixedVersion });
    for (const misconfiguration of result.Misconfigurations ?? []) findings.push({ scanner: "misconfiguration", target: result.Target, id: misconfiguration.ID, severity: String(misconfiguration.Severity ?? "UNKNOWN").toUpperCase(), status: misconfiguration.Status });
    for (const secret of result.Secrets ?? []) findings.push({ scanner: "secret", target: result.Target, id: secret.RuleID, severity: String(secret.Severity ?? "CRITICAL").toUpperCase() });
  }
  const sanitizedReport = sanitizeTrivyReport(report);
  return {
    schemaVersion: "molit.trivy-scan/1",
    artifactDigest: imageDigest,
    scanner: { name: "trivy", image: scannerImage, version: scannerVersion },
    rawReportSha256: sha256(sanitizedReport),
    databaseMetadataSha256: sha256(databaseMetadata),
    databaseUpdatedAt: dbUpdatedAt(version, databaseMetadata),
    scannedAt: new Date(scannedAt).toISOString(),
    scanners: ["vuln", "secret", "misconfig"],
    complete: true,
    findings: findings.sort((left, right) => `${left.scanner}:${left.target}:${left.id}`.localeCompare(`${right.scanner}:${right.target}:${right.id}`)),
  };
}

export function evaluateVulnerabilityGate(scan, { now = new Date(), maxDatabaseAgeHours = 24 } = {}) {
  required(scan?.schemaVersion === "molit.trivy-scan/1" && scan.complete === true, "SUP_SCAN_INCOMPLETE", "normalized image scan is incomplete");
  required(["vuln", "secret", "misconfig"].every((name) => scan.scanners?.includes(name)), "SUP_SCAN_SCOPE_INCOMPLETE", "vulnerability, secret, and misconfiguration scanners are all required");
  const age = now.valueOf() - Date.parse(scan.databaseUpdatedAt);
  required(Number.isFinite(age) && age >= -300_000 && age <= maxDatabaseAgeHours * 3_600_000, "SUP_SCANNER_DB_STALE", "scanner vulnerability database is missing, stale, or from the future");
  const blocking = scan.findings.filter((finding) => BLOCKING_SEVERITIES.includes(finding.severity));
  return { decision: blocking.length === 0 ? "pass" : "blocked", blockingSeverities: BLOCKING_SEVERITIES, findingCount: blocking.length, databaseUpdatedAt: scan.databaseUpdatedAt, evaluatedAt: now.toISOString() };
}

function assertSbomSubjects(spdx, cycloneDx, imageDigest) {
  required(spdx.annotations?.some((annotation) => annotation.comment === `molit:imageDigest=${imageDigest}`), "SUP_SPDX_SUBJECT_MISMATCH", "SPDX document does not identify the image digest");
  required(cycloneDx.metadata?.properties?.some((property) => property.name === "molit:imageDigest" && property.value === imageDigest), "SUP_CYCLONEDX_SUBJECT_MISMATCH", "CycloneDX document does not identify the image digest");
}

function artifactReference(path, bytes) {
  required(basename(path) === path && path.endsWith(".json"), "SUP_ARTIFACT_PATH_INVALID", "supply-chain artifact references must be JSON basenames");
  return { path, sha256: sha256(bytes) };
}

function dssePae(payloadType, payload) {
  const type = Buffer.from(payloadType);
  const body = Buffer.from(payload);
  return Buffer.concat([Buffer.from(`DSSEv1 ${type.length} `), type, Buffer.from(` ${body.length} `), body]);
}

export function publicKeyId(publicKey) {
  const key = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  const der = key.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}

export function signDsse(statement, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  required(privateKey.asymmetricKeyType === "ed25519", "SUP_SIGNING_KEY_INVALID", "supply-chain signing key must be Ed25519");
  const publicKey = createPublicKey(privateKey);
  const payloadType = "application/vnd.in-toto+json";
  const payloadBytes = Buffer.from(canonicalJson(statement));
  const signature = sign(null, dssePae(payloadType, payloadBytes), privateKey);
  return { payloadType, payload: payloadBytes.toString("base64"), signatures: [{ keyid: publicKeyId(publicKey), sig: signature.toString("base64") }] };
}

export function verifyDsse(envelope, publicKeyPem) {
  required(envelope?.payloadType === "application/vnd.in-toto+json" && envelope.signatures?.length === 1, "SUP_DSSE_INVALID", "DSSE envelope contract is invalid");
  const publicKey = createPublicKey(publicKeyPem);
  required(publicKey.asymmetricKeyType === "ed25519", "SUP_TRUST_KEY_INVALID", "trusted supply-chain key must be Ed25519");
  required(envelope.signatures[0].keyid === publicKeyId(publicKey), "SUP_KEY_ID_MISMATCH", "DSSE key identifier does not match the trusted key");
  const payload = Buffer.from(envelope.payload, "base64");
  required(verify(null, dssePae(envelope.payloadType, payload), publicKey, Buffer.from(envelope.signatures[0].sig, "base64")), "SUP_SIGNATURE_INVALID", "DSSE signature verification failed");
  let statement;
  try { statement = JSON.parse(payload.toString("utf8")); } catch (error) { throw new SupplyChainError("SUP_PAYLOAD_INVALID", "DSSE payload is not JSON", { cause: error }); }
  required(canonicalJson(statement) === payload.toString("utf8"), "SUP_PAYLOAD_NONCANONICAL", "DSSE payload is not canonical JSON");
  return statement;
}

export function createProvenance({ imageName, imageDigest, sourceDigest, dockerfile, builderId, invocationId, startedOn, finishedOn, toolchain, artifacts, artifact, provenanceMode }) {
  assertImageDigest(imageDigest);
  assertImageDigest(sourceDigest);
  for (const value of Object.values(toolchain)) assertPinnedImage(value);
  const identity = assertReleaseArtifact(artifact);
  required(RELEASE_ARTIFACTS[identity.service].provenanceMode === provenanceMode,
    "SUP_PROVENANCE_MODE_INVALID", "artifact provenance mode differs from the reviewed runtime class register");
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: imageName, digest: { sha256: imageDigest.slice(7) } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: provenanceMode === "external-adoption"
          ? "https://data.molit.go.kr/build-types/external-image-adoption/v1"
          : "https://data.molit.go.kr/build-types/source-container/v1",
        externalParameters: { artifact: identity, dockerfile, provenanceMode },
        internalParameters: { networkMode: "default", reproducibleBuildClaim: false },
        resolvedDependencies: [
          ...Object.values(toolchain).map((uri) => ({ uri, digest: { sha256: uri.split("sha256:")[1] } })),
          { uri: provenanceMode === "external-adoption" ? "git+adoption-policy" : "git+workspace", digest: { sha256: sourceDigest.slice(7) } },
        ],
      },
      runDetails: {
        builder: { id: builderId },
        metadata: { invocationId, startedOn, finishedOn },
        byproducts: Object.entries(artifacts).map(([name, reference]) => ({ name, digest: { sha256: reference.sha256 } })),
      },
    },
  };
}

export function createReleaseBundle({ imageName, imageDigest, sourceDigest, dockerfile, toolchain, builderId, invocationId, startedOn, finishedOn, spdx, cycloneDx, scan, rawScan, paths, privateKeyPem, artifact, provenanceMode = "source-build", now = new Date() }) {
  assertImageDigest(imageDigest);
  const identity = assertReleaseArtifact(artifact);
  for (const value of Object.values(toolchain ?? {})) assertPinnedImage(value);
  required(Object.keys(toolchain ?? {}).sort().join(",") === "baseImage,buildImage,sbomGeneratorImage,scannerImage,signerImage", "SUP_TOOLCHAIN_INVALID", "runtime base, build, SBOM generator, scanner, and signer images are required");
  required(scan.scanner?.image === toolchain.scannerImage, "SUP_SCANNER_TOOL_MISMATCH", "scan did not use the attested scanner image");
  required(scan.rawReportSha256 === sha256(rawScan), "SUP_SCAN_NORMALIZATION_MISMATCH", "normalized scan does not bind the raw scanner report");
  required(scan.artifactDigest === imageDigest, "SUP_SCAN_SUBJECT_MISMATCH", "normalized scan does not identify the image digest");
  assertSbomSubjects(spdx, cycloneDx, imageDigest);
  const gate = evaluateVulnerabilityGate(scan, { now });
  required(gate.decision === "pass", "SUP_VULNERABILITY_GATE_BLOCKED", `image has ${gate.findingCount} blocking findings`);
  const artifacts = {
    spdx: artifactReference(paths.spdx, Buffer.from(`${canonicalJson(spdx)}\n`)),
    cycloneDx: artifactReference(paths.cycloneDx, Buffer.from(`${canonicalJson(cycloneDx)}\n`)),
    vulnerabilityScan: artifactReference(paths.scan, Buffer.from(`${canonicalJson(scan)}\n`)),
    vulnerabilityScanRaw: artifactReference(paths.scanRaw, Buffer.from(`${canonicalJson(rawScan)}\n`)),
  };
  const provenance = createProvenance({ imageName, imageDigest, sourceDigest, dockerfile, builderId, invocationId, startedOn, finishedOn, toolchain, artifacts, artifact: identity, provenanceMode });
  return { schemaVersion: "molit.supply-chain-release/1", artifact: identity, image: { name: imageName, digest: imageDigest }, toolchain, artifacts, vulnerabilityGate: gate, provenance, dsse: signDsse(provenance, privateKeyPem) };
}

export async function verifyReleaseBundle({ bundle, publicKeyPem, artifactDirectory, expectedImageName, expectedImageDigest, expectedSourceDigest, expectedArtifact, now = new Date(), maxAttestationAgeHours = 24 }) {
  required(bundle?.schemaVersion === "molit.supply-chain-release/1", "SUP_BUNDLE_INVALID", "release bundle schema version is invalid");
  exactKeys(bundle, ["schemaVersion", "artifact", "image", "toolchain", "artifacts", "vulnerabilityGate", "provenance", "dsse"]);
  const identity = assertReleaseArtifact(bundle.artifact);
  const expectedIdentity = assertReleaseArtifact(expectedArtifact);
  required(canonicalJson(identity) === canonicalJson(expectedIdentity), "SUP_ARTIFACT_IDENTITY_MISMATCH", "release artifact identity differs from the expected service and runtime class");
  exactKeys(bundle.image, ["name", "digest"]);
  exactKeys(bundle.toolchain, ["baseImage", "buildImage", "sbomGeneratorImage", "scannerImage", "signerImage"]);
  exactKeys(bundle.artifacts, ["spdx", "cycloneDx", "vulnerabilityScan", "vulnerabilityScanRaw"]);
  for (const reference of Object.values(bundle.artifacts)) exactKeys(reference, ["path", "sha256"]);
  exactKeys(bundle.vulnerabilityGate, ["decision", "blockingSeverities", "findingCount", "databaseUpdatedAt", "evaluatedAt"]);
  required(bundle.image?.name === expectedImageName && bundle.image?.digest === expectedImageDigest, "SUP_BUNDLE_SUBJECT_MISMATCH", "release bundle image subject does not match the expected image");
  const statement = verifyDsse(bundle.dsse, publicKeyPem);
  required(canonicalJson(statement) === canonicalJson(bundle.provenance), "SUP_PROVENANCE_ENVELOPE_MISMATCH", "signed provenance differs from the bundle provenance");
  required(canonicalJson(statement.predicate?.buildDefinition?.externalParameters?.artifact) === canonicalJson(identity),
    "SUP_ARTIFACT_PROVENANCE_MISMATCH", "release artifact identity is not bound by signed provenance");
  const provenanceMode = RELEASE_ARTIFACTS[identity.service].provenanceMode;
  const expectedBuildType = provenanceMode === "external-adoption"
    ? "https://data.molit.go.kr/build-types/external-image-adoption/v1"
    : "https://data.molit.go.kr/build-types/source-container/v1";
  required(statement.predicate?.buildDefinition?.externalParameters?.provenanceMode === provenanceMode
    && statement.predicate?.buildDefinition?.buildType === expectedBuildType,
  "SUP_PROVENANCE_MODE_INVALID", "signed provenance mode or build type differs from the runtime class register");
  required(statement.subject?.length === 1 && statement.subject[0].name === expectedImageName && statement.subject[0].digest?.sha256 === expectedImageDigest.slice(7), "SUP_PROVENANCE_SUBJECT_MISMATCH", "provenance subject does not match the expected image");
  const sourceUri = provenanceMode === "external-adoption" ? "git+adoption-policy" : "git+workspace";
  required(statement.predicate?.buildDefinition?.resolvedDependencies?.some((item) => item.uri === sourceUri && item.digest?.sha256 === expectedSourceDigest.slice(7)), "SUP_SOURCE_SUBJECT_MISMATCH", "provenance source digest does not match the expected source");
  for (const image of Object.values(bundle.toolchain ?? {})) {
    assertPinnedImage(image);
    required(statement.predicate?.buildDefinition?.resolvedDependencies?.some((item) => item.uri === image && item.digest?.sha256 === image.split("sha256:")[1]), "SUP_TOOLCHAIN_PROVENANCE_MISMATCH", "toolchain image is missing from signed provenance");
  }
  const byproducts = new Map((statement.predicate?.runDetails?.byproducts ?? []).map((item) => [item.name, item.digest?.sha256]));
  for (const [name, reference] of Object.entries(bundle.artifacts)) required(byproducts.get(name) === reference.sha256, "SUP_ARTIFACT_PROVENANCE_MISMATCH", `${name} artifact is not bound by signed provenance`);
  const finishedOn = Date.parse(statement.predicate?.runDetails?.metadata?.finishedOn);
  required(Number.isFinite(finishedOn) && now.valueOf() - finishedOn >= -300_000 && now.valueOf() - finishedOn <= maxAttestationAgeHours * 3_600_000, "SUP_ATTESTATION_STALE", "attestation is missing, stale, or from the future");
  const loaded = {};
  for (const [name, reference] of Object.entries(bundle.artifacts)) {
    required(basename(reference.path) === reference.path && reference.path.endsWith(".json"), "SUP_ARTIFACT_PATH_INVALID", "artifact reference is not a JSON basename");
    const bytes = await readFile(resolve(artifactDirectory, reference.path));
    required(sha256(bytes) === reference.sha256, "SUP_ARTIFACT_TAMPERED", `${name} artifact digest verification failed`);
    loaded[name] = JSON.parse(bytes.toString("utf8"));
  }
  assertSbomSubjects(loaded.spdx, loaded.cycloneDx, expectedImageDigest);
  required(loaded.vulnerabilityScan.artifactDigest === expectedImageDigest, "SUP_SCAN_SUBJECT_MISMATCH", "scan artifact subject does not match the expected image");
  required(loaded.vulnerabilityScan.scanner?.image === bundle.toolchain?.scannerImage, "SUP_SCANNER_TOOL_MISMATCH", "scan artifact used a different scanner image");
  required(loaded.vulnerabilityScan.rawReportSha256 === sha256(loaded.vulnerabilityScanRaw), "SUP_SCAN_NORMALIZATION_MISMATCH", "normalized scan does not match the signed raw scanner report");
  const gate = evaluateVulnerabilityGate(loaded.vulnerabilityScan, { now });
  required(gate.decision === "pass" && gate.findingCount === bundle.vulnerabilityGate.findingCount && gate.databaseUpdatedAt === bundle.vulnerabilityGate.databaseUpdatedAt
    && canonicalJson(bundle.vulnerabilityGate.blockingSeverities) === canonicalJson(BLOCKING_SEVERITIES), "SUP_GATE_MISMATCH", "vulnerability gate cannot be reproduced from the scan artifact");
  const evaluatedAt = Date.parse(bundle.vulnerabilityGate.evaluatedAt);
  required(Number.isFinite(evaluatedAt) && evaluatedAt <= now.valueOf() + 300_000 && now.valueOf() - evaluatedAt <= maxAttestationAgeHours * 3_600_000, "SUP_GATE_STALE", "vulnerability gate evaluation is missing, stale, or from the future");
  return { verified: true, keyid: bundle.dsse.signatures[0].keyid, artifact: identity, image: bundle.image, artifacts: Object.keys(loaded) };
}

export { BLOCKING_SEVERITIES, canonicalJson };
