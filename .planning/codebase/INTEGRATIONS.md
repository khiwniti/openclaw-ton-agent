# External Integrations

**Analysis Date:** 2026-08-16

## APIs & External Services

**Blockchain RPC & Indexers (TON):**
- TonAPI (`https://tonapi.io/v2`) — primary high-speed indexed on-chain data provider (jetton accounts, balances, events, traces, pools).
  - Used in: `packages/scanner/src/tonapi.ts`, `packages/scanner/src/tonapi-source.ts`, `packages/executor/src/config.ts`.
  - Auth: `TONAPI_KEY` (bearer token).
  - Base URL: `TONAPI_BASE` (default `https://tonapi.io/v2`).
- Toncenter JSON-RPC (`https://toncenter.com/api/v2/jsonRPC` / `https://testnet.toncenter.com/api/v3`) — fallback and direct contract state query RPC.
  - Used in: `packages/wallet/src/wallet.ts`, `packages/executor/src/acton/acton-wallet.ts`, `Acton.toml`.
  - Auth: `TONCENTER_API_KEY`.
  - Network: `TON_NETWORK` (`mainnet` or `testnet`).

**DEX Protocols & Swaps:**
- DeDust (`https://dedust.io`) — factory and native asset pool routing (`packages/dex/src/router.ts`, `packages/executor/src/acton/router.ts`).
- STON.fi (`https://ston.fi`) — constant-product AMM router (`packages/dex/src/router.ts`).
- Omniston (via `@ton/mcp`) — cross-DEX aggregator tool used by OpenClaw agents for optimal trade routing.

**Market & Macro Intelligence:**
- Binance Spot API (`https://api.binance.com`) — historical klines and spot tickers for backtesting and price reference (`packages/backtest/src/fetch.ts`).
- Binance USD-M Futures API (`https://fapi.binance.com/fapi/v1`) — macro market funding rates, open interest, and regime shifts (`packages/risk-gates/src/macro-feed.ts`).
- CoinGecko API (`https://api.coingecko.com`) — secondary historical market data provider (`packages/backtest/src/fetch.ts`).

**Telegram Interface:**
- Telegram Bot API — conversational interaction and real-time alert broadcasts configured via `openclaw/openclaw.json`:
  - `TELEGRAM_BOT_TOKEN` — default account bound to `trader-ui` persona (DM policy: pairing).
  - `TELEGRAM_ALERTS_BOT_TOKEN` — alerts account bound to `market-intel` persona (DM policy: allowlist).

## Data Storage

**Databases:**
- SQLite (Local WAL Database):
  - Path: `SQLITE_PATH` (defaults to `/app/data/agent.db` or `./data/agent.db`).
  - Driver: `better-sqlite3` with `journal_mode = WAL`.
  - Managed by: `packages/storage/src/store.ts`.
  - Schemas: `positions`, `daily_pnl`, `decision_journal`, `agentic_wallets`.
- TimescaleDB / PostgreSQL (Optional / Analytics):
  - Connection: `DATABASE_URL` (`postgres://postgres:postgres@localhost:5432/openclaw`).
  - Purpose: Long-term historical time-series analytics and backtest storage.

**File Storage & Append Journals:**
- Local Filesystem mount (`/app/data` in container):
  - Signal Streams: `packages/shared/src/journal.ts` writes rotated NDJSON logs (`signals-mainnet.ndjson`, `gated-mainnet.ndjson`).
  - Order & Fill Logs: `ORDERS_OUT` (`/app/data/orders-mainnet.ndjson`), `FILLS_OUT` (`/app/data/fills-mainnet.ndjson`).
  - Agent Bus Logs: `/app/data/bus.ndjson`.

**Messaging & Caching:**
- Redis:
  - Connection: `REDIS_URL` (`redis://localhost:6379`).
  - Client: `ioredis`.
  - Purpose: Inter-agent event publication and subscription (`agents.broadcast`, `agents.direct.*`) in `packages/agents/src/bus.ts`.

## Authentication & Identity

**On-Chain Custody & Key Management:**
- TON Wallet v5r1 — native mnemonic-derived keypair using `@ton/crypto` (`mnemonicToPrivateKey`) and `@ton/ton` (`WalletContractV5R1`).
- Acton Smart Contract Wallets — locked smart contract wallet logic with delegated public keys and daily spend caps (`packages/executor/src/acton/locked-wallet.ts`, `packages/storage/src/store.ts`).
- OpenClaw MCP Custody — `@ton/mcp` extension managing keyrings for autonomous agents.

