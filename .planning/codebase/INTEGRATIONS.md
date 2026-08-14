# External Integrations

**Analysis Date:** 2026-08-14

## APIs & External Services

**Blockchain Data (TON):**
- TonAPI (`https://tonapi.io`) — primary on-chain data source (blocks, transactions, jetton balances, account state)
  - SDK/Client: raw fetch in `packages/scanner/src/config.ts` and `packages/executor/src/config.ts`
  - Auth: `TONAPI_KEY` (env var name only)
  - Base URL: `TONAPI_BASE` (default `https://tonapi.io`); `fly.toml` overrides to `https://tonapi.io/v2`
  - Network: `TON_NETWORK` (`mainnet` / `testnet`)
- Toncenter RPC (`https://toncenter.com/api/v2/jsonRPC`) — JSON-RPC fallback for wallet/contract calls
  - Client: `TON_RPC_URL` default in `packages/executor/src/config.ts`
  - Auth: `TONCENTER_API_KEY`

**Market Data:**
- Binance Spot (`https://api.binance.com`) — price/ticker data
  - Used by: `packages/backtest/src/fetch.ts` (`BINANCE_URL`)
- Binance Futures (`https://fapi.binance.com/fapi/v1`) — macro/funding data
  - Used by: `packages/risk-gates/src/macro-feed.ts`
- CoinGecko — market data fallback
  - Used by: `packages/backtest/src/fetch.ts` (`COINGECKO_URL`)

## Data Storage

**Databases:**
- TimescaleDB (PostgreSQL)
  - Connection: `DATABASE_URL` (env var name only; example value is localhost dev default)
  - Client: `pg` driver via `packages/*/src/db.ts`
- SQLite
  - Connection: `SQLITE_PATH` (default `./data/agent.db`)
  - Client: `better-sqlite3` via `packages/*/src/db.ts`

**File Storage:**
- Local filesystem only (`/app/data` mount in `Dockerfile`; `data/` dir for journals/state)

**Caching:**
- None

## Authentication & Identity

**Auth Provider:**
- Custom — no external identity provider
  - Chain access via `TON_CONFIG_PATH` (wallet config) and `@ton/mcp` custody
  - Telegram access via bot tokens (see below)

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/DataDog detected)

**Logs:**
- stdout/stderr via `dumb-init` in `Dockerfile`; `OPENCLAW_STATE_DIR` for agent state

## CI/CD & Deployment

**Hosting:**
- Fly.io (`fly.toml`)

**CI Pipeline:**
- None detected (no `.github/workflows` or equivalent)

## Environment Configuration

**Required env vars:**
- `TONAPI_KEY`, `TONAPI_BASE`, `TON_NETWORK`
- `TON_RPC_URL`, `TONCENTER_API_KEY`
- `DATABASE_URL`, `SQLITE_PATH`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERTS_BOT_TOKEN`
- `SIGNAL_OUT_URL`, `SIGNAL_OUT_SHARED_SECRET`
- `KILL_SWITCH_URL`, `TON_CONFIG_PATH`
- `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR`
- `PUBLIC_WEBHOOK_URL`

**Secrets location:**
- `.env` file (gitignored; see `.env.example` for names only)
- Fly.io secrets for production (`fly.toml` env section)

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- Signal webhook: `SIGNAL_OUT_URL` + `SIGNAL_OUT_SHARED_SECRET` (signal-out module)
- Kill switch: `KILL_SWITCH_URL` (polled; flips `KILL_SWITCH_FLIPPED`)
- Telegram: `TELEGRAM_BOT_TOKEN` (alerts to channels bound in `openclaw/openclaw.json`)

## Agent Integration (OpenClaw)

**Plugins:**
- `clawhub:ton-mcp` — TON wallet custody/execution (`openclaw/openclaw.json`)
- `https://docs.ton.org/mcp` — TON docs lookup (config.url in openclaw.json)
- `dune` — on-chain analytics
- `sim` — wallet balance/token lookups
- `sperax-skills` — sourced from `https://github.com/Sperax/sperax-skills` (in openclaw.json persona config)

**Inter-agent messaging:**
- `tools.agentToAgent.enabled: true` — agents (risk-analyst, executor, trader-ui, scanner-ops, market-intel) communicate directly

---

*Integration audit: 2026-08-14*
