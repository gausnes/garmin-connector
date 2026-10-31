import { describe, expect, it } from "vitest";
import { analyzeActivityFile, extractFit } from "../src/fit.js";
import { makeFit, resortDay, splitboardTour, zip } from "./fixtures.js";

describe("analyzeActivityFile", () => {
  it("flags lift-assisted climbing on a resort day", () => {
    const file = zip("123_ACTIVITY.fit", makeFit(resortDay(3)));
    const a = analyzeActivityFile(file);
    expect(a.sport).toBe("snowboarding");
    expect(a.duration_min).toBe(30);
    expect(a.phases.lift_like_climb.minutes).toBeGreaterThanOrEqual(15);
    expect(a.phases.self_powered_climb.minutes).toBeLessThanOrEqual(3);
    expect(a.phases.lift_like_climb.hr_avg).toBeLessThan(100);
    expect(a.notes.join(" ")).toMatch(/chairlift/);
    expect(a.series.length).toBe(30);
  });

  it("shows long self-powered climbing on a splitboard tour", () => {
    const a = analyzeActivityFile(zip("t.fit", makeFit(splitboardTour())));
    expect(a.phases.lift_like_climb.minutes).toBe(0);
    expect(a.phases.self_powered_climb.minutes).toBeGreaterThanOrEqual(85);
    expect(a.phases.self_powered_climb.hr_avg).toBeGreaterThan(140);
    expect(a.phases.self_powered_climb.elev_change_m).toBeGreaterThan(650);
  });

  it("accepts a bare FIT file and can omit the series", () => {
    const a = analyzeActivityFile(makeFit(resortDay(1)), { includeSeries: false });
    expect(a.series).toEqual([]);
    expect(a.duration_min).toBe(10);
  });

  it("widens the interval when asked", () => {
    const a = analyzeActivityFile(makeFit(splitboardTour()), { intervalMinutes: 5 });
    expect(a.interval_minutes).toBe(5);
    expect(a.series.length).toBe(21);
  });

  it("explains archives without a FIT file", () => {
    expect(() => extractFit(zip("route.gpx", new Uint8Array([1, 2, 3])))).toThrow(/no FIT file/);
  });
});
