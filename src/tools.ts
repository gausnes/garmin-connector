import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { decodeFitMessages } from "./fit.ts";
import { type BodyBatteryDay, GarminApi, type GarminClient } from "./garmin/index.ts";
import {
  bigIntSafe,
  pageArray,
  paginate,
  resolveBodyBatteryValues,
  run,
  summarizeActivity,
  summarizeBodyBatteryDay,
} from "./responses/index.ts";

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

const bodyBatteryRef = z.object({
  source: z.literal("body_battery"),
  date,
});
const seriesLimit = z.number().int().min(1).max(500).optional().describe("Max readings per page. Default 200");

/**
 * Every date-range/paged tool returns this wrapper, which we construct ourselves (`paginate`/
 * `pageArray`), so it's safe to validate at runtime. `items`' contents stay `z.unknown()` — Garmin's
 * own shapes are compile-time-only per AGENTS.md, not validated here.
 */
const pageOutputSchema = {
  total: z.number().int().describe("Total items available across all pages"),
  start: z.number().int().describe("Offset of this page"),
  limit: z.number().int().describe("Max items in this page"),
  items: z.array(z.unknown()),
};

// All tools are pure reads against Garmin's live API: repeating a call never has additional effect
// (idempotentHint), and the data can change between calls as Garmin's own records change
// (openWorldHint) — not a violation of idempotence, just an external system.
const readOnlyAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

export function buildServer(garmin: GarminClient): McpServer {
  const api = new GarminApi(garmin);
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
        "Detailed sleep for one night: duration (s), deep/light/REM/awake (s), sleep score, overnight " +
        "HRV, resting HR, Body Battery change. `date` is the morning the user woke up.",
      inputSchema: { date },
      annotations: readOnlyAnnotations,
    },
    ({ date }) => run(async () => api.dailySleep(date)),
  );

  server.registerTool(
    "get_sleep_range",
    {
      title: "Sleep summaries over a date range",
      description:
        "One sleep summary per night for an inclusive range (max 31 days), paged newest-first.",
      inputSchema: { start_date: date, end_date: date, start: pageStart, limit: pageLimit },
      outputSchema: pageOutputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ start_date, end_date, start, limit }) =>
      run(async () => paginate(await api.sleepSummaries(start_date, end_date), { start, limit }), {
        structured: true,
      }),
  );

  server.registerTool(
    "get_daily_summaries",
    {
      title: "Daily health summaries",
      description:
        "Per-day summaries: steps, calories, intensity minutes, resting HR, stress, Body Battery, etc. " +
        "Inclusive range, up to 1 year, paged newest-first.",
      inputSchema: { start_date: date, end_date: date, start: pageStart, limit: pageLimit },
      outputSchema: pageOutputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ start_date, end_date, start, limit }) =>
      run(async () => paginate(await api.dailySummaries(start_date, end_date), { start, limit }), {
        structured: true,
      }),
  );

  server.registerTool(
    "get_hrv",
    {
      title: "HRV summaries",
      description:
        "Overnight heart rate variability summaries (weekly average, status, baseline) per day, " +
        "paged newest-first. No enforced range cap here (unlike sleep/Body Battery/daily summaries) " +
        "since this endpoint's real response shape isn't fully confirmed — very long ranges may " +
        "still be slow or rejected by Garmin.",
      inputSchema: { start_date: date, end_date: date, start: pageStart, limit: pageLimit },
      outputSchema: pageOutputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ start_date, end_date, start, limit }) =>
      run(async () => paginate(await api.hrvSummaries(start_date, end_date), { start, limit }), {
        structured: true,
      }),
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
      outputSchema: pageOutputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ start_date, end_date, start, limit, include_timeseries }) =>
      run(
        async () =>
          paginate(
            await api.bodyBattery(start_date, end_date),
            { start, limit },
            include_timeseries,
            (item) => summarizeBodyBatteryDay(item as BodyBatteryDay),
          ),
        { structured: true },
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
      annotations: readOnlyAnnotations,
    },
    (args) =>
      run(async () => {
        const data = await api.searchActivities({
          start: args.start,
          limit: args.limit,
          startDate: args.start_date,
          endDate: args.end_date,
          activityType: args.activity_type,
        });
        return args.raw ? data : data.map(summarizeActivity);
      }),
  );

  server.registerTool(
    "get_activity",
    {
      title: "Activity details",
      description: "Garmin's full summary for one activity (splits, laps, training effect, etc.).",
      inputSchema: { activity_id: z.string().regex(/^[1-9]\d*$/).describe("From list_activities") },
      annotations: readOnlyAnnotations,
    },
    ({ activity_id }) => run(async () => api.activity(activity_id)),
  );

  server.registerTool(
    "get_activity_fit",
    {
      title: "Activity FIT file contents",
      description:
        "Downloads the original FIT file and returns its decoded messages exactly as Garmin's FIT SDK " +
        "reads them (record, lap, session, event, device_info, hrv, etc.), with no interpretation. " +
        "Prefer setting `message_types` for long activities — it lets decoding stop early once a page " +
        "is found, instead of reading the whole file — but that's also the only time `counts` becomes " +
        "a lower bound rather than the file's true total.",
      inputSchema: {
        activity_id: z.string().regex(/^[1-9]\d*$/).describe("From list_activities"),
        message_types: z
          .array(z.string().regex(/^[A-Za-z0-9_]+$/))
          .optional()
          .describe("Message types to return, e.g. [\"sessionMesgs\", \"lapMesgs\"]. Default: all"),
        offset: z.number().int().min(0).optional().describe("Start index within each type. Default 0"),
        limit: z.number().int().min(1).max(2000).optional().describe("Max messages per type. Default 200"),
      },
      outputSchema: {
        counts: z.record(z.string(), z.number()).describe("Message count per type in the whole file"),
        offset: z.number().int(),
        limit: z.number().int(),
        messages: z.record(z.string(), z.array(z.unknown())).describe("Each requested type, sliced to one page"),
        counts_exact: z.boolean().describe("False when counts is a lower bound (decoding stopped early)"),
        decode_errors: z.array(z.string()).optional(),
      },
      annotations: readOnlyAnnotations,
    },
    ({ activity_id, message_types, offset, limit }) =>
      run(
        async () => {
          const file = await garmin.downloadActivity(activity_id);
          const page = decodeFitMessages(file, { types: message_types, offset, limit });
          // FIT-decoded data is the only place BigInt can show up; sanitize before it can ever
          // reach structuredContent, which (unlike content) has no replacer to catch it later.
          return bigIntSafe(page);
        },
        { structured: true },
      ),
  );

  server.registerTool(
    "get_body_battery_series",
    {
      title: "Page through a day's Body Battery curve",
      description:
        "Follows the `ref` attached by get_body_battery when a day's `bodyBatteryValuesArray` is too " +
        "long to return inline, and returns one page of just that array. Use this instead of " +
        "include_timeseries=true when only the Body Battery curve is needed, not the whole response.",
      inputSchema: { ref: bodyBatteryRef, start: pageStart, limit: seriesLimit },
      outputSchema: pageOutputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ ref, start, limit }) =>
      run(async () => pageArray(await resolveBodyBatteryValues(api, ref), start, limit), { structured: true }),
  );

  return server;
}
