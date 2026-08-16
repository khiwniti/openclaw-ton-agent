# Codebase Concerns

**Analysis Date:** 2026-08-16

## Tech Debt

**1. Simulated DEX Execution Stubs:**
- **Issue:** In `packages/dex/src/router.ts`, `executeSwap` and `getSwapQuote` currently use simplified calculation stubs (`expectedOutNano = BigInt(amountInNano) / 2n` and `txHash: "simulated_tx"`).
- **Files:** `packages/dex/src/router.ts` (lines 18-32), `packages/executor/src/acton/router.ts`.
- **Impact:** Live trades routed through `executeSwap` in `packages/dex` will not submit real BOC messages to DeDust/STON.fi factory pools unless using the Acton wallet path (`packages/executor/src/acton/acton-wallet.ts`) or `@ton/mcp`.
- **Fix approach:** Replace the simulated execution stub with production DeDust SDK (`@dedust/sdk`) and STON.fi SDK (`@ston-fi/sdk`) transaction builders, while preserving deterministic fallback testing.

**2. Duplicate Wallet Layer Implementations:**
- **Issue:** Three distinct wallet handling layers exist across the codebase:
  1. `packages/wallet/src/wallet.ts` (basic `TonClient` and `WalletContractV5R1` wrapper)
  2. `packages/executor/src/wallet.ts` (execution-specific wallet adapter interface)
  3. `packages/executor/src/acton/acton-wallet.ts` (Acton smart contract wallet implementation)
- **Files:** `packages/wallet/src/wallet.ts`, `packages/executor/src/wallet.ts`, `packages/executor/src/acton/acton-wallet.ts`.
- **Impact:** Inconsistent error reporting, fragmented balance checking logic, and potential confusion over which wallet adapter is authoritative in production.
- **Fix approach:** Consolidate wallet interfaces into `packages/wallet`, exposing standard adapter implementations (`NativeV5R1Adapter`, `ActonSmartWalletAdapter`, `PaperWalletAdapter`).

**3. Unversioned SQLite Migration Script:**
- **Issue:** `packages/storage/src/store.ts` runs a hardcoded multi-table `CREATE TABLE IF NOT EXISTS` block in its constructor without schema versioning or migration history tracking.
- **Files:** `packages/storage/src/store.ts` (lines 16-52).
- **Impact:** Modifying table schemas (e.g. altering `positions` or `decision_journal` columns) in future releases will require manual database wipes or risk runtime SQL errors.
- **Fix approach:** Introduce a lightweight migration table (`schema_migrations`) or adopt standard PRAGMA `user_version` tracking in SQLite.

**4. Backtest CEX-to-DEX Cross-Rate Discrepancies:**
- **Issue:** Backtesting engine derives historical jetton pricing via synthetic CEX cross-rates (Binance + CoinGecko) in `packages/backtest/src/fetch.ts`, whereas actual execution occurs against on-chain AMM bonding curves.
- **Files:** `packages/backtest/src/fetch.ts`, `packages/backtest/src/drift.ts`.
- **Impact:** Backtest Sharpe ratio and expectancy calculations may overstate performance on low-liquidity pairs subject to AMM price impact and pool imbalance.
- **Fix approach:** Ingest on-chain DeDust/STON.fi historical swap swap logs (via TonAPI event history) into `packages/backtest` for high-fidelity backtesting.

## Known Bugs & Operational Risks

**1. Dockerfile `SKIP_TYPECHECK` Build Argument:**
- **Issue:** `Dockerfile` supports `ARG SKIP_TYPECHECK=false`, which allows bypassing `npm run typecheck` during container compilation.
- **Files:** `Dockerfile` (lines 6, 60).
- **Trigger:** If set to `true` during CI/CD to expedite builds, broken TypeScript code could deploy to production unchecked.
- **Workaround:** Ensure production deployment workflows strictly enforce `SKIP_TYPECHECK=false`.

**2. SQLite Multi-Process Concurrency Contention:**
- **Issue:** In the unified container (`scripts/start-unified.sh`), multiple separate processes (`api`, `scanner`, `risk-gates`, `executor`) concurrently access `/app/data/agent.db`.
- **Files:** `scripts/start-unified.sh`, `packages/storage/src/store.ts`.
- **Trigger:** Although WAL mode (`journal_mode = WAL`) is enabled, heavy concurrent write spikes (e.g. high-frequency sniper ticks + API decision logging) can trigger `SQLITE_BUSY` errors if busy timeouts are not configured.
- **Workaround:** Add `this.db.pragma("busy_timeout = 5000")` to `packages/storage/src/store.ts`.

## Security Considerations

**1. In-Memory Private Key and Mnemonic Handling:**
- **Risk:** Plaintext mnemonic phrases are loaded into memory and converted to private keys using `mnemonicToPrivateKey` in `packages/executor/src/acton/acton-wallet.ts`.
- **Files:** `packages/executor/src/acton/acton-wallet.ts`, `packages/wallet/src/wallet.ts`.
- **Current mitigation:** Key material is read strictly from environment variables or secure key files, never logged or committed.
- **Recommendations:** For large capital tiers, integrate hardware security modules (HSM), KMS-backed signing, or delegated Acton locked contracts with on-chain daily spend limits.

