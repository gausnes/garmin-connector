import type { ActivityTypeRef } from "./activity-type-ref.ts";
import type { TypeRef } from "./type-ref.ts";

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
