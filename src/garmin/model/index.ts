/**
 * Shapes for Garmin Personal API responses, based on live captures against a real account (see
 * AGENTS.md / PR history). Garmin's API is undocumented at the field level, so these reflect what
 * was actually observed on one account, not a published schema — fields not listed here may still
 * be present at runtime, and fields listed here aren't guaranteed on every activity/device/account.
 *
 * One interface per file, grouped by the endpoint that returns it.
 */
export * from "./activity-detail.ts";
export * from "./activity-summary-dto.ts";
export * from "./activity-type-ref.ts";
export * from "./activity.ts";
export * from "./body-battery-day.ts";
export * from "./body-battery-value-descriptor.ts";
export * from "./daily-summary.ts";
export * from "./sleep-summary.ts";
export * from "./type-ref.ts";
export * from "./wellness-chronology.ts";
