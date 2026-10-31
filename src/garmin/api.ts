/**
 * Typed, per-endpoint access on top of a GarminClient (paths from Garmin's reference client,
 * garmin/connect-personal-api-python). Types are compile-time only — not runtime-validated — so
 * array-returning methods still defensively fall back to `[]` rather than trusting the type if
 * Garmin ever returns something else (as dailySummaries already does by wrapping its array in
 * `{ data: [...] }`).
 */
import { assertActivityId, type GarminClient } from "./client.js";
import type { Activity, ActivityDetail, BodyBatteryDay, DailySummary, SleepSummary } from "./model/index.js";

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export class GarminApi {
  constructor(private readonly client: GarminClient) {}

  dailySleep(date: string): Promise<SleepSummary> {
    return this.client.getJson("/sleep-service/sleep/dailySleep", { date }) as Promise<SleepSummary>;
  }

  async sleepSummaries(startDate: string, endDate: string): Promise<SleepSummary[]> {
    return asArray<SleepSummary>(
      await this.client.getJson("/sleep-service/sleep/dailySleepSummariesByDate", { startDate, endDate }),
    );
  }

  /** Unlike the other range endpoints, Garmin wraps this one's array in `{ data: [...] }`. */
  async dailySummaries(startDate: string, endDate: string): Promise<DailySummary[]> {
    const res = (await this.client.getJson("/usersummary-service/v2/dailysummaries", { startDate, endDate })) as {
      data?: unknown;
    } | null;
    return asArray<DailySummary>(res?.data);
  }

  /** Real response shape unconfirmed (empty for the account/range tested); kept untyped. */
  hrvSummaries(startDate: string, endDate: string): Promise<unknown> {
    return this.client.getJson(`/hrv-service/hrv/daily/${startDate}/${endDate}`);
  }

  async bodyBattery(startDate: string, endDate: string): Promise<BodyBatteryDay[]> {
    return asArray<BodyBatteryDay>(
      await this.client.getJson("/wellness-service/wellness/bodyBattery/reports/daily", { startDate, endDate }),
    );
  }

  /** Real response shape unconfirmed; kept untyped. Not currently exposed as an MCP tool. */
  dailyHeartRate(date: string): Promise<unknown> {
    return this.client.getJson("/wellness-service/wellness/dailyHeartRate", { date });
  }

  async searchActivities(opts: {
    start?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    activityType?: string;
  }): Promise<Activity[]> {
    return asArray<Activity>(
      await this.client.getJson("/activitylist-service/activities/search/activities", {
        start: opts.start ?? 0,
        limit: opts.limit ?? 20,
        startDate: opts.startDate,
        endDate: opts.endDate,
        activityType: opts.activityType,
      }),
    );
  }

  async activity(activityId: string): Promise<ActivityDetail> {
    assertActivityId(activityId);
    return (await this.client.getJson(`/activity-service/activity/${activityId}`)) as ActivityDetail;
  }
}
