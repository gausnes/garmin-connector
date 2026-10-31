/**
 * Minimal client for the official Garmin Connect Personal API.
 *
 * Auth flow (per Garmin's reference client, garmin/connect-personal-api-python):
 *   POST {base}/personalapitoken-service/personal-api/personal-api-key/token
 *     Authorization: ApiKey <personal API key>
 *   -> response body is a raw JWT bearer token (~24h lifetime, `exp` claim).
 * Data requests then use `Authorization: Bearer <token>`.
 */

export const DEFAULT_BASE_URL = "https://personal.connectapi.garmin.com";
export const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

/** Refresh the bearer token when less than this many seconds remain. */
const REFRESH_WINDOW_SECONDS = 60 * 60;

export class GarminApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "GarminApiError";
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // seconds since epoch
  keyFingerprint: string;
}

// Module-level cache: survives across requests within one Worker isolate.
let tokenCache: CachedToken | undefined;

/** Test hook. */
export function resetTokenCache(): void {
  tokenCache = undefined;
}

export function jwtExpiration(token: string): number {
  const part = token.split(".")[1];
  if (!part) throw new GarminApiError("Token endpoint did not return a JWT");
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
  let payload: unknown;
  try {
    payload = JSON.parse(atob(b64));
  } catch {
    throw new GarminApiError("Token endpoint returned an unreadable JWT");
  }
  const exp = (payload as { exp?: unknown }).exp;
  if (typeof exp !== "number") throw new GarminApiError("JWT has no exp claim");
  return exp;
}

async function fingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface GarminClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number; // ms since epoch
}

export class GarminClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(opts: GarminClientOptions) {
    if (!opts.apiKey) throw new GarminApiError("GARMIN_API_KEY is not configured");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const rawFetch = opts.fetchImpl ?? fetch.bind(globalThis);
    this.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        return await rawFetch(input, init);
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        throw new GarminApiError(`Could not reach Garmin (${new URL(String(input)).host}): ${why}`);
      }
    }) as typeof fetch;
    this.now = opts.now ?? Date.now;
  }

  private async token(forceRefresh = false): Promise<string> {
    const fp = await fingerprint(`${this.baseUrl}\0${this.apiKey}`);
    const nowSec = this.now() / 1000;
    if (
      !forceRefresh &&
      tokenCache &&
      tokenCache.keyFingerprint === fp &&
      tokenCache.expiresAt - nowSec > REFRESH_WINDOW_SECONDS
    ) {
      return tokenCache.accessToken;
    }
    const res = await this.fetchImpl(`${this.baseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: { Accept: "*/*", Authorization: `ApiKey ${this.apiKey}` },
    });
    const text = (await res.text()).trim();
    if (!res.ok) {
      throw new GarminApiError(
        `Token exchange failed (HTTP ${res.status}). Check that the Garmin personal API key is valid and not expired.`,
        res.status,
        text.slice(0, 500),
      );
    }
    tokenCache = { accessToken: text, expiresAt: jwtExpiration(text), keyFingerprint: fp };
    return text;
  }

  private async request(path: string, accept: string): Promise<Response> {
    if (!path.startsWith("/") || path.startsWith("//") || /[\s]/.test(path)) {
      throw new GarminApiError(`Invalid API path: ${path}`);
    }
    const url = `${this.baseUrl}${path}`;
    const doFetch = async (token: string) =>
      this.fetchImpl(url, { headers: { Accept: accept, Authorization: `Bearer ${token}` } });

    let res = await doFetch(await this.token());
    if (res.status === 401) {
      // Token may have been revoked or expired early; retry once with a fresh one.
      res = await doFetch(await this.token(true));
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 1000);
      throw new GarminApiError(`GET ${path} failed with HTTP ${res.status}`, res.status, body);
    }
    return res;
  }

  /** GET a path and return parsed JSON, or null for an empty body. */
  async getJson(path: string, params?: Record<string, string | number | undefined>): Promise<unknown> {
    const res = await this.request(withQuery(path, params), "application/json");
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new GarminApiError(`GET ${path} returned non-JSON content`, res.status, text.slice(0, 500));
    }
  }

  /** Download the original activity file (Garmin returns a ZIP). */
  async downloadActivity(activityId: string): Promise<Uint8Array> {
    assertActivityId(activityId);
    const res = await this.request(
      `/download-service/files/activity/${activityId}`,
      "application/zip, application/x-zip-compressed, application/octet-stream",
    );
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0) throw new GarminApiError("Activity download was empty");
    return buf;
  }

  // ---- Typed wrappers (endpoint paths from Garmin's reference client) ----

  dailySleep(date: string) {
    return this.getJson("/sleep-service/sleep/dailySleep", { date });
  }
  sleepSummaries(startDate: string, endDate: string) {
    return this.getJson("/sleep-service/sleep/dailySleepSummariesByDate", { startDate, endDate });
  }
  dailySummaries(startDate: string, endDate: string) {
    return this.getJson("/usersummary-service/v2/dailysummaries", { startDate, endDate });
  }
  hrvSummaries(startDate: string, endDate: string) {
    return this.getJson(`/hrv-service/hrv/daily/${startDate}/${endDate}`);
  }
  bodyBattery(startDate: string, endDate: string) {
    return this.getJson("/wellness-service/wellness/bodyBattery/reports/daily", { startDate, endDate });
  }
  dailyHeartRate(date: string) {
    return this.getJson("/wellness-service/wellness/dailyHeartRate", { date });
  }
  searchActivities(opts: {
    start?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    activityType?: string;
  }) {
    return this.getJson("/activitylist-service/activities/search/activities", {
      start: opts.start ?? 0,
      limit: opts.limit ?? 20,
      startDate: opts.startDate,
      endDate: opts.endDate,
      activityType: opts.activityType,
    });
  }
  async activity(activityId: string) {
    assertActivityId(activityId);
    return this.getJson(`/activity-service/activity/${activityId}`);
  }
}

export function assertActivityId(id: string): void {
  if (!/^[1-9]\d*$/.test(id)) throw new GarminApiError("activity_id must be a positive integer");
}

export function withQuery(path: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}${path.includes("?") ? "&" : "?"}${s}` : path;
}
