/**
 * Garmin responses can contain long per-minute arrays (sleep movement, heart
 * rate, stress). Those blow up the model's context for little benefit, so by
 * default arrays longer than `maxArray` are replaced with a short summary.
 */
export function compact(value: unknown, maxArray = 32, depth = 0): unknown {
  if (depth > 12) return "[truncated: nested too deep]";
  if (Array.isArray(value)) {
    if (value.length > maxArray) {
      return {
        omitted_items: value.length,
        sample_first: compact(value[0], maxArray, depth + 1),
        sample_last: compact(value[value.length - 1], maxArray, depth + 1),
        hint: "Long time series omitted. Call again with include_timeseries=true to get it.",
      };
    }
    return value.map((v) => compact(v, maxArray, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue; // drop empty fields
      out[k] = compact(v, maxArray, depth + 1);
    }
    return out;
  }
  return value;
}
