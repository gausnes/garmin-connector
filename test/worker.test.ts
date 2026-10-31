import { describe, expect, it } from "vitest";
import worker, { authorize, safeEqual, type Env } from "../src/index.js";
import { bigIntSafe, ok } from "../src/responses/index.js";

const SECRET = "s".repeat(40);
const env: Env = { GARMIN_API_KEY: "key-123", MCP_PATH_SECRET: SECRET };

describe("auth", () => {
  it("compares in constant time correctly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("accepts the secret in the path or as a bearer token", () => {
    expect(authorize(new Request(`https://w/mcp/${SECRET}`), env).ok).toBe(true);
    expect(
      authorize(new Request("https://w/mcp", { headers: { Authorization: `Bearer ${SECRET}` } }), env).ok,
    ).toBe(true);
    expect(authorize(new Request("https://w/mcp/wrong"), env).ok).toBe(false);
    expect(authorize(new Request("https://w/mcp"), env).ok).toBe(false);
  });

  it("refuses to run with a weak secret", () => {
    const r = authorize(new Request("https://w/mcp/short"), { ...env, MCP_PATH_SECRET: "short" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/at least 32/);
  });

  it("returns 404 for unauthorized MCP requests", async () => {
    const res = await worker.fetch(new Request("https://w/mcp/nope", { method: "POST" }), env);
    expect(res.status).toBe(404);
  });
});

describe("ok", () => {
  it("drops null fields (but not undefined-turned-null array entries) and stringifies BigInt", () => {
    const result = ok({ a: null, nested: { c: null, d: 1n }, levels: [1, null, 2], score: 80 });
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed).toEqual({ nested: { d: "1" }, levels: [1, null, 2], score: 80 });
  });

  it("still serializes a genuinely-null top-level result as the literal null, not undefined", () => {
    const result = ok(null);
    expect(result.content[0]!.text).toBe("null");
  });

  it("only attaches structuredContent when asked to, reusing data as-is", () => {
    expect(ok({ a: 1 })).not.toHaveProperty("structuredContent");
    expect(ok({ a: 1 }, true).structuredContent).toEqual({ a: 1 });
  });
});

describe("bigIntSafe", () => {
  it("stringifies BigInt and drops nulls, same as the ok() text pass", () => {
    expect(bigIntSafe({ a: null, b: 1n, items: [{ c: 2n }] })).toEqual({ b: "1", items: [{ c: "2" }] });
  });
});

describe("MCP endpoint", () => {
  it("lists tools over streamable HTTP", async () => {
    const req = (body: object) =>
      new Request(`https://w/mcp/${SECRET}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
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
    expect(init.status).toBe(200);
    const list = await worker.fetch(req({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), env);
    const body = (await list.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(
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
