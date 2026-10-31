/**
 * Garmin responses can contain long per-minute arrays (sleep movement, heart
 * rate, stress). Those blow up the model's context for little benefit, so by
 * default arrays longer than `maxArray` are replaced with a short summary and
 * a hint to call again with `include_timeseries=true`.
 *
 * Endpoints with a confirmed long-array field (currently just Body Battery)
 * summarize that field themselves instead, with a typed ref `get_timeseries`
 * can page through directly — see `summarizeBodyBatteryDay` in response.ts.
 */
export interface CompactOptions {
  maxArray?: number;
}

export function compact(value: unknown, opts: CompactOptions = {}): unknown {
  return compactInner(value, opts.maxArray ?? 32, 0);
}

/** Recursively drops null/undefined fields, with no array truncation — plain JSON cleanup. */
export function stripNullish(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNullish);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNullish(v);
    }
    return out;
  }
  return value;
}

function compactInner(value: unknown, maxArray: number, depth: number): unknown {
  if (depth > 12) return "[truncated: nested too deep]";
  if (Array.isArray(value)) {
    if (value.length > maxArray) {
      return {
        omitted_items: value.length,
        sample_first: compactInner(value[0], maxArray, depth + 1),
        sample_last: compactInner(value[value.length - 1], maxArray, depth + 1),
        hint: "Long time series omitted. Call again with include_timeseries=true to get it.",
      };
    }
    return value.map((v) => compactInner(v, maxArray, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue; // drop empty fields
      out[k] = compactInner(v, maxArray, depth + 1);
    }
    return out;
  }
  return value;
}
