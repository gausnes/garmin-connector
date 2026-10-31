/**
 * Response modeling shared by the MCP tool handlers in tools.ts: paging date-range arrays,
 * summarizing activities, resolving a get_timeseries ref back to its source array, and wrapping
 * handler results/errors into MCP content. Builds on compact.ts's array-truncation/ref handling.
 */
import { compact, stripNullish, type CompactRef } from "./compact.js";
import { GarminApiError, type GarminApi, type GarminClient } from "./garmin/index.js";

export interface Page {
  total: number;
  start: number;
  limit: number;
  items: unknown[];
}

/**
 * Page a date-range array newest-first. Items are compacted individually unless `full` is set.
 * `itemRef`, when given, builds the get_timeseries ref for one item (e.g. from its date field) so a
 * long array inside that item can be paged on its own instead of requiring `full`/include_timeseries.
 */
export function paginate(
  data: unknown,
  opts: { start?: number; limit?: number },
  full = false,
  itemRef?: (item: unknown) => CompactRef | undefined,
): unknown {
  if (!Array.isArray(data)) return full ? data : compact(data);
  const items = [...data].reverse();
  const start = Math.max(0, Math.floor(opts.start ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 20)));
  const page: Page = {
    total: items.length,
    start,
    limit,
    items: items
      .slice(start, start + limit)
      .map((item) => (full ? item : compact(item, { ref: itemRef?.(item) }))),
  };
  return page;
}

/** `item.calendarDate`, if that's what it is — the key `sleepSummaries`/`dailySummaries` items use. */
export function calendarDateOf(item: unknown): string | undefined {
  const d = (item as { calendarDate?: unknown } | null)?.calendarDate;
  return typeof d === "string" ? d : undefined;
}

export function walkPath(root: unknown, path: (string | number)[]): unknown {
  let node = root;
  for (const key of path) {
    if (node === null || typeof node !== "object") {
      throw new Error(`ref.path not found at "${key}"`);
    }
    node = Array.isArray(node) ? node[key as number] : (node as Record<string, unknown>)[key as string];
  }
  return node;
}

export interface TimeseriesRef {
  source: "sleep" | "garmin_get" | "body_battery" | "daily_summaries";
  args: Record<string, string | number>;
  path: (string | number)[];
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const garminPath = /^\/[A-Za-z0-9\-_/.?=&%]*$/;

function refDate(ref: TimeseriesRef): string {
  const d = ref.args.date;
  if (typeof d !== "string" || !isoDate.test(d)) throw new Error("ref.args.date must be YYYY-MM-DD");
  return d;
}

/** Refetches the array a get_timeseries ref points into, so `walkPath` can page through it. */
export async function resolveTimeseriesRef(
  garmin: GarminClient,
  api: GarminApi,
  ref: TimeseriesRef,
): Promise<unknown> {
  switch (ref.source) {
    case "sleep":
      return api.dailySleep(refDate(ref));
    case "body_battery": {
      const d = refDate(ref);
      const days = await api.bodyBattery(d, d);
      const day = days.find((x) => x.date === d);
      if (!day) throw new Error(`No Body Battery data for ${d}`);
      return day;
    }
    case "daily_summaries": {
      const d = refDate(ref);
      const days = await api.dailySummaries(d, d);
      const day = days.find((x) => x.calendarDate === d);
      if (!day) throw new Error(`No daily summary for ${d}`);
      return day;
    }
    case "garmin_get": {
      const apiPath = ref.args.api_path;
      if (typeof apiPath !== "string" || !garminPath.test(apiPath)) {
        throw new Error("ref.args.api_path is not a valid Garmin API path");
      }
      return garmin.getJson(apiPath);
    }
  }
}

const ACTIVITY_FIELDS = [
  "activityId",
  "activityName",
  "startTimeLocal",
  "duration",
  "movingDuration",
  "distance",
  "elevationGain",
  "elevationLoss",
  "averageSpeed",
  "maxSpeed",
  "averageHR",
  "maxHR",
  "calories",
  "locationName",
] as const;

export function summarizeActivity(a: unknown): unknown {
  if (!a || typeof a !== "object") return a;
  const src = a as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of ACTIVITY_FIELDS) if (src[f] !== undefined && src[f] !== null) out[f] = src[f];
  const type = src.activityType as { typeKey?: string } | undefined;
  if (type?.typeKey) out.activityType = type.typeKey;
  return Object.keys(out).length ? out : stripNullish(a);
}

/** FIT messages can carry 64-bit fields that the SDK decodes as BigInt, which JSON can't encode. */
function jsonSafe(_key: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

export function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, jsonSafe, 1) }] };
}

export function fail(err: unknown) {
  const msg =
    err instanceof GarminApiError
      ? `${err.message}${err.body ? `\nGarmin said: ${err.body}` : ""}`
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

export async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}
