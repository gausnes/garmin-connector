import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchOrigin, preflightResponse, withCors } from "../../workers/cors-proxy/cors.ts";

const env = { ALLOWED_ORIGINS: "http://localhost:8081, https://app.example.com" };

describe("withCors", () => {
  it("reflects back an exactly-matching Origin", () => {
    const req = new Request("https://w/api/garmin/activities", { headers: { Origin: "http://localhost:8081" } });
    const res = withCors(new Response("ok"), req, env);
    assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:8081");
  });

  it("adds no CORS headers at all for a non-matching Origin", () => {
    const req = new Request("https://w/api/garmin/activities", { headers: { Origin: "https://evil.example" } });
    const res = withCors(new Response("ok"), req, env);
    assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("adds no CORS headers when there is no Origin header at all (non-browser client)", () => {
    const req = new Request("https://w/api/garmin/activities");
    const res = withCors(new Response("ok"), req, env);
    assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("never reflects a wildcard, even if ALLOWED_ORIGINS somehow contained one", () => {
    const req = new Request("https://w/x", { headers: { Origin: "https://anything.example" } });
    const res = withCors(new Response("ok"), req, { ALLOWED_ORIGINS: "*" });
    assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("preserves the wrapped response's status and body", async () => {
    const req = new Request("https://w/x", { headers: { Origin: "http://localhost:8081" } });
    const res = withCors(Response.json({ error: "nope" }, { status: 401 }), req, env);
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(await res.json(), { error: "nope" });
  });
});

describe("matchOrigin", () => {
  it("matches exactly, not as a prefix/substring", () => {
    const req = new Request("https://w/x", { headers: { Origin: "http://localhost:80810" } });
    assert.strictEqual(matchOrigin(req, env), undefined);
  });
});

describe("preflightResponse", () => {
  it("handles an OPTIONS preflight: 204, allow-methods/headers/max-age always set", () => {
    const req = new Request("https://w/api/garmin/activities", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:8081" },
    });
    const res = preflightResponse(req, env);
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:8081");
    assert.strictEqual(res.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
    assert.strictEqual(res.headers.get("Access-Control-Allow-Headers"), "Authorization, Content-Type");
    assert.strictEqual(res.headers.get("Access-Control-Max-Age"), "600");
  });

  it("still responds 204 for a non-matching Origin, but without Allow-Origin", () => {
    const req = new Request("https://w/api/garmin/activities", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    const res = preflightResponse(req, env);
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), null);
  });
});
