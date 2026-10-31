/**
 * Response modeling shared by the MCP tool handlers in tools.ts: paging date-range arrays,
 * summarizing activities and Body Battery days, resolving a get_body_battery_series ref back to its
 * source array, and wrapping handler results/errors into MCP content (including null-dropping,
 * folded into the one JSON.stringify pass every response already goes through). One file per concern.
 */
export * from "./activity.ts";
export * from "./body-battery.ts";
export * from "./mcp-result.ts";
export * from "./page.ts";
