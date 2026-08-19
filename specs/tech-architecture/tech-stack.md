# Project Context

## Stack

**Primary Language & Runtime**
- TypeScript (ES2022 / ESNext) — strict mode, zero-build execution via `tsx`
- Node.js ≥ 22.0.0 (Alpine Linux in Docker, Fly.io microVMs)
- npm workspaces monorepo with 15 packages under `packages/*`

**Core Frameworks**
| Layer | Technology | Purpose |
|-------|------------|---------|
| HTTP/API | Fastify v5 | REST + WebSocket control plane (`packages/api`) |
| Agent Orchestration | OpenClaw Gateway + Internal Agent Graph | Multi-agent personas, Redis pub/sub bus, LangGraph-style state machine |
| Blockchain SDK | `@ton/ton` v15 + `@ton/crypto` v3 | TON Cells, BOC, WalletContractV5R1, TonClient |
| Smart Contracts | Tolk + Acton CLI | Native contract dev, TVM test runner |
| Validation | Zod v3 | Schema-first boundaries, inferred TS types |
| Storage | `better-sqlite3` v11 (WAL mode) | Local SQLite for positions, PnL, decisions |
| Messaging | `ioredis` v5 | Redis pub/sub for agent event bus |
| Testing | Node `node:test` + `tsx --test` | Built-in runner, zero external deps |