**2. Risk Gate Bypass via Environment Flag (`GATES_G1_G3_ACK`):**
- **Risk:** Setting `GATES_G1_G3_ACK=1` in production overrides safety warnings without verifying whether statistical expectancy is actually positive.
- **Files:** `packages/executor/src/acton/acton-wallet.ts`, `fly.toml`.
- **Current mitigation:** Production configuration defaults to `GATES_G1_G3_ACK=0` and `OBSERVE_ONLY=true`.
- **Recommendations:** Require programmatic verification of positive expectancy from `eval-report.json` before allowing wallet unfreezing.

**3. Unauthenticated Public WebSocket Stream:**
- **Risk:** The Fastify WebSocket route (`/ws` in `packages/api/src/routes/ws.ts`) accepts connections from any client without API key or JWT token verification.
- **Files:** `packages/api/src/routes/ws.ts`, `packages/api/src/index.ts`.
- **Current mitigation:** Rate limiting is enforced globally at 200 requests/minute.
- **Recommendations:** Add token/secret validation header or query parameter to `/ws` before streaming proprietary trading decisions to clients.

## Performance Bottlenecks

**1. TonAPI Rate Limiting Under Rapid Sniper Polling:**
- **Problem:** When sniper mode is enabled (`SCAN_SNIPER_INTERVAL_MS=10000`), aggressive polling of new token traces can exceed TonAPI free/pro tier rate limits.
- **Files:** `packages/scanner/src/tonapi.ts`, `packages/scanner/src/config.ts`.
- **Improvement path:** Implement adaptive backoff and jittered polling in `TonApiSource`, with WebSocket trace streaming where available.

**2. Synchronous File and SQLite Operations on Main Event Loop:**
- **Problem:** `better-sqlite3` methods (`insert`, `query`) and `Journal.append` run synchronously on the main Node.js thread.
- **Files:** `packages/storage/src/store.ts`, `packages/shared/src/journal.ts`.
- **Improvement path:** While `better-sqlite3` is extremely fast for standard loads, high-frequency signal throughput should batch writes or offload heavy analytics queries to worker threads.

## Fragile Areas

**1. Slippage on Low-Liquidity AMM Pools:**
- **Files:** `packages/dex/src/router.ts`, `packages/executor/src/order-builder.ts`.
- **Why fragile:** High-volatility memecoins on TON often suffer from shallow liquidity pools. A 200 BPS (2%) slippage ceiling can cause swaps to fail or experience severe MEV front-running.
- **Safe modification:** Dynamically compute slippage bounds based on measured pool depth and trade size relative to pool reserve.

**2. TonAPI Trace Structure Changes:**
- **Files:** `packages/scanner/src/tonapi-source.ts`, `packages/security/src/audit.ts`.
- **Why fragile:** On-chain transaction trace formats may change as TON node versions evolve, causing parsing logic in `tonapi-source.ts` to miss mints or liquidity events.
- **Safe modification:** Add strict Zod schema validation on raw TonAPI JSON responses to detect schema drift immediately.

## Scaling Limits

**1. Monolithic Container Process Architecture:**
- **Current capacity:** 4 background processes (`api`, `scanner`, `risk-gates`, `executor`) run inside a single 1GB RAM Fly.io container managed by `scripts/start-unified.sh`.
- **Limit:** If memory spikes during intensive scanner polling or backtest execution, the entire container risks hitting OOM and terminating all services simultaneously.
- **Scaling path:** Split processes into distinct Fly.io process groups (`[processes]` in `fly.toml`: `api = "packages/api/src/index.ts"`, `scanner = "packages/scanner/src/index.ts"`, `executor = "packages/executor/src/continuous.ts"`).

**2. SQLite Local Storage Volume Constraints:**
- **Current capacity:** Local SQLite file `/app/data/agent.db`.
- **Limit:** Suitable for ~100k trade records; beyond that, multi-process query latency on attached network volumes will increase.
- **Scaling path:** Route historical decision reporting to TimescaleDB/PostgreSQL (`DATABASE_URL`).

## Dependencies at Risk

**1. External OpenClaw MCP Plugins:**
- **Risk:** Plugins defined in `openclaw/openclaw.json` (such as `clawhub:ton-mcp` and `sperax-skills`) rely on external repository availability and ClawHub registry uptime.
- **Impact:** Gateway initialization may fail if network access to external git repositories is disrupted.
- **Migration plan:** Vendor critical MCP plugins and skill definitions directly into the project repository.

## Missing Critical Features

**1. Direct On-Chain AMM Route Builders:**
- **Problem:** Full on-chain transaction generation for DeDust and STON.fi pools is currently partitioned across `@ton/mcp` and Acton smart contracts; a pure TypeScript SDK fallback in `packages/dex` is incomplete.
- **Blocks:** Independent standalone live swap execution without OpenClaw or Acton dependencies.

## Test Coverage Gaps

**1. Multi-Process Startup and Shutdown Integration Test:**
- **What's not tested:** End-to-end container startup and graceful termination of `scripts/start-unified.sh` under `SIGTERM`.
- **Files:** `scripts/start-unified.sh`.
- **Priority:** High.

**2. Live WebSocket Reconnection & Stream Resilience:**
- **What's not tested:** Client reconnect behavior, message queueing during disconnection, and client broadcast latency in `packages/api/src/routes/ws.ts`.
- **Files:** `packages/api/src/routes/ws.ts`, `packages/api/src/__tests__/decisions.test.ts`.
- **Priority:** Medium.

---

*Concerns audit: 2026-08-16*
