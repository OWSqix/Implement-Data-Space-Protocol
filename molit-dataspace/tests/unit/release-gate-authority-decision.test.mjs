import assert from "node:assert/strict";
import test from "node:test";
import {
  authorityBlocked,
  authorityReleaseReadyDecision,
} from "../../tools/release/release-gate.mjs";

const approvedEntry = Object.freeze({ decision: "approved" });

test("RELEASE-GATE-AUTH-001: the ready decision is the value the schema allows", () => {
  assert.equal(authorityReleaseReadyDecision, "eligible-after-runtime-verification");
});

test("RELEASE-GATE-AUTH-002: an empty registry blocks the release", () => {
  assert.equal(authorityBlocked({
    releaseDecision: "blocked-no-approved-authority",
    entries: [],
  }), true);
});

test("RELEASE-GATE-AUTH-003: the ready decision with entries clears the blocker", () => {
  assert.equal(authorityBlocked({
    releaseDecision: authorityReleaseReadyDecision,
    entries: [approvedEntry],
  }), false);
});

test("RELEASE-GATE-AUTH-004: the ready decision without entries still blocks", () => {
  assert.equal(authorityBlocked({
    releaseDecision: authorityReleaseReadyDecision,
    entries: [],
  }), true);
});

// The gate used to compare against `approved`, which belongs to `entry.decision`
// and is not a permitted `releaseDecision`. A registry can never carry it, so the
// blocker could not be cleared by any valid registry.
test("RELEASE-GATE-AUTH-005: `approved` is not accepted as a release decision", () => {
  assert.equal(authorityBlocked({
    releaseDecision: "approved",
    entries: [approvedEntry],
  }), true);
});

test("RELEASE-GATE-AUTH-006: a malformed registry blocks the release", () => {
  for (const document of [undefined, null, {}, { releaseDecision: authorityReleaseReadyDecision }]) {
    assert.equal(authorityBlocked(document), true);
  }
});
