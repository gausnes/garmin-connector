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
