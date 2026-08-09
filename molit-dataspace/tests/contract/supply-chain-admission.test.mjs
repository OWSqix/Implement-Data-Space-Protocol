import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The admission policy template targets the Kyverno v1.18 Stable API group
// `policies.kyverno.io/v1` (`ValidatingPolicy` + `ImageValidatingPolicy`).
// The previous revision of this file asserted against `kyverno.io/v1 ClusterPolicy`,
// which Kyverno deprecated in v1.18 and schedules for removal in v1.20 (2026-10).
// The deployed artifact under deploy/supply-chain/ is canonical, so these tests
// were rewritten against the new API and now read the template as YAML structure
// instead of counting literal substrings.

const template = await readFile(new URL("../../deploy/supply-chain/verify-images.template.yaml", import.meta.url), "utf8");
const apply = await readFile(new URL("../../deploy/supply-chain/apply-admission.ps1", import.meta.url), "utf8");
const verify = await readFile(new URL("../../deploy/supply-chain/verify-admission-policy.ps1", import.meta.url), "utf8");
const observability = await readFile(new URL("../../deploy/kubernetes/ha/observability.template.yaml", import.meta.url), "utf8");
const rbac = await readFile(new URL("../../deploy/kubernetes/control-plane-rbac.yaml", import.meta.url), "utf8");
const caasConfig = await readFile(new URL("../../deploy/kubernetes/caas-config.production.example.json", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Minimal block-YAML reader.
//
// The repository declares no YAML dependency (js-yaml is only present as a
// transitive dependency of markdownlint-cli2 and must not be imported directly),
// and every other deployment test reads templates as raw text. This reader covers
// exactly the subset the admission template uses: multiple documents, block
// mappings and sequences, flow mappings and sequences, and block scalars. Any
// construct outside that subset throws rather than silently returning a wrong
// shape, so a reader defect fails the test instead of weakening it.
// ---------------------------------------------------------------------------

const BLOCK_SCALAR_HEADER = /^[|>][+-]?\d*$/u;

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function isBlank(line) {
  return line.trim().length === 0;
}

function unquote(text) {
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text;
}

function coerce(raw) {
  const text = raw.trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~" || text === "") return null;
  if (/^-?\d+$/u.test(text)) return Number(text);
  return unquote(text);
}

function readFlowQuoted(text, start) {
  const quote = text[start];
  let index = start + 1;
  let out = "";
  while (index < text.length && text[index] !== quote) {
    out += text[index];
    index += 1;
  }
  if (index >= text.length) throw new Error(`Unterminated flow scalar: ${text}`);
  return [out, index + 1];
}

function readFlowValue(text, start) {
  let index = start;
  while (index < text.length && /\s/u.test(text[index])) index += 1;
  if (text[index] === "[") return readFlowSequence(text, index);
  if (text[index] === "{") return readFlowMapping(text, index);
  if (text[index] === '"' || text[index] === "'") return readFlowQuoted(text, index);
  let end = index;
  while (end < text.length && !",]}".includes(text[end])) end += 1;
  return [coerce(text.slice(index, end)), end];
}

function readFlowSequence(text, start) {
  const items = [];
  let index = start + 1;
  for (;;) {
    while (index < text.length && /[\s,]/u.test(text[index])) index += 1;
    if (index >= text.length) throw new Error(`Unterminated flow sequence: ${text}`);
    if (text[index] === "]") return [items, index + 1];
    const [value, next] = readFlowValue(text, index);
    items.push(value);
    index = next;
  }
}

function readFlowMapping(text, start) {
  const map = {};
  let index = start + 1;
  for (;;) {
    while (index < text.length && /[\s,]/u.test(text[index])) index += 1;
    if (index >= text.length) throw new Error(`Unterminated flow mapping: ${text}`);
    if (text[index] === "}") return [map, index + 1];
    let keyEnd = index;
    while (keyEnd < text.length && text[keyEnd] !== ":") keyEnd += 1;
    if (keyEnd >= text.length) throw new Error(`Flow mapping entry has no key separator: ${text}`);
    const key = unquote(text.slice(index, keyEnd).trim());
    const [value, next] = readFlowValue(text, keyEnd + 1);
    map[key] = value;
    index = next;
  }
}

function parseFlow(text) {
  const [value, index] = readFlowValue(text, 0);
  const remainder = text.slice(index).trim();
  if (remainder !== "") throw new Error(`Unparsed flow remainder: ${remainder}`);
  return value;
}

function readBlockScalar(lines, start, parentIndent) {
  const collected = [];
  let index = start;
  let blockIndent = null;
  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      collected.push("");
      index += 1;
      continue;
    }
    if (indentOf(line) <= parentIndent) break;
    if (blockIndent === null) blockIndent = indentOf(line);
    collected.push(line.slice(blockIndent));
    index += 1;
  }
  while (collected.length > 0 && collected.at(-1) === "") collected.pop();
  return [collected.join("\n"), index];
}

