import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Parser, Store } from "n3";
import {
  blockedClaimsInMarkdown,
  rawHtmlFindings,
} from "../../tools/claims/blocked-claim-gate.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const [
  schema,
  register,
  sourceRegisterText,
  crsVocabularyText,
  claimMatrixText,
] = await Promise.all([
  readFile(path.join(root, "contracts/korean-interoperability-register.v1.schema.json"), "utf8")
    .then(JSON.parse),
  readFile(path.join(root, "standards/korean-interoperability-register.json"), "utf8")
    .then(JSON.parse),
  readFile(path.join(root, "evidence/source-register.yaml"), "utf8"),
  readFile(path.join(
    root,
    "profiles/molit-dcat-ap/releases/1.0.0-rc.1/vocabulary/ogc-crs-allowlist.ttl",
  ), "utf8"),
  readFile(path.join(root, "evidence/claim-evidence-matrix.md"), "utf8"),
]);
const currentCrsSnapshotPaths = [...new Set(
  register.referenceSystems.map(({ snapshotManifest }) => snapshotManifest),
)];
assert.equal(currentCrsSnapshotPaths.length, 1, "one current CRS snapshot is required");
const currentCrsSnapshotPath = currentCrsSnapshotPaths[0];
const crsSnapshotManifest = JSON.parse(await readFile(
  path.join(root, ...currentCrsSnapshotPath.split("/")),
  "utf8",
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateRegister = ajv.compile(schema);

// These reviewed digests are deliberately outside the mutable evidence register.
// Changing an allowlist, lifecycle decision or release-blocking disposition requires
// an explicit test-baseline review; equality between two edited data files is insufficient.
const REVIEWED_STANDARD_LIFECYCLE_SHA256 =
  "78abc11ebf434cdcda8c1c413749e008af307f5f382b8a1b01cfa9e7158a5770";
const REVIEWED_CLAIM_POLICY_SHA256 =
  "e09094aa7089c005896a9ad1546b9b43d77190aca3e8ec2a8d97d9cd5542a44e";
const REVIEWED_CRS_ALLOWLIST_SHA256 =
  "caf29dd5aa995e6800cbb5195ba68d2512b5d9445eddd7b9eddac4d47ece1de3";
const REVIEWED_BLINDSPOT_POLICY_SHA256 =
  "e93cf963ceee1d5d90d81588474353b2d45c92d9652fa9c2eedefd2b5ad9ade3";
const REVIEWED_BLINDSPOT_RECORDS_SHA256 =
  "2a6a73f51b57ea146395f5e85ff22e9b68bcf7aed45496c78058609b8d5990e4";
const REVIEWED_NONBLOCKING_DECISIONS_SHA256 =
  "c4fc53153eb44952a30965f75620257e82206b1a3087c9753c3fcaa29e15714d";

function sortedById(values) {
  return [...values].sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ));
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => (
      [key, canonicalJsonValue(value[key])]
    )));
  }
  return value;
}

function jsonDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalJsonValue(value))).digest("hex");
}

function standardLifecycleDigest(candidate) {
  return jsonDigest({ asOf: candidate.asOf, standards: sortedById(candidate.standards) });
}

function crsAllowlistDigest(candidate) {
  const records = candidate.referenceSystems.map((record) => ({ id: record.iri, ...record }));
  const referenceSystems = sortedById(records).map(({ id: _id, ...record }) => record);
  return jsonDigest({ asOf: candidate.asOf, referenceSystems });
}

function blindspotPolicyDigest(blindspots) {
  return jsonDigest(sortedById(blindspots.map(({ id, severity, releaseGateRequired }) => ({
    id,
    severity,
    releaseGateRequired,
  }))));
}

function nonblockingDecisionDigest(blindspots) {
  return jsonDigest(sortedById(blindspots
    .filter((item) => !item.currentlyBlocksRelease)
    .map(({ id, status, evidence, releaseGateRequired, currentlyBlocksRelease }) => ({
      id,
      status,
      evidence,
      releaseGateRequired,
      currentlyBlocksRelease,
    }))));
}

function blindspotRecordsDigest(blindspots) {
  return jsonDigest(sortedById(blindspots));
}

function unique(values) {
  return new Set(values).size === values.length;
}

function parseSourceRegister(text) {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === "sources:");
  assert.ok(start >= 0, "source register has no sources section");
  const entries = [];
  let current;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const entryMatch = /^  - id: ("(?:[^"\\]|\\.)+")$/u.exec(line);
    if (entryMatch) {
      current = { id: JSON.parse(entryMatch[1]) };
      entries.push(current);
      continue;
    }
    const propertyMatch = /^    ([a-z][a-z0-9_]*): (.+)$/u.exec(line);
    assert.ok(propertyMatch && current, `unsupported source-register YAML at line ${index + 1}`);
    const [, key, encodedValue] = propertyMatch;
    assert.equal(Object.hasOwn(current, key), false, `duplicate ${key} at line ${index + 1}`);
    assert.doesNotThrow(() => JSON.parse(encodedValue), `non-JSON scalar at line ${index + 1}`);
    current[key] = JSON.parse(encodedValue);
  }
  const required = [
    "id",
    "title",
    "authority",
    "type",
    "version_or_effective_date",
    "checked_on",
    "status",
    "supports",
    "notes",
  ];
  assert.ok(entries.length > 0);
  assert.ok(unique(entries.map((entry) => entry.id)), "duplicate source evidence ID");
  for (const entry of entries) {
    for (const field of required) assert.ok(Object.hasOwn(entry, field), `${entry.id}.${field}`);
    assert.ok(Object.hasOwn(entry, "url") || Object.hasOwn(entry, "artifact"), entry.id);
  }
  return entries;
}

