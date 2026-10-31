export interface Page {
  total: number;
  start: number;
  limit: number;
  items: unknown[];
}

/** Page a date-range array newest-first. `full`/`summarizeItem` let a caller swap in per-item truncation. */
export function paginate(
  data: unknown,
  opts: { start?: number; limit?: number },
  full = false,
  summarizeItem: (item: unknown) => unknown = (item) => item,
): unknown {
  if (!Array.isArray(data)) return data;
  const items = [...data].reverse();
  const start = Math.max(0, Math.floor(opts.start ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 20)));
  const page: Page = {
    total: items.length,
    start,
    limit,
    items: items.slice(start, start + limit).map((item) => (full ? item : summarizeItem(item))),
  };
  return page;
}

/** Slices a known array to one page — used by get_timeseries, which already has the full array. */
export function pageArray<T>(items: T[], start: number | undefined, limit: number | undefined): Page {
  const s = Math.max(0, Math.floor(start ?? 0));
  const l = Math.min(500, Math.max(1, Math.floor(limit ?? 200)));
  return { total: items.length, start: s, limit: l, items: items.slice(s, s + l) };
}