function parseBlock(lines, start, indent) {
  let index = start;
  while (index < lines.length && isBlank(lines[index])) index += 1;
  if (index >= lines.length) return [null, index];
  if (indentOf(lines[index]) !== indent) throw new Error(`Unexpected indent at: ${lines[index]}`);
  const body = lines[index].trimStart();
  if (body === "-" || body.startsWith("- ")) return parseSequence(lines, index, indent);
  return parseMapping(lines, index, indent);
}

function parseSequence(lines, start, indent) {
  const items = [];
  let index = start;
  while (index < lines.length) {
    if (isBlank(lines[index])) {
      index += 1;
      continue;
    }
    if (indentOf(lines[index]) < indent) break;
    if (indentOf(lines[index]) !== indent) throw new Error(`Unexpected indent in sequence at: ${lines[index]}`);
    const body = lines[index].trimStart();
    if (body !== "-" && !body.startsWith("- ")) break;
    let end = index + 1;
    while (end < lines.length && (isBlank(lines[end]) || indentOf(lines[end]) > indent)) end += 1;
    const rewritten = lines.slice(index, end);
    rewritten[0] = rewritten[0].replace(/^(\s*)-/u, "$1 ");
    const [value] = parseBlock(rewritten, 0, indent + 2);
    items.push(value);
    index = end;
  }
  return [items, index];
}

function parseMapping(lines, start, indent) {
  const map = {};
  let index = start;
  while (index < lines.length) {
    if (isBlank(lines[index])) {
      index += 1;
      continue;
    }
    const lineIndent = indentOf(lines[index]);
    if (lineIndent < indent) break;
    if (lineIndent > indent) throw new Error(`Unexpected deeper indent at: ${lines[index]}`);
    const body = lines[index].trimStart();
    if (body === "-" || body.startsWith("- ")) break;
    const separator = body.indexOf(":");
    if (separator < 0) throw new Error(`Not a mapping entry: ${lines[index]}`);
    const key = unquote(body.slice(0, separator).trim());
    const rest = body.slice(separator + 1).trim();
    index += 1;
    if (BLOCK_SCALAR_HEADER.test(rest)) {
      const [scalar, next] = readBlockScalar(lines, index, indent);
      map[key] = scalar;
      index = next;
    } else if (rest === "") {
      let peek = index;
      while (peek < lines.length && isBlank(lines[peek])) peek += 1;
      const nested = peek < lines.length ? indentOf(lines[peek]) : -1;
      const nestedIsSequence = peek < lines.length && (lines[peek].trimStart() === "-" || lines[peek].trimStart().startsWith("- "));
      if (nested > indent || (nested === indent && nestedIsSequence)) {
        const [value, next] = parseBlock(lines, peek, nested);
        map[key] = value;
        index = next;
      } else {
        map[key] = null;
      }
    } else if (rest.startsWith("[") || rest.startsWith("{")) {
      map[key] = parseFlow(rest);
    } else {
      map[key] = coerce(rest);
    }
  }
  return [map, index];
}

function parseYamlDocuments(text) {
  const documents = [];
  let current = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line.trimEnd() === "---") {
      documents.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  documents.push(current);
  return documents.filter((lines) => lines.some((line) => !isBlank(line))).map((lines) => parseBlock(lines, 0, 0)[0]);
}

// Collapse the whitespace the YAML block-scalar folding introduces so CEL
// expressions can be compared and matched as single logical lines.
function squish(text) {
  return String(text).replace(/\s+/gu, " ").trim();
}

