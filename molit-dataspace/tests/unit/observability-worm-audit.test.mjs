import assert from "node:assert/strict";
import test from "node:test";

import { createLocalTestWormBackend, HttpWormBackend, ObservabilityError, WormAuditExporter } from "../../src/observability/index.mjs";

function fixture() {
  const backend = createLocalTestWormBackend({ environment: "test" });
  const exporter = new WormAuditExporter({ backend, environment: "test", retentionDays: 365, clock: () => new Date("2026-07-14T00:00:00.000Z") });
  return { backend, exporter };
}

test("WORM export binds content, retention, sequence, and read-back receipt", async () => {
  const { exporter } = fixture();
  await exporter.initialize();
  const first = await exporter.append({ eventId: "audit-event-0001", type: "connector.provisioned", traceId: "a".repeat(32), actor: { id: "operator", authorization: "Bearer hidden" }, subject: { tenant: "road" }, data: { result: "ok" } });
  const second = await exporter.append({ eventId: "audit-event-0002", type: "connector.reconciled", data: {} });
  assert.equal(first.receipt.sequence, 1);
  assert.equal(second.receipt.sequence, 2);
  assert.equal(second.receipt.previousReceiptDigest, first.receipt.receiptDigest);
  assert.equal(first.record.retentionUntil, "2027-07-14T00:00:00.000Z");
  assert.equal(first.record.actor.authorization, "[REDACTED]");
  assert.equal(await exporter.verifyReceipt(first.receipt), true);
});

test("identical retry recovers receipt while conflicting duplicate and mutation fail closed", async () => {
  const { backend, exporter } = fixture();
  await exporter.initialize();
  const event = { eventId: "audit-event-0003", type: "connector.failed", data: { code: "x" } };
  const { receipt } = await exporter.append(event);
  const replay = await exporter.append(event);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.receiptDigest, receipt.receiptDigest);
  await assert.rejects(() => exporter.append({ eventId: "audit-event-0003", type: "connector.failed", data: {} }), { code: "OBS_WORM_DUPLICATE_CONFLICT" });
  backend.testOnlyTamper(receipt.eventId, (record) => ({ ...record, data: { code: "tampered" } }));
  await assert.rejects(() => exporter.verifyReceipt(receipt), { code: "OBS_AUDIT_CONTENT_TAMPERED" });
  backend.testOnlyDelete(receipt.eventId);
  await assert.rejects(() => exporter.verifyReceipt(receipt), { code: "OBS_WORM_RECORD_DELETED" });
});

test("backend capability failure and local production use fail closed", async () => {
  const backend = createLocalTestWormBackend({ environment: "test" });
  assert.throws(() => new WormAuditExporter({ backend, environment: "production" }), { code: "OBS_WORM_OPERATIONAL_REQUIRED" });
  const exporter = new WormAuditExporter({ backend: { mode: "operational", async capabilities() { return { backendId: "bad", appendOnly: true }; } } });
  await assert.rejects(() => exporter.initialize(), { code: "OBS_WORM_CAPABILITY_MISSING" });
});

test("WORM capability readiness expires, fails closed, and recovers without an audit event", async () => {
  let now = new Date("2026-07-14T00:00:00.000Z");
  let available = true;
  const backend = {
    mode: "operational",
    async capabilities() {
      if (!available) throw new ObservabilityError("OBS_WORM_UNAVAILABLE", "backend unavailable");
      return { backendId: "worm-production", appendOnly: true, conditionalAppend: true, immutableUntilRetention: true, readAfterWrite: true, retentionEnforced: true };
    },
  };
  const exporter = new WormAuditExporter({ backend, readinessMaxAgeMs: 1_000, clock: () => now });
  await exporter.initialize();
  assert.equal(exporter.readiness().ready, true);
  now = new Date("2026-07-14T00:00:02.000Z");
  available = false;
  assert.equal((await exporter.probeReadiness()).ready, false);
  available = true;
  assert.equal((await exporter.probeReadiness()).ready, true);
});

test("operational HTTP WORM endpoint requires uncredentialed HTTPS", () => {
  assert.throws(() => new HttpWormBackend({ baseUrl: "http://worm.example/v1/" }), { code: "OBS_WORM_URL_INVALID" });
  assert.throws(() => new HttpWormBackend({ baseUrl: "https://user:pass@worm.example/" }), { code: "OBS_WORM_URL_INVALID" });
  assert.equal(new HttpWormBackend({ baseUrl: "https://worm.example/" }).mode, "operational");
});
