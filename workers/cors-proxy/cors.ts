/**
 * Origin-allowlist CORS header helper for the cors-proxy Worker (see plan §5). Exact string match
 * only against a comma-separated allowlist — never a wildcard or pattern.
 *
 * A non-matching Origin gets no CORS headers at all: the browser blocks the page's JS from reading
 * the response, but a non-browser client can still call the API directly. CORS is not the security
 * boundary here — the Bearer session-token check in auth.ts/routes.ts is. CORS only controls which
 * web pages' JS may *read* a cross-origin response.
 */

export interface CorsEnv {
  /** Comma-separated exact origins, e.g. "http://localhost:8081,https://app.example.com". */
  ALLOWED_ORIGINS: string;
}

function parseAllowedOrigins(env: CorsEnv): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Exact match of the request's Origin header against the allowlist, or undefined if absent/unmatched. */
export function matchOrigin(request: Request, env: CorsEnv): string | undefined {
  const origin = request.headers.get("Origin");
  if (!origin) return undefined;
  return parseAllowedOrigins(env).includes(origin) ? origin : undefined;
}

/** Attach Access-Control-Allow-Origin to a response, only when the request's Origin exactly
 *  matches the allowlist. Used on every response, success and error alike. */
export function withCors(response: Response, request: Request, env: CorsEnv): Response {
  const origin = matchOrigin(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Explicit OPTIONS preflight handling, per plan §5: 204, with Allow-Methods/Allow-Headers/Max-Age
 *  always set, and Allow-Origin set only when the request's Origin matches the allowlist. */
export function preflightResponse(request: Request, env: CorsEnv): Response {
  const origin = matchOrigin(request, env);
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(null, { status: 204, headers });
}
