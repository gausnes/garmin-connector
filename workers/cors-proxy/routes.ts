/**
 * REST handlers for the cors-proxy Worker (plan §5): same `GarminApi`/`GarminClient` calls the MCP
 * connector's tools.ts already makes, over plain JSON instead of MCP's content/structuredContent
 * wrapping. src/responses/ (page.ts, activity.ts, mcp-result.ts, body-battery.ts) is MCP-result-
 * shaped and deliberately not reused here — a plain `Response.json(result)` is enough.
 */
import { decodeFitMessages } from "../../src/fit.ts";
import type { GarminApi, GarminClient } from "../../src/garmin/index.ts";
import { bigIntSafe } from "../../src/responses/index.ts";
import { AuthError, mintSessionToken, verifyAccessJwt, verifySessionToken, type AccessEnv, type SessionEnv } from "./auth.ts";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function unauthorized(message: string): Response {
  return json({ error: message }, 401);
}

/** Verifies the `Authorization: Bearer <session token>` header required on every /api/garmin/*
 *  route. Returns an unauthorized Response if missing/invalid/expired, or null if the caller may
 *  proceed. Stateless — no Garmin call happens before this check passes. */
async function requireSession(request: Request, env: SessionEnv): Promise<Response | null> {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return unauthorized("Missing bearer session token");
  try {
    await verifySessionToken(match[1]!, env);
    return null;
  } catch (err) {
    return unauthorized(err instanceof AuthError ? err.message : "Invalid session token");
  }
}

/**
 * GET /auth/session — gated by Cloudflare Access on the path itself (manual dashboard setup, plan
 * §6 steps 1-5, not part of this code). Access forwards a signed JWT in `Cf-Access-Jwt-Assertion`
 * once its own hosted login succeeds; this verifies that JWT and mints the short-lived Bearer
 * session token the SPA then sends explicitly on data calls.
 */
export async function handleAuthSession(request: Request, env: AccessEnv & SessionEnv): Promise<Response> {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) return unauthorized("Missing Cf-Access-Jwt-Assertion header");
  try {
    const email = await verifyAccessJwt(jwt, env);
    return json(await mintSessionToken(email, env));
  } catch (err) {
    return unauthorized(err instanceof AuthError ? err.message : "Access JWT verification failed");
  }
}

/** GET /api/garmin/activities — same query params as list_activities in tools.ts, Garmin's array
 *  returned directly as the response body (no MCP paging/summarizing wrapper). */
export async function handleActivities(request: Request, env: SessionEnv, api: GarminApi, url: URL): Promise<Response> {
  const denied = await requireSession(request, env);
  if (denied) return denied;

  const q = url.searchParams;
  const data = await api.searchActivities({
    startDate: q.get("startDate") ?? undefined,
    endDate: q.get("endDate") ?? undefined,
    start: q.has("start") ? Number(q.get("start")) : undefined,
    limit: q.has("limit") ? Number(q.get("limit")) : undefined,
    activityType: q.get("activityType") ?? undefined,
  });
  return json(data);
}

/** GET /api/garmin/activities/:id — Garmin's full activity detail, returned as-is. */
export async function handleActivity(
  request: Request,
  env: SessionEnv,
  api: GarminApi,
  activityId: string,
): Promise<Response> {
  const denied = await requireSession(request, env);
  if (denied) return denied;

  return json(await api.activity(activityId));
}

/** GET /api/garmin/activities/:id/fit — same decode logic/paging/truncation behavior as the MCP
 *  connector's get_activity_fit tool (src/fit.ts), over the activity's downloaded FIT file. */
export async function handleActivityFit(
  request: Request,
  env: SessionEnv,
  garmin: GarminClient,
  activityId: string,
  url: URL,
): Promise<Response> {
  const denied = await requireSession(request, env);
  if (denied) return denied;

  const q = url.searchParams;
  const messageTypes = q.get("message_types");
  const file = await garmin.downloadActivity(activityId);
  const page = decodeFitMessages(file, {
    types: messageTypes
      ? messageTypes
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined,
    offset: q.has("offset") ? Number(q.get("offset")) : undefined,
    limit: q.has("limit") ? Number(q.get("limit")) : undefined,
  });
  // Response.json() runs JSON.stringify with no replacer, which throws on BigInt — the one thing
  // FIT-decoded data can contain (src/responses/mcp-result.ts). bigIntSafe is a generic JSON
  // sanitizer, not the MCP content/structuredContent wrapping this file otherwise avoids reusing,
  // so reusing just this helper doesn't pull MCP result-shaping back in.
  return json(bigIntSafe(page));
}
