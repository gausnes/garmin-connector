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