**Key Dependencies**
- `dotenv` v16 — env config
- `concurrently` v9 — multi-process dev runner
- `json5` v2 — OpenClaw config parsing
- `@fastify/websocket`, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit` — API hardening

**Smart Contract Toolchain**
- Acton (`Acton.toml` manifest) — Tolk compilation, testing, deployment scripts
- Contracts in `contracts/*.tolk`, tests in `tests/*.test.tolk`, wrappers in `wrappers/*.gen.tolk`

**Deployment**
- Docker multi-stage (builder → runtime with `dumb-init`, non-root UID 1001)
- Fly.io (Singapore `sin` region), persistent volume `/app/data`
- Process supervisor `scripts/start-unified.sh` manages API (3000), Scanner (8080), Risk Gates, Executor (8081)

---

## Architecture

**Overall Pattern:** Event-Driven, Multi-Agent Autonomous Pipeline with Deterministic Guardrails

**Layered Data Flow (L1 → L5)**

```
L1 Scanner (packages/scanner)          ──► IngestedEnvelope (sig_*)
    TonAPI Radar / Sniper scan
    Safety audit (packages/security)   ──► score, audit flags

L2 Market Intel (packages/market-intel) ──► Annotated envelope
    Regime detection, ATR vol, whale flow

L3 Risk Gates (packages/risk-gates)     ──► GatedEnvelope (env_*)
    G0 Kill Switch → G1 Drawdown (20%) → G2 Cooldown
    → G3 Portfolio caps → G4 Kelly sizing → G5 Sniper threshold
    OUTRANKS any LLM verdict (fail-closed)

L4 Orchestration (packages/orchestration) ──► TradeTicket / CapCheckResult
    TierCoordinator (low/mid/high capital tiers)
    Supervisor graph: scanner → risk → strategy → safety-caps → execution
    SafetyCaps authorizeTicket (deterministic cap check)

L5 Executor (packages/executor)        ──► OrderRequest (ord_*) → FillResult
    OrderBuilder: gated envelope → OrderRequest (entry, stop, target, slippage)
    Execution modes: notify_only | paper | auto (strict escalation)
    Wallet adapters: PaperWallet | TonMcpWallet → ActonWallet (canonical live path)
    DEX routing: packages/dex (STON.fi / DeDust quotes + minOut)

L6 Exit Manager (packages/exit-manager) ──► ExitAction
    TPSL, Chandelier trailing stop, Supertrend flip, time stops

L7 Persistence (packages/storage + packages/shared)
    SQLite: positions, daily_pnl, decision_journal, agentic_wallets
    NDJSON journals: signals-*.ndjson, orders-*.ndjson, fills-*.ndjson
```

**Key Abstractions**
- `IngestedEnvelope` — standardized signal with token metadata, audit, score
- `GatedEnvelope` — envelope + deterministic `meta.gate{verdict,sizeTon,rRatio,reasons}`
- `OrderRequest` — executable order: side, jettonMaster, amountTon, minOutTokenQty, slippageBps, tier, confirmRequired
- `Position` — open trade state: entry, qty, high-water, trailing stop, exit triggers
- `GateContext` — ephemeral risk state: bankroll, drawdown%, cooldowns, sector exposure
- `AgentMessage` — A2A envelope: from/to/kind/cycleId + payload

**Entry Points**
- `scripts/start-unified.sh` — container bootstrap (4 processes, SIGTERM handling)
- `packages/api/src/index.ts` — Fastify server (port 3000, health + WS)
- `packages/scanner/src/index.ts` — scanner polling loop
- `packages/executor/src/continuous.ts` — continuous order execution
- `packages/risk-gates/src/continuous.ts` — continuous risk evaluation

---

## Conventions (Observed)

**Package & Import Discipline**
- 15 workspace packages, each with `src/index.ts` public boundary
- Cross-package imports **MUST** use workspace names: `@openclaw-ton-agent/shared`, `@openclaw-ton-agent/core`, etc.
- Relative imports across package boundaries (`../../shared/src/...`) prohibited
- Import order: Node builtins → external deps → workspace packages → local

**Type Safety & Validation**
- `strict: true`, `noEmit: true`, `noUnusedLocals/Parameters: true`
- Schema-first: all external data validated with Zod at boundaries
- Types inferred from Zod: `z.infer<typeof Schema>`
- Missing numeric fields = `null`, never fabricated as `0`

**Error Handling**
- Structured result objects over exceptions: `{ ok: boolean, error?: string, ... }`
- Fail-closed risk gates: network timeout/missing data → `reject` or `halt`
- Async calls bounded with `AbortSignal.timeout(ms)`

**Logging & Observability**
- Structured JSON logging via `@openclaw-ton-agent/core` logger
- Levels: `err` > `warn` > `trade` > `ok` > `info`
- `LOG_FORMAT=json` in production for Loki/Datadog ingestion
- Append-only NDJSON journals (rotated via `Journal` class)
- Health endpoints: `/health`, `/health/ready`, `/health/live` on API (3000), Scanner (8080), Executor (8081)

**Naming**
- Files: kebab-case (`order-builder.ts`, `circuit-breaker.ts`)
- Types: PascalCase (`IngestedEnvelope`, `GateContext`, `FillResult`)
- Constants: `UPPER_SNAKE_CASE` (`GATE_CONFIG`, `DB_PATH`)
- Enums: lowercase string unions (`"buy" | "sell"`, `"pass" | "reject" | "halt"`, `"notify_only" | "paper" | "auto"`)
- Entity IDs: `sig_<ts>_<rand>`, `env_<ts>_<rand>`, `ord_<ts>_<rand>`, `pos_<ts>_<rand>`
- DB: snake_case tables/columns (`positions.wallet_tier`, `decision_journal.cap_check_result`)

**Module Design**
- Named exports exclusively (no default exports)
- Options objects for >2 params (`GateContext`, `PipelineOpts`, `ActonWalletOptions`)
- Pure helpers isolated for testability (`chandelierStop`, `sizedPositionTon`, `computeMinOut`)

---

## Signals / Active Considerations

**1. Simulated DEX Execution Stubs (Tech Debt)**
- `packages/dex/src/router.ts` uses simplified stubs (`expectedOutNano = amountInNano / 2n`, `txHash: "simulated_tx"`)
- Real on-chain execution only via ActonWallet (`packages/executor/src/acton/acton-wallet.ts`) or `@ton/mcp`
- **Impact:** Production swaps routed through `dex.executeSwap` won't hit real DeDust/STON.fi factory pools
- **Fix:** Integrate `@dedust/sdk` and `@ston-fi/sdk` transaction builders in `router.ts`

**2. Duplicate Wallet Layer Implementations (Tech Debt)**
- Three wallet layers: `packages/wallet` (basic v5r1), `packages/executor/src/wallet.ts` (adapter interface), `packages/executor/src/acton/acton-wallet.ts` (smart contract wallet)
- Inconsistent error reporting, fragmented balance logic
- **Fix:** Consolidate into `packages/wallet` with standard adapters (`NativeV5R1Adapter`, `ActonSmartWalletAdapter`, `PaperWalletAdapter`)

**3. Unversioned SQLite Migrations (Tech Debt)**
- `packages/storage/src/store.ts` runs hardcoded `CREATE TABLE IF NOT EXISTS` without schema versioning
- Future schema changes risk `SQLITE_BUSY` or manual wipes
- **Fix:** Add `schema_migrations` table or `PRAGMA user_version` tracking

**4. Backtest CEX-to-DEX Cross-Rate Discrepancy (Tech Debt)**
- Backtest uses Binance/CoinGecko synthetic prices; real execution hits on-chain AMM bonding curves
- Overstates performance on low-liquidity pairs (price impact, pool imbalance)
- **Fix:** Ingest on-chain DeDust/STON.fi historical swap logs via TonAPI events

**5. Dockerfile `SKIP_TYPECHECK` Build Arg (Operational Risk)**
- `ARG SKIP_TYPECHECK=false` can bypass `tsc --noEmit` in CI/CD
- **Mitigation:** Enforce `SKIP_TYPECHECK=false` in production workflows

**6. SQLite Multi-Process Contention (Operational Risk)**
- 4 processes in unified container concurrently access `/app/data/agent.db`
- WAL mode + `busy_timeout = 5000` set, but write spikes can still trigger `SQLITE_BUSY`
- **Mitigation:** Batch writes, consider worker threads for heavy analytics

**7. In-Memory Private Key Handling (Security)**
- Mnemonics → private keys via `mnemonicToPrivateKey` in ActonWallet/wallet.ts
- **Mitigation:** Env-only, never logged; consider HSM/KMS/Acton locked contracts for large capital

**8. `GATES_G1_G3_ACK` Environment Flag Bypass (Security)**
- Setting `GATES_G1_G3_ACK=1` overrides safety without verifying positive expectancy
- Defaults: `GATES_G1_G3_ACK=0`, `OBSERVE_ONLY=true`
- **Recommendation:** Require programmatic verification from `eval-report.json` before unfreezing

**9. Unauthenticated WebSocket Stream (Security)**
- `/ws` accepts any client without API key/JWT
- Rate limited (200 req/min) but no auth on proprietary decision stream
- **Fix:** Add token/secret validation header or query param

**10. TonAPI Rate Limiting Under Sniper Polling (Performance)**
- Sniper mode (`SCAN_SNIPER_INTERVAL_MS=10000`) can exceed TonAPI free/pro tier limits
- **Fix:** Adaptive backoff, jittered polling, WebSocket trace streaming

**11. Synchronous I/O on Main Event Loop (Performance)**
- `better-sqlite3` and `Journal.append` run synchronously
- High-frequency throughput should batch writes or offload to workers

**12. Slippage on Low-Liquidity AMM Pools (Fragile Area)**
- 200 BPS (2%) slippage ceiling fails on shallow memecoin pools
- **Safe mod:** Dynamic slippage bounds based on pool depth vs trade size

**13. TonAPI Trace Structure Drift (Fragile Area)**
- On-chain trace formats evolve with TON node versions
- **Safe mod:** Strict Zod schema validation on raw TonAPI responses

**14. Monolithic Container Scaling Limit (Scaling)**
- Single 1GB Fly.io container runs 4 processes; OOM kills all services
- **Path:** Split into distinct Fly.io process groups (`[processes]` in `fly.toml`)

**15. SQLite Volume Constraint (Scaling)**
- Local SQLite suitable for ~100k records; network volume latency grows beyond
- **Path:** Route historical analytics to TimescaleDB/PostgreSQL (`DATABASE_URL`)

**16. External OpenClaw MCP Plugin Dependency (Dependency Risk)**
- Plugins (`clawhub:ton-mcp`, `sperax-skills`) rely on external registry uptime
- **Migration:** Vendor critical plugins/skills into repo

**17. Missing Direct On-Chain AMM Route Builders (Missing Feature)**
- Full DeDust/STON.fi tx generation partitioned across `@ton/mcp` and Acton
- No pure TS SDK fallback in `packages/dex`
- **Blocks:** Standalone live swap execution without OpenClaw/Acton

**18. Test Coverage Gaps (Quality)**
- No multi-process startup/shutdown integration test for `start-unified.sh`
- No WebSocket reconnection/stream resilience tests
- **Priority:** High / Medium

---

*Generated by map-codebase analysis — 2026-08-18*