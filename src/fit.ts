import { Decoder, Stream } from "@garmin/fitsdk";
import { unzipSync } from "fflate";

/**
 * Turn an original Garmin activity file into a compact, per-interval series plus
 * features that help tell similar activities apart, e.g.:
 *   - resort snowboarding (fast, lift-assisted climbs) vs splitboarding (slow,
 *     self-powered climbs at elevated heart rate)
 *   - mountain biking (slow, spiky, lots of climbing per km) vs road/gravel
 *     (steady, faster)
 * The tool reports measurements; the model makes the call.
 */

/** Vertical gain faster than this (m/min) is treated as lift/vehicle-assisted. */
export const LIFT_CLIMB_RATE_M_PER_MIN = 40;
/** Vertical change smaller than this (m/min) counts as flat. */
const FLAT_RATE_M_PER_MIN = 2;
const MAX_ROWS = 400;

export interface Sample {
  t: number; // seconds since activity start
  alt?: number; // m
  dist?: number; // cumulative m
  hr?: number; // bpm
  speed?: number; // m/s
  cadence?: number;
  power?: number;
}

export interface IntervalRow {
  minute: number; // start of interval, minutes from activity start
  elev_m?: number; // mean altitude
  elev_change_m?: number; // altitude change over interval
  dist_m?: number; // distance covered in interval
  speed_kmh?: number;
  hr_avg?: number;
  hr_max?: number;
  cadence_avg?: number;
  power_avg?: number;
}

export interface PhaseStats {
  minutes: number;
  elev_change_m: number;
  dist_m: number;
  hr_avg?: number;
}

export interface ActivityAnalysis {
  sport?: string;
  sub_sport?: string;
  start_time?: string;
  duration_min: number;
  distance_km?: number;
  total_ascent_m?: number;
  total_descent_m?: number;
  min_elev_m?: number;
  max_elev_m?: number;
  hr_avg?: number;
  hr_max?: number;
  interval_minutes: number;
  phases: {
    lift_like_climb: PhaseStats; // climbing faster than LIFT_CLIMB_RATE_M_PER_MIN
    self_powered_climb: PhaseStats;
    descent: PhaseStats;
    flat_or_stopped: PhaseStats;
  };
  moving_speed_kmh?: number;
  climb_m_per_km?: number;
  hr_variability_pct?: number; // coefficient of variation of per-interval HR
  notes: string[];
  series: IntervalRow[];
}

export function extractFit(zipOrFit: Uint8Array): Uint8Array {
  // ZIP local file header magic: PK\x03\x04
  if (zipOrFit[0] === 0x50 && zipOrFit[1] === 0x4b) {
    const files = unzipSync(zipOrFit);
    const names = Object.keys(files);
    const fitName = names.find((n) => n.toLowerCase().endsWith(".fit"));
    if (!fitName) {
      throw new Error(
        `Activity archive has no FIT file (contains: ${names.join(", ") || "nothing"}). ` +
          "Manually uploaded GPX/TCX activities can't be analyzed.",
      );
    }
    return files[fitName]!;
  }
  return zipOrFit;
}

