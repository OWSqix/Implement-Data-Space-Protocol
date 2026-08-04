import assert from "node:assert/strict";
import test from "node:test";
import { HttpPlatformAdapter } from "../../src/bridge-runtime/platform-adapter.mjs";

// FR-CAT-001은 공식 export·API·change feed 수집을, FR-CAT-006은 증분 동기화
// pagination을 요구한다. 두 축의 실행 코드는 HttpPlatformAdapter.poll이며,
// 이 파일이 검증 계획의 IT-CAT-001·IT-CAT-008 행을 구현한다.

function pageResponse(items, { status = 200, etag, lastModified, nextCursor } = {}) {
  const headers = new Map();
  if (etag) headers.set("etag", etag);
  if (lastModified) headers.set("last-modified", lastModified);
  return { status, headers, value: { items, nextCursor } };
}

function adapterWith(responses, config = {}) {
  const calls = [];
  const http = {
    async json(url, options) {
      calls.push({ url: new URL(url), headers: options.headers });
      assert.ok(responses.length > 0, "adapter requested more pages than the stub provides");
      return responses.shift();
    },
  };
  const adapter = new HttpPlatformAdapter({
    config: { baseUrl: "https://provider.poc.invalid", path: "/catalog/records", ...config },
    http,
    env: {},
  });
  return { adapter, calls };
}

test("IT-CAT-001: API poll collects validated records and captures the change-feed checkpoint", async () => {
  const { adapter, calls } = adapterWith([
    pageResponse(
      [{ id: "rec-1", version: 3, title: "하나" }, { id: "rec-2", version: "7" }],
      { etag: 'W/"v3"', lastModified: "Tue, 04 Aug 2026 00:00:00 GMT" },
    ),
  ]);
  const result = await adapter.poll();
  assert.equal(result.notModified, false);
  assert.deepEqual(result.records.map((item) => item.id), ["rec-1", "rec-2"]);
  // version은 문자열로 정규화되고 원본 record가 보존된다.
  assert.deepEqual(result.records.map((item) => item.version), ["3", "7"]);
  assert.equal(result.records[0].record.title, "하나");
  // change feed 재개점: 첫 페이지의 etag·last-modified가 checkpoint로 남는다.
  assert.equal(result.checkpoint.etag, 'W/"v3"');
  assert.equal(result.checkpoint.lastModified, "Tue, 04 Aug 2026 00:00:00 GMT");
  assert.ok(typeof result.checkpoint.polledAt === "string" && result.checkpoint.polledAt.length > 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.accept, "application/json");
  assert.equal(calls[0].headers["if-none-match"], undefined);
});

test("IT-CAT-001: unchanged feed answers 304 and the previous checkpoint survives", async () => {
  const checkpoint = { etag: 'W/"v3"', lastModified: "Tue, 04 Aug 2026 00:00:00 GMT" };
  const { adapter, calls } = adapterWith([pageResponse([], { status: 304 })]);
  const result = await adapter.poll(checkpoint);
  assert.equal(result.notModified, true);
  assert.deepEqual(result.records, []);
  assert.equal(result.checkpoint, checkpoint);
  // 조건부 요청 헤더가 저장된 checkpoint에서 만들어진다.
  assert.equal(calls[0].headers["if-none-match"], 'W/"v3"');
  assert.equal(calls[0].headers["if-modified-since"], "Tue, 04 Aug 2026 00:00:00 GMT");
});

test("IT-CAT-001: provider errors and malformed pages fail closed", async () => {
  {
    const { adapter } = adapterWith([pageResponse([], { status: 500 })]);
    await assert.rejects(() => adapter.poll(), (error) => error.code === "PROVIDER_HTTP_ERROR");
  }
  {
    const { adapter } = adapterWith([{ status: 200, headers: new Map(), value: { items: "not-an-array" } }]);
    await assert.rejects(() => adapter.poll(), (error) => error.code === "INVALID_PROVIDER_PAGE");
  }
  {
    const { adapter } = adapterWith([pageResponse([{ id: "", version: 1 }])]);
    await assert.rejects(() => adapter.poll(), (error) => error.code === "INVALID_PROVIDER_ITEM");
  }
});

test("IT-CAT-008: incremental pagination walks every cursor page exactly once, in order", async () => {
  const { adapter, calls } = adapterWith([
    pageResponse([{ id: "rec-1", version: 1 }], { etag: 'W/"first"', nextCursor: "cursor-2" }),
    pageResponse([{ id: "rec-2", version: 1 }], { etag: 'W/"second"', nextCursor: "cursor-3" }),
    pageResponse([{ id: "rec-3", version: 1 }]),
  ]);
  const result = await adapter.poll({ etag: 'W/"stale"' });
  assert.deepEqual(result.records.map((item) => item.id), ["rec-1", "rec-2", "rec-3"]);
  // cursor는 두 번째 요청부터 붙는다.
  assert.equal(calls[0].url.searchParams.get("cursor"), null);
  assert.equal(calls[1].url.searchParams.get("cursor"), "cursor-2");
  assert.equal(calls[2].url.searchParams.get("cursor"), "cursor-3");
  // 조건부 헤더는 첫 요청에만 붙고, checkpoint의 etag는 첫 페이지의 것이다.
  assert.equal(calls[0].headers["if-none-match"], 'W/"stale"');
  assert.equal(calls[1].headers["if-none-match"], undefined);
  assert.equal(calls[2].headers["if-none-match"], undefined);
  assert.equal(result.checkpoint.etag, 'W/"first"');
});

test("IT-CAT-008: pagination defects fail closed instead of looping or truncating silently", async () => {
  {
    // 같은 cursor가 반복되면 무한 루프 대신 거부한다.
    const { adapter } = adapterWith([
      pageResponse([{ id: "rec-1", version: 1 }], { nextCursor: "cursor-2" }),
      pageResponse([{ id: "rec-2", version: 1 }], { nextCursor: "cursor-2" }),
    ]);
    await assert.rejects(() => adapter.poll(), (error) => error.code === "PAGINATION_LOOP");
  }
  {
    // maxPages 안에서 끝나지 않는 pagination은 거부한다.
    const endless = Array.from({ length: 3 }, (_, index) => pageResponse(
      [{ id: `rec-${index}`, version: 1 }],
      { nextCursor: `cursor-${index + 1}` },
    ));
    const { adapter } = adapterWith(endless, { maxPages: 2 });
    await assert.rejects(() => adapter.poll(), (error) => error.code === "PAGE_LIMIT_EXCEEDED");
  }
  {
    // 페이지당 한도 초과는 수집 전에 거부한다.
    const { adapter } = adapterWith(
      [pageResponse([{ id: "rec-1", version: 1 }, { id: "rec-2", version: 1 }])],
      { maxItemsPerPage: 1 },
    );
    await assert.rejects(() => adapter.poll(), (error) => error.code === "PROVIDER_PAGE_TOO_LARGE");
  }
  {
    // poll 전체 한도 초과도 거부한다 — 조용한 절단이 없어야 한다.
    const { adapter } = adapterWith(
      [pageResponse([{ id: "rec-1", version: 1 }, { id: "rec-2", version: 1 }])],
      { maxItemsPerPoll: 1 },
    );
    await assert.rejects(() => adapter.poll(), (error) => error.code === "PROVIDER_POLL_TOO_LARGE");
  }
});