// ---------------------------------------------------------------------------
// Render the template exactly the way deploy/supply-chain/apply-admission.ps1
// renders it. The raw template is deliberately not valid YAML — the PEM
// placeholder sits at column 0 inside a block scalar and `allowInsecureRegistry`
// takes a bare `@@...@@` token — so parsing the rendered form additionally
// proves the installer substitution produces well-formed YAML.
// ---------------------------------------------------------------------------

const FIXTURE_REGISTRY_PREFIX = "registry.molit.example/molit-dataspace";
const FIXTURE_TRUST_ANCHOR_SHA256 = "a".repeat(64);
// Rendering fixture only: this PEM is never used for cryptographic verification,
// it exists so the template renders to parseable YAML. It is held to the same
// shape the installer enforces on a real key (see the PEM guard below).
const FIXTURE_PUBLIC_KEY = [
  "-----BEGIN PUBLIC KEY-----",
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEUkVOREVSSU5HRklYVFVSRU9OTFlO",
  "T1RBUkVBTEtFWVJFTkRFUklOR0ZJWFRVUkVPTkxZTk9UQVJFQUxLRVk9PQ==",
  "-----END PUBLIC KEY-----",
].join("\n");

function renderTemplate({ allowInsecureRegistry }) {
  const indentedKey = FIXTURE_PUBLIC_KEY.split("\n").map((line) => `            ${line}`).join("\n");
  return template
    .replaceAll("@@REGISTRY_PREFIX@@", FIXTURE_REGISTRY_PREFIX)
    .replaceAll("@@COSIGN_PUBLIC_KEY@@", indentedKey)
    .replaceAll("@@COSIGN_PUBLIC_KEY_SHA256@@", FIXTURE_TRUST_ANCHOR_SHA256)
    .replaceAll("@@ALLOW_INSECURE_REGISTRY@@", String(allowInsecureRegistry));
}

const rendered = renderTemplate({ allowInsecureRegistry: false });
const documents = parseYamlDocuments(rendered);
const [restrictPolicy, verifyPolicy] = documents;

const EXPECTED_REPOSITORIES = [
  "caas",
  "dsaas",
  "edc-control-plane",
  "edc-data-plane",
  "edc-schema-migration",
  "fencing-webhook",
  "otel-collector",
  "postgres-operand",
];

// repository -> [artifact.service, artifact.runtimeClass]
const EXPECTED_RUNTIME_IDENTITY = new Map([
  ["caas", ["caas", "caas-control-plane"]],
  ["dsaas", ["dsaas", "dsaas-control-plane"]],
  ["edc-control-plane", ["edc-control-plane", "edc-control-plane"]],
  ["edc-data-plane", ["edc-data-plane", "edc-data-plane"]],
  ["edc-schema-migration", ["edc-schema-migration", "schema-migration"]],
  ["fencing-webhook", ["fencing-webhook", "fencing-webhook"]],
  ["otel-collector", ["otel-collector", "otel-collector"]],
  ["postgres-operand", ["postgres-operand", "postgres-operand"]],
]);

const ALL_CONTAINER_KINDS = "(images.containers + images.initContainers + images.ephemeralContainers)";

function namespaceGateExpression(document) {
  if (Array.isArray(document.spec.variables)) {
    const variable = document.spec.variables.find((entry) => entry.name === "enforcedNamespace");
    if (variable) return squish(variable.expression);
  }
  if (Array.isArray(document.spec.matchConditions)) {
    const condition = document.spec.matchConditions.find((entry) => entry.name === "managed-namespace");
    if (condition) return squish(condition.expression);
  }
  throw new Error("Policy has no namespace gate");
}

const verifyExpressions = verifyPolicy.spec.validations.map((entry) => squish(entry.expression));
const runtimeIdentityExpressions = verifyExpressions.filter((expression) => expression.includes(".filter(image, image.startsWith("));
const bundleContentExpression = verifyExpressions.find((expression) => expression.includes("payload.artifact.productionEligible"));

