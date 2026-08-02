import test from "node:test";
import assert from "node:assert/strict";
import { validateFencingAdmission } from "../../src/caas/kubernetes-fencing-webhook.mjs";

const group = "caas.data.molit.go.kr";
const annotations = (token, operationKey = "a".repeat(64)) => ({
  [`${group}/fencing-token`]: token,
  [`${group}/operation-key`]: operationKey,
  [`${group}/generation`]: token,
  [`${group}/intent-digest`]: "b".repeat(64),
  [`${group}/desired-state`]: "DELETED",
});
const labels = {
  "app.kubernetes.io/managed-by": "molit-caas",
  [`${group}/tenant-id`]: "road-provider",
  [`${group}/instance-id`]: "caas-a",
};

function resource(token) {
  return { apiVersion: "v1", kind: "Namespace", metadata: { name: "molit-edc-road-provider", labels, annotations: annotations(token) } };
}

function fence(token) {
  return {
    metadata: { labels },
    data: {
      fencingToken: token,
      operationKey: "a".repeat(64),
      generation: token,
      intentDigest: "b".repeat(64),
      desiredState: "DELETED",
    },
  };
}

function review(operation, object) {
  return { request: { uid: "admission-1", operation, ...(operation === "DELETE" ? { oldObject: object } : { object }) } };
}

test("fencing webhook denies a stale DELETE after the central fence advances", async () => {
  const result = await validateFencingAdmission(review("DELETE", resource("8")), { readFence: async () => fence("9") });
  assert.equal(result.response.allowed, false);
  assert.match(result.response.status.message, /does not match/u);
});

test("fencing webhook allows DELETE only when token, owner, and command match", async () => {
  const result = await validateFencingAdmission(review("DELETE", resource("9")), { readFence: async () => fence("9") });
  assert.equal(result.response.allowed, true);
});

test("fencing webhook fails closed when the central store cannot be read", async () => {
  const result = await validateFencingAdmission(review("UPDATE", resource("9")), { readFence: async () => { throw new Error("unavailable"); } });
  assert.equal(result.response.allowed, false);
  assert.match(result.response.status.message, /could not be verified/u);
});

test("fencing webhook does not claim unmanaged Kubernetes resources", async () => {
  const unmanaged = resource("1");
  unmanaged.metadata.labels["app.kubernetes.io/managed-by"] = "another-controller";
  const result = await validateFencingAdmission(review("DELETE", unmanaged), { readFence: async () => { throw new Error("must not be called"); } });
  assert.equal(result.response.allowed, true);
});
