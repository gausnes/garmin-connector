/**
 * Worker entry for the cors-proxy: a second, independently-deployable Worker in this repo (plan
 * §1) that fronts a browser-reachable subset of the Garmin Personal API for bridger's Web target,
 * reusing src/garmin/ with zero duplication. Unlike src/index.ts (the MCP connector), this Worker
 * never changes that one's behavior or deployment — separate wrangler.toml, separate routes.
 */
import { GarminApi, GarminClient, GarminApiError } from "../../src/garmin/index.ts";
import { preflightResponse, withCors, type CorsEnv } from "./cors.ts";
import type { AccessEnv, SessionEnv } from "./auth.ts";
import { handleActivities, handleActivity, handleActivityFit, handleAuthSession } from "./routes.ts";

export interface Env extends CorsEnv, AccessEnv, SessionEnv {
  /** Garmin Connect personal API key (wrangler secret). Defaults to reusing the MCP connector's
   *  secret of the same name — see open question 5, wrangler.toml. */
  GARMIN_API_KEY: string;
  /** Optional override, mainly for tests. */
  GARMIN_BASE_URL?: string;
}

async function route(request: Request, url: URL, env: Env): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && parts.length === 2 && parts[0] === "auth" && parts[1] === "session") {
    return handleAuthSession(request, env);
  }

  if (parts[0] === "api" && parts[1] === "garmin" && parts[2] === "activities") {
    const garmin = new GarminClient({ apiKey: env.GARMIN_API_KEY, baseUrl: env.GARMIN_BASE_URL });
    const api = new GarminApi(garmin);

    if (request.method === "GET" && parts.length === 3) {
      return handleActivities(request, env, api, url);
    }
    if (request.method === "GET" && parts.length === 4) {
      return handleActivity(request, env, api, parts[3]!);
    }
    if (request.method === "GET" && parts.length === 5 && parts[4] === "fit") {
      return handleActivityFit(request, env, garmin, parts[3]!, url);
    }
  }

  return new Response("Not found\n", { status: 404 });
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response("garmin-cors-proxy: ok\n", { headers: { "content-type": "text/plain" } });
  }
  try {
    return await route(request, url, env);
  } catch (err) {
    const status = err instanceof GarminApiError && err.status ? err.status : 500;
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Preflight gets CORS headers from preflightResponse itself; every other response (success and
    // error alike, per plan §5) is wrapped by withCors on the way out.
    if (request.method === "OPTIONS") return preflightResponse(request, env);
    return withCors(await handle(request, env), request, env);
  },
} satisfies ExportedHandler<Env>;
