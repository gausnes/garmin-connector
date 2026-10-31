import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compact } from "./compact.js";
import { analyzeActivityFile, LIFT_CLIMB_RATE_M_PER_MIN } from "./fit.js";
import { GarminApiError, type GarminClient } from "./garmin.js";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Calendar date, YYYY-MM-DD");

const includeTimeseries = z
  .boolean()
  .optional()
  .describe("Include long per-minute arrays (large). Default false.");

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] };
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
        "To tell similar activities apart (resort snowboarding vs splitboarding, mountain vs road biking), " +
        "call analyze_activity and compare its climb phases, speeds and heart rate.",
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
        return include_timeseries ? data : compact(data);
      }),
  );

  server.registerTool(
    "get_sleep_range",
    {
      title: "Sleep summaries over a date range",
      description: "One sleep summary per night for an inclusive range (max 31 days).",
      inputSchema: { start_date: date, end_date: date },
      annotations: { readOnlyHint: true },
    },
    ({ start_date, end_date }) => run(async () => compact(await garmin.sleepSummaries(start_date, end_date))),
  );

  server.registerTool(
    "get_daily_summaries",
    {
      title: "Daily health summaries",
      description:
        "Per-day summaries: steps, calories, intensity minutes, resting HR, stress, Body Battery, etc. " +
        "Inclusive range, up to 1 year.",
      inputSchema: { start_date: date, end_date: date },
      annotations: { readOnlyHint: true },
    },
    ({ start_date, end_date }) => run(async () => compact(await garmin.dailySummaries(start_date, end_date))),
  );

  server.registerTool(
    "get_hrv",
    {
      title: "HRV summaries",
      description: "Overnight heart rate variability summaries (weekly average, status, baseline) per day.",
      inputSchema: { start_date: date, end_date: date },
      annotations: { readOnlyHint: true },
    },
    ({ start_date, end_date }) => run(async () => compact(await garmin.hrvSummaries(start_date, end_date))),
  );

  server.registerTool(
    "get_body_battery",
    {
      title: "Body Battery",
      description: "Daily Body Battery reports (charged, drained, highs/lows). Inclusive range, max 31 days.",
      inputSchema: { start_date: date, end_date: date, include_timeseries: includeTimeseries },
      annotations: { readOnlyHint: true },
    },
    ({ start_date, end_date, include_timeseries }) =>
      run(async () => {
        const data = await garmin.bodyBattery(start_date, end_date);
        return include_timeseries ? data : compact(data);
      }),
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
        if (args.raw || !Array.isArray(data)) return compact(data);
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
    ({ activity_id }) => run(async () => compact(await garmin.activity(activity_id))),
  );

  server.registerTool(
    "analyze_activity",
    {
      title: "Analyze an activity's recorded data",
      description:
        "Downloads the original FIT file and returns a per-minute series (elevation, elevation change, " +
        "distance, speed, heart rate, cadence, power) plus phase totals: climbing faster than " +
        `${LIFT_CLIMB_RATE_M_PER_MIN} m/min (lift/vehicle-like), self-powered climbing, descending, flat. ` +
        "Resort riding shows lift-like climbs with low heart rate; splitboarding/ski touring shows long " +
        "self-powered climbs with elevated heart rate. Mountain biking shows high climb per km, lower " +
        "moving speed and higher heart-rate variability than road riding.",
      inputSchema: {
        activity_id: z.string().regex(/^[1-9]\d*$/).describe("From list_activities"),
        interval_minutes: z.number().int().min(1).max(60).optional().describe("Bucket size. Default 1"),
        include_series: z.boolean().optional().describe("Include the per-interval series. Default true"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ activity_id, interval_minutes, include_series }) =>
      run(async () => {
        const file = await garmin.downloadActivity(activity_id);
        return analyzeActivityFile(file, { intervalMinutes: interval_minutes, includeSeries: include_series });
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
        return include_timeseries ? data : compact(data);
      }),
  );

  return server;
}
