/**
 * Garmin responses can contain long per-minute arrays (sleep movement, heart
 * rate, stress). Those blow up the model's context for little benefit, so by
 * default arrays longer than `maxArray` are replaced with a short summary.
 *
 * When a `ref` is given, the summary also carries enough information (source
 * tool + its args, and the JSON path to the array) for `get_timeseries` to
 * refetch and page through that exact array instead of dumping everything.
 */
export interface CompactRef {
  source: string;
  args: Record<string, string | number>;
}

export interface CompactOptions {
  maxArray?: number;
  ref?: CompactRef;
}

export function compact(value: unknown, opts: CompactOptions = {}): unknown {
  return compactInner(value, opts.maxArray ?? 32, 0, [], opts.ref);
}

function compactInner(
  value: unknown,
  maxArray: number,
  depth: number,
  path: (string | number)[],
  ref: CompactRef | undefined,
): unknown {
  if (depth > 12) return "[truncated: nested too deep]";
  if (Array.isArray(value)) {
    if (value.length > maxArray) {
      const stub: Record<string, unknown> = {
        omitted_items: value.length,
        sample_first: compactInner(value[0], maxArray, depth + 1, [], undefined),
        sample_last: compactInner(value[value.length - 1], maxArray, depth + 1, [], undefined),
      };
      if (ref) {
        stub.ref = { source: ref.source, args: ref.args, path };
        stub.hint =
          "Long time series omitted. Call get_timeseries with this ref to page through it, " +
          "or include_timeseries=true to get everything at once.";
      } else {
        stub.hint = "Long time series omitted. Call again with include_timeseries=true to get it.";
      }
      return stub;
    }
    return value.map((v, i) => compactInner(v, maxArray, depth + 1, [...path, i], ref));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue; // drop empty fields
      out[k] = compactInner(v, maxArray, depth + 1, [...path, k], ref);
    }
    return out;
  }
  return value;
}
