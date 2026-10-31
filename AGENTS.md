# garmin-connector

Cloudflare Worker serving a stateless MCP server (Streamable HTTP, JSON responses) over Garmin's official Connect Personal API. Public repo, MIT.

## Layout
- `src/index.ts`: Worker entry. Auth via `/mcp/<MCP_PATH_SECRET>` or `Authorization: Bearer` on `/mcp`. Builds a fresh MCP server per request.
- `src/garmin.ts`: API client. API key → JWT bearer token (cached in isolate memory, refreshed within 1h of `exp`, retried once on 401).
- `src/tools.ts`: MCP tool definitions (all read-only).
- `src/fit.ts`: unzips the original activity file and decodes FIT with `@garmin/fitsdk` into per-minute series and climb phases (`analyze_activity`), or returns the decoded messages as-is, paged (`get_activity_fit`).
- `src/compact.ts`: trims long arrays from Garmin responses.

## Rules
- Never commit secrets. `GARMIN_API_KEY` and `MCP_PATH_SECRET` live only in Cloudflare secrets and `.dev.vars` (gitignored).
- Keep it read-only and single-user.
- Endpoint paths must match Garmin's reference client (github.com/garmin/connect-personal-api-python, `README.md` endpoint table).
- Run `npm run check` (tsc + vitest + wrangler dry-run) before committing.
- Activity-type judgment belongs to the model. `analyze_activity` reports measurements and phase totals, not verdicts.
