import { beforeEach, describe, expect, it } from "vitest";
import worker, { authorize, safeEqual, type Env } from "../src/index.js";
import { GarminClient, jwtExpiration, resetTokenCache, TOKEN_PATH } from "../src/garmin.js";
import { compact } from "../src/compact.js";

const SECRET = "s".repeat(40);
const env: Env = { GARMIN_API_KEY: "key-123", MCP_PATH_SECRET: SECRET };

function jwt(expSec: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64({ exp: expSec })}.sig`;
}

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

describe("GarminClient", () => {
  beforeEach(() => resetTokenCache());

  it("exchanges the API key once and reuses the bearer token", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const now = Date.parse("2026-10-30T00:00:00Z");
    const token = jwt(now / 1000 + 24 * 3600);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("Authorization");
      calls.push({ url, auth });
      if (url.endsWith(TOKEN_PATH)) return new Response(token);
      return Response.json({ ok: true, url });
    }) as typeof fetch;

    const c = new GarminClient({ apiKey: "key-123", fetchImpl, now: () => now });
    await c.dailySleep("2026-10-30");
    await c.sleepSummaries("2026-10-01", "2026-10-30");

    expect(calls.filter((x) => x.url.endsWith(TOKEN_PATH))).toHaveLength(1);
    expect(calls[0]!.auth).toBe("ApiKey key-123");
    expect(calls[1]!.url).toBe(
      "https://personal.connectapi.garmin.com/sleep-service/sleep/dailySleep?date=2026-10-30",
    );
    expect(calls[1]!.auth).toBe(`Bearer ${token}`);
    expect(calls[2]!.url).toContain("dailySleepSummariesByDate?startDate=2026-10-01&endDate=2026-10-30");
  });

  it("refreshes the token once on 401", async () => {
    let tokenCalls = 0;
    let dataCalls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(TOKEN_PATH)) {
        tokenCalls++;
        return new Response(jwt(Date.now() / 1000 + 86400));
      }
      dataCalls++;
      return dataCalls === 1 ? new Response("expired", { status: 401 }) : Response.json([]);
    }) as typeof fetch;
    const c = new GarminClient({ apiKey: "k", fetchImpl });
    await expect(c.searchActivities({})).resolves.toEqual([]);
    expect(tokenCalls).toBe(2);
  });

  it("explains a bad API key", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    const c = new GarminClient({ apiKey: "bad", fetchImpl });
    await expect(c.dailySleep("2026-10-30")).rejects.toThrow(/personal API key is valid/);
  });

  it("rejects bad activity ids and paths", async () => {
    const c = new GarminClient({ apiKey: "k", fetchImpl: (async () => new Response("")) as never });
    await expect(c.activity("../x")).rejects.toThrow(/positive integer/);
    await expect(c.getJson("https://evil.example/x")).rejects.toThrow(/Invalid API path/);
    await expect(c.getJson("//evil.example/x")).rejects.toThrow(/Invalid API path/);
  });

  it("explains network failures", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const c = new GarminClient({ apiKey: "k", fetchImpl });
    await expect(c.dailySleep("2026-10-30")).rejects.toThrow(/Could not reach Garmin.*network down/);
  });

  it("reads the JWT exp claim", () => {
    expect(jwtExpiration(jwt(1234))).toBe(1234);
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
        "analyze_activity",
        "garmin_get",
        "get_activity",
        "get_activity_fit",
        "get_body_battery",
        "get_daily_summaries",
        "get_hrv",
        "get_sleep",
        "get_sleep_range",
        "list_activities",
      ].sort(),
    );
  });
});
