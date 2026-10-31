import { describe, expect, it } from "vitest";
import worker, { authorize, safeEqual, type Env } from "../src/index.js";
import { compact } from "../src/compact.js";

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

describe("compact", () => {
  it("summarizes long arrays and drops nulls", () => {
    const out = compact({ a: null, levels: Array.from({ length: 100 }, (_, i) => i), score: 80 }) as Record<
      string,
      unknown
    >;
    expect(out.a).toBeUndefined();
    expect(out.score).toBe(80);
    expect((out.levels as { omitted_items: number }).omitted_items).toBe(100);
  });

  it("attaches a get_timeseries ref with the array's path, when given one", () => {
    const out = compact(
      { nested: { levels: Array.from({ length: 50 }, (_, i) => i) } },
      { ref: { source: "sleep", args: { date: "2026-10-30" } } },
    ) as { nested: { levels: { ref: unknown; omitted_items: number } } };
    expect(out.nested.levels.omitted_items).toBe(50);
    expect(out.nested.levels.ref).toEqual({
      source: "sleep",
      args: { date: "2026-10-30" },
      path: ["nested", "levels"],
    });
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
        "garmin_get",
        "get_activity",
        "get_activity_fit",
        "get_body_battery",
        "get_daily_summaries",
        "get_hrv",
        "get_sleep",
        "get_sleep_range",
        "get_timeseries",
        "list_activities",
      ].sort(),
    );
  });
});
