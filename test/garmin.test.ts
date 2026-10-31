import { afterEach, beforeEach, describe, expect, it } from "vitest";
import nock from "nock";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  DEFAULT_BASE_URL,
  GarminApi,
  GarminClient,
  jwtExpiration,
  resetActivityCache,
  resetTokenCache,
  TOKEN_PATH,
} from "../src/garmin/index.js";
import { buildServer } from "../src/tools.js";
import { bodyBatteryDayFixture, dailySleepFixture, dailySummaryFixture, jwt, mockToken } from "./garmin-mock.js";

beforeEach(() => {
  resetTokenCache();
  resetActivityCache();
  nock.disableNetConnect();
});

afterEach(() => {
  // Every defined interceptor must have been hit, and nothing escaped to a real network call.
  expect(nock.isDone()).toBe(true);
  nock.cleanAll();
  nock.enableNetConnect();
});

describe("GarminClient", () => {
  it("exchanges the API key once, reuses the bearer token, and builds correct URLs", async () => {
    const token = mockToken("key-123");
    const authed = { reqheaders: { authorization: `Bearer ${token}` } };
    nock(DEFAULT_BASE_URL, authed)
      .get("/sleep-service/sleep/dailySleep")
      .query({ date: "2026-10-30" })
      .reply(200, dailySleepFixture("2026-10-30"));
    nock(DEFAULT_BASE_URL, authed)
      .get("/sleep-service/sleep/dailySleepSummariesByDate")
      .query({ startDate: "2026-10-01", endDate: "2026-10-30" })
      .reply(200, []);

    const c = new GarminClient({ apiKey: "key-123" });
    await c.getJson("/sleep-service/sleep/dailySleep", { date: "2026-10-30" });
    await c.getJson("/sleep-service/sleep/dailySleepSummariesByDate", { startDate: "2026-10-01", endDate: "2026-10-30" });
    // afterEach's nock.isDone() proves: one token exchange (cached for the second call), and both
    // data requests carried the bearer token at the right path and query string.
  });

  it("refreshes the token once on 401 and retries with it", async () => {
    const token1 = mockToken("k");
    nock(DEFAULT_BASE_URL, { reqheaders: { authorization: `Bearer ${token1}` } })
      .get("/activitylist-service/activities/search/activities")
      .query(true)
      .reply(401, "expired");
    const token2 = mockToken("k");
    nock(DEFAULT_BASE_URL, { reqheaders: { authorization: `Bearer ${token2}` } })
      .get("/activitylist-service/activities/search/activities")
      .query(true)
      .reply(200, []);

    const c = new GarminClient({ apiKey: "k" });
    await expect(
      c.getJson("/activitylist-service/activities/search/activities", { start: 0, limit: 20 }),
    ).resolves.toEqual([]);
  });

  it("refreshes the token proactively when it's within the window before expiry", async () => {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    mockToken("k", { nowSec, expiresInSec: 30 * 60 }); // 30 min left: inside the 1h refresh window
    mockToken("k", { nowSec }); // so a second exchange is expected on the very next call
    nock(DEFAULT_BASE_URL)
      .get("/sleep-service/sleep/dailySleep")
      .query({ date: "2026-10-30" })
      .twice()
      .reply(200, dailySleepFixture("2026-10-30"));

    const c = new GarminClient({ apiKey: "k", now: () => nowMs });
    await c.getJson("/sleep-service/sleep/dailySleep", { date: "2026-10-30" });
    // afterEach's nock.isDone() proves this didn't reuse the near-expiry token: a second token
    // exchange had to happen, not just a second data request on the first token.
    await c.getJson("/sleep-service/sleep/dailySleep", { date: "2026-10-30" });
  });

  it("explains a bad API key", async () => {
    nock(DEFAULT_BASE_URL).post(TOKEN_PATH).reply(403, "nope");
    const c = new GarminClient({ apiKey: "bad" });
    await expect(c.getJson("/sleep-service/sleep/dailySleep", { date: "2026-10-30" })).rejects.toThrow(
      /personal API key is valid/,
    );
  });

  it("rejects bad activity ids and paths without any network call", async () => {
    const c = new GarminClient({ apiKey: "k" });
    await expect(c.downloadActivity("../x")).rejects.toThrow(/positive integer/);
    await expect(c.getJson("https://evil.example/x")).rejects.toThrow(/Invalid API path/);
    await expect(c.getJson("//evil.example/x")).rejects.toThrow(/Invalid API path/);
  });

  it("explains network failures with the underlying reason, not just \"fetch failed\"", async () => {
    mockToken("k");
    nock(DEFAULT_BASE_URL)
      .get("/sleep-service/sleep/dailySleep")
      .query({ date: "2026-10-30" })
      .replyWithError(new Error("network down"));

    const c = new GarminClient({ apiKey: "k" });
    await expect(c.getJson("/sleep-service/sleep/dailySleep", { date: "2026-10-30" })).rejects.toThrow(
      /Could not reach Garmin.*network down/,
    );
  });

  it("reads the JWT exp claim", () => {
    expect(jwtExpiration(jwt(1234))).toBe(1234);
  });

  it("caches a downloaded activity file across calls, per isolate", async () => {
    mockToken("k");
    nock(DEFAULT_BASE_URL).get("/download-service/files/activity/123").reply(200, Buffer.from([1, 2, 3]));
    nock(DEFAULT_BASE_URL).get("/download-service/files/activity/456").reply(200, Buffer.from([4, 5, 6]));

    const c = new GarminClient({ apiKey: "k" });
    await c.downloadActivity("123");
    // Served from the isolate cache: if it weren't, this would hit the network with no interceptor
    // left to match, and nock.disableNetConnect() would fail the test.
    await c.downloadActivity("123");
    await c.downloadActivity("456");
  });
});

