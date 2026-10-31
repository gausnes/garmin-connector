import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compact } from "./compact.js";
import { decodeFitMessages } from "./fit.js";
import { GarminApiError, type GarminClient } from "./garmin.js";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Calendar date, YYYY-MM-DD");

const includeTimeseries = z
  .boolean()
  .optional()
  .describe("Include long per-minute arrays (large). Default false.");

const pageStart = z.number().int().min(0).optional().describe("Offset for paging. Default 0");
const pageLimit = z.number().int().min(1).max(100).optional().describe("Max items per page. Default 20");

interface Page {
  total: number;
  start: number;
  limit: number;
  items: unknown[];
}

/** Page a date-range array newest-first. Items are compacted individually unless `full` is set. */
function paginate(data: unknown, opts: { start?: number; limit?: number }, full = false): unknown {
  if (!Array.isArray(data)) return full ? data : compact(data);
  const items = [...data].reverse();
  const start = Math.max(0, Math.floor(opts.start ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 20)));
  const page: Page = {
    total: items.length,
    start,
    limit,
    items: items.slice(start, start + limit).map((item) => (full ? item : compact(item))),
  };
  return page;
}

const timeseriesRef = z.object({
  source: z.enum(["sleep", "garmin_get"]),
  args: z.record(z.string(), z.union([z.string(), z.number()])),
  path: z.array(z.union([z.string(), z.number()])),
});

function walkPath(root: unknown, path: (string | number)[]): unknown {
  let node = root;
  for (const key of path) {
    if (node === null || typeof node !== "object") {
      throw new Error(`ref.path not found at "${key}"`);
    }
    node = Array.isArray(node) ? node[key as number] : (node as Record<string, unknown>)[key as string];
  }
  return node;
}

/** FIT messages can carry 64-bit fields that the SDK decodes as BigInt, which JSON can't encode. */
function jsonSafe(_key: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, jsonSafe, 1) }] };
}

function fail(err: unknown) {
  const msg =
    err instanceof GarminApiError
      ? `${err.message}${err.body ? `\nGarmin said: ${err.body}` : ""}`
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
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
  return Object.keys(out).length ? out : compact(a);
}

