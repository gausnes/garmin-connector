import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import nock from "nock";
import {
  DEFAULT_BASE_URL,
  GarminApi,
  GarminClient,
  resetActivityCache,
  resetTokenCache,
} from "../../src/garmin/index.ts";
import { mintSessionToken, type SessionEnv } from "../../workers/cors-proxy/auth.ts";
import { handleActivities, handleActivity, handleActivityFit } from "../../workers/cors-proxy/routes.ts";
import worker, { type Env } from "../../workers/cors-proxy/index.ts";
import { mockToken } from "../garmin-mock.ts";
import { makeFit, resortDay, zip } from "../fixtures.ts";

const SESSION_SECRET = "s".repeat(40);
const sessionEnv: SessionEnv = { SESSION_SIGNING_SECRET: SESSION_SECRET };
const fullEnv: Env = {
  GARMIN_API_KEY: "key-123",
  SESSION_SIGNING_SECRET: SESSION_SECRET,
  ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com",
  ACCESS_AUD: "test-aud",
  ALLOWED_EMAIL: "owner@example.com",
  ALLOWED_ORIGINS: "http://localhost:8081",
};

beforeEach(() => {
  resetTokenCache();
  resetActivityCache();
  nock.disableNetConnect();
});

afterEach(() => {
  assert.strictEqual(nock.isDone(), true);
  nock.cleanAll();
  nock.enableNetConnect();
});

async function bearer(): Promise<string> {
  return (await mintSessionToken("owner@example.com", sessionEnv)).token;
}

describe("handleActivities", () => {
  it("401s without touching Garmin when no bearer session token is sent", async () => {
    const api = new GarminApi(new GarminClient({ apiKey: "key-123" }));
    const req = new Request("https://w/api/garmin/activities");
    const res = await handleActivities(req, sessionEnv, api, new URL(req.url));
    assert.strictEqual(res.status, 401);
  });

  it("returns searchActivities' array directly, forwarding list_activities' query params", async () => {
    mockToken("key-123");
    nock(DEFAULT_BASE_URL)
      .get("/activitylist-service/activities/search/activities")
      .query({ start: "5", limit: "10", startDate: "2026-10-01", endDate: "2026-10-30", activityType: "cycling" })
      .reply(200, [{ activityId: 1 }]);

    const client = new GarminClient({ apiKey: "key-123" });
    const api = new GarminApi(client);
    const token = await bearer();
    const req = new Request(
      "https://w/api/garmin/activities?start=5&limit=10&startDate=2026-10-01&endDate=2026-10-30&activityType=cycling",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const res = await handleActivities(req, sessionEnv, api, new URL(req.url));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), [{ activityId: 1 }]);
  });
});

describe("handleActivity", () => {
  it("returns Garmin's full activity detail as-is, no MCP wrapper", async () => {
    mockToken("key-123");
    nock(DEFAULT_BASE_URL)
      .get("/activity-service/activity/42")
      .reply(200, { activityId: 42, activityName: "Morning ride" });

    const client = new GarminClient({ apiKey: "key-123" });
    const api = new GarminApi(client);
    const token = await bearer();
    const req = new Request("https://w/api/garmin/activities/42", { headers: { Authorization: `Bearer ${token}` } });
    const res = await handleActivity(req, sessionEnv, api, "42");
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { activityId: 42, activityName: "Morning ride" });
  });
});

describe("handleActivityFit", () => {
  it("decodes the downloaded FIT file with the same paging behavior as get_activity_fit, BigInt-safe", async () => {
    mockToken("key-123");
    const file = zip("a.fit", makeFit(resortDay(1)));
    nock(DEFAULT_BASE_URL).get("/download-service/files/activity/99").reply(200, Buffer.from(file));

    const client = new GarminClient({ apiKey: "key-123" });
    const token = await bearer();
    const req = new Request("https://w/api/garmin/activities/99/fit?message_types=recordMesgs&offset=0&limit=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleActivityFit(req, sessionEnv, client, "99", new URL(req.url));
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      messages: { recordMesgs: unknown[] };
      counts: { recordMesgs: number };
      counts_exact: boolean;
    };
    // offset(0) + limit(5): decoding stops as soon as 5 recordMesgs are seen, so counts is a lower
    // bound (5), not the file's true total of 60 — same truncation behavior as get_activity_fit.
    assert.strictEqual(body.counts.recordMesgs, 5);
    assert.strictEqual(body.counts_exact, false);
    assert.strictEqual(body.messages.recordMesgs.length, 5);
  });
});

describe("full Worker dispatch (index.ts)", () => {
  it("answers /health with no Origin-dependent CORS headers needed", async () => {
    const res = await worker.fetch(new Request("https://w/health"), fullEnv);
    assert.strictEqual(res.status, 200);
  });

  it("handles an OPTIONS preflight for a matching Origin", async () => {
    const res = await worker.fetch(
      new Request("https://w/api/garmin/activities", { method: "OPTIONS", headers: { Origin: "http://localhost:8081" } }),
      fullEnv,
    );
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:8081");
  });

  it("404s an unknown path, still with CORS headers for a matching Origin", async () => {
    const res = await worker.fetch(
      new Request("https://w/nope", { headers: { Origin: "http://localhost:8081" } }),
      fullEnv,
    );
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:8081");
  });

  it("401s /auth/session when Access's Cf-Access-Jwt-Assertion header is missing", async () => {
    const res = await worker.fetch(new Request("https://w/auth/session"), fullEnv);
    assert.strictEqual(res.status, 401);
  });

  it("routes GET /api/garmin/activities/:id end to end, with CORS applied to a real data response", async () => {
    mockToken("key-123");
    nock(DEFAULT_BASE_URL).get("/activity-service/activity/7").reply(200, { activityId: 7 });

    const token = await bearer();
    const res = await worker.fetch(
      new Request("https://w/api/garmin/activities/7", {
        headers: { Authorization: `Bearer ${token}`, Origin: "http://localhost:8081" },
      }),
      fullEnv,
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:8081");
    assert.deepStrictEqual(await res.json(), { activityId: 7 });
  });
});
