import assert from "node:assert/strict";
import test from "node:test";

import { createLocalTestWormBackend, HttpWormBackend, WormAuditExporter } from "../../src/observability/index.mjs";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("HTTPS WORM adapter executes conditional append, read-back, and receipt recovery contract", async () => {
  const storage = createLocalTestWormBackend({ environment: "test", backendId: "worm-integration" });
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = new URL(url);
    calls.push({ authorization: options.headers.authorization, method: options.method, path: target.pathname });
    assert.equal(target.protocol, "https:");
    if (target.pathname === "/v1/capabilities") return json(await storage.capabilities());
    if (target.pathname === "/v1/head") return json(await storage.head());
    if (target.pathname === "/v1/records" && options.method === "POST") {
      const body = JSON.parse(options.body);
      try { return json(await storage.append(body.record, { expectedHead: body.expectedHead })); }
      catch (error) { return json({ code: error.code }, 409); }
    }
    const record = /^\/v1\/records\/(.+)$/u.exec(target.pathname);
    if (record) {
      const value = await storage.get(decodeURIComponent(record[1]));
      return value ? json(value) : json({ code: "not-found" }, 404);
    }
    const receipt = /^\/v1\/receipts\/(.+)$/u.exec(target.pathname);
    if (receipt) {
      const value = await storage.receipt(decodeURIComponent(receipt[1]));
      return value ? json(value) : json({ code: "not-found" }, 404);
    }
    return json({ code: "not-found" }, 404);
  };
  const backend = new HttpWormBackend({ baseUrl: "https://worm.example/", authorization: async () => "Bearer operational-test", fetchImpl });
  const exporter = new WormAuditExporter({ backend, clock: () => new Date("2026-07-14T01:00:00.000Z") });
  await exporter.initialize();
  const event = { eventId: "audit-http-event-0001", type: "caas.audit", occurredAt: "2026-07-14T00:00:00.000Z", actor: {}, subject: {}, data: { result: "ok" } };
  const first = await exporter.append(event);
  const recovered = await exporter.append(event);
  assert.equal(first.replayed, false);
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.receipt.receiptDigest, first.receipt.receiptDigest);
  assert.ok(calls.every((call) => call.authorization === "Bearer operational-test"));
  assert.ok(calls.some((call) => call.path.startsWith("/v1/receipts/")));
});
