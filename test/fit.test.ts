import { describe, expect, it } from "vitest";
import { decodeFitMessages, extractFit } from "../src/fit.js";
import { makeFit, resortDay, zip } from "./fixtures.js";

describe("extractFit", () => {
  it("explains archives without a FIT file", () => {
    expect(() => extractFit(zip("route.gpx", new Uint8Array([1, 2, 3])))).toThrow(/no FIT file/);
  });
});

describe("decodeFitMessages", () => {
  it("returns raw decoded messages with counts and paging", () => {
    const file = zip("a.fit", makeFit(resortDay(1)));
    const page = decodeFitMessages(file, { types: ["recordMesgs", "sessionMesgs"], offset: 10, limit: 5 });
    expect(page.counts.recordMesgs).toBe(60);
    expect(page.counts.sessionMesgs).toBe(1);
    expect(page.messages.recordMesgs).toHaveLength(5);
    expect(page.messages.sessionMesgs).toEqual([]);
    const rec = page.messages.recordMesgs![0] as Record<string, unknown>;
    expect(rec.heartRate).toBe(85);
    expect(rec.timestamp).toBeInstanceOf(Date);
    expect(Object.keys(page.messages)).toEqual(["recordMesgs", "sessionMesgs"]);
  });

  it("returns every message type by default", () => {
    const page = decodeFitMessages(makeFit(resortDay(1)));
    expect(Object.keys(page.messages).sort()).toEqual(Object.keys(page.counts).sort());
    expect((page.messages.sessionMesgs![0] as Record<string, unknown>).sport).toBe("snowboarding");
    expect(page.limit).toBe(200);
  });

  it("names available types when asked for a missing one", () => {
    expect(() => decodeFitMessages(makeFit(resortDay(1)), { types: ["nopeMesgs"] })).toThrow(
      /not in this file: nopeMesgs.*recordMesgs/,
    );
  });
});