async function matchingFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const itemPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await matchingFiles(itemPath, predicate));
    else if (entry.isFile() && predicate(entry.name)) files.push(itemPath);
  }
  return files;
}

async function markdownFiles(directory) {
  return matchingFiles(directory, (name) => /[.]md$/iu.test(name));
}

function blockedClaimsIn(value) {
  return blockedClaimsInMarkdown(value, register.claimPolicy.blockedClaimPatterns);
}

const evidencePathRoots = new Set([
  "contracts",
  "docs",
  "fixtures",
  "profiles",
  "src",
  "tests",
  "tools",
]);

function portableEvidencePathSegments(relativePath) {
  assert.equal(typeof relativePath, "string", "evidence path must be a string");
  assert.ok(relativePath.length > 0, "evidence path must not be empty");
  assert.equal(relativePath.includes("\\"), false, "evidence path must use forward slashes");
  assert.equal(relativePath.includes(":"), false, "evidence path must not contain a colon");
  assert.equal(path.posix.isAbsolute(relativePath), false, "evidence path must be relative");
  const segments = relativePath.split("/");
  assert.ok(segments.length > 1, "evidence path must name a file below an allowed root");
  assert.ok(evidencePathRoots.has(segments[0]), "evidence path root is not allowed");
  assert.ok(
    segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "evidence path contains an empty or dot segment",
  );
  return segments;
}

function sameFilesystemPath(left, right) {
  const normalize = (value) => {
    const normalized = path.normalize(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}

async function checkedEvidenceFile(relativePath) {
  const segments = portableEvidencePathSegments(relativePath);
  const resolved = path.resolve(root, ...segments);
  const rootRelative = path.relative(root, resolved);
  assert.ok(
    rootRelative !== "" && rootRelative !== ".."
      && !rootRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(rootRelative),
    "evidence path resolves outside the project root",
  );
  const canonicalRoot = await realpath(root);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const item = await lstat(current);
    assert.equal(item.isSymbolicLink(), false, `${relativePath}: symbolic link or junction rejected`);
    const canonical = await realpath(current);
    const expectedCanonical = path.resolve(canonicalRoot, ...segments.slice(0, index + 1));
    assert.ok(
      sameFilesystemPath(canonical, expectedCanonical),
      `${relativePath}: reparse-point resolution rejected`,
    );
    if (index === segments.length - 1) {
      assert.ok(item.isFile(), `${relativePath}: final path is not a regular file`);
    } else {
      assert.ok(item.isDirectory(), `${relativePath}: intermediate component is not a directory`);
    }
  }
  return resolved;
}

function temporalOrderErrors(candidate) {
  const errors = [];
  const asOf = Date.parse(`${candidate.asOf}T00:00:00Z`);
  for (const item of candidate.standards) {
    const observed = Date.parse(`${item.statusObservedAt}T00:00:00Z`);
    if (observed > asOf) errors.push(`${item.id}: statusObservedAt > asOf`);
    if (item.statusEventDate !== null) {
      const event = Date.parse(`${item.statusEventDate}T00:00:00Z`);
      if (event > observed) errors.push(`${item.id}: statusEventDate > statusObservedAt`);
    }
  }
  return errors;
}

function standardLifecycleErrors(candidateRegister, candidateSources) {
  const errors = [];
  const candidateSourcesById = new Map(candidateSources.map((source) => [source.id, source]));
  const candidateStandardsById = new Map(
    candidateRegister.standards.map((standard) => [standard.id, standard]),
  );
  const expectedFields = new Map([
    ["lifecycle_subject_id", "id"],
    ["lifecycle_status", "status"],
    ["status_event_type", "statusEventType"],
    ["status_event_date", "statusEventDate"],
    ["status_observed_at", "statusObservedAt"],
  ]);
  for (const standard of candidateRegister.standards) {
    const primarySources = standard.sourceIds.map((id) => candidateSourcesById.get(id))
      .filter((source) => source?.url === standard.officialUrl);
    if (primarySources.length !== 1) {
      errors.push(`${standard.id}: expected one official lifecycle source`);
      continue;
    }
    const [source] = primarySources;
    for (const [sourceField, standardField] of expectedFields) {
      if (!Object.hasOwn(source, sourceField)) {
        errors.push(`${source.id}: missing ${sourceField}`);
      } else if (source[sourceField] !== standard[standardField]) {
        errors.push(`${source.id}.${sourceField} != ${standard.id}.${standardField}`);
      }
    }
    if (source.checked_on !== standard.statusObservedAt) {
      errors.push(`${source.id}.checked_on != ${standard.id}.statusObservedAt`);
    }
  }
  for (const source of candidateSources.filter((item) => (
    Object.hasOwn(item, "lifecycle_subject_id")
  ))) {
    const standard = candidateStandardsById.get(source.lifecycle_subject_id);
    if (!standard || !standard.sourceIds.includes(source.id) || source.url !== standard.officialUrl) {
      errors.push(`${source.id}: orphan or non-primary lifecycle provenance`);
    }
  }
  return errors;
}

function snapshotSourceErrors(candidateRegister, candidateSources) {
  const errors = [];
  const candidateSourcesById = new Map(candidateSources.map((source) => [source.id, source]));
  const expectedFields = new Map([
    ["artifact_path", "path"],
    ["retrieved_at", "retrievedAt"],
    ["sha256", "sha256"],
    ["disposition", "expectedDisposition"],
    ["bytes", "bytes"],
    ["content_type", "responseContentType"],
  ]);
  for (const snapshot of candidateRegister.snapshots) {
    const primarySources = snapshot.sourceIds.map((id) => candidateSourcesById.get(id))
      .filter((source) => source?.url === snapshot.sourceUrl);
    if (primarySources.length !== 1) {
      errors.push(`${snapshot.id}: expected one snapshot provenance source`);
      continue;
    }
    const [source] = primarySources;
    for (const [sourceField, snapshotField] of expectedFields) {
      if (!Object.hasOwn(source, sourceField)) {
        errors.push(`${source.id}: missing ${sourceField}`);
      } else if (source[sourceField] !== snapshot[snapshotField]) {
        errors.push(`${source.id}.${sourceField} != ${snapshot.id}.${snapshotField}`);
      }
    }
  }
  return errors;
}

function crsConsistencyErrors(referenceSystems, store) {
  const errors = [];
  const labelPredicate = "http://www.w3.org/2004/02/skos/core#prefLabel";
  for (const item of referenceSystems) {
    if (item.officialUrl !== item.iri.replace(/^http:/u, "https:")) {
      errors.push(`${item.iri}: officialUrl is not the HTTPS form of iri`);
    }
    const components = new URL(item.iri).pathname.split("/").filter(Boolean);
    const [definition, crs, authority, version, code] = components;
    if (definition !== "def" || crs !== "crs" || components.length !== 5) {
      errors.push(`${item.iri}: unexpected OGC CRS path`);
    }
    if (authority !== item.authority) errors.push(`${item.iri}: authority mismatch`);
    if (code !== item.code) errors.push(`${item.iri}: code mismatch`);
    if ((authority === "EPSG" && version !== "0")
      || (authority === "OGC" && version !== "1.3")) {
      errors.push(`${item.iri}: authority version mismatch`);
    }
    const englishLabels = store.getObjects(item.iri, labelPredicate, null)
      .filter((term) => term.language === "en");
    if (englishLabels.length !== 1 || englishLabels[0].value !== item.label) {
      errors.push(`${item.iri}: English prefLabel mismatch`);
    }
  }
  return errors;
}

function registerStringLosses(value, location = []) {
  const findings = [];
  if (typeof value === "string") {
    const field = String(location.at(-1) ?? "");
    const isUrl = field.endsWith("Url") || /^https?:\/\//u.test(value);
    if (value.includes("\uFFFD")) findings.push(`${location.join(".")}: replacement character`);
    if (!isUrl && /(?:\?\s*){2,}/u.test(value)) {
      findings.push(`${location.join(".")}: repeated question-mark loss pattern`);
    }
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...registerStringLosses(item, [...location, index])));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      findings.push(...registerStringLosses(item, [...location, key]));
    });
  }
  return findings;
}

