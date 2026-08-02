import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const policy = await readFile(new URL("../../deploy/supply-chain/verify-images.template.yaml", import.meta.url), "utf8");
const apply = await readFile(new URL("../../deploy/supply-chain/apply-admission.ps1", import.meta.url), "utf8");
const verify = await readFile(new URL("../../deploy/supply-chain/verify-admission-policy.ps1", import.meta.url), "utf8");
const observability = await readFile(new URL("../../deploy/kubernetes/ha/observability.template.yaml", import.meta.url), "utf8");
const rbac = await readFile(new URL("../../deploy/kubernetes/control-plane-rbac.yaml", import.meta.url), "utf8");
const caasConfig = await readFile(new URL("../../deploy/kubernetes/caas-config.production.example.json", import.meta.url), "utf8");

test("COM-SUP-ADMISSION-001: release images require digest, signature, and passing attestation", () => {
  assert.equal((policy.match(/failureAction: Enforce/gu) ?? []).length, 11);
  assert.equal((policy.match(/verifyDigest: true/gu) ?? []).length, 10);
  assert.equal((policy.match(/required: true/gu) ?? []).length, 2);
  assert.match(policy, /failurePolicy: Fail/gu);
  assert.match(policy, /predicateType: https:\/\/data\.molit\.go\.kr\/attestations\/release-bundle\/v1/gu);
  assert.match(policy, /vulnerabilityGate\.decision/gu);
  assert.match(policy, /value: pass/gu);
  assert.match(policy, /app\.kubernetes\.io\/managed-by: molit-caas/gu);
  assert.equal((policy.match(/supply-chain\.data\.molit\.go\.kr\/enforcement: required/gu) ?? []).length, 4);
  assert.equal((policy.match(/namespaces: \[molit-caas-system, observability\]/gu) ?? []).length, 4);
  assert.match(policy, /require-release-registry-and-digest/gu);
  assert.match(policy, /request\.object\.spec\.\[initContainers, ephemeralContainers, containers\]\[\]/gu);
  for (const repository of ["caas", "dsaas", "fencing-webhook", "edc-control-plane", "edc-data-plane", "edc-schema-migration", "postgres-operand", "otel-collector"]) {
    assert.match(policy, new RegExp(`@@REGISTRY_PREFIX@@/${repository}`, "u"));
  }
  assert.doesNotMatch(policy, /@@REGISTRY_PREFIX@@\/\*@sha256:\*/u);
  assert.match(policy, /name: verify-release-runtime-identity/u);
  assert.equal((policy.match(/artifact\.productionEligible/gu) ?? []).length, 8);
  assert.equal((policy.match(/artifact\.runtimeClass/gu) ?? []).length, 8);
  assert.equal((policy.match(/artifact\.service/gu) ?? []).length, 8);
  assert.equal((policy.match(/operator: LessThanOrEquals/gu) ?? []).length, 3);
  assert.equal((policy.match(/value: 24h/gu) ?? []).length, 3);
  assert.match(policy, /vulnerabilityGate\.databaseUpdatedAt/gu);
  assert.match(policy, /vulnerabilityGate\.evaluatedAt/gu);
  assert.match(policy, /provenance\.predicate\.runDetails\.metadata\.finishedOn/gu);
  assert.equal((policy.match(/time_before/gu) ?? []).length, 3);
});

test("COM-SUP-ADMISSION-004: observability workloads are in the same enforced supply-chain namespace scope", () => {
  assert.match(observability, /name: observability[\s\S]*supply-chain\.data\.molit\.go\.kr\/enforcement: required/u);
  assert.match(observability, /image: "@@OTEL_COLLECTOR_IMAGE@@"/u);
  assert.match(policy, /namespaceSelector:[\s\S]*supply-chain\.data\.molit\.go\.kr\/enforcement: required/u);
});

test("COM-SUP-ADMISSION-005: production tenant provisioning verifies the installed attestation policy", () => {
  assert.match(rbac, /apiGroups: \["kyverno\.io"\][\s\S]*resources: \["clusterpolicies"\][\s\S]*verbs: \["get"\]/u);
  assert.match(caasConfig, /"policyName": "molit-verify-release-images"/u);
  assert.match(caasConfig, /"attestationPredicateType": "https:\/\/data\.molit\.go\.kr\/attestations\/release-bundle\/v1"/u);
});

test("COM-SUP-ADMISSION-002: installer requires an explicit cluster, Kyverno readiness, and external public key", () => {
  assert.match(apply, /current-context/gu);
  assert.match(apply, /clusterpolicies\.kyverno\.io/gu);
  assert.match(apply, /kyverno-admission-controller/gu);
  assert.match(apply, /BEGIN PUBLIC KEY/gu);
  assert.match(apply, /SignatureIndentedKey/gu);
  assert.match(apply, /AttestationIndentedKey/gu);
  assert.match(policy, /@@COSIGN_PUBLIC_KEY_SIGNATURE@@/gu);
  assert.match(policy, /@@COSIGN_PUBLIC_KEY_ATTESTATION@@/gu);
  assert.match(apply, /--server-side/gu);
  assert.doesNotMatch(policy, /BEGIN PUBLIC KEY/gu);
});

test("COM-SUP-ADMISSION-003: pinned Kyverno CLI proves fail-closed behavior", () => {
  assert.match(verify, /kyverno-cli:v1\.18\.0@sha256:[a-f0-9]{64}/gu);
  assert.match(verify, /--registry/gu);
  assert.match(verify, /DenialExitCode -eq 0/gu);
  assert.match(verify, /verify-release-signature/gu);
  assert.match(verify, /verify-release-attestation/gu);
  assert.match(verify, /foreignRegistryDenied=true/gu);
  assert.match(verify, /namespace: observability/gu);
  assert.match(verify, /observabilityForeignRegistryDenied=true/gu);
  assert.match(verify, /mutableTagDenied=true/gu);
  assert.match(verify, /unknownRepositoryDenied=true/gu);
  assert.match(verify, /runtimeIdentityRuleDenied=true/gu);
});
