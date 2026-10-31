import { Encoder, Profile } from "@garmin/fitsdk";
import { zipSync } from "fflate";

export interface SynthPoint {
  sec: number;
  alt: number;
  dist: number;
  hr: number;
  speed: number;
}

/** Build a minimal FIT activity file from synthetic points. */
export function makeFit(points: SynthPoint[], sport = "snowboarding"): Uint8Array {
  const start = new Date("2026-10-30T21:30:00Z");
  const enc = new Encoder();
  enc.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "activity",
    manufacturer: "development",
    product: 0,
    timeCreated: start,
    serialNumber: 1234,
  } as never);
  for (const p of points) {
    enc.writeMesg({
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: new Date(start.getTime() + p.sec * 1000),
      enhancedAltitude: p.alt,
      distance: p.dist,
      heartRate: p.hr,
      enhancedSpeed: p.speed,
    } as never);
  }
  const last = points[points.length - 1]!;
  enc.writeMesg({
    mesgNum: Profile.MesgNum.SESSION,
    timestamp: new Date(start.getTime() + last.sec * 1000),
    startTime: start,
    sport,
    totalElapsedTime: last.sec,
    totalTimerTime: last.sec,
    totalDistance: last.dist,
  } as never);
  return enc.close();
}

export const zip = (name: string, data: Uint8Array) => zipSync({ [name]: data });

/**
 * Resort laps: 8 min chairlift up 300 m at low HR (~25 m/min... too slow for lift?
 * No: 300 m / 6 min = 50 m/min), then 4 min fast descent.
 */
export function resortDay(laps = 3): SynthPoint[] {
  const pts: SynthPoint[] = [];
  let sec = 0;
  let alt = 3000;
  let dist = 0;
  for (let lap = 0; lap < laps; lap++) {
    for (let i = 0; i < 6 * 6; i++) {
      // lift: 6 min, 10 s samples, +300 m, ~3.3 m/s horizontal-ish
      sec += 10;
      alt += 300 / 36;
      dist += 30;
      pts.push({ sec, alt, dist, hr: 85, speed: 3 });
    }
    for (let i = 0; i < 4 * 6; i++) {
      // ride down: 4 min, -300 m, fast
      sec += 10;
      alt -= 300 / 24;
      dist += 120;
      pts.push({ sec, alt, dist, hr: 135, speed: 12 });
    }
  }
  return pts;
}