const sourceRegister = parseSourceRegister(sourceRegisterText);
const sourcesById = new Map(sourceRegister.map((source) => [source.id, source]));

test("CT-KR-STD-001: domestic interoperability evidence satisfies its contract", () => {
  assert.equal(validateRegister(register), true, JSON.stringify(validateRegister.errors, null, 2));
  assert.ok(unique(register.standards.map((item) => item.id)));
  assert.ok(unique(register.snapshots.map((item) => item.id)));
  assert.ok(unique(register.blindspots.map((item) => item.id)));
  assert.equal(register.claimPolicy.institutionalConformanceAllowed, false);
});

test("CT-KR-STD-002: retired and untested standards cannot authorize a conformance claim", () => {
  assert.ok(register.standards.every((item) => item.conformanceClaimAllowed === false));
  assert.ok(register.standards
    .filter((item) => item.status === "retired")
    .every((item) => item.normativeUse === "prohibited"));
  assert.ok(register.standards
    .filter((item) => item.crosswalkEvidence === "clause-crosswalk-blocked")
    .every((item) => item.blockers.length > 0));

  const requiredCurrent = new Set([
    "KS-X-ISO-19115-1",
    "KS-X-ISO-19115-2",
    "KS-X-ISO-19115-3",
    "KS-X-ISO-19157-1",
    "KS-X-ISO-19157",
    "KS-X-ISO-TS-19157-2",
    "KS-X-ISO-TS-19139-1",
    "KS-X-ISO-19119",
    "KS-X-ISO-19136-1",
    "KS-X-ISO-19136-2",
    "TTAK.OT-10.1406",
    "TTAK.KO-10.1422",
    "TTAK.KO-10.1510-Part3",
    "TTAK.KO-10.1557",
  ]);
  const byId = new Map(register.standards.map((item) => [item.id, item]));
  for (const id of requiredCurrent) assert.equal(byId.get(id)?.status, "current", id);
  assert.equal(byId.get("KS-X-ISO-19136")?.normativeUse, "prohibited");
  assert.equal(byId.get("KS-X-ISO-19139")?.normativeUse, "prohibited");
  assert.equal(byId.get("TTAS.KO-10.0139-R1")?.status, "confirmation-required");
  assert.deepEqual(temporalOrderErrors(register), []);
});

