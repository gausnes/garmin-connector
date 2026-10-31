# garmin-connector

Cloudflare Worker serving a stateless MCP server (Streamable HTTP, JSON responses) over Garmin's official Connect Personal API. Public repo, MIT.

## Layout
- `src/index.ts`: Worker entry. Auth via `/mcp/<MCP_PATH_SECRET>` or `Authorization: Bearer` on `/mcp`. Builds a fresh MCP server per request.
- `src/garmin.ts`: API client. API key → JWT bearer token (cached in isolate memory, refreshed within 1h of `exp`, retried once on 401). Downloaded activity files are also cached in isolate memory, since `get_activity_fit` pages through one activity with several calls.
- `src/tools.ts`: MCP tool definitions (all read-only).
- `src/fit.ts`: unzips the original activity file and decodes FIT with `@garmin/fitsdk`, returning the decoded messages as-is, paged (`get_activity_fit`).
- `src/compact.ts`: trims long arrays from Garmin responses. Given a `ref` (source tool + its args), a trimmed array carries that ref plus its JSON path so `get_timeseries` can refetch and page through it directly.

## Rules
- Never commit secrets. `GARMIN_API_KEY` and `MCP_PATH_SECRET` live only in Cloudflare secrets and `.dev.vars` (gitignored).
- Keep it read-only and single-user.
- Endpoint paths must match Garmin's reference client (github.com/garmin/connect-personal-api-python, `README.md` endpoint table).
- Run `npm run check` (tsc + vitest + wrangler dry-run) before committing.
- Date-range tools page results newest-first (`start`/`limit`); don't let `compact()` silently truncate a whole page.
- Tools whose response (or each paged item) can contain large nested arrays (`get_sleep`, `get_sleep_range`, `get_daily_summaries`, `get_body_battery`, `garmin_get`) pass a `ref` into `compact()` so `get_timeseries` can page into one array instead of requiring `include_timeseries=true` to dump everything. `get_hrv` doesn't yet — its real response shape (field names) hasn't been confirmed against a live account.
