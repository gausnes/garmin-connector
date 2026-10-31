import { GarminApiError } from "../garmin/index.js";

/** FIT messages can carry 64-bit fields that the SDK decodes as BigInt, which JSON can't encode. */
function jsonSafe(_key: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

export function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, jsonSafe, 1) }] };
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

export async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}
