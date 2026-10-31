/**
 * Response modeling shared by the MCP tool handlers in tools.ts: paging date-range arrays,
 * summarizing activities and Body Battery days, resolving a get_timeseries ref back to its source
 * array, and wrapping handler results/errors into MCP content. Builds on compact.ts's
 * array-truncation handling.
 */
import { compact, stripNullish } from "./compact.js";
import { GarminApiError, type BodyBatteryDay, type GarminApi } from "./garmin/index.js";

export interface Page {
  total: number;
  start: number;
  limit: number;
  items: unknown[];
}

/** Page a date-range array newest-first. Items are compacted individually unless `full` is set. */
export function paginate(
  data: unknown,
  opts: { start?: number; limit?: number },
  full = false,
  summarizeItem: (item: unknown) => unknown = (item) => compact(item),
): unknown {
  if (!Array.isArray(data)) return full ? data : compact(data);
  const items = [...data].reverse();
  const start = Math.max(0, Math.floor(opts.start ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 20)));
  const page: Page = {
    total: items.length,
    start,
    limit,
    items: items.slice(start, start + limit).map((item) => (full ? item : summarizeItem(item))),
  };
  return page;
}

/**
 * Body Battery is the only range endpoint with a confirmed long-array field
 * (`bodyBatteryValuesArray`), so it's the only one with a typed get_timeseries ref — strongly typed
 * to that one known field rather than a generic JSON path into an otherwise-unconfirmed shape.
 */
export interface BodyBatteryRef {
  source: "body_battery";
  date: string;
}

const MAX_INLINE_VALUES = 32;

export function summarizeBodyBatteryDay(day: BodyBatteryDay): unknown {
  const { bodyBatteryValuesArray: values, ...rest } = day;
  const clean = stripNullish(rest) as Record<string, unknown>;
  if (values.length <= MAX_INLINE_VALUES) return { ...clean, bodyBatteryValuesArray: values };
  return {
    ...clean,
    bodyBatteryValuesArray: {
      omitted_items: values.length,
      sample_first: values[0],
      sample_last: values[values.length - 1],
      ref: { source: "body_battery", date: day.date } satisfies BodyBatteryRef,
      hint: "Long time series omitted. Call get_timeseries with this ref to page through it, or include_timeseries=true to get everything at once.",
    },
  };
}

/** Refetches the day a get_timeseries ref points to, so its full value array can be paged. */
export async function resolveBodyBatteryValues(
  api: GarminApi,
  ref: BodyBatteryRef,
): Promise<[number, number | null][]> {
  const days = await api.bodyBattery(ref.date, ref.date);
  const day = days.find((d) => d.date === ref.date);
  if (!day) throw new Error(`No Body Battery data for ${ref.date}`);
  return day.bodyBatteryValuesArray;
}

export function pageArray<T>(items: T[], start: number | undefined, limit: number | undefined): Page {
  const s = Math.max(0, Math.floor(start ?? 0));
  const l = Math.min(500, Math.max(1, Math.floor(limit ?? 200)));
  return { total: items.length, start: s, limit: l, items: items.slice(s, s + l) };
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
