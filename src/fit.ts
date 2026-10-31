import { Decoder, Stream } from "@garmin/fitsdk";
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

export interface FitMessagesPage {
  /** Number of messages of each type in the file, e.g. { recordMesgs: 5400, lapMesgs: 12 }. */
  counts: Record<string, number>;
  offset: number;
  limit: number;
  /** Requested message types, each sliced to [offset, offset + limit). */
  messages: Record<string, unknown[]>;
  decode_errors?: string[];
}

/**
 * Decode every message in the FIT file as Garmin's FIT SDK reports it (field names in
 * camelCase, timestamps as ISO strings), with no interpretation. Message arrays are
 * paged so a long recording doesn't overflow the model's context.
 */
export function decodeFitMessages(
  file: Uint8Array,
  opts: { types?: string[]; offset?: number; limit?: number } = {},
): FitMessagesPage {
  const fit = extractFit(file);
  if (!Decoder.isFIT(Stream.fromByteArray(fit))) throw new Error("File is not a valid FIT file");
  const { messages, errors } = new Decoder(Stream.fromByteArray(fit)).read({ convertDateTimesToDates: true });
  const all = messages as unknown as Record<string, unknown[]>;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(all)) if (Array.isArray(v)) counts[k] = v.length;

  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const limit = Math.max(1, Math.floor(opts.limit ?? 200));
  const types = opts.types?.length ? opts.types : Object.keys(counts);
  const unknown = types.filter((t) => !(t in counts));
  if (unknown.length) {
    throw new Error(
      `Message type(s) not in this file: ${unknown.join(", ")}. Available: ${Object.keys(counts).join(", ")}`,
    );
  }
  const out: Record<string, unknown[]> = {};
  for (const t of types) out[t] = all[t]!.slice(offset, offset + limit);
  return {
    counts,
    offset,
    limit,
    messages: out,
    ...(errors.length ? { decode_errors: errors.map((e) => e.message) } : {}),
  };
}
