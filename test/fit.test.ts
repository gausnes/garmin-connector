import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFitMessages, extractFit } from "../src/fit.ts";
import { makeFit, resortDay, zip } from "./fixtures.ts";

describe("extractFit", () => {
  it("explains archives without a FIT file", () => {
    assert.throws(() => extractFit(zip("route.gpx", new Uint8Array([1, 2, 3]))), /no FIT file/);
  });
});

describe("decodeFitMessages", () => {
  it("returns raw decoded messages with counts and paging", () => {
    const file = zip("a.fit", makeFit(resortDay(1)));
    const page = decodeFitMessages(file, { types: ["recordMesgs", "sessionMesgs"], offset: 10, limit: 5 });
    // sessionMesgs only has 1 message, so it can never reach offset+limit=15 — decoding can't stop
    // early, and both counts come back exact.
    assert.strictEqual(page.counts.recordMesgs, 60);
    assert.strictEqual(page.counts.sessionMesgs, 1);
    assert.strictEqual(page.counts_exact, true);
    assert.strictEqual(page.messages.recordMesgs!.length, 5);
    assert.deepStrictEqual(page.messages.sessionMesgs, []);
    const rec = page.messages.recordMesgs![0] as Record<string, unknown>;
    assert.strictEqual(rec.heartRate, 85);
    assert.ok(rec.timestamp instanceof Date);
    assert.deepStrictEqual(Object.keys(page.messages), ["recordMesgs", "sessionMesgs"]);
  });

  it("returns every message type by default", () => {
    const page = decodeFitMessages(makeFit(resortDay(1)));
    assert.deepStrictEqual(Object.keys(page.messages).sort(), Object.keys(page.counts).sort());
    assert.strictEqual((page.messages.sessionMesgs![0] as Record<string, unknown>).sport, "snowboarding");
    assert.strictEqual(page.limit, 200);
    assert.strictEqual(page.counts_exact, true);
  });

  it("stops decoding once a single requested type's page is found, reporting counts as a lower bound", () => {
    const page = decodeFitMessages(makeFit(resortDay(1)), { types: ["recordMesgs"], offset: 10, limit: 5 });
    assert.strictEqual(page.counts.recordMesgs, 15); // offset + limit, not the true total of 60
    assert.strictEqual(page.counts_exact, false);
    assert.strictEqual(page.messages.recordMesgs!.length, 5);
  });

  it("doesn't truncate early when the requested type runs out before offset + limit", () => {
    const page = decodeFitMessages(makeFit(resortDay(1)), { types: ["sessionMesgs"], offset: 0, limit: 200 });
    assert.strictEqual(page.counts.sessionMesgs, 1);
    assert.strictEqual(page.counts_exact, true);
    assert.strictEqual(page.messages.sessionMesgs!.length, 1);
  });

  it("returns empty results for a recognized FIT type that's just absent from this file", () => {
    const page = decodeFitMessages(makeFit(resortDay(1)), { types: ["hrvMesgs"] });
    assert.strictEqual(page.counts.hrvMesgs, 0);
    assert.deepStrictEqual(page.messages.hrvMesgs, []);
  });

  it("rejects a type name the FIT SDK doesn't recognize at all", () => {
    assert.throws(
      () => decodeFitMessages(makeFit(resortDay(1)), { types: ["nopeMesgs"] }),
      /Unknown message type.*nopeMesgs/,
    );
  });
});
