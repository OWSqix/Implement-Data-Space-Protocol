import { authorizationHeaders } from "./telemetry.mjs";
import { RuntimeError, assertRuntime } from "./errors.mjs";

function at(value, path) {
  return path.split(".").filter(Boolean).reduce((current, part) => current?.[part], value);
}

function validateItem(item, config) {
  assertRuntime(item && typeof item === "object" && !Array.isArray(item), "INVALID_PROVIDER_ITEM", "provider item must be an object");
  const id = at(item, config.idPath ?? "id");
  const version = at(item, config.versionPath ?? "version");
  assertRuntime(typeof id === "string" && id.length > 0 && id.length <= 512, "INVALID_PROVIDER_ITEM", "provider item ID is invalid");
  assertRuntime(["string", "number"].includes(typeof version) && String(version).length <= 128, "INVALID_PROVIDER_ITEM", "provider item version is invalid");
  return { id, version: String(version), record: item };
}

export class HttpPlatformAdapter {
  constructor({ config, http, env = process.env }) {
    this.config = config;
    this.http = http;
    this.authHeaders = authorizationHeaders(config.auth, env);
  }

  async poll(checkpoint = {}, { signal } = {}) {
    const cfg = this.config;
    const records = [];
    const cursors = new Set();
    let cursor = cfg.initialCursor ?? null;
    let first = true;
    let etag;
    let lastModified;
    for (let page = 0; page < (cfg.maxPages ?? 100); page += 1) {
      const url = new URL(cfg.path, cfg.baseUrl);
      if (cursor !== null) url.searchParams.set(cfg.cursorParameter ?? "cursor", cursor);
      const headers = { accept: "application/json", ...this.authHeaders };
      if (first && checkpoint.etag) headers["if-none-match"] = checkpoint.etag;
      if (first && checkpoint.lastModified) headers["if-modified-since"] = checkpoint.lastModified;
      const response = await this.http.json(url, { headers, signal, maxResponseBytes: cfg.maxPageBytes ?? 4 * 1024 * 1024 });
      if (response.status === 304) return { notModified: true, records: [], checkpoint };
      assertRuntime(response.status === 200, "PROVIDER_HTTP_ERROR", `provider returned ${response.status}`);
      if (first) {
        etag = response.headers.get("etag") ?? undefined;
        lastModified = response.headers.get("last-modified") ?? undefined;
      }
      const items = at(response.value, cfg.itemsPath ?? "items");
      assertRuntime(Array.isArray(items), "INVALID_PROVIDER_PAGE", "configured itemsPath is not an array");
      assertRuntime(items.length <= (cfg.maxItemsPerPage ?? 1_000), "PROVIDER_PAGE_TOO_LARGE", "provider page has too many records");
      for (const item of items) {
        records.push(validateItem(item, cfg));
        assertRuntime(records.length <= (cfg.maxItemsPerPoll ?? 10_000), "PROVIDER_POLL_TOO_LARGE", "poll item limit exceeded");
      }
      const next = at(response.value, cfg.nextCursorPath ?? "nextCursor");
      if (next === null || next === undefined || next === "") {
        return {
          notModified: false,
          records,
          checkpoint: { etag, lastModified, polledAt: new Date().toISOString() },
        };
      }
      assertRuntime(typeof next === "string" && next.length <= 2_048, "INVALID_PROVIDER_CURSOR", "provider cursor is invalid");
      if (cursors.has(next)) throw new RuntimeError("PAGINATION_LOOP", "provider repeated a pagination cursor");
      cursors.add(next);
      cursor = next;
      first = false;
    }
    throw new RuntimeError("PAGE_LIMIT_EXCEEDED", "provider did not terminate pagination within maxPages");
  }
}