describe("GarminApi", () => {
  it("unwraps dailySummaries' { data: [...] } envelope", async () => {
    mockToken("k");
    nock(DEFAULT_BASE_URL)
      .get("/usersummary-service/v2/dailysummaries")
      .query({ startDate: "2026-10-29", endDate: "2026-10-29" })
      .reply(200, { data: [dailySummaryFixture("2026-10-29")] });

    const api = new GarminApi(new GarminClient({ apiKey: "k" }));
    await expect(api.dailySummaries("2026-10-29", "2026-10-29")).resolves.toEqual([
      dailySummaryFixture("2026-10-29"),
    ]);
  });
});

describe("get_body_battery_series", () => {
  // Mirrors src/index.ts: a fresh server + transport per request (stateless, no shared session).
  async function send(client: GarminClient, body: object) {
    const server = buildServer(client);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(
      new Request("https://w/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
      }),
    );
  }

  async function callToolRaw(client: GarminClient, name: string, args: object) {
    await send(client, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    const res = await send(client, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
    const body = (await res.json()) as {
      result: { content: { text: string }[]; structuredContent?: unknown; isError?: boolean };
    };
    return body.result;
  }

  async function callTool(client: GarminClient, name: string, args: object) {
    const result = await callToolRaw(client, name, args);
    return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
  }

  it("get_sleep has no confirmed long-array field, so even a long array passes through untouched", async () => {
    mockToken("k");
    const sleepLevels = Array.from({ length: 50 }, (_, i) => ({ level: i }));
    nock(DEFAULT_BASE_URL)
      .get("/sleep-service/sleep/dailySleep")
      .query({ date: "2026-10-30" })
      .reply(200, dailySleepFixture("2026-10-30", { sleepLevels }));

    const client = new GarminClient({ apiKey: "k" });
    const sleep = await callTool(client, "get_sleep", { date: "2026-10-30" });
    expect(sleep.sleepLevels).toEqual(sleepLevels);
  });

  it("pages through one day's array omitted by get_body_battery, keyed by `date` not calendarDate", async () => {
    mockToken("k"); // one exchange, cached for the second (get_body_battery_series) call
    const bodyBatteryValuesArray = Array.from({ length: 40 }, (_, i) => [i, i]);
    const days = [bodyBatteryDayFixture("2026-10-28"), bodyBatteryDayFixture("2026-10-29", { bodyBatteryValuesArray })];
    nock(DEFAULT_BASE_URL)
      .get("/wellness-service/wellness/bodyBattery/reports/daily")
      .query({ startDate: "2026-10-28", endDate: "2026-10-29" })
      .reply(200, days)
      .get("/wellness-service/wellness/bodyBattery/reports/daily")
      .query({ startDate: "2026-10-29", endDate: "2026-10-29" })
      .reply(200, [days[1]]);

    const client = new GarminClient({ apiKey: "k" });
    const page = await callTool(client, "get_body_battery", { start_date: "2026-10-28", end_date: "2026-10-29" });
    const items = (page as { items: { bodyBatteryValuesArray: { omitted_items: number; ref: unknown } }[] }).items;
    const stub = items[0]!.bodyBatteryValuesArray; // newest-first, so 10-29 is items[0]
    expect(stub.omitted_items).toBe(40);
    expect(stub.ref).toEqual({ source: "body_battery", date: "2026-10-29" });

    const result = await callToolRaw(client, "get_body_battery_series", { ref: stub.ref });
    const expected = { total: 40, start: 0, limit: 200, items: bodyBatteryValuesArray };
    expect(JSON.parse(result.content[0]!.text)).toEqual(expected);
    // Also confirms the SDK's own server-side validation of structuredContent against our
    // outputSchema actually passes — a schema mismatch here would come back as an McpError instead
    // of a normal tool result, which result.isError/content wouldn't even get this far to assert on.
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(expected);
  });
});
