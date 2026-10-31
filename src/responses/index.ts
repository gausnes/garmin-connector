/**
 * Response modeling shared by the MCP tool handlers in tools.ts: paging date-range arrays,
 * summarizing activities and Body Battery days, resolving a get_timeseries ref back to its source
 * array, stripping null fields for plain JSON cleanup, and wrapping handler results/errors into MCP
 * content. One file per concern.
 */
export * from "./activity.js";
export * from "./body-battery.js";
export * from "./mcp-result.js";
export * from "./page.js";
export * from "./strip-nullish.js";
