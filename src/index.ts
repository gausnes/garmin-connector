import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { GarminClient } from "./garmin/index.ts";
import { buildServer } from "./tools.ts";

export interface Env {
  /** Garmin Connect personal API key (wrangler secret). */
  GARMIN_API_KEY: string;
  /** Long random string; sent as the `access-key` header on /mcp (wrangler secret). */
  MCP_ACCESS_KEY: string;
  /** Optional override, mainly for tests. */
  GARMIN_BASE_URL?: string;
}

const MIN_SECRET_LENGTH = 32;

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/**
 * Accept the secret only as an `access-key` header on /mcp. claude.ai custom
 * connectors reserve `Authorization` for OAuth, so a plain header is used
 * instead of a bearer token or a path segment.
 */
export function authorize(request: Request, env: Env): { ok: boolean; reason?: string } {
  const secret = env.MCP_ACCESS_KEY ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    return { ok: false, reason: `MCP_ACCESS_KEY must be set and at least ${MIN_SECRET_LENGTH} characters` };
  }
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 1 || parts[0] !== "mcp") return { ok: false };
  const accessKey = request.headers.get("access-key");
  if (accessKey && safeEqual(accessKey.trim(), secret)) return { ok: true };
  return { ok: false };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("garmin-connector: ok\n", { headers: { "content-type": "text/plain" } });
    }

    const auth = authorize(request, env);
    if (!auth.ok) {
      if (auth.reason) return new Response(`Server misconfigured: ${auth.reason}\n`, { status: 500 });
      return new Response("Not found\n", { status: 404 }); // don't reveal the endpoint exists
    }

    // Stateless MCP: a fresh server + transport per request, JSON responses (no SSE sessions).
    const garmin = new GarminClient({ apiKey: env.GARMIN_API_KEY, baseUrl: env.GARMIN_BASE_URL });
    const server = buildServer(garmin);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