test("CT-KR-STD-003: every evidence ID is registered", () => {
  const known = new Set(sourceRegister.map((source) => source.id));
  const referenced = [
    ...register.standards.flatMap((item) => item.sourceIds),
    ...register.referenceSystems.flatMap((item) => item.sourceIds),
    ...register.snapshots.flatMap((item) => item.sourceIds),
    ...register.blindspots.flatMap((item) => item.evidence
      .filter((evidence) => evidence.kind === "source-id")
      .map((evidence) => evidence.value)),
  ];
  assert.deepEqual([...new Set(referenced.filter((id) => !known.has(id)))], []);
  const knownClaims = new Set([...claimMatrixText.matchAll(/^\| (C-[0-9]{3}) \|/gmu)]
    .map((match) => match[1]));
  const unknownClaims = sourceRegister.flatMap((source) => source.supports
    .filter((claimId) => !knownClaims.has(claimId))
    .map((claimId) => `${source.id}:${claimId}`));
  assert.deepEqual(unknownClaims, []);
  assert.ok(sourceRegister.every((source) => source.checked_on <= register.asOf));
  for (const item of [...register.standards, ...register.referenceSystems]) {
    assert.ok(
      item.sourceIds.some((id) => sourcesById.get(id)?.url === item.officialUrl),
      `${item.id ?? item.iri}: no source entry matches officialUrl`,
    );
    for (const sourceId of item.sourceIds) {
      assert.equal(
        sourcesById.get(sourceId)?.checked_on,
        item.statusObservedAt,
        `${item.id ?? item.iri}: ${sourceId}.checked_on != statusObservedAt`,
      );
    }
  }
  for (const snapshot of register.snapshots) {
    assert.ok(
      snapshot.sourceIds.some((id) => sourcesById.get(id)?.url === snapshot.sourceUrl),
      `${snapshot.id}: no source entry matches sourceUrl`,
    );
  }
  assert.deepEqual(standardLifecycleErrors(register, sourceRegister), []);
  assert.deepEqual(snapshotSourceErrors(register, sourceRegister), []);
});