**API & System Authentication:**
- Webhook HMAC Authentication: `SIGNAL_OUT_SHARED_SECRET` validated on outgoing signal dispatch (`packages/scanner/src/signal-out.ts`).
- Fastify Rate Limiting & Helmet: IP-based rate limiting (200 req/min) in `packages/api/src/index.ts`.

## Monitoring & Observability

**Error Tracking & Health Probes:**
- Health Endpoints:
  - Fastify API (Port 3000): `/health`, `/health/ready`, `/health/live`, `/health/status` (`packages/api/src/routes/health.ts`).
  - Scanner Health Probe (Port 8080): HTTP status server in `packages/scanner/src/health.ts`.
  - Executor Health Probe (Port 8081): HTTP status server in `packages/executor/src/continuous.ts`.
- Fly.io Health Checks:
  - TCP checks on internal port 8080.
  - HTTP checks on port 3000 calling `/health/ready` every 30s.

**Telemetry & Logging:**
- Structured Logging: Level-based JSON logging via `packages/core/src/logger.ts` controlled by `LOG_LEVEL` (debug, info, warn, error).
- OpenTelemetry: Configured via `OTEL_EXPORTER_OTLP_ENDPOINT` for trace export.

## CI/CD & Deployment

**Hosting:**
- Fly.io:
  - Production Spec: `fly.toml` (app `openclaw-ton-agent`, primary region `sin`, unified container with 1024MB RAM).
  - Testnet Spec: `fly.testnet.toml` (for testing against testnet RPCs).

**Container Build:**
- Multi-stage Dockerfile (`Dockerfile`):
  - Builder stage builds TypeScript and compiles native C++ `better-sqlite3` bindings.
  - Runtime stage runs as non-root `appuser` (UID 1001) with `dumb-init`.
  - Unified process supervisor `scripts/start-unified.sh` launches API, Scanner, Risk-Gates, and Executor with trap shutdown.

## Environment Configuration

**Required Environment Variables:**
- Core: `NODE_ENV`, `TON_NETWORK`, `OBSERVE_ONLY`, `DATA_DIR`, `SQLITE_PATH`, `JOURNAL_DIR`.
- Network & RPC: `TONAPI_KEY`, `TONAPI_BASE`, `TONCENTER_API_KEY`, `TON_RPC_URL`.
- Risk & Execution: `EXECUTION_MODE`, `GATES_G1_G3_ACK`, `CIRCUIT_BREAKER_DRAWDOWN_PCT`, `MAX_OPEN_POSITIONS_PER_TIER`, `GATE_RISK_PER_TRADE_PCT`, `GATE_VOL_FLOOR_PCT`, `GATE_VOL_CAP_PCT`.
- Ports & Services: `API_PORT`, `API_HOST`, `PORT` (Scanner health), `EXEC_HEALTH_PORT`, `REDIS_URL`.
- OpenClaw & Webhooks: `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR`, `SIGNAL_OUT_URL`, `SIGNAL_OUT_SHARED_SECRET`, `KILL_SWITCH_URL`, `KILL_SWITCH_POLL_MS`.
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERTS_BOT_TOKEN`.
- Acton: `ACTON_ENABLED`, `ACTON_PROJECT_PATH`, `ACTON_CONTRACT_ADDRESS`, `ACTON_ROUTER_ADDRESS`.

**Secrets Storage:**
- Fly.io Secrets (`fly secrets set`) for production deployment.
- Local `.env` (gitignored; documented via `.env.example`).

## Webhooks & Callbacks

**Incoming:**
- Fastify WebSocket (`/ws` on port 3000): streams live decisions, signal events, and health metrics to connected trader dashboards (`packages/api/src/routes/ws.ts`).

**Outgoing:**
- Signal Webhook: `SIGNAL_OUT_URL` with HMAC header `X-Agent-Secret` (`packages/scanner/src/signal-out.ts`).
- Kill Switch Poller: periodic GET to `KILL_SWITCH_URL` (every `KILL_SWITCH_POLL_MS` ms) which halts all trade execution immediately if tripped.
- Telegram Alerts: automated broadcasts to configured channel IDs on gate triggers, trade execution, or circuit breaker trips.

## OpenClaw MCP Plugins

Defined in `openclaw/openclaw.json`:
- `ton` (`clawhub:ton-mcp`): official TON Blockchain MCP providing agentic wallet tools and Omniston swap execution.
- `ton-docs` (`https://docs.ton.org/mcp`): hosted documentation server for on-chain development reference.
- `dune`: Dune Analytics MCP plugin for whale discovery and on-chain metrics.
- `sim`: Dune Sim MCP plugin for real-time wallet balances and token metadata.
- `sperax-skills`: external financial/DeFi risk skills imported from `https://github.com/Sperax/sperax-skills`.

---

*Integration audit: 2026-08-16*
