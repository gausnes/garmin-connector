# garmin-connector

Cloudflare Worker serving a stateless MCP server (Streamable HTTP, JSON responses) over Garmin's official Connect Personal API. Public repo, MIT.

## Layout
- `src/index.ts`: Worker entry. Auth via `/mcp/<MCP_PATH_SECRET>` or `Authorization: Bearer` on `/mcp`. Builds a fresh MCP server per request.
- `src/garmin/`: the Garmin API client, split by concern.
  - `client.ts`: transport. API key → JWT bearer token (cached in isolate memory, refreshed within 1h of `exp`, retried once on 401). Downloaded activity files are also cached in isolate memory, since `get_activity_fit` pages through one activity with several calls.
  - `api.ts`: `GarminApi`, a typed per-endpoint layer over a `GarminClient` (paths from Garmin's reference client). Types are compile-time only, not runtime-validated, so array-returning methods still defensively fall back to `[]`.
  - `model/`: TS shapes for confirmed response fields, one interface per file (barrel `index.ts`), from live captures against a real account — not a published schema. Endpoints with no confirmed shape (e.g. `hrvSummaries`) stay untyped rather than guessed.
  - `index.ts`: barrel re-exporting `client.ts`, `api.ts`, and `model/`.
- `src/tools.ts`: MCP tool definitions only (schemas + `registerTool` calls) — response shaping lives in `responses/`.
- `src/responses/`: response modeling shared across tool handlers, one file per concern (barrel `index.ts`): `page.ts` (date-range paging + `pageArray` for get_timeseries), `activity.ts` (summarizing `list_activities` items), `body-battery.ts` (the one typed `get_timeseries` ref + resolver, see below), `strip-nullish.ts` (plain null/undefined-dropping JSON cleanup, no truncation), `mcp-result.ts` (wrapping handler results/errors into MCP content).
- `src/fit.ts`: unzips the original activity file and decodes FIT with `@garmin/fitsdk`, returning the decoded messages as-is, paged (`get_activity_fit`).

## Rules
- Never commit secrets. `GARMIN_API_KEY` and `MCP_PATH_SECRET` live only in Cloudflare secrets and `.dev.vars` (gitignored).
- Keep it read-only and single-user.
- Endpoint paths must match Garmin's reference client (github.com/garmin/connect-personal-api-python, `README.md` endpoint table).
- Run `npm run check` (tsc + vitest + wrangler dry-run) before committing.
- `GarminClient` tests exercise real `fetch()` against `nock`-intercepted endpoints (`test/garmin.test.ts`, fixtures in `test/garmin-mock.ts` shaped after confirmed real API responses) rather than injecting a fake implementation — prefer extending those over hand-rolled stand-ins.
- Date-range tools page results newest-first (`start`/`limit`).
- `get_activity_fit` with `message_types` set decodes via a `mesgListener` that aborts once `offset + limit` messages of every requested type are seen, so cost scales with the page requested, not the whole file (Cloudflare Workers' free-tier 10ms CPU budget makes full-file decodes of long activities risky otherwise). `counts` becomes a lower bound (`counts_exact: false`) when truncated this way. Only possible when `types` is given — without it, the full file must be walked regardless.
- No generic mechanisms for unconfirmed shapes: no raw-GET escape hatch, and no generic ref-and-JSON-path walking or array-crawling truncation. `get_timeseries` is strongly typed to the one endpoint with a confirmed long-array field, `get_body_battery`'s `bodyBatteryValuesArray` (`responses/body-battery.ts`). A tool only gets a typed `get_timeseries` ref once its long-array field is actually confirmed against live data and modeled in `model/`. Until then (`get_sleep`, `get_sleep_range`, `get_daily_summaries`, `get_hrv`), responses just get `stripNullish`'s null cleanup — no truncation, no ref — so a surprise long array passes through untouched rather than being guessed at.
