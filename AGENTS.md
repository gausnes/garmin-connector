# garmin-connector

Cloudflare Worker serving a stateless MCP server (Streamable HTTP, JSON responses) over Garmin's official Connect Personal API. Public repo, MIT.

## Layout
- `src/index.ts`: Worker entry. Auth via `/mcp/<MCP_PATH_SECRET>` or `Authorization: Bearer` on `/mcp`. Builds a fresh MCP server per request.
- `src/garmin/`: the Garmin API client, split by concern.
  - `client.ts`: transport. API key → JWT bearer token (cached in isolate memory, refreshed within 1h of `exp`, retried once on 401). Downloaded activity files are also cached in isolate memory, since `get_activity_fit` pages through one activity with several calls.
  - `api.ts`: `GarminApi`, a typed per-endpoint layer over a `GarminClient` (paths from Garmin's reference client). Types are compile-time only, not runtime-validated, so array-returning methods still defensively fall back to `[]`.
  - `model.ts`: TS shapes for confirmed response fields, from live captures against a real account — not a published schema. Endpoints with no confirmed shape (e.g. `hrvSummaries`) stay untyped rather than guessed.
  - `index.ts`: barrel re-exporting all three.
- `src/tools.ts`: MCP tool definitions (all read-only).
- `src/fit.ts`: unzips the original activity file and decodes FIT with `@garmin/fitsdk`, returning the decoded messages as-is, paged (`get_activity_fit`).
- `src/compact.ts`: trims long arrays from Garmin responses. Given a `ref` (source tool + its args), a trimmed array carries that ref plus its JSON path so `get_timeseries` can refetch and page through it directly.

## Rules
- Never commit secrets. `GARMIN_API_KEY` and `MCP_PATH_SECRET` live only in Cloudflare secrets and `.dev.vars` (gitignored).
- Keep it read-only and single-user.
- Endpoint paths must match Garmin's reference client (github.com/garmin/connect-personal-api-python, `README.md` endpoint table).
- Run `npm run check` (tsc + vitest + wrangler dry-run) before committing.
- `GarminClient` tests exercise real `fetch()` against `nock`-intercepted endpoints (`test/garmin.test.ts`, fixtures in `test/garmin-mock.ts` shaped after confirmed real API responses) rather than injecting a fake implementation — prefer extending those over hand-rolled stand-ins.
- Date-range tools page results newest-first (`start`/`limit`); don't let `compact()` silently truncate a whole page.
- Tools whose response (or each paged item) can contain large nested arrays (`get_sleep`, `get_sleep_range`, `get_daily_summaries`, `get_body_battery`, `garmin_get`) pass a `ref` into `compact()` so `get_timeseries` can page into one array instead of requiring `include_timeseries=true` to dump everything. `get_hrv` doesn't yet — its real response shape (field names) hasn't been confirmed against a live account.