test("COM-SUP-ADMISSION-001: release images require digest, signature, and passing attestation", () => {
  // Both policies are Kyverno v1.18 Stable-API objects, not the deprecated ClusterPolicy.
  assert.equal(documents.length, 2);
  assert.equal(restrictPolicy.apiVersion, "policies.kyverno.io/v1");
  assert.equal(restrictPolicy.kind, "ValidatingPolicy");
  assert.equal(restrictPolicy.metadata.name, "molit-restrict-release-images");
  assert.equal(restrictPolicy.metadata.labels["supply-chain.data.molit.go.kr/control"], "canonical-image-reference");
  assert.equal(verifyPolicy.apiVersion, "policies.kyverno.io/v1");
  assert.equal(verifyPolicy.kind, "ImageValidatingPolicy");
  assert.equal(verifyPolicy.metadata.name, "molit-verify-release-images");
  assert.equal(verifyPolicy.metadata.labels["supply-chain.data.molit.go.kr/control"], "signed-release-bundle");
  // NOTE (no equivalent): the old test asserted `app.kubernetes.io/managed-by: molit-caas`
  // on the policy. The template has never carried that label — it uses
  // `app.kubernetes.io/part-of: molit-dataspace` plus the control label above. There is
  // no new-API equivalent to restore, so the ownership label is asserted in its
  // actual form rather than dropped.
  for (const document of documents) {
    assert.equal(document.metadata.labels["app.kubernetes.io/part-of"], "molit-dataspace");
  }

  // Fail-closed. `failureAction: Enforce` was a per-rule field of the deprecated
  // API; the new-API equivalent is the policy-level `validationActions: [Deny]`,
  // which governs every validation in the policy at once.
  for (const document of documents) {
    assert.equal(document.spec.failurePolicy, "Fail");
    assert.deepEqual(document.spec.validationActions, ["Deny"]);
    assert.equal(document.spec.evaluation.admission.enabled, true);
    assert.equal(document.spec.evaluation.background.enabled, true);
    assert.deepEqual(document.spec.matchConstraints.resourceRules, [
      {
        apiGroups: [""],
        apiVersions: ["v1"],
        operations: ["CREATE", "UPDATE"],
        resources: ["pods", "pods/ephemeralcontainers"],
      },
    ]);
  }

  // The old test counted 11 `failureAction: Enforce` occurrences. The rewritten
  // policy pair carries 12 decision expressions, all under the Deny actions above.
  assert.equal(restrictPolicy.spec.validations.length, 1);
  assert.equal(verifyPolicy.spec.validations.length, 11);

  // `verifyDigest`/`required` moved from 10 and 2 per-rule occurrences to a single
  // policy-level block that applies to every matched image.
  assert.deepEqual(verifyPolicy.spec.validationConfigurations, {
    mutateDigest: false,
    required: true,
    verifyDigest: true,
  });

  // Attestation predicate type.
  assert.deepEqual(verifyPolicy.spec.attestations, [
    { name: "releaseBundle", intoto: { type: "https://data.molit.go.kr/attestations/release-bundle/v1" } },
  ]);

  // Container reach. The deprecated API expressed this as the JMESPath
  // `request.object.spec.[initContainers, ephemeralContainers, containers][]`.
  const allContainers = squish(restrictPolicy.spec.variables.find((entry) => entry.name === "allContainers").expression);
  assert.equal(
    allContainers,
    "object.spec.containers + object.spec.?initContainers.orValue([]) + object.spec.?ephemeralContainers.orValue([])",
  );
  for (const expression of verifyExpressions) {
    assert.ok(expression.includes(ALL_CONTAINER_KINDS), `validation does not cover all container kinds: ${expression}`);
  }

  // Two-policy invariant replacing the deleted wildcard-ban assertion.
  //
  // The old test asserted the template never contains `@@REGISTRY_PREFIX@@/*@sha256:*`.
  // The new API needs that glob, but only as a *selector* in `matchImageReferences`
  // (which images get signature-verified). It must never act as an allow-list. The
  // allow-list lives in the ValidatingPolicy and is an exact 8-repository enumeration,
  // so an extra or a missing repository both fail.
  assert.deepEqual(verifyPolicy.spec.matchImageReferences, [{ glob: `${FIXTURE_REGISTRY_PREFIX}/*@sha256:*` }]);
  const allowedRepositories = parseFlow(
    squish(restrictPolicy.spec.variables.find((entry) => entry.name === "allowedRepositories").expression),
  );
  assert.ok(Array.isArray(allowedRepositories));
  for (const repository of allowedRepositories) {
    assert.ok(repository.startsWith(`${FIXTURE_REGISTRY_PREFIX}/`), `repository escapes the registry prefix: ${repository}`);
    assert.ok(!repository.includes("*"), `allow-list entry must not be a wildcard: ${repository}`);
  }
  assert.deepEqual(
    allowedRepositories.map((repository) => repository.slice(FIXTURE_REGISTRY_PREFIX.length + 1)).sort(),
    EXPECTED_REPOSITORIES,
  );

  // Digest immutability, still enforced by the canonical-reference policy.
  const restrictExpression = squish(restrictPolicy.spec.validations[0].expression);
  assert.ok(restrictExpression.includes("image(container.image).containsDigest()"));
  assert.ok(restrictExpression.includes("image(container.image).digest().matches('^sha256:[0-9a-f]{64}$')"));
  assert.ok(restrictExpression.includes("variables.allowedRepositories.exists(repository,"));
  assert.ok(restrictExpression.startsWith("!variables.enforcedNamespace || variables.allContainers.all(container,"));

  // Signature and attestation are both required, over every container kind.
  const signatureExpression = verifyExpressions.find((expression) => expression.includes("verifyImageSignatures("));
  assert.ok(signatureExpression.includes("verifyImageSignatures(image, [attestors.releaseKey]) > 0"));
  assert.ok(
    signatureExpression.includes("verifyAttestationSignatures(image, attestations.releaseBundle, [attestors.releaseKey]) > 0"),
  );
  assert.ok(signatureExpression.includes(`${ALL_CONTAINER_KINDS}.all(image,`));

  // The signed subject must be the admitted image.
  const subjectExpression = verifyExpressions.find((expression) => expression.includes(".image.digest == image"));
  assert.ok(subjectExpression.includes("extractPayload(image, attestations.releaseBundle).image.name + '@'"));

  // Release-bundle content gate.
  assert.ok(bundleContentExpression.includes("payload.schemaVersion == 'molit.supply-chain-release/1'"));
  assert.ok(bundleContentExpression.includes("payload.artifact.productionEligible == true"));
  assert.ok(bundleContentExpression.includes("payload.vulnerabilityGate.decision == 'pass'"));
  assert.ok(bundleContentExpression.includes("payload.vulnerabilityGate.findingCount == 0"));
  assert.ok(bundleContentExpression.includes("payload.vulnerabilityGate.blockingSeverities == ['UNKNOWN', 'HIGH', 'CRITICAL']"));
  assert.ok(bundleContentExpression.includes("payload.provenance.predicateType == 'https://slsa.dev/provenance/v1'"));
  assert.ok(
    bundleContentExpression.includes(
      "payload.provenance.predicate.buildDefinition.externalParameters.artifact == payload.artifact",
    ),
  );
  // `productionEligible` dropped from 8 literal occurrences to 1 because the gate
  // now runs over every image via `.all(payload, ...)` instead of per-repository rules.
  assert.ok(bundleContentExpression.includes(`${ALL_CONTAINER_KINDS}.map(image, extractPayload(image, attestations.releaseBundle)).all(payload,`));

  // Freshness. Replaces `operator: LessThanOrEquals` x3, `value: 24h` x3 and
  // `time_before` x3 with the exact set of fields under each comparison.
  const freshnessFields = [
    ...bundleContentExpression.matchAll(/time\.now\(\) - timestamp\(payload\.([A-Za-z.]+)\) <= duration\('24h'\)/gu),
  ].map((match) => match[1]).sort();
  const notInFutureFields = [
    ...bundleContentExpression.matchAll(/timestamp\(payload\.([A-Za-z.]+)\) <= time\.now\(\)/gu),
  ].map((match) => match[1]).sort();
  const EXPECTED_TIMESTAMP_FIELDS = [
    "provenance.predicate.runDetails.metadata.finishedOn",
    "vulnerabilityGate.databaseUpdatedAt",
    "vulnerabilityGate.evaluatedAt",
  ];
  assert.deepEqual(freshnessFields, EXPECTED_TIMESTAMP_FIELDS);
  assert.deepEqual(notInFutureFields, EXPECTED_TIMESTAMP_FIELDS);

  // Runtime identity. The deprecated API used one rule named
  // `verify-release-runtime-identity`; the new API uses one validation per
  // repository. Every allow-listed repository must have exactly one, so a new
  // repository added to the allow-list without an identity rule fails here.
  assert.equal(runtimeIdentityExpressions.length, EXPECTED_RUNTIME_IDENTITY.size);
  const observedRuntimeIdentity = new Map();
  for (const expression of runtimeIdentityExpressions) {
    const reference = expression.match(/image\.startsWith\('([^']+)@sha256:'\)/u);
    const service = expression.match(/payload\.artifact\.service == '([^']+)'/u);
    const runtimeClass = expression.match(/payload\.artifact\.runtimeClass == '([^']+)'/u);
    assert.ok(reference && service && runtimeClass, `unparsable runtime identity validation: ${expression}`);
    assert.ok(reference[1].startsWith(`${FIXTURE_REGISTRY_PREFIX}/`));
    observedRuntimeIdentity.set(reference[1].slice(FIXTURE_REGISTRY_PREFIX.length + 1), [service[1], runtimeClass[1]]);
  }
  assert.deepEqual([...observedRuntimeIdentity.keys()].sort(), EXPECTED_REPOSITORIES);
  for (const [repository, expected] of EXPECTED_RUNTIME_IDENTITY) {
    assert.deepEqual(observedRuntimeIdentity.get(repository), expected, `runtime identity mismatch for ${repository}`);
  }
});

