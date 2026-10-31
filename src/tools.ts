import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { decodeFitMessages } from "./fit.js";
import { type BodyBatteryDay, GarminApi, type GarminClient } from "./garmin/index.js";
import {
  pageArray,
  paginate,
  resolveBodyBatteryValues,
  run,
  stripNullish,
  summarizeActivity,
  summarizeBodyBatteryDay,
} from "./responses/index.js";

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
        "Detailed sleep for one night: duration, deep/light/REM/awake, sleep score, overnight HRV, " +
        "resting HR, Body Battery change. `date` is the morning the user woke up.",
      inputSchema: { date, include_timeseries: includeTimeseries },
      annotations: { readOnlyHint: true },
    },
    ({ date, include_timeseries }) =>
      run(async () => {
        const data = await api.dailySleep(date);
        return include_timeseries ? data : stripNullish(data);
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
      run(async () => paginate(await api.sleepSummaries(start_date, end_date), { start, limit }, include_timeseries)),
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
      run(async () => paginate(await api.dailySummaries(start_date, end_date), { start, limit }, include_timeseries)),
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
        paginate(await api.hrvSummaries(start_date, end_date), { start, limit }, include_timeseries),
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
        paginate(
          await api.bodyBattery(start_date, end_date),
          { start, limit },
          include_timeseries,
          (item) => summarizeBodyBatteryDay(item as BodyBatteryDay),
        ),
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
      annotations: { readOnlyHint: true },
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
        "Every call reports `counts` per message type. Each returned type is sliced to " +
        "[offset, offset + limit); page through long types such as recordMesgs (one row per second " +
        "or so) by raising offset. Passing `message_types` is strongly preferred for long activities: " +
        "it lets decoding stop as soon as enough messages are found instead of reading the whole file, " +
        "making it far cheaper the smaller `offset` is. Without it, `counts_exact` is always true but " +
        "the whole file must be decoded regardless of how small a page is requested. With it, " +
        "`counts_exact: false` means `counts` is a lower bound (at least that many exist, decoding " +
        "stopped once the page was found) rather than the file's true total.",
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
    "get_timeseries",
    {
      title: "Page through a day's Body Battery curve",
      description:
        "Follows the `ref` attached by get_body_battery when a day's `bodyBatteryValuesArray` is too " +
        "long to return inline, and returns one page of just that array. Use this instead of " +
        "include_timeseries=true when only the Body Battery curve is needed, not the whole response.",
      inputSchema: { ref: bodyBatteryRef, start: pageStart, limit: seriesLimit },
      annotations: { readOnlyHint: true },
    },
    ({ ref, start, limit }) => run(async () => pageArray(await resolveBodyBatteryValues(api, ref), start, limit)),
  );

  return server;
}
