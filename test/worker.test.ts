import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker, { authorize, safeEqual, type Env } from "../src/index.ts";
import { bigIntSafe, ok } from "../src/responses/index.ts";

const SECRET = "s".repeat(40);
const env: Env = { GARMIN_API_KEY: "key-123", MCP_ACCESS_KEY: SECRET };

describe("auth", () => {
  it("compares in constant time correctly", () => {
    assert.strictEqual(safeEqual("abc", "abc"), true);
    assert.strictEqual(safeEqual("abc", "abd"), false);
    assert.strictEqual(safeEqual("abc", "abcd"), false);
  });

  it("accepts the secret only as an access-key header", () => {
    assert.strictEqual(authorize(new Request("https://w/mcp", { headers: { "access-key": SECRET } }), env).ok, true);
    assert.strictEqual(authorize(new Request(`https://w/mcp/${SECRET}`), env).ok, false);
    assert.strictEqual(
      authorize(new Request("https://w/mcp", { headers: { Authorization: `Bearer ${SECRET}` } }), env).ok,
      false,
    );
    assert.strictEqual(authorize(new Request("https://w/mcp"), env).ok, false);
    assert.strictEqual(
      authorize(new Request("https://w/mcp", { headers: { "access-key": "wrong" } }), env).ok,
      false,
    );
  });

  it("refuses to run with a weak secret", () => {
    const r = authorize(new Request("https://w/mcp", { headers: { "access-key": "short" } }), {
      ...env,
      MCP_ACCESS_KEY: "short",
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason!, /at least 32/);
  });

  it("returns 404 for unauthorized MCP requests", async () => {
    const res = await worker.fetch(new Request("https://w/mcp", { method: "POST" }), env);
    assert.strictEqual(res.status, 404);
  });
});

describe("ok", () => {
  it("drops null fields (but not undefined-turned-null array entries) and stringifies BigInt", () => {
    const result = ok({ a: null, nested: { c: null, d: 1n }, levels: [1, null, 2], score: 80 });
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    assert.deepStrictEqual(parsed, { nested: { d: "1" }, levels: [1, null, 2], score: 80 });
  });

  it("still serializes a genuinely-null top-level result as the literal null, not undefined", () => {
    const result = ok(null);
    assert.strictEqual(result.content[0]!.text, "null");
  });

  it("only attaches structuredContent when asked to, reusing data as-is", () => {
    assert.ok(!("structuredContent" in ok({ a: 1 })));
    assert.deepStrictEqual(ok({ a: 1 }, true).structuredContent, { a: 1 });
  });

  it("skips the JSON.stringify pass entirely once structuredContent covers it", () => {
    // Spec-valid per CallToolResultSchema: content "is always present, but it may be empty" once
    // outputSchema/structuredContent exists — it exists only for clients that don't read the latter.
    assert.deepStrictEqual(ok({ a: 1 }, true).content, []);
  });
});

describe("bigIntSafe", () => {
  it("stringifies BigInt and drops nulls, same as the ok() text pass", () => {
    assert.deepStrictEqual(bigIntSafe({ a: null, b: 1n, items: [{ c: 2n }] }), { b: "1", items: [{ c: "2" }] });
  });
});

describe("MCP endpoint", () => {
  it("lists tools over streamable HTTP", async () => {
    const req = (body: object) =>
      new Request("https://w/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "access-key": SECRET,
        },
        body: JSON.stringify(body),
      });
    const init = await worker.fetch(
      req({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
      env,
    );
    assert.strictEqual(init.status, 200);
    const list = await worker.fetch(req({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), env);
    const body = (await list.json()) as { result: { tools: { name: string }[] } };
    assert.deepStrictEqual(
      body.result.tools.map((t) => t.name).sort(),
      [
        "get_activity",
        "get_activity_fit",
        "get_body_battery",
        "get_daily_summaries",
        "get_hrv",
        "get_body_battery_series",
        "get_sleep",
        "get_sleep_range",
        "list_activities",
      ].sort(),
    );
  });
});
