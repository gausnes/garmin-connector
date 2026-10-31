import type { BodyBatteryValueDescriptor } from "./body-battery-value-descriptor.js";

/**
 * One day from bodyBattery reports/daily. Keyed by `date`, not `calendarDate` like the others.
 * The most recent (still in-progress) day comes back with most fields `null` rather than omitted.
 */
export interface BodyBatteryDay {
  date: string;
  charged: number | null;
  drained: number | null;
  startTimestampGMT: string | null;
  endTimestampGMT: string | null;
  startTimestampLocal: string | null;
  endTimestampLocal: string | null;
  /** Each entry is `[absoluteTimestampMs, bodyBatteryLevel]` — see bodyBatteryValueDescriptorDTOList.
   *  The level can be `null` for the most recent, still-in-progress day. */
  bodyBatteryValuesArray: [number, number | null][];
  bodyBatteryValueDescriptorDTOList: BodyBatteryValueDescriptor[] | null;
}
