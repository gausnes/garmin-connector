/**
 * Shapes for Garmin Personal API responses, based on live captures against a real account (see
 * AGENTS.md / PR history). Garmin's API is undocumented at the field level, so these reflect what
 * was actually observed on one account, not a published schema — fields not listed here may still
 * be present at runtime, and fields listed here aren't guaranteed on every activity/device/account.
 *
 * One interface per file, grouped by the endpoint that returns it.
 */
export * from "./activity-detail.js";
export * from "./activity-summary-dto.js";
export * from "./activity-type-ref.js";
export * from "./activity.js";
export * from "./body-battery-day.js";
export * from "./body-battery-value-descriptor.js";
export * from "./daily-summary.js";
export * from "./sleep-summary.js";
export * from "./type-ref.js";
export * from "./wellness-chronology.js";
