const ACTIVITY_FIELDS = [
  "activityId",
  "activityName",
  "startTimeLocal",
  "duration",
  "movingDuration",
  "distance",
  "elevationGain",
  "elevationLoss",
  "averageSpeed",
  "maxSpeed",
  "averageHR",
  "maxHR",
  "calories",
  "locationName",
] as const;

export function summarizeActivity(a: unknown): unknown {
  if (!a || typeof a !== "object") return a;
  const src = a as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of ACTIVITY_FIELDS) if (src[f] !== undefined && src[f] !== null) out[f] = src[f];
  const type = src.activityType as { typeKey?: string } | undefined;
  if (type?.typeKey) out.activityType = type.typeKey;
  return Object.keys(out).length ? out : a;
}
