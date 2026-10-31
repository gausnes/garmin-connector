import type { WellnessChronology } from "./wellness-chronology.js";

/** One day from dailySummaries (the endpoint wraps an array of these in `{ data: [...] }`). */
export interface DailySummary {
  uuid: string;
  userProfilePk: number;
  calendarDate: string;
  source: string;
  includesWellnessData: boolean;
  includesActivityData: boolean;
  wellnessChronology: WellnessChronology;
  movement: {
    steps?: { goal: number; value: number; distanceInMeters: number };
    pushes?: Record<string, unknown>;
    floorsAscended?: { goal: number; value: number; distanceInMeters: number };
    floorsDescended?: { value: number; distanceInMeters: number };
  };
  calories: { burnedResting: number; burnedActive: number; burnedTotal: number };
  heartRate: { minValue: number; maxValue: number; restingValue: number };
  intensityMinutes: { goal: number; moderate: number; vigorous: number };
  stress: {
    avgLevel: number;
    maxLevel: number;
    restProportion: number;
    activityProportion: number;
    uncategorizedProportion: number;
    lowStressProportion: number;
    mediumStressProportion: number;
    highStressProportion: number;
    qualifier: string;
    totalDurationInMillis: number;
    restDurationInMillis: number;
    activityDurationInMillis: number;
    uncategorizedDurationInMillis: number;
    lowStressDurationInMillis: number;
    mediumStressDurationInMillis: number;
    highStressDurationInMillis: number;
  };
  bodyBattery: {
    minValue: number;
    maxValue: number;
    chargedValue: number;
    drainedValue: number;
    latestValue: number;
    featureVersion: string;
  };
  /** Seen only as `{}` so far on this account. */
  hydration: Record<string, unknown>;
  respiration: Record<string, unknown>;
  pulseOx: Record<string, unknown>;
  jetLag: Record<string, unknown>;
}
