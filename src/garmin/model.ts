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
  // The following were always null across a 30-day sample on this account — types are a
  // best-effort guess from field naming, not a confirmed non-null observation.
  sleepQualityTypePK: number | null;
  sleepResultTypePK: number | null;
  sleepFromDevice: boolean | null;
  numberOfEventsBelowThreshold: number | null;
  averageSpO2HRSleep: number | null;
  spo2Threshold: number | null;
  awakeCount: number | null;
  ageGroup: string | null;
  sleepScorePersonalizedInsight: unknown | null;
  userNote: string | null;
  kidSleepNote: string | null;
  sleepVersion: number | null;
  sleepNeed: unknown | null;
  nextSleepNeed: unknown | null;
  dailyNapDTOS: unknown[] | null;
  breathingDisruptionSeverity: string | null;
  sleepAlignment: unknown | null;
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

export interface BodyBatteryValueDescriptor {
  bodyBatteryValueDescriptorIndex: number;
  bodyBatteryValueDescriptorKey: string;
}

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

export interface TypeRef {
  typeId: number;
  typeKey: string;
}

export interface ActivityTypeRef extends TypeRef {
  parentTypeId: number;
}

/**
 * One item from searchActivities (list_activities). GPS/distance/speed/steps fields are absent
 * for activity types with no corresponding data (e.g. yoga has no GPS, cycling has no steps) —
 * marked optional rather than assuming every activity type populates them.
 *
 * Garmin also returns bare duplicates of several boolean fields (e.g. `pr`/`favorite`/
 * `manualActivity`/`autoCalcCalories`/`elevationCorrected`/`parent` alongside `isPR`/`isFavorite`/
 * etc.) — intentionally not modeled here since they're redundant with the `is`-prefixed versions.
 */
export interface Activity {
  activityId: number;
  activityUUID: string;
  activityName: string;
  startTimeLocal: string;
  startTimeGMT: string;
  endTimeGMT: string;
  beginTimestamp: number;
  activityType: ActivityTypeRef;
  eventType: TypeRef;
  privacy: TypeRef;
  sportTypeId: number;
  distance?: number;
  duration: number;
  elapsedDuration: number;
  movingDuration: number;
  elevationGain?: number;
  elevationLoss?: number;
  minElevation?: number;
  maxElevation?: number;
  averageSpeed?: number;
  maxSpeed?: number;
  maxVerticalSpeed?: number;
  minActivityLapDuration?: number;
  startLatitude?: number;
  startLongitude?: number;
  endLatitude?: number;
  endLongitude?: number;
  calories: number;
  bmrCalories?: number;
  averageHR: number;
  maxHR: number;
  /** Minutes spent in each of Garmin's 5 HR zones. */
  hrTimeInZone_1?: number;
  hrTimeInZone_2?: number;
  hrTimeInZone_3?: number;
  hrTimeInZone_4?: number;
  hrTimeInZone_5?: number;
  steps?: number;
  // Running-specific.
  averageRunningCadenceInStepsPerMinute?: number;
  maxRunningCadenceInStepsPerMinute?: number;
  avgStrideLength?: number;
  maxDoubleCadence?: number;
  // Seen on yoga activities.
  avgStress?: number;
  startStress?: number;
  endStress?: number;
  differenceStress?: number;
  maxStress?: number;
  ownerId: number;
  ownerDisplayName: string;
  ownerFullName: string;
  locationName: string;
  manufacturer: string;
  lapCount: number;
  hasImages?: boolean;
  hasVideo?: boolean;
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
  // GPS-dependent — absent for indoor/manual activities.
  startLatitude?: number;
  startLongitude?: number;
  endLatitude?: number;
  endLongitude?: number;
  avgElevation?: number;
  averageMovingSpeed?: number;
  bmrCalories?: number;
  maxVerticalSpeed?: number;
  minActivityLapDuration?: number;
  // Sport-dependent — e.g. running cadence, outdoor temperature, yoga stress.
  averageRunCadence?: number;
  maxRunCadence?: number;
  averageTemperature?: number;
  maxTemperature?: number;
  minTemperature?: number;
  strideLength?: number;
  startStress?: number;
  endStress?: number;
  differenceStress?: number;
  avgStress?: number;
  maxStress?: number;
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
  timeZoneUnitDTO: { timeZone: string };
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