export function decodeFit(fit: Uint8Array): {
  samples: Sample[];
  session: Record<string, unknown> | undefined;
  startTime?: Date;
} {
  const stream = Stream.fromByteArray(fit);
  if (!Decoder.isFIT(stream)) throw new Error("File is not a valid FIT file");
  const decoder = new Decoder(Stream.fromByteArray(fit));
  const { messages, errors } = decoder.read({ convertDateTimesToDates: true });
  if (errors.length && !messages.recordMesgs?.length) {
    throw new Error(`FIT decode failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  const records = messages.recordMesgs ?? [];
  const session = messages.sessionMesgs?.[0] as Record<string, unknown> | undefined;
  const first = records.find((r) => r.timestamp instanceof Date)?.timestamp as Date | undefined;
  const startTime = (session?.startTime as Date | undefined) ?? first;
  const t0 = startTime ? startTime.getTime() : 0;

  const samples: Sample[] = [];
  for (const r of records) {
    if (!(r.timestamp instanceof Date)) continue;
    samples.push({
      t: (r.timestamp.getTime() - t0) / 1000,
      alt: num(r.enhancedAltitude ?? r.altitude),
      dist: num(r.distance),
      hr: num(r.heartRate),
      speed: num(r.enhancedSpeed ?? r.speed),
      cadence: num(r.cadence),
      power: num(r.power),
    });
  }
  return { samples, session, startTime };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

const round = (v: number | undefined, d = 0) =>
  v === undefined ? undefined : Math.round(v * 10 ** d) / 10 ** d;

function mean(xs: number[]): number | undefined {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
}

export function analyzeSamples(
  samples: Sample[],
  opts: { intervalMinutes?: number; session?: Record<string, unknown>; startTime?: Date } = {},
): ActivityAnalysis {
  const notes: string[] = [];
  const lastT = samples.length ? samples[samples.length - 1]!.t : 0;
  const durationMin = lastT / 60;
  let interval = Math.max(1, Math.floor(opts.intervalMinutes ?? 1));
  if (durationMin / interval > MAX_ROWS) {
    interval = Math.ceil(durationMin / MAX_ROWS);
    notes.push(`Interval widened to ${interval} min to keep the series under ${MAX_ROWS} rows.`);
  }
  const bucketSec = interval * 60;

  // Bucket samples.
  const buckets = new Map<number, Sample[]>();
  // A final sample landing exactly on a boundary belongs to the last full interval.
  const maxKey = Math.max(0, Math.ceil(lastT / bucketSec) - 1);
  for (const s of samples) {
    const k = Math.min(Math.floor(s.t / bucketSec), maxKey);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(s);
  }

  const series: IntervalRow[] = [];
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  let prevLastAlt: number | undefined;
  let prevLastDist: number | undefined;
  for (const k of keys) {
    const b = buckets.get(k)!;
    const alts = b.map((s) => s.alt).filter((x): x is number => x !== undefined);
    const dists = b.map((s) => s.dist).filter((x): x is number => x !== undefined);
    const hrs = b.map((s) => s.hr).filter((x): x is number => x !== undefined);
    const cads = b.map((s) => s.cadence).filter((x): x is number => x !== undefined);
    const pows = b.map((s) => s.power).filter((x): x is number => x !== undefined);

    const firstAlt = prevLastAlt ?? alts[0];
    const lastAlt = alts[alts.length - 1];
    const firstDist = prevLastDist ?? dists[0];
    const lastDist = dists[dists.length - 1];
    const distM = firstDist !== undefined && lastDist !== undefined ? lastDist - firstDist : undefined;

    series.push({
      minute: k * interval,
      elev_m: round(mean(alts)),
      elev_change_m: firstAlt !== undefined && lastAlt !== undefined ? round(lastAlt - firstAlt) : undefined,
      dist_m: round(distM),
      speed_kmh: distM !== undefined ? round((distM / bucketSec) * 3.6, 1) : undefined,
      hr_avg: round(mean(hrs)),
      hr_max: hrs.length ? Math.max(...hrs) : undefined,
      cadence_avg: round(mean(cads)),
      power_avg: round(mean(pows)),
    });
    if (lastAlt !== undefined) prevLastAlt = lastAlt;
    if (lastDist !== undefined) prevLastDist = lastDist;
  }

  // Phase classification by vertical rate per interval.
  const empty = (): PhaseStats & { _hr: number[] } => ({ minutes: 0, elev_change_m: 0, dist_m: 0, _hr: [] });
  const phases = {
    lift_like_climb: empty(),
    self_powered_climb: empty(),
    descent: empty(),
    flat_or_stopped: empty(),
  };
  for (const row of series) {
    const rate = row.elev_change_m !== undefined ? row.elev_change_m / interval : undefined;
    let p: keyof typeof phases;
    if (rate === undefined || Math.abs(rate) < FLAT_RATE_M_PER_MIN) p = "flat_or_stopped";
    else if (rate >= LIFT_CLIMB_RATE_M_PER_MIN) p = "lift_like_climb";
    else if (rate > 0) p = "self_powered_climb";
    else p = "descent";
    const ph = phases[p];
    ph.minutes += interval;
    ph.elev_change_m += row.elev_change_m ?? 0;
    ph.dist_m += row.dist_m ?? 0;
    if (row.hr_avg !== undefined) ph._hr.push(row.hr_avg);
  }
  const finalize = (ph: PhaseStats & { _hr: number[] }): PhaseStats => ({
    minutes: ph.minutes,
    elev_change_m: Math.round(ph.elev_change_m),
    dist_m: Math.round(ph.dist_m),
    hr_avg: round(mean(ph._hr)),
  });

  const alts = samples.map((s) => s.alt).filter((x): x is number => x !== undefined);
  const hrs = samples.map((s) => s.hr).filter((x): x is number => x !== undefined);
  const lastDist = [...samples].reverse().find((s) => s.dist !== undefined)?.dist;
  const sess = opts.session ?? {};
  const totalAscent = num(sess.totalAscent) ?? sumPositive(series.map((r) => r.elev_change_m));
  const totalDescent = num(sess.totalDescent) ?? -sumNegative(series.map((r) => r.elev_change_m));
  const distanceKm = num(sess.totalDistance) !== undefined ? num(sess.totalDistance)! / 1000 : lastDist !== undefined ? lastDist / 1000 : undefined;

  const movingRows = series.filter((r) => (r.speed_kmh ?? 0) > 2);
  const movingSpeed = mean(movingRows.map((r) => r.speed_kmh!));
  const rowHr = series.map((r) => r.hr_avg).filter((x): x is number => x !== undefined);
  const hrMean = mean(rowHr);
  const hrCv =
    hrMean && rowHr.length > 1
      ? (Math.sqrt(rowHr.reduce((a, x) => a + (x - hrMean) ** 2, 0) / rowHr.length) / hrMean) * 100
      : undefined;

  if (!alts.length) notes.push("No altitude data in this file.");
  if (!hrs.length) notes.push("No heart-rate data in this file.");
  if (phases.lift_like_climb.minutes > 0) {
    notes.push(
      `${phases.lift_like_climb.minutes} min of climbing faster than ${LIFT_CLIMB_RATE_M_PER_MIN} m/min ` +
        "(typical of a chairlift/gondola or vehicle, not human-powered).",
    );
  }

  return {
    sport: str(sess.sport),
    sub_sport: str(sess.subSport),
    start_time: opts.startTime?.toISOString(),
    duration_min: Math.round(durationMin),
    distance_km: round(distanceKm, 2),
    total_ascent_m: round(totalAscent),
    total_descent_m: round(totalDescent),
    min_elev_m: alts.length ? Math.round(Math.min(...alts)) : undefined,
    max_elev_m: alts.length ? Math.round(Math.max(...alts)) : undefined,
    hr_avg: round(mean(hrs)),
    hr_max: hrs.length ? Math.max(...hrs) : undefined,
    interval_minutes: interval,
    phases: {
      lift_like_climb: finalize(phases.lift_like_climb),
      self_powered_climb: finalize(phases.self_powered_climb),
      descent: finalize(phases.descent),
      flat_or_stopped: finalize(phases.flat_or_stopped),
    },
    moving_speed_kmh: round(movingSpeed, 1),
    climb_m_per_km:
      totalAscent !== undefined && distanceKm ? round(totalAscent / distanceKm, 1) : undefined,
    hr_variability_pct: round(hrCv, 1),
    notes,
    series,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}
function sumPositive(xs: (number | undefined)[]): number {
  return xs.reduce<number>((a, x) => a + (x && x > 0 ? x : 0), 0);
}
function sumNegative(xs: (number | undefined)[]): number {
  return xs.reduce<number>((a, x) => a + (x && x < 0 ? x : 0), 0);
}

export function analyzeActivityFile(
  file: Uint8Array,
  opts: { intervalMinutes?: number; includeSeries?: boolean } = {},
): ActivityAnalysis {
  const fit = extractFit(file);
  const { samples, session, startTime } = decodeFit(fit);
  if (!samples.length) throw new Error("FIT file has no record samples");
  const analysis = analyzeSamples(samples, { intervalMinutes: opts.intervalMinutes, session, startTime });
  if (opts.includeSeries === false) analysis.series = [];
  return analysis;
}
