import { GarminApiError } from "../garmin/index.js";

/**
 * Replacer for the one JSON.stringify call every response goes through: stringifies BigInt (FIT
 * messages can carry 64-bit fields the SDK decodes as BigInt, which JSON can't encode) and drops
 * null fields, so no separate sanitizing pass has to walk the response first. `key !== ""` guards
 * the root call so a genuinely-null top-level result still serializes to `"null"`, not `undefined`.
 */
function jsonSafe(key: string, v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v === null && key !== "") return undefined;
  return v;
}

/**
 * get_activity_fit's handler calls this on its own result before returning it, since FIT-decoded
 * data is the only place BigInt can show up — `structuredContent` can't contain one either (the
 * transport will eventually JSON-serialize it with no replacer to catch it). Every other tool
 * returns plain Garmin JSON with no BigInt, so `structuredContent` can just reuse `data` directly.
 */
export function bigIntSafe(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data, jsonSafe));
}

/**
 * For tools with an outputSchema, `content` is spec-allowed to be empty — it exists only for
 * clients that don't yet read `structuredContent` (CallToolResultSchema: "this field is always
 * present, but it may be empty"). Single-user/single-client here, so skip the JSON.stringify pass
 * entirely rather than building a text block nothing reads.
 */
export function ok(data: unknown, structured = false) {
  return {
    content: structured ? [] : [{ type: "text" as const, text: JSON.stringify(data, jsonSafe, 1) }],
    ...(structured ? { structuredContent: data as Record<string, unknown> } : {}),
  };
}

export function fail(err: unknown) {
  const msg =
    err instanceof GarminApiError
      ? `${err.message}${err.body ? `\nGarmin said: ${err.body}` : ""}`
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

export async function run(fn: () => Promise<unknown>, opts: { structured?: boolean } = {}) {
  try {
    return ok(await fn(), opts.structured);
  } catch (err) {
    return fail(err);
  }
}
