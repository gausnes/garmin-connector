import type { BodyBatteryDay, GarminApi } from "../garmin/index.js";
import { stripNullish } from "./strip-nullish.js";

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
