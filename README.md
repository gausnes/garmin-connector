# garmin-connector

An [MCP](https://modelcontextprotocol.io) connector that gives Claude read-only access to **your own** Garmin Connect data (sleep, HRV, Body Battery, daily summaries, activities and original FIT files) through Garmin's official [Connect Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api). It runs on a free Cloudflare Worker, so it works from Claude on the web, desktop and phone.

> Not affiliated with Garmin. Uses only Garmin's documented, read-only Personal API with a key you create for your own account.

## Tools

| Tool | What it returns |
|---|---|
| `get_sleep` | One night: duration, stages, sleep score, overnight HRV, resting HR (date = morning you woke up) |
| `get_sleep_range` | One sleep summary per night (max 31 days), paged newest-first |
| `get_daily_summaries` | Steps, calories, stress, Body Battery, resting HR per day (up to 1 year), paged newest-first |
| `get_hrv` | HRV status and baseline per day, paged newest-first |
| `get_body_battery` | Daily Body Battery reports (max 31 days), paged newest-first |
| `list_activities` | Recent activities with type, duration, distance, elevation, HR |
| `get_activity` | Garmin's full summary for one activity |
| `get_activity_fit` | The FIT file's decoded messages as-is (records, laps, sessions, events, HRV, devices), with counts per type and offset/limit paging |
| `get_body_battery_series` | Pages through a day's Body Battery curve, using the `ref` get_body_battery attaches when that array is too long to return inline |

A day's per-minute Body Battery levels are summarized by default, with a `ref` attached so `get_body_battery_series` can page through just that array without dumping everything. Pass `include_timeseries: true` on `get_body_battery` instead to get the whole response in full. Date-range tools (`get_sleep_range`, `get_daily_summaries`, `get_hrv`, `get_body_battery`) page newest-first; pass `start`/`limit` to go further back. All paged tools, including `get_body_battery_series`, return the same `{ total, start, limit, items }` shape (also published as each tool's `outputSchema`, so clients can read `structuredContent` instead of re-parsing JSON text).

## Setup (about 15 minutes, all free)

### 1. Create a Garmin personal API key
1. Sign in at [connect.garmin.com](https://connect.garmin.com) on the web.
2. Open the **Personal API Key** page from your account settings, select **Create Key**, accept the terms and pick an expiration.
3. Copy the key now; it's shown only once. Treat it like a password.

### 2. Deploy the Worker
You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and Node 26+ (matches CI).

```sh
git clone https://github.com/gausnes/garmin-connector && cd garmin-connector
npm ci
npx wrangler login
npx wrangler deploy
```

Note the URL it prints, e.g. `https://garmin-connector.<you>.workers.dev`.

### 3. Set the two secrets
```sh
npx wrangler secret put GARMIN_API_KEY       # paste your Garmin key
openssl rand -hex 32                         # generate a connector secret, copy it
npx wrangler secret put MCP_ACCESS_KEY       # paste that value
```
(You can also add them in the Cloudflare dashboard under Workers & Pages → garmin-connector → Settings → Variables and Secrets.)

### 4. Add it to Claude
In claude.ai, go to **Settings → Connectors → Add custom connector**, use this URL:

```
https://garmin-connector.<you>.workers.dev/mcp
```

and add an HTTP header `access-key` set to your `MCP_ACCESS_KEY` value (`Authorization` is reserved there for OAuth). Leave the OAuth fields empty. The connector then shows up in Claude on every device.

For Claude Code: `claude mcp add --transport http garmin https://garmin-connector.<you>.workers.dev/mcp --header "access-key: <MCP_ACCESS_KEY>"`

## Security model

- **Single user, read-only.** The Personal API can't write anything, and this Worker only reads your account.
- **The connector secret is the password.** Anyone with it can read your Garmin data. Don't share it. If it leaks, run `wrangler secret put MCP_ACCESS_KEY` with a new value and update the `access-key` header in Claude. Wrong or missing secrets get a plain 404.
- **Your Garmin key never leaves Cloudflare's secret store.** It's never committed, logged or returned to Claude. Bearer tokens (24h) are cached in memory only.
- When your Garmin key expires, create a new one and run `wrangler secret put GARMIN_API_KEY` again.

## Continuous deployment (optional)

`.github/workflows/ci.yml` typechecks, tests and dry-run-bundles every PR and push. The `deploy` job runs under `environment: production`, so its secrets live on that GitHub Environment, not the plain repo Actions secrets page: GitHub repo → **Settings → Environments → production → Environment secrets**. Add:

- `CLOUDFLARE_API_TOKEN`: create it at dash.cloudflare.com → My Profile → API Tokens, using the **Edit Cloudflare Workers** template
- `CLOUDFLARE_ACCOUNT_ID`: shown on the Workers & Pages overview page

Without them, the deploy job is skipped. Forks can use their own.

**When `CLOUDFLARE_API_TOKEN` expires** (tokens can be created with an expiration date), the `deploy` job starts failing on push to `main` with an auth error from `wrangler-action`. To rotate it:
1. dash.cloudflare.com → My Profile → API Tokens → create a new one with the same **Edit Cloudflare Workers** template.
2. GitHub repo → Settings → Environments → production → Environment secrets → edit `CLOUDFLARE_API_TOKEN` → paste the new value.
3. Revoke the old token from the Cloudflare dashboard once the next deploy succeeds.

`CLOUDFLARE_ACCOUNT_ID` is just your account identifier, not a credential — it doesn't expire and only needs updating if you move the Worker to a different Cloudflare account.

## Development

```sh
cp .dev.vars.example .dev.vars   # fill in real values to hit Garmin locally
npm run dev                      # local Worker on http://localhost:8787
npm run check                    # typecheck + tests + bundle
```

Endpoint paths come from Garmin's reference client, [garmin/connect-personal-api-python](https://github.com/garmin/connect-personal-api-python). Garmin's range limits: sleep and Body Battery 31 days, steps and stress 28 days, daily summaries 1 year.

## License

MIT
