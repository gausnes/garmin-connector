/**
 * Shapes for Garmin Personal API responses, based on live captures against a real account (see
 * AGENTS.md / PR history). Garmin's API is undocumented at the field level, so these reflect what
 * was actually observed on one account, not a published schema — fields not listed here may still
 * be present at runtime, and fields listed here aren't guaranteed on every activity/device/account.
 */

/** From dailySleep and sleepSummaries (same shape; the latter is an array of these per night). */
export interface SleepSummary {
  id: number;
  userProfilePK: number;
  calendarDate: string;
  sleepTimeSeconds: number;
  napTimeSeconds: number;
  sleepWindowConfirmed: boolean;
  sleepWindowConfirmationType: string;
  sleepStartTimestampGMT: number;
  sleepEndTimestampGMT: number;
  sleepStartTimestampLocal: number;
  sleepEndTimestampLocal: number;
  autoSleepStartTimestampGMT: number;
  autoSleepEndTimestampGMT: number;
  unmeasurableSleepSeconds: number;
  deepSleepSeconds: number;
  lightSleepSeconds: number;
  remSleepSeconds: number;
  awakeSleepSeconds: number;
  deviceRemCapable: boolean;
  retro: boolean;
  averageSpO2Value: number | null;
  lowestSpO2Value: number | null;
  highestSpO2Value: number | null;
  averageRespirationValue: number | null;
  lowestRespirationValue: number | null;
  highestRespirationValue: number | null;
  avgSleepStress: number | null;
  avgHeartRate: number | null;
}

export interface WellnessChronology {
  startTimestampGmt: string;
  startTimestampLocal: string;
  endTimestampGmt: string;
  endTimestampLocal: string;
  totalDurationInMillis: number;
}

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
    floorsAscended?: { goal: number; value: number; distanceInMeters: number };
    floorsDescended?: { value: number; distanceInMeters: number };
  };
  calories: { burnedResting: number; burnedActive: number; burnedTotal: number };
  heartRate: { minValue: number; maxValue: number; restingValue: number };
  intensityMinutes: { goal: number; moderate: number; vigorous: number };
  stress: {
    avgLevel: number;
    maxLevel: number;
    qualifier: string;
    totalDurationInMillis: number;
    restDurationInMillis: number;
    activityDurationInMillis: number;
  };
  bodyBattery: {
    minValue: number;
    maxValue: number;
    chargedValue: number;
    drainedValue: number;
    latestValue: number;
  };
}

export interface BodyBatteryValueDescriptor {
  bodyBatteryValueDescriptorIndex: number;
  bodyBatteryValueDescriptorKey: string;
}

/** One day from bodyBattery reports/daily. Keyed by `date`, not `calendarDate` like the others. */
export interface BodyBatteryDay {
  date: string;
  charged: number;
  drained: number;
  startTimestampGMT: string;
  endTimestampGMT: string;
  startTimestampLocal: string;
  endTimestampLocal: string;
  /** Each entry is `[timestampOffsetMs, bodyBatteryLevel]` — see bodyBatteryValueDescriptorDTOList. */
  bodyBatteryValuesArray: [number, number][];
  bodyBatteryValueDescriptorDTOList: BodyBatteryValueDescriptor[];
}

export interface TypeRef {
  typeId: number;
  typeKey: string;
}

export interface ActivityTypeRef extends TypeRef {
  parentTypeId: number;
}

/** One item from searchActivities (list_activities). */
export interface Activity {
  activityId: number;
  activityName: string;
  startTimeLocal: string;
  startTimeGMT: string;
  endTimeGMT: string;
  activityType: ActivityTypeRef;
  eventType: TypeRef;
  privacy: TypeRef;
  distance: number;
  duration: number;
  elapsedDuration: number;
  movingDuration: number;
  elevationGain: number;
  elevationLoss: number;
  averageSpeed: number;
  maxSpeed: number;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
  calories: number;
  averageHR: number;
  maxHR: number;
  steps: number;
  ownerDisplayName: string;
  locationName: string;
  manufacturer: string;
  lapCount: number;
  isFavorite: boolean;
  isPR: boolean;
  isManualActivity: boolean;
}

export interface ActivitySummaryDTO {
  startTimeLocal: string;
  startTimeGMT: string;
  distance: number;
  duration: number;
  movingDuration: number;
  elapsedDuration: number;
  elevationGain: number;
  elevationLoss: number;
  maxElevation: number;
  minElevation: number;
  averageSpeed: number;
  maxSpeed: number;
  calories: number;
  averageHR: number;
  maxHR: number;
  minHR: number;
  steps: number;
}

/** From the activity endpoint (get_activity) — full detail for one activity. */
export interface ActivityDetail {
  activityId: number;
  activityUUID: { uuid: string };
  activityName: string;
  userProfileId: number;
  isMultiSportParent: boolean;
  activityTypeDTO: ActivityTypeRef;
  eventTypeDTO: TypeRef;
  accessControlRuleDTO: TypeRef;
  metadataDTO: {
    isOriginal: boolean;
    fileFormat: { formatId: number; formatKey: string };
    lastUpdateDate: string;
    uploadedDate: string;
    manufacturer: string;
    lapCount: number;
    personalRecord: boolean;
    favorite: boolean;
    manualActivity: boolean;
  };
  summaryDTO: ActivitySummaryDTO;
  locationName: string;
}
