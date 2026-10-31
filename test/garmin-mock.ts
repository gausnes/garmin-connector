import nock from "nock";
import { DEFAULT_BASE_URL, TOKEN_PATH } from "../src/garmin/index.ts";

export function jwt(expSec: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64({ exp: expSec })}.sig`;
}

/** Stubs the token endpoint and returns the bearer token it hands back. One-shot by default. */
export function mockToken(
  apiKey: string,
  opts: { times?: number; expiresInSec?: number; nowSec?: number } = {},
): string {
  const base = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const exp = base + (opts.expiresInSec ?? 86400);
  const token = jwt(exp);
  nock(DEFAULT_BASE_URL, { reqheaders: { authorization: `ApiKey ${apiKey}` } })
    .post(TOKEN_PATH)
    .times(opts.times ?? 1)
    .reply(200, token);
  return token;
}

/** Shaped after a real dailySleep response (see AGENTS.md / PR history): mostly scalars and nulls. */
export function dailySleepFixture(calendarDate: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 1234567890,
    userProfilePK: 987654321,
    calendarDate,
    sleepTimeSeconds: 27000,
    napTimeSeconds: 0,
    sleepWindowConfirmed: true,
    sleepStartTimestampGMT: 1761780600000,
    sleepEndTimestampGMT: 1761807600000,
    deepSleepSeconds: 5400,
    lightSleepSeconds: 14400,
    remSleepSeconds: 5400,
    awakeSleepSeconds: 1800,
    deviceRemCapable: true,
    retro: false,
    averageSpO2Value: null,
    avgHeartRate: null,
    ...overrides,
  };
}

/** Shaped after a real bodyBattery reports/daily item: keyed by `date`, not `calendarDate`. */
export function bodyBatteryDayFixture(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    charged: 62,
    drained: 58,
    startTimestampGMT: `${date}T07:00:00.0`,
    endTimestampGMT: `${date}T07:00:00.0`,
    bodyBatteryValuesArray: [
      [0, 50],
      [900000, 55],
    ],
    bodyBatteryValueDescriptorDTOList: [
      { bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: "timestamp" },
      { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: "bodyBatteryLevel" },
    ],
    ...overrides,
  };
}

/** Shaped after a real dailysummaries item (the endpoint itself wraps these in `{ data: [...] }`). */
export function dailySummaryFixture(calendarDate: string, overrides: Record<string, unknown> = {}) {
  return {
    uuid: "fixture-uuid",
    userProfilePk: 987654321,
    calendarDate,
    source: "GARMIN",
    movement: { steps: { goal: 10000, value: 8200, distanceInMeters: 6100 } },
    calories: { burnedResting: 1600, burnedActive: 420, burnedTotal: 2020 },
    heartRate: { minValue: 48, maxValue: 142, restingValue: 52 },
    stress: { avgLevel: 24, maxLevel: 70, qualifier: "BALANCED" },
    bodyBattery: { minValue: 20, maxValue: 90, chargedValue: 62, drainedValue: 58, latestValue: 55 },
    ...overrides,
  };
}