export function buildServer(garmin: GarminClient): McpServer {
  const server = new McpServer(
    { name: "garmin-connector", version: "0.1.0" },
    {
      instructions:
        "Read-only access to the user's own Garmin Connect data via Garmin's official Personal API. " +
        "Dates are the user's local calendar dates (YYYY-MM-DD). Sleep for a night is filed under the " +
        "date the user woke up. Garmin caps ranges: sleep and Body Battery 31 days, daily summaries 1 year. " +
        "Date-range tools page newest-first; raise `start` to go further back.",
    },
  );

  server.registerTool(
    "get_sleep",
    {
      title: "Sleep for one night",
      description:
        "Detailed sleep for one night: duration, deep/light/REM/awake, sleep score, overnight HRV, " +
        "resting HR, Body Battery change. `date` is the morning the user woke up.",
      inputSchema: { date, include_timeseries: includeTimeseries },
      annotations: { readOnlyHint: true },
    },
    ({ date, include_timeseries }) =>
      run(async () => {
        const data = await garmin.dailySleep(date);
        return include_timeseries ? data : compact(data, { ref: { source: "sleep", args: { date } } });
      }),
  );

  server.registerTool(
    "get_sleep_range",
    {
      title: "Sleep summaries over a date range",
      description:
        "One sleep summary per night for an inclusive range (max 31 days), paged newest-first.",
      inputSchema: {
        start_date: date,
        end_date: date,
        start: pageStart,
        limit: pageLimit,
        include_timeseries: includeTimeseries,
      },
      annotations: { readOnlyHint: true },
    },
    ({ start_date, end_date, start, limit, include_timeseries }) =>
      run(async () =>
        paginate(await garmin.sleepSummaries(start_date, end_date), { start, limit }, include_timeseries),
      ),
  );

  server.registerTool(
    "get_daily_summaries",
    {
      title: "Daily health summaries",
      description:
        "Per-day summaries: steps, calories, intensity minutes, resting HR, stress, Body Battery, etc. " +
        "Inclusive range, up to 1 year, paged newest-first.",
      inputSchema: {
        start_date: date,
        end_date: date,
        start: pageStart,
        limit: pageLimit,
        include_timeseries: includeTimeseries,
      },
      annotations: { readOnlyHint: true },
    },
    ({ start_date, end_date, start, limit, include_timeseries }) =>
      run(async () =>
        paginate(await garmin.dailySummaries(start_date, end_date), { start, limit }, include_timeseries),
      ),
  );

  server.registerTool(
    "get_hrv",
    {
      title: "HRV summaries",
      description:
        "Overnight heart rate variability summaries (weekly average, status, baseline) per day, " +
        "paged newest-first.",
      inputSchema: {
        start_date: date,
        end_date: date,
        start: pageStart,
        limit: pageLimit,
        include_timeseries: includeTimeseries,
      },
      annotations: { readOnlyHint: true },
    },
    ({ start_date, end_date, start, limit, include_timeseries }) =>
      run(async () =>
        paginate(await garmin.hrvSummaries(start_date, end_date), { start, limit }, include_timeseries),
      ),
  );

  server.registerTool(
    "get_body_battery",
    {
      title: "Body Battery",
      description:
        "Daily Body Battery reports (charged, drained, highs/lows). Inclusive range, max 31 days, " +
        "paged newest-first.",
      inputSchema: {
        start_date: date,
        end_date: date,
        start: pageStart,
        limit: pageLimit,
        include_timeseries: includeTimeseries,
      },
      annotations: { readOnlyHint: true },
    },
    ({ start_date, end_date, start, limit, include_timeseries }) =>
      run(async () =>
        paginate(await garmin.bodyBattery(start_date, end_date), { start, limit }, include_timeseries),
      ),
  );

  server.registerTool(
    "list_activities",
    {
      title: "List activities",
      description:
        "Recorded activities, newest first, with type (e.g. snowboarding, backcountry_snowboarding, " +
        "mountain_biking, road_biking), duration (s), distance (m), elevation gain (m) and heart rate.",
      inputSchema: {
        start_date: date.optional(),
        end_date: date.optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
        start: z.number().int().min(0).optional().describe("Offset for paging. Default 0"),
        activity_type: z.string().optional().describe("Garmin activity type key filter, e.g. cycling"),
        raw: z.boolean().optional().describe("Return Garmin's full objects instead of a summary"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      run(async () => {
        const data = await garmin.searchActivities({
          start: args.start,
          limit: args.limit,
          startDate: args.start_date,
          endDate: args.end_date,
          activityType: args.activity_type,
        });
        if (args.raw || !Array.isArray(data)) return data;
        return data.map(summarizeActivity);
      }),
  );

  server.registerTool(
    "get_activity",
    {
      title: "Activity details",
      description: "Garmin's full summary for one activity (splits, laps, training effect, etc.).",
      inputSchema: { activity_id: z.string().regex(/^[1-9]\d*$/).describe("From list_activities") },
      annotations: { readOnlyHint: true },
    },
    ({ activity_id }) => run(async () => garmin.activity(activity_id)),
  );

  server.registerTool(
    "get_activity_fit",
    {
      title: "Activity FIT file contents",
      description:
        "Downloads the original FIT file and returns its decoded messages exactly as Garmin's FIT SDK " +
        "reads them (record, lap, session, event, device_info, hrv, etc.), with no interpretation. " +
        "Every call reports `counts` per message type. Each returned type is sliced to " +
        "[offset, offset + limit); page through long types such as recordMesgs (one row per second " +
        "or so) by raising offset.",
      inputSchema: {
        activity_id: z.string().regex(/^[1-9]\d*$/).describe("From list_activities"),
        message_types: z
          .array(z.string().regex(/^[A-Za-z0-9_]+$/))
          .optional()
          .describe("Message types to return, e.g. [\"sessionMesgs\", \"lapMesgs\"]. Default: all"),
        offset: z.number().int().min(0).optional().describe("Start index within each type. Default 0"),
        limit: z.number().int().min(1).max(2000).optional().describe("Max messages per type. Default 200"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ activity_id, message_types, offset, limit }) =>
      run(async () => {
        const file = await garmin.downloadActivity(activity_id);
        return decodeFitMessages(file, { types: message_types, offset, limit });
      }),
  );

  server.registerTool(
    "garmin_get",
    {
      title: "Raw Personal API GET",
      description:
        "Escape hatch: GET any Garmin Personal API path, e.g. /hrv-service/hrv/2026-10-30 or " +
        "/usersummary-service/stats/steps/daily/2026-10-01/2026-10-28. Read-only.",
      inputSchema: {
        path: z.string().regex(/^\/[A-Za-z0-9\-_/.?=&%]*$/).describe("Path starting with /, query string allowed"),
        include_timeseries: includeTimeseries,
      },
      annotations: { readOnlyHint: true },
    },
    ({ path, include_timeseries }) =>
      run(async () => {
        const data = await garmin.getJson(path);
        return include_timeseries
          ? data
          : compact(data, { ref: { source: "garmin_get", args: { api_path: path } } });
      }),
  );

  server.registerTool(
    "get_timeseries",
    {
      title: "Page through one omitted array",
      description:
        "Follows a `ref` from a truncated array (returned by get_sleep or garmin_get when a long " +
        "nested array is omitted) and returns one page of just that array, refetching the source and " +
        "walking `ref.path` to it. Use this instead of include_timeseries=true when only one series " +
        "is needed, not the whole response.",
      inputSchema: { ref: timeseriesRef, start: pageStart, limit: pageLimit },
      annotations: { readOnlyHint: true },
    },
    ({ ref, start, limit }) =>
      run(async () => {
        let root: unknown;
        if (ref.source === "sleep") {
          const argDate = ref.args.date;
          if (typeof argDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(argDate)) {
            throw new Error("ref.args.date must be YYYY-MM-DD");
          }
          root = await garmin.dailySleep(argDate);
        } else {
          const apiPath = ref.args.api_path;
          if (typeof apiPath !== "string" || !/^\/[A-Za-z0-9\-_/.?=&%]*$/.test(apiPath)) {
            throw new Error("ref.args.api_path is not a valid Garmin API path");
          }
          root = await garmin.getJson(apiPath);
        }
        const node = walkPath(root, ref.path);
        if (!Array.isArray(node)) throw new Error(`ref.path does not point to an array: ${ref.path.join(".")}`);
        const s = Math.max(0, Math.floor(start ?? 0));
        const l = Math.min(500, Math.max(1, Math.floor(limit ?? 200)));
        return { total: node.length, start: s, limit: l, items: node.slice(s, s + l) };
      }),
  );

  return server;
}
