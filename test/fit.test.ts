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
    // sessionMesgs only has 1 message, so it can never reach offset+limit=15 — decoding can't stop
    // early, and both counts come back exact.
    expect(page.counts.recordMesgs).toBe(60);
    expect(page.counts.sessionMesgs).toBe(1);
    expect(page.counts_exact).toBe(true);
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
    expect(page.counts_exact).toBe(true);
  });

  it("stops decoding once a single requested type's page is found, reporting counts as a lower bound", () => {
    const page = decodeFitMessages(makeFit(resortDay(1)), { types: ["recordMesgs"], offset: 10, limit: 5 });
    expect(page.counts.recordMesgs).toBe(15); // offset + limit, not the true total of 60
    expect(page.counts_exact).toBe(false);
    expect(page.messages.recordMesgs).toHaveLength(5);
  });

  it("doesn't truncate early when the requested type runs out before offset + limit", () => {
    const page = decodeFitMessages(makeFit(resortDay(1)), { types: ["sessionMesgs"], offset: 0, limit: 200 });
    expect(page.counts.sessionMesgs).toBe(1);
    expect(page.counts_exact).toBe(true);
    expect(page.messages.sessionMesgs).toHaveLength(1);
  });

  it("returns empty results for a recognized FIT type that's just absent from this file", () => {
    const page = decodeFitMessages(makeFit(resortDay(1)), { types: ["hrvMesgs"] });
    expect(page.counts.hrvMesgs).toBe(0);
    expect(page.messages.hrvMesgs).toEqual([]);
  });

  it("rejects a type name the FIT SDK doesn't recognize at all", () => {
    expect(() => decodeFitMessages(makeFit(resortDay(1)), { types: ["nopeMesgs"] })).toThrow(
      /Unknown message type.*nopeMesgs/,
    );
  });
});