test("COM-SUP-ADMISSION-004: observability workloads are in the same enforced supply-chain namespace scope", () => {
  assert.match(observability, /name: observability[\s\S]*supply-chain\.data\.molit\.go\.kr\/enforcement: required/u);
  assert.match(observability, /image: "@@OTEL_COLLECTOR_IMAGE@@"/u);

  // The deprecated API expressed namespace scope with a `namespaceSelector`. The
  // new API has no such field: the ValidatingPolicy uses an `enforcedNamespace`
  // variable and the ImageValidatingPolicy a `managed-namespace` match condition.
  // Both must resolve the same scope, so they are compared against each other.
  const restrictGate = namespaceGateExpression(restrictPolicy);
  const verifyGate = namespaceGateExpression(verifyPolicy);
  assert.equal(restrictGate, verifyGate);
  for (const gate of [restrictGate, verifyGate]) {
    assert.ok(gate.includes("object.metadata.namespace in ['molit-caas-system', 'observability']"));
    assert.ok(gate.includes("namespaceObject.metadata.labels['supply-chain.data.molit.go.kr/enforcement'] == 'required'"));
    assert.ok(gate.includes("has(namespaceObject.metadata.labels)"));
  }
});

test("COM-SUP-ADMISSION-005: production tenant provisioning verifies the installed attestation policy", () => {
  // The RBAC grant follows the template onto the Stable API group.
  assert.match(rbac, /apiGroups: \["policies\.kyverno\.io"\][\s\S]*resources: \["validatingpolicies", "imagevalidatingpolicies"\][\s\S]*verbs: \["get"\]/u);
  assert.doesNotMatch(rbac, /"clusterpolicies"/u);

  // The tenant configuration must name the policy and predicate the template
  // actually installs, so these are compared to the parsed template rather than
  // to hard-coded strings.
  const configuration = JSON.parse(caasConfig);
  const supplyChain = configuration.provisioners["kube-edc"].supplyChainAdmission;
  assert.equal(supplyChain.policyName, verifyPolicy.metadata.name);
  assert.equal(supplyChain.attestationPredicateType, verifyPolicy.spec.attestations[0].intoto.type);
  assert.match(supplyChain.trustAnchorSha256, /^[a-f0-9]{64}$/u);
});

