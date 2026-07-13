import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { operationalEnvelope } from "../../src/bridge-runtime/clients.mjs";
import { BridgeRuntime } from "../../src/bridge-runtime/worker.mjs";
import { JsonPathDispatchProjector } from "../../src/bridge-runtime/projector.mjs";
import { digest } from "../../src/discovery/stable-json.mjs";

test("approval binds profile version and validation decision", () => {
  const metadata = { sha256: "a".repeat(64), profileName: "core", profileVersion: "1.0.0-rc.1", decisionDigest: "sha256:one" };
  const offering = { assetId: "urn:asset:1" };
  const record = { dispatchEnvelope: { schemaVersion: "molit.operational-dispatch/1", automaticDispatchAllowed: true, routing: "production-connector", approvalId: "a1", metadata, offering } };
  const source = { sourceSystemId: "p", sourceRecordId: "r", resourceVersion: "1" };
  const registry = { entries: [{ approvalId: "a1", sourceSystemId: "p", sourceRecordId: "r", resourceVersion: "1", status: "approved", approvedBy: "urn:operator", validFrom: "2026-01-01T00:00:00Z", validUntil: "2099-01-01T00:00:00Z", payloadDigest: digest({ metadata, offering }) }] };
  assert.equal(operationalEnvelope(record, registry, source).offering.assetId, "urn:asset:1");
  record.dispatchEnvelope.metadata.decisionDigest = "sha256:changed";
  assert.throws(() => operationalEnvelope(record, registry, source), { code: "DISPATCH_APPROVAL_DIGEST_MISMATCH" });
});

test("projector rejects staged RDF that changes across the validation boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-projector-digest-"));
  try {
    await writeFile(join(directory, "metadata.ttl"), "@prefix dcat: <http://www.w3.org/ns/dcat#> .\n");
    const projector = new JsonPathDispatchProjector({
      approvalIdPath: "dispatch.approvalId",
      metadataPath: "metadata.file",
      offeringPath: "publication.offering",
      profileName: "core",
      profileVersion: "1.0.0-rc.1",
    }, {
      metadataRoot: directory,
      profileGate: {
        validate: async () => ({
          decisionDigest: "sha256:fixture",
          gatePassed: true,
          inputSha256: "0".repeat(64),
        }),
      },
    });
    await assert.rejects(projector.project({
      dispatch: { approvalId: "approval-1" },
      metadata: { file: "metadata.ttl" },
      publication: { offering: { assetId: "urn:asset:1" } },
    }), { code: "METADATA_CHANGED_DURING_VALIDATION" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejected record is quarantined with version and does not advance checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molit-quarantine-"));
  const statePath = join(directory, "state.json");
  try {
    const runtime = new BridgeRuntime({
      statePath, providerId: "provider",
      adapter: { poll: async () => ({ notModified: false, checkpoint: { etag: "new" }, records: [{ id: "bad", version: "7", record: {} }] }) },
      projector: { project: async () => { const error = new Error("bad mapping"); error.code = "PROJECTION_FAILED"; throw error; } },
      approvalRegistry: { entries: [] },
      managementClient: {},
    });
    const result = await runtime.poll();
    assert.equal(result.rejected[0].version, "7");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.checkpoints.provider, undefined);
    assert.equal(state.quarantine["provider:bad"].version, "7");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