test("CT-KR-STD-004: status combinations and event chronology fail closed", () => {
  const mutations = [
    (candidate) => {
      candidate.standards.find((item) => item.status === "current").statusEvidence =
        "official-retirement-verified";
    },
    (candidate) => {
      candidate.standards.find((item) => item.status === "retired").normativeUse =
        "allowed-reference";
    },
    (candidate) => {
      candidate.standards.find((item) => item.status === "confirmation-required").statusEvidence =
        "official-metadata-verified";
    },
    (candidate) => {
      candidate.standards.find((item) => item.status === "current").statusEventType = "retired";
    },
    (candidate) => {
      candidate.standards.find((item) => item.status === "confirmation-required").statusEventType =
        "retired";
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(register);
    mutate(candidate);
    assert.equal(validateRegister(candidate), false, JSON.stringify(candidate.standards, null, 2));
  }
  const futureEvent = structuredClone(register);
  futureEvent.standards[0].statusEventDate = "2026-07-13";
  assert.ok(temporalOrderErrors(futureEvent).length > 0);
  const futureObservation = structuredClone(register);
  futureObservation.standards[0].statusObservedAt = "2026-07-13";
  assert.ok(temporalOrderErrors(futureObservation).length > 0);
});

test("CT-KR-STD-005: official source lifecycle provenance rejects status forgery", () => {
  const retiredAsCurrent = structuredClone(register);
  Object.assign(
    retiredAsCurrent.standards.find((item) => item.id === "TTAS.KO-10.0157"),
    {
      status: "current",
      statusEvidence: "official-metadata-verified",
      statusEventType: "confirmed",
      statusEventDate: "2026-07-12",
      normativeUse: "pending-review",
    },
  );
  assert.equal(validateRegister(retiredAsCurrent), true);
  assert.ok(standardLifecycleErrors(retiredAsCurrent, sourceRegister).length > 0);

  const currentAsConfirmationRequired = structuredClone(register);
  Object.assign(
    currentAsConfirmationRequired.standards.find((item) => item.id === "KS-X-ISO-19115-1"),
    {
      status: "confirmation-required",
      statusEvidence: "status-confirmation-required",
      normativeUse: "pending-review",
    },
  );
  assert.equal(validateRegister(currentAsConfirmationRequired), true);
  assert.ok(standardLifecycleErrors(currentAsConfirmationRequired, sourceRegister).length > 0);

  const changedAdministrativeEvent = structuredClone(register);
  changedAdministrativeEvent.standards
    .find((item) => item.id === "MOIS-NOTICE-2025-19").statusEventType = "revised";
  assert.equal(validateRegister(changedAdministrativeEvent), true);
  assert.ok(standardLifecycleErrors(changedAdministrativeEvent, sourceRegister).length > 0);

  const omittedLifecycle = structuredClone(sourceRegister);
  delete omittedLifecycle.find((source) => source.id === "SRC-STD-003").lifecycle_status;
  assert.ok(standardLifecycleErrors(register, omittedLifecycle).length > 0);

  const forgedLifecycle = structuredClone(sourceRegister);
  forgedLifecycle.find((source) => source.id === "SRC-STD-019").lifecycle_status = "current";
  assert.ok(standardLifecycleErrors(register, forgedLifecycle).length > 0);

  const coordinatedRegister = structuredClone(register);
  Object.assign(
    coordinatedRegister.standards.find((item) => item.id === "TTAS.KO-10.0157"),
    {
      status: "current",
      statusEvidence: "official-metadata-verified",
      statusEventType: "confirmed",
      statusEventDate: "2026-07-12",
      normativeUse: "pending-review",
    },
  );
  const coordinatedSources = structuredClone(sourceRegister);
  Object.assign(
    coordinatedSources.find((source) => source.id === "SRC-STD-019"),
    {
      lifecycle_status: "current",
      status_event_type: "confirmed",
      status_event_date: "2026-07-12",
    },
  );
  assert.deepEqual(standardLifecycleErrors(coordinatedRegister, coordinatedSources), []);
  assert.notEqual(
    standardLifecycleDigest(coordinatedRegister),
    REVIEWED_STANDARD_LIFECYCLE_SHA256,
  );
});

test("CT-KR-STD-006: lifecycle decisions match the separately reviewed baseline", () => {
  assert.equal(standardLifecycleDigest(register), REVIEWED_STANDARD_LIFECYCLE_SHA256);
});

test("CT-KR-TEXT-001: human-readable register strings reject encoding-loss markers", () => {
  assert.deepEqual(registerStringLosses(register), []);
  const candidate = structuredClone(register);
  candidate.standards[0].title = "???? ????";
  assert.ok(registerStringLosses(candidate).length > 0);
  candidate.standards[0].title = "\uFFFD";
  assert.ok(registerStringLosses(candidate).length > 0);
});

test("CT-KR-CRS-001: every source-reference CRS has official evidence and RDF support", () => {
  const store = new Store(new Parser().parse(crsVocabularyText));
  const supported = store.getSubjects(
    "http://purl.org/dc/terms/type",
    "http://inspire.ec.europa.eu/glossary/SpatialReferenceSystem",
    null,
  ).map((term) => term.value).sort();
  const registered = register.referenceSystems.map((item) => item.iri).sort();
  assert.ok(registered.every((iri) => supported.includes(iri)));
  assert.deepEqual(supported.filter((iri) => !registered.includes(iri)), [
    "http://www.opengis.net/def/crs/EPSG/0/3857",
    "http://www.opengis.net/def/crs/EPSG/0/4326",
  ]);
  assert.ok(register.referenceSystems.every((item) => item.profileUses.includes("source-reference")));
  assert.ok(register.referenceSystems.every((item) => item.sourceIds.every((id) => id.startsWith("SRC-CRS-"))));
  assert.ok(register.referenceSystems.every((item) => (
    item.evidenceLevel === "content-addressed-offline-snapshot"
  )));
  assert.ok(register.referenceSystems.every((item) => item.contentAddressed === true));
  assert.ok(register.referenceSystems.every((item) => (
    item.snapshotManifest === currentCrsSnapshotPath
      && /^[a-f0-9]{64}$/u.test(item.snapshotSha256)
  )));
  const snapshotsByIri = new Map(crsSnapshotManifest.artifacts.map((item) => (
    [item.canonicalIri, item]
  )));
  assert.ok(register.referenceSystems.every((item) => {
    const snapshot = snapshotsByIri.get(item.iri);
    return snapshot?.id === item.snapshotArtifactId
      && snapshot?.sha256 === item.snapshotSha256
      && snapshot?.sourceUrl === item.officialUrl;
  }));
  assert.deepEqual(crsConsistencyErrors(register.referenceSystems, store), []);
  assert.equal(crsAllowlistDigest(register), REVIEWED_CRS_ALLOWLIST_SHA256);
});

test("CT-KR-CRS-002: authority, code and local prefLabel mutations fail closed", () => {
  const store = new Store(new Parser().parse(crsVocabularyText));
  const mutations = [
    (candidate) => {
      candidate.find((item) => item.authority === "EPSG").authority = "OGC";
    },
    (candidate) => {
      candidate.find((item) => item.authority === "EPSG").code = "9999";
    },
    (candidate) => {
      candidate[0].label = "forged CRS label";
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(register.referenceSystems);
    mutate(candidate);
    assert.ok(crsConsistencyErrors(candidate, store).length > 0);
  }

  const coordinatedCandidate = structuredClone(register);
  Object.assign(coordinatedCandidate.referenceSystems.find((item) => item.authority === "EPSG"), {
    iri: "http://www.opengis.net/def/crs/EPSG/0/9999",
    code: "9999",
    label: "forged coordinated CRS",
    officialUrl: "https://www.opengis.net/def/crs/EPSG/0/9999",
  });
  assert.notEqual(crsAllowlistDigest(coordinatedCandidate), REVIEWED_CRS_ALLOWLIST_SHA256);

  const expandedGeometryUse = structuredClone(register);
  expandedGeometryUse.referenceSystems
    .find((item) => item.code === "5186").profileUses.push("geometry-literal");
  assert.equal(validateRegister(expandedGeometryUse), true);
  assert.notEqual(crsAllowlistDigest(expandedGeometryUse), REVIEWED_CRS_ALLOWLIST_SHA256);

  const shiftedObservation = structuredClone(register);
  shiftedObservation.asOf = "2026-07-13";
  shiftedObservation.referenceSystems.forEach((item) => {
    item.statusObservedAt = "2026-07-13";
  });
  assert.equal(validateRegister(shiftedObservation), true);
  assert.notEqual(crsAllowlistDigest(shiftedObservation), REVIEWED_CRS_ALLOWLIST_SHA256);
});

test("PDP-REAL-001: the public-portal golden-negative is content addressed and offline", async () => {
  for (const snapshot of register.snapshots) {
    const bytes = await readFile(path.join(root, snapshot.path));
    assert.equal(bytes.length, snapshot.bytes, snapshot.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), snapshot.sha256, snapshot.id);
    assert.equal(snapshot.expectedDisposition, "quarantine");
    assert.equal(snapshot.liveFetchInCi, false);
    assert.ok(snapshot.expectedShaclResults > 0);
    assert.ok(unique(snapshot.observations.map((item) => item.code)), snapshot.id);
  }
  assert.deepEqual(snapshotSourceErrors(register, sourceRegister), []);
});

test("PDP-SOURCE-001: snapshot source provenance mutations fail closed", () => {
  const sourceMutations = new Map([
    ["artifact_path", "fixtures/interoperability/other.rdf"],
    ["retrieved_at", "2026-07-12T09:08:00Z"],
    ["sha256", "0".repeat(64)],
    ["disposition", "publish"],
    ["bytes", 2266],
    ["content_type", "text/turtle"],
  ]);
  for (const [field, value] of sourceMutations) {
    const candidateSources = structuredClone(sourceRegister);
    candidateSources.find((source) => source.id === "SRC-KR-003")[field] = value;
    assert.ok(snapshotSourceErrors(register, candidateSources).length > 0, field);
  }
  const candidateRegister = structuredClone(register);
  candidateRegister.snapshots[0].path = "fixtures/interoperability/other.rdf";
  assert.ok(snapshotSourceErrors(candidateRegister, sourceRegister).length > 0);
});

test("PDP-REAL-002: portal observations separate syntax, conformance, profile and mapping work", () => {
  const expected = new Map([
    ["PDP-LANG-KR", "adapter-normalization"],
    ["PDP-XSD-DATE-LEXICAL", "datatype-lexical-error"],
    ["PDP-LITERAL-THEME", "dcat-ap-conformance-error"],
    ["PDP-LITERAL-FREQUENCY", "dcat-ap-conformance-error"],
    ["PDP-WRONG-FORMAT-PREDICATE", "adapter-normalization"],
    ["PDP-EMPTY-MEDIA-TYPE", "dcat-ap-conformance-error"],
    ["PDP-BLANK-PUBLISHER", "enrichment-required"],
    ["PDP-BLANK-CATALOG", "enrichment-required"],
    ["PDP-COMBINED-KEYWORDS", "adapter-normalization"],
    ["PDP-PROFILE-MARKER-MISSING", "molit-profile-requirement"],
  ]);
  const actual = new Map(register.snapshots[0].observations
    .map((item) => [item.code, item.category]));
  assert.deepEqual(actual, expected);
});

test("CT-KR-CLAIM-001: blocked public claim strings are an executable documentation Gate", async () => {
  assert.equal(jsonDigest(register.claimPolicy), REVIEWED_CLAIM_POLICY_SHA256);
  const files = [path.join(root, "README.md")];
  files.push(...await markdownFiles(path.join(root, "docs")));
  files.push(...await markdownFiles(path.join(root, "evidence")));
  files.push(...await markdownFiles(path.join(root, "profiles")));
  files.push(...await markdownFiles(path.join(root, "templates")));
  const violations = [];
  for (const file of new Set(files)) {
    const content = await readFile(file, "utf8");
    for (const pattern of blockedClaimsIn(content)) {
      violations.push(`${path.relative(root, file)}: ${pattern}`);
    }
    for (const finding of rawHtmlFindings(content)) {
      violations.push(`${path.relative(root, file)}: raw HTML is prohibited: ${finding}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("CT-KR-CLAIM-002: rendered Markdown, HTML and Unicode cannot evade the claim Gate", () => {
  const mutations = new Map([
    ["KS **적합**", "KS 적합"],
    ["KS\n적합", "KS 적합"],
    ["KS에 적합", "KS 적합"],
    ["KS에는 적합", "KS 적합"],
    ["KS에도 적합", "KS 적합"],
    ["KS으로는 적합", "KS 적합"],
    ["KS 에 적합", "KS 적합"],
    ["KS&#x2009;에 적합", "KS 적합"],
    ["KS-적합", "KS 적합"],
    ["KS·적합", "KS 적합"],
    ["KS－적합", "KS 적합"],
    ["KS-에 적합", "KS 적합"],
    ["KS·에 적합", "KS 적합"],
    ["KS(에) 적합", "KS 적합"],
    ["KS-에는 적합", "KS 적합"],
    ["KS✅적합", "KS 적합"],
    ["KS® 적합", "KS 적합"],
    ["K\u0301S 적합", "KS 적합"],
    ["K\u0000S 적합", "KS 적합"],
    ["KS &#51201;&#54633;", "KS 적합"],
    ["KS&nbsp;적합", "KS 적합"],
    ["KS<!--comment-->적합", "KS 적합"],
    ["[KS](https://example.invalid) 적합", "KS 적합"],
    ["KS<span></span>적합", "KS 적합"],
    ["K\u2060S 적합", "KS 적합"],
    ["ＫＳ 적합", "KS 적합"],
    ["kS CoMpLiAnT", "KS compliant"],
    ["KS를 준수", "KS 준수"],
    ["KS에 부합", "KS 부합"],
    ["KS와 호환", "KS 호환"],
    ["conforms-to-KS", "conforms to KS"],
    ["COMPLIANT WITH KS", "compliant with KS"],
    ["KS-CONFORMANT", "KS conformant"],
    ["FULLY INTEROPERABLE WITH KOREAN INSTITUTIONAL METADATA", "fully interoperable with Korean institutional metadata"],
    ["LOSSLESS ISO 19115 ROUND-TRIP", "lossless ISO 19115 round-trip"],
    ["LOSSLESS ISO 19157 ROUND-TRIP", "lossless ISO 19157 round-trip"],
    ["FULLY COMPATIBLE WITH DATA.GO.KR", "fully compatible with data.go.kr"],
  ]);
  for (const [mutation, expectedPattern] of mutations) {
    assert.ok(blockedClaimsIn(mutation).includes(expectedPattern), mutation);
  }
});

test("CT-KR-CLAIM-003: public Markdown rejects raw HTML rendering paths", () => {
  const unsafe = [
    "<span>KS compliant</span>",
    "<input value=\"KS compliant\">",
    "<input placeholder=\"KS compliant\">",
    "<iframe srcdoc=\"KS compliant\"></iframe>",
    "<style>body::before { content: 'KS compliant'; }</style>",
    "<script>document.write('KS compliant')</script>",
    "<object data=\"claim.html\"></object>",
    "K<span hidden>X</span>S 적합",
    "<!--safe--><input value=\"KS compliant\"><!--x-->",
    "<!--safe--><style>body:before { content: 'KS compliant'; }</style><!--x-->",
  ];
  for (const source of unsafe) assert.ok(rawHtmlFindings(source).length > 0, source);
  assert.deepEqual(rawHtmlFindings("KS<!-- editorial note -->적합"), []);
});

test("CT-KR-CLAIM-004: the reviewed claim policy cannot be silently weakened", () => {
  const weakened = structuredClone(register.claimPolicy);
  weakened.blockedClaimPatterns = weakened.blockedClaimPatterns.filter((pattern) => (
    pattern !== "KS 호환" && pattern !== "KS conformant"
  ));
  assert.ok(weakened.blockedClaimPatterns.length >= 10);
  assert.notEqual(jsonDigest(weakened), REVIEWED_CLAIM_POLICY_SHA256);
});

test("CT-KR-CLAIM-005: Markdown discovery is case-insensitive", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-claim-discovery-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(path.join(directory, "claim.MD"), "KS compliant", "utf8");
  await writeFile(path.join(directory, "ignored.txt"), "KS compliant", "utf8");
  const discovered = await markdownFiles(directory);
  assert.deepEqual(discovered.map((file) => path.basename(file)), ["claim.MD"]);
  assert.ok(blockedClaimsIn(await readFile(discovered[0], "utf8")).includes("KS compliant"));
});

test("CT-KR-BLINDSPOT-001: every unresolved P0 issue remains a release gate", () => {
  const unresolvedP0 = register.blindspots.filter((item) => (
    item.severity === "P0" && item.status !== "fixed" && item.status !== "not-applicable"
  ));
  assert.ok(unresolvedP0.length >= 5);
  assert.ok(unresolvedP0.every((item) => item.releaseGateRequired));
  assert.ok(unresolvedP0.every((item) => item.currentlyBlocksRelease));
  assert.ok(register.blindspots.every((item) => (
    item.currentlyBlocksRelease === (
      item.releaseGateRequired && item.status !== "fixed" && item.status !== "not-applicable"
    )
  )));
  assert.equal(blindspotPolicyDigest(register.blindspots), REVIEWED_BLINDSPOT_POLICY_SHA256);
  assert.equal(blindspotRecordsDigest(register.blindspots), REVIEWED_BLINDSPOT_RECORDS_SHA256);
  assert.equal(
    nonblockingDecisionDigest(register.blindspots),
    REVIEWED_NONBLOCKING_DECISIONS_SHA256,
  );
});

test("CT-KR-BLINDSPOT-002: release-gate policy and current blocking state fail closed", () => {
  const mutations = [
    (candidate) => {
      candidate.blindspots.find((item) => item.status === "fixed").currentlyBlocksRelease = true;
    },
    (candidate) => {
      candidate.blindspots.find((item) => (
        item.status === "open" && item.releaseGateRequired
      )).currentlyBlocksRelease = false;
    },
    (candidate) => {
      candidate.blindspots.find((item) => (
        item.status === "open" && !item.releaseGateRequired
      )).currentlyBlocksRelease = true;
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(register);
    mutate(candidate);
    assert.equal(validateRegister(candidate), false);
  }
});

test("CT-KR-BLINDSPOT-003: repository evidence paths stay below real directories", async () => {
  const pathReferences = register.blindspots.flatMap((item) => item.evidence)
    .filter((evidence) => evidence.kind === "repository-file")
    .map((evidence) => evidence.path);
  assert.ok(pathReferences.length > 0);
  for (const relativePath of pathReferences) {
    const checkedPath = await checkedEvidenceFile(relativePath);
    await assert.doesNotReject(() => readFile(checkedPath), relativePath);
  }
  assert.throws(
    () => portableEvidencePathSegments("src/../../README.md"),
    /empty or dot segment/u,
  );
  assert.throws(() => portableEvidencePathSegments("C:/Windows/win.ini"), /colon/u);
  assert.throws(() => portableEvidencePathSegments("src\\profile\\file.mjs"), /forward slashes/u);
  assert.throws(() => portableEvidencePathSegments("//server/share/file"), /relative/u);

  const sourceEvidence = register.blindspots.flatMap((item) => item.evidence)
    .filter((evidence) => evidence.kind === "source-id");
  assert.ok(sourceEvidence.every((evidence) => sourcesById.has(evidence.value)));

  const controls = register.blindspots.flatMap((item) => item.evidence)
    .filter((evidence) => evidence.kind === "control-id");
  const testFiles = await matchingFiles(path.join(root, "tests"), (name) => (
    name.endsWith(".mjs") || name.endsWith(".js") || name.endsWith(".py")
  ));
  const testCorpus = (await Promise.all(testFiles.map((file) => readFile(file, "utf8")))).join("\n");
  const documentationFiles = await markdownFiles(path.join(root, "docs"));
  const documentationCorpus = (await Promise.all(
    documentationFiles.map((file) => readFile(file, "utf8")),
  )).join("\n");
  for (const control of controls) {
    if (control.status === "implemented") assert.ok(testCorpus.includes(control.value), control.value);
    if (control.status === "open") assert.ok(documentationCorpus.includes(control.value), control.value);
    if (control.status === "reference") {
      assert.ok(register.standards.some((standard) => standard.id === control.value), control.value);
    }
  }
});

test("CT-KR-BLINDSPOT-004: evidence kinds cannot disguise paths or identifiers", () => {
  const invalidEvidence = [
    { kind: "repository-file", path: "src/../../README.md" },
    { kind: "repository-file", path: "src\\profile\\file.mjs" },
    { kind: "repository-file", path: "C:/Windows/win.ini" },
    { kind: "repository-file", path: "//server/share/file" },
    { kind: "repository-file", path: "file:///tmp/file" },
    { kind: "repository-file", path: "Src/profile/file.mjs" },
    { kind: "note", value: "src/profile/file.mjs" },
    { kind: "note", value: "src\\profile\\file.mjs" },
    { kind: "note", value: "C:/Windows/win.ini" },
    { kind: "note", value: "file:///tmp/file" },
    { kind: "note", value: ".." },
    { kind: "note", value: "ST-SUPPLY-001" },
    { kind: "source-id", value: "../SRC-TECH-001" },
    { kind: "control-id", value: "src/profile/file", status: "open" },
  ];
  for (const evidence of invalidEvidence) {
    const candidate = structuredClone(register);
    candidate.blindspots.find((item) => item.status === "open").evidence[0] = evidence;
    assert.equal(validateRegister(candidate), false, JSON.stringify(evidence));
  }

  const noteOnlyFixed = structuredClone(register);
  noteOnlyFixed.blindspots.find((item) => item.status === "fixed").evidence = [
    { kind: "note", value: "claimed fixed without executable evidence" },
  ];
  assert.equal(validateRegister(noteOnlyFixed), false);
});

test("CT-KR-BLINDSPOT-005: an unrelated existing file cannot resolve a release gate", () => {
  const forgedFixed = structuredClone(register);
  Object.assign(
    forgedFixed.blindspots.find((item) => item.id === "BS-RDF-SERIALIZATION"),
    {
      status: "fixed",
      currentlyBlocksRelease: false,
      evidence: [
        { kind: "repository-file", path: "docs/00-concepts-primer.md" },
      ],
    },
  );
  assert.equal(validateRegister(forgedFixed), true);
  assert.notEqual(
    nonblockingDecisionDigest(forgedFixed.blindspots),
    REVIEWED_NONBLOCKING_DECISIONS_SHA256,
  );
  assert.notEqual(blindspotRecordsDigest(forgedFixed.blindspots), REVIEWED_BLINDSPOT_RECORDS_SHA256);

  const forgedNotApplicable = structuredClone(register);
  Object.assign(
    forgedNotApplicable.blindspots.find((item) => item.id === "BS-RDF-SERIALIZATION"),
    { status: "not-applicable", currentlyBlocksRelease: false },
  );
  assert.equal(validateRegister(forgedNotApplicable), true);
  assert.notEqual(
    nonblockingDecisionDigest(forgedNotApplicable.blindspots),
    REVIEWED_NONBLOCKING_DECISIONS_SHA256,
  );

  const omitted = structuredClone(register.blindspots).slice(1);
  assert.notEqual(blindspotPolicyDigest(omitted), REVIEWED_BLINDSPOT_POLICY_SHA256);
});
