import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { GarminClient } from "./garmin/index.ts";
import { buildServer } from "./tools.ts";

export interface Env {
  /** Garmin Connect personal API key (wrangler secret). */
  GARMIN_API_KEY: string;
  /** Long random string; the MCP endpoint lives at /mcp/<MCP_PATH_SECRET> (wrangler secret). */
  MCP_PATH_SECRET: string;
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
 * Accept the secret either in the path (/mcp/<secret>, for claude.ai custom
 * connectors, which take a URL) or as a bearer token on /mcp (for clients that
 * can send headers, e.g. Claude Code).
 */
export function authorize(request: Request, env: Env): { ok: boolean; reason?: string } {
  const secret = env.MCP_PATH_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    return { ok: false, reason: `MCP_PATH_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters` };
  }
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "mcp") return { ok: false };
  if (parts.length === 2 && safeEqual(parts[1]!, secret)) return { ok: true };
  if (parts.length === 1) {
    const auth = request.headers.get("Authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m && safeEqual(m[1]!.trim(), secret)) return { ok: true };
  }
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
