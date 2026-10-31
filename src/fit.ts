import { Decoder, Profile, Stream } from "@garmin/fitsdk";
import { unzipSync } from "fflate";

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

/** Message type name (e.g. "recordMesgs") -> the FIT SDK's numeric mesgNum, from its Profile. */
const MESG_NUM_BY_KEY: Record<string, number> = {};
for (const mesg of Object.values(Profile.messages)) MESG_NUM_BY_KEY[mesg.messagesKey] = mesg.num;

/** Thrown from a mesgListener to unwind Decoder.read() once enough messages have been seen. */
class StopDecoding extends Error {}

export interface FitMessagesPage {
  /** Number of messages of each type in the file, e.g. { recordMesgs: 5400, lapMesgs: 12 }. */
  counts: Record<string, number>;
  offset: number;
  limit: number;
  /** Requested message types, each sliced to [offset, offset + limit). */
  messages: Record<string, unknown[]>;
  /**
   * False when `counts` is a lower bound, not the file's true total: decoding stopped as soon as
   * `offset + limit` messages of every requested type had been seen, rather than reading to the
   * end of the file. Only possible when `types` is given — reading "everything" has to walk the
   * whole file regardless, since there's no way to know what types exist without doing so.
   */
  counts_exact: boolean;
  decode_errors?: string[];
}

/**
 * Decode every message in the FIT file as Garmin's FIT SDK reports it (field names in
 * camelCase, timestamps as ISO strings), with no interpretation. Message arrays are
 * paged so a long recording doesn't overflow the model's context.
 *
 * When `types` is given, decoding stops as soon as `offset + limit` messages of every requested
 * type have been seen — the FIT SDK always fully builds a message before handing it anywhere, so
 * this is the only way to make cost scale with the page requested rather than the whole file (a
 * multi-hour recording's full decode can take 10-20ms; aborting at a typical page is under 1ms).
 */
export function decodeFitMessages(
  file: Uint8Array,
  opts: { types?: string[]; offset?: number; limit?: number } = {},
): FitMessagesPage {
  const fit = extractFit(file);
  if (!Decoder.isFIT(Stream.fromByteArray(fit))) throw new Error("File is not a valid FIT file");

  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const limit = Math.max(1, Math.floor(opts.limit ?? 200));

  if (opts.types?.length) {
    return decodeTargeted(fit, opts.types, offset, limit);
  }
  return decodeFull(fit, offset, limit);
}

function decodeFull(fit: Uint8Array, offset: number, limit: number): FitMessagesPage {
  const { messages, errors } = new Decoder(Stream.fromByteArray(fit)).read({ convertDateTimesToDates: true });
  const all = messages as unknown as Record<string, unknown[]>;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(all)) if (Array.isArray(v)) counts[k] = v.length;

  const out: Record<string, unknown[]> = {};
  for (const t of Object.keys(counts)) out[t] = all[t]!.slice(offset, offset + limit);
  return {
    counts,
    offset,
    limit,
    messages: out,
    counts_exact: true,
    ...(errors.length ? { decode_errors: errors.map((e) => e.message) } : {}),
  };
}

function decodeTargeted(fit: Uint8Array, types: string[], offset: number, limit: number): FitMessagesPage {
  const unknown = types.filter((t) => !(t in MESG_NUM_BY_KEY));
  if (unknown.length) {
    throw new Error(`Unknown message type(s): ${unknown.join(", ")}. Not a recognized FIT SDK message name.`);
  }
  const typeByMesgNum = new Map(types.map((t) => [MESG_NUM_BY_KEY[t]!, t]));
  const target = offset + limit;
  const counts: Record<string, number> = Object.fromEntries(types.map((t) => [t, 0]));
  const buffers: Record<string, unknown[]> = Object.fromEntries(types.map((t) => [t, []]));
  let truncated = false;

  try {
    new Decoder(Stream.fromByteArray(fit)).read({
      convertDateTimesToDates: true,
      mesgListener: (mesgNum, mesg) => {
        const type = typeByMesgNum.get(mesgNum);
        if (type === undefined) return;
        counts[type]!++;
        if (counts[type]! <= target) buffers[type]!.push(mesg);
        if (types.every((t) => counts[t]! >= target)) {
          truncated = true;
          throw new StopDecoding();
        }
      },
    });
  } catch (err) {
    if (!(err instanceof StopDecoding)) throw err;
  }

  const out: Record<string, unknown[]> = {};
  for (const t of types) out[t] = buffers[t]!.slice(offset, offset + limit);
  return { counts, offset, limit, messages: out, counts_exact: !truncated };
}
