/**
 * Cloudflare Access JWT verification + short-lived Bearer session-token mint/verify (plan §6).
 *
 * Only the Worker side is implemented here: Access fronts `/auth/session` with its own hosted
 * email-OTP login (manual dashboard setup, out of scope for this code — see plan §6 steps 1-5) and
 * forwards a signed JWT in the `Cf-Access-Jwt-Assertion` header once that succeeds. This file
 * verifies that JWT, then mints a separate, short-lived Bearer token the SPA sends explicitly on
 * every `/api/garmin/*` call — not the Access `CF_Authorization` cookie, which would be an ambient
 * credential and a CSRF surface on the data path (plan §1). The SPA-side handshake itself (open
 * question 1) is intentionally not invented here.
 *
 * JWKS verification is hand-rolled with Web Crypto (crypto.subtle) rather than pulling in a JWT
 * library: Access JWTs are RS256, and `crypto.subtle.importKey("jwk", ...)` + `.verify()` covers
 * the whole signature check with no dependency, matching this repo's no-dependency-bloat convention
 * and the plan's stated preference to hand-roll first (plan §6 step 6).
 */

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** The one owner email Access authenticates. Not listed in the plan's wrangler.toml secrets
   *  comment, but required to implement the email check the plan's step 6 explicitly calls for. */
  ALLOWED_EMAIL: string;
}

export interface SessionEnv {
  SESSION_SIGNING_SECRET: string;
}

export class AuthError extends Error {}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface Jwk {
  kid?: string;
  kty: string;
  n: string;
  e: string;
}

interface Jwks {
  keys: Jwk[];
}

interface JwksCacheEntry {
  teamDomain: string;
  keys: Jwk[];
  fetchedAt: number;
}

/** Isolate-memory cache for the team's JWKS, mirroring the token cache in src/garmin/client.ts. */
let jwksCache: JwksCacheEntry | undefined;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Test hook. */
export function resetJwksCache(): void {
  jwksCache = undefined;
}

async function fetchJwks(teamDomain: string): Promise<Jwk[]> {
  if (jwksCache && jwksCache.teamDomain === teamDomain && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new AuthError(`Failed to fetch Access JWKS (HTTP ${res.status})`);
  const body = (await res.json()) as Jwks;
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { teamDomain, keys, fetchedAt: Date.now() };
  return keys;
}

interface AccessClaims {
  email?: unknown;
  aud?: unknown;
  exp?: unknown;
}

function decodeJwtPart<T>(part: string, what: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as T;
  } catch {
    throw new AuthError(`Malformed JWT ${what}`);
  }
}

/**
 * Verify a Cloudflare Access JWT (the `Cf-Access-Jwt-Assertion` header value): RS256 signature
 * against the team's JWKS, `aud` matches `ACCESS_AUD`, not expired, and the verified `email` claim
 * equals the one allowed owner email. Returns that email on success.
 */
export async function verifyAccessJwt(token: string, env: AccessEnv): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Malformed JWT");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = decodeJwtPart<{ alg?: string; kid?: string }>(headerB64, "header");
  if (header.alg !== "RS256") throw new AuthError(`Unsupported JWT alg: ${String(header.alg)}`);

  const keys = await fetchJwks(env.ACCESS_TEAM_DOMAIN);
  const jwk = (header.kid ? keys.find((k) => k.kid === header.kid) : undefined) ?? keys[0];
  if (!jwk) throw new AuthError("No matching key in Access JWKS");

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, base64UrlToBytes(sigB64), signedData);
  if (!valid) throw new AuthError("Invalid JWT signature");

  const claims = decodeJwtPart<AccessClaims>(payloadB64, "payload");

  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new AuthError("JWT expired");

  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new AuthError("JWT aud mismatch");

  if (typeof claims.email !== "string" || claims.email !== env.ALLOWED_EMAIL) {
    throw new AuthError("Email not allowed");
  }
  return claims.email;
}

export interface SessionTokenPayload {
  sub: string;
  exp: number; // seconds since epoch
}

const SESSION_TOKEN_TTL_SECONDS = 60 * 60;

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/**
 * Mint a short-lived Bearer session token (plan §6 step 7): HMAC-SHA256 over `{ sub, exp }`, signed
 * with `SESSION_SIGNING_SECRET`. Stateless — no KV/Durable Object, verified by recomputing the HMAC.
 */
export async function mintSessionToken(
  email: string,
  env: SessionEnv,
  now: () => number = Date.now,
): Promise<{ token: string; expires_at: string }> {
  const exp = Math.floor(now() / 1000) + SESSION_TOKEN_TTL_SECONDS;
  const payload: SessionTokenPayload = { sub: email, exp };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const key = await hmacKey(env.SESSION_SIGNING_SECRET);
  const signature = await crypto.subtle.sign("HMAC", key, payloadBytes);
  const token = `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(new Uint8Array(signature))}`;
  return { token, expires_at: new Date(exp * 1000).toISOString() };
}

/**
 * Verify a session token's HMAC signature and expiry (plan §6 step 8). `/api/garmin/*` handlers
 * call this on every request; a thrown AuthError should make the SPA re-run `/auth/session`.
 */
export async function verifySessionToken(
  token: string,
  env: SessionEnv,
  now: () => number = Date.now,
): Promise<SessionTokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 2) throw new AuthError("Malformed session token");
  const [payloadB64, sigB64] = parts as [string, string];
  const payloadBytes = base64UrlToBytes(payloadB64);
  const key = await hmacKey(env.SESSION_SIGNING_SECRET);
  const valid = await crypto.subtle.verify("HMAC", key, base64UrlToBytes(sigB64), payloadBytes);
  if (!valid) throw new AuthError("Invalid session token signature");

  const payload = decodeJwtPart<SessionTokenPayload>(payloadB64, "session token payload");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < now()) throw new AuthError("Session token expired");
  return payload;
}