test("COM-SUP-ADMISSION-002: installer requires an explicit cluster, Kyverno readiness, and external public key", () => {
  assert.match(apply, /current-context/u);
  assert.match(apply, /--server-side/u);
  assert.match(apply, /kyverno-admission-controller/u);

  // CRD preflight tracks the Stable API group, and the deprecated group is gone.
  assert.match(apply, /get crd validatingpolicies\.policies\.kyverno\.io/u);
  assert.match(apply, /get crd imagevalidatingpolicies\.policies\.kyverno\.io/u);
  assert.doesNotMatch(apply, /clusterpolicies\.kyverno\.io/u);
  assert.match(apply, /wait validatingpolicy\/molit-restrict-release-images/u);
  assert.match(apply, /wait "imagevalidatingpolicy\/\$PolicyName"/u);

  // The key stays outside the repository: the installer reads and validates a PEM
  // and the template must never embed key material.
  assert.match(apply, /BEGIN PUBLIC KEY/u);
  assert.match(apply, /PRIVATE KEY/u);
  assert.doesNotMatch(template, /BEGIN PUBLIC KEY/u);
  assert.match(FIXTURE_PUBLIC_KEY + "\n", /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/su);

  // Placeholder parity: what the template declares is exactly what the installer
  // substitutes, and nothing survives rendering. This is the load-bearing check.
  //
  // DEFECT FOUND IN deploy/ (not fixed here — deploy/ is outside this change):
  // both apply-admission.ps1:36 and verify-admission-policy.ps1:184 guard against
  // leftover placeholders with '@@[A-Z_]+@@', whose character class excludes
  // digits and therefore can never match '@@COSIGN_PUBLIC_KEY_SHA256@@'. The
  // runtime guard is blind to that one placeholder; the parity assertions below
  // use a digit-aware pattern and cover it statically.
  const PLACEHOLDER = /@@[A-Z0-9_]+@@/gu;
  const templatePlaceholders = [...new Set(template.match(PLACEHOLDER))].sort();
  const substituted = [...new Set(apply.match(PLACEHOLDER))].sort();
  assert.deepEqual(templatePlaceholders, [
    "@@ALLOW_INSECURE_REGISTRY@@",
    "@@COSIGN_PUBLIC_KEY@@",
    "@@COSIGN_PUBLIC_KEY_SHA256@@",
    "@@REGISTRY_PREFIX@@",
  ]);
  assert.deepEqual(substituted, templatePlaceholders);
  assert.doesNotMatch(rendered, /@@[A-Z0-9_]+@@/u);
  assert.match(apply, /if \(\$Rendered -match '@@\[A-Z_\]\+@@'\) \{ throw/u);

  // Registry TLS posture is placeholder-driven, never hard-coded: the installer
  // renders `false`, the Docker-backed fixture harness renders `true`.
  assert.equal(verifyPolicy.spec.credentials.allowInsecureRegistry, false);
  assert.match(apply, /Replace\('@@ALLOW_INSECURE_REGISTRY@@', 'false'\)/u);
  const insecureDocuments = parseYamlDocuments(renderTemplate({ allowInsecureRegistry: true }));
  assert.equal(insecureDocuments[1].spec.credentials.allowInsecureRegistry, true);
  assert.match(verify, /Replace\('@@ALLOW_INSECURE_REGISTRY@@', 'true'\)/u);

  // SINGLE TRUST ANCHOR (accepted design risk, recorded in
  // docs/04-implementation/observability-and-supply-chain.md section 6.3).
  //
  // The deprecated-API test expected two separately indented keys
  // (`SignatureIndentedKey` / `AttestationIndentedKey`) fed by
  // `@@COSIGN_PUBLIC_KEY_SIGNATURE@@` and `@@COSIGN_PUBLIC_KEY_ATTESTATION@@`.
  // The template now uses one attestor, `releaseKey`, for both the image
  // signature and the attestation signature. That consolidation is deliberate,
  // so it is asserted explicitly instead of being silently dropped: compromise of
  // this one key forges both proofs at once.
  assert.equal(verifyPolicy.spec.attestors.length, 1);
  assert.equal(verifyPolicy.spec.attestors[0].name, "releaseKey");
  assert.equal(squish(verifyPolicy.spec.attestors[0].cosign.key.data), squish(FIXTURE_PUBLIC_KEY));
  assert.equal((apply.match(/\$IndentedKey/gu) ?? []).length, 2);
  const signatureExpression = verifyExpressions.find((expression) => expression.includes("verifyImageSignatures("));
  assert.equal((signatureExpression.match(/attestors\.releaseKey/gu) ?? []).length, 2);
  for (const expression of verifyExpressions) {
    assert.ok(!/attestors\.(?!releaseKey)[A-Za-z]/u.test(expression), `unexpected second attestor in: ${expression}`);
  }

  // The trust anchor digest is published on the policy so an operator can compare
  // the installed policy against the key they hold.
  assert.equal(
    verifyPolicy.metadata.annotations["supply-chain.data.molit.go.kr/trust-anchor-sha256"],
    FIXTURE_TRUST_ANCHOR_SHA256,
  );

  // REKOR POSTURE (accepted design risk, recorded in the same document section).
  // The transparency log is switched off on the verifying side and the installer
  // reports that posture in its result object. It is consistent with the signing
  // side, which passes `--tlog-upload=false`.
  assert.equal(verifyPolicy.spec.attestors[0].cosign.ctlog.url, "https://rekor.invalid");
  assert.equal(verifyPolicy.spec.attestors[0].cosign.ctlog.insecureIgnoreTlog, true);
  assert.match(apply, /transparencyLog = 'disabled'/u);
});

test("COM-SUP-ADMISSION-003: pinned Kyverno CLI proves fail-closed behavior", () => {
  // Pin follows the script, which is canonical. The 1.18 line has since moved on
  // to v1.18.2 (released 2026-07-10); the tag-to-digest correspondence below has
  // not been independently confirmed here, so only the exact literal is asserted.
  assert.match(
    verify,
    /kyverno-cli:v1\.18\.1@sha256:b7e272572d244ddec0b83469f7200ba883555bf69de4b294cee52a197c8c6590/u,
  );
  assert.match(verify, /--registry/u);

  // Fail-closed proof: a denial must be a non-zero exit, and the denial reason
  // must name the policy that is supposed to have denied it.
  assert.match(verify, /if \(\$Result\.exitCode -eq 0\) \{ throw "Kyverno admitted \$Label" \}/u);
  assert.match(verify, /if \(\$Result\.output -notmatch \$Pattern\)/u);
  const denialPatterns = new Set([...verify.matchAll(/Assert-Denied \(Invoke-Kyverno [^)]*\) '([^']+)'/gu)].map((match) => match[1]));
  // Replaces the old rule-name expectations `verify-release-signature` and
  // `verify-release-attestation`, which the new API folds into policy names.
  assert.deepEqual([...denialPatterns].sort(), [restrictPolicy.metadata.name, verifyPolicy.metadata.name].sort());

  // Every negative case is reported, including the ones the old test named
  // separately: `observabilityForeignRegistryDenied` (the foreign-registry fixture
  // is itself in the observability namespace, so the two cases are one) and
  // `runtimeIdentityRuleDenied` (now `signedWrongRuntimeInitContainerDenied`).
  assert.match(verify, /metadata: \{ name: foreign, namespace: observability \}/u);
  for (const field of [
    "unrelatedAllowed",
    "correctlySignedRegularContainerAllowed",
    "correctlySignedInitContainerAllowed",
    "correctlySignedEphemeralContainerAllowed",
    "foreignRegistryDenied",
    "mutableTagDenied",
    "unknownRepositoryDenied",
    "unsignedInitContainerDenied",
    "signedWrongKeyDenied",
    "signedWrongRuntimeInitContainerDenied",
    "signedFalseEligibleDenied",
  ]) {
    assert.match(verify, new RegExp(`${field} = \\$true`, "u"), `harness does not report ${field}`);
  }
  assert.match(verify, /policyApiVersion = "policies\.kyverno\.io\/v1"/u);
  assert.match(verify, /transparencyLog = 'disabled'/u);
  assert.match(verify, /--tlog-upload=false/u);

  // KNOWN GAP: the harness pushes 7 of the 8 allow-listed repositories, so the
  // `edc-data-plane` runtime-identity validation is never exercised against a real
  // registry. Fixing that means editing deploy/supply-chain/verify-admission-policy.ps1,
  // which is outside this change. The gap is asserted so it stays visible; when the
  // fixture adds edc-data-plane, change the expected gap to an empty array.
  const fixtureList = verify.match(/foreach \(\$Service in @\(([^)]*)\)\)/u);
  assert.ok(fixtureList, "fixture repository list not found");
  const pushedRepositories = [...fixtureList[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]).sort();
  for (const repository of pushedRepositories) {
    assert.ok(EXPECTED_REPOSITORIES.includes(repository), `fixture pushes an unknown repository: ${repository}`);
  }
  const unexercised = EXPECTED_REPOSITORIES.filter((repository) => !pushedRepositories.includes(repository));
  assert.deepEqual(unexercised, ["edc-data-plane"]);
});
