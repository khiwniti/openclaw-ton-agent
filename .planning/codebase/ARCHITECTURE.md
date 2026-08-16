<!-- refreshed: 2026-08-16 -->
# Architecture

**Analysis Date:** 2026-08-16

## System Overview

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               OPERATOR & CONTROL PLANE (L5 / L6)                       │
│  Fastify API (`packages/api`) [Port 3000] ── WebSocket (`/ws`) ── Telegram (`trader-ui`)│
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              AGENT ORCHESTRATION & BUS                                 │
│  OpenClaw Gateway (`openclaw/openclaw.json`) ── 5 Personas (scanner-ops, market-intel, │
│  risk-analyst, executor, trader-ui) ── Redis Event Bus (`packages/agents/src/bus.ts`) │
│  Orchestration State Graph & Tier Coordinator (`packages/orchestration`)               │
└───────────────┬─────────────────────────────────────────────────────────▲──────────────┘
                │ A2A Event Stream                                        │ State Sync
                ▼                                                         │
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         SIGNAL INGESTION & MARKET INTEL (L1 / L2)                       │
│  `packages/scanner` (TonAPI Radar / Sniper) ── Audit & Score (`packages/security`)    │
│  `packages/market-intel` (Regime detection, ATR volatility, whale watching)           │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │ IngestedEnvelope (sig_*)
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                       DETERMINISTIC RISK GATES & SIZING (L3)                           │
│  `packages/risk-gates` (G0 Kill Switch → G1 Drawdown → G2 Cooldown → G3 Portfolio      │
│  → G4 Sizing / Kelly fraction → G5 Sniper trigger) [Outranks any LLM verdict]          │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │ GatedEnvelope (env_*)
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         EXECUTION & ROUTING ENGINE (L4)                                │
│  `packages/executor` (OrderBuilder, ActonWallet, WalletContractV5R1, PaperEngine)      │
│  `packages/dex` (STON.fi & DeDust AMM Routers, MinOut / Slippage Guards)               │
│  `contracts/Counter.tolk` / Acton Toolchain (Smart contract execution layer)           │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │ OrderRequest (ord_*) / FillResult
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                     POSITION MANAGEMENT & EXIT LIFECYCLE                               │
│  `packages/exit-manager` (TPSL, Chandelier Trailing Stop, Supertrend Flip, Time Stops) │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         PERSISTENCE & VALIDATION ENGINE                                │
│  SQLite (`packages/storage` via `better-sqlite3` WAL) ── NDJSON Journals (`packages/   │
│  shared`) ── Backtest Replay & Hyperopt Engine (`packages/backtest`)                   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File / Path |
|-----------|----------------|-------------|
| **API Control Plane** | Fastify v5 HTTP server, health checks (`/health/*`), decision queries, and real-time WebSocket telemetry | `packages/api/src/index.ts`, `packages/api/src/routes/*` |
| **Agent Bus & Personas** | Redis pub/sub message router (`AgentBus`) and base agent lifecycle classes | `packages/agents/src/bus.ts`, `packages/agents/src/base.ts` |
| **Orchestration Graph** | LangGraph-style trade state machine, supervisor node, and capital tier coordinator | `packages/orchestration/src/graph.ts`, `packages/orchestration/src/coordinator.ts` |
| **Scanner & Ingestion** | Polls TonAPI for newly minted jettons and large liquidity pools; computes initial safety scores | `packages/scanner/src/pipeline.ts`, `packages/scanner/src/tonapi.ts` |
| **Market Intelligence** | Classifies market regimes, computes ATR-based volatility, and monitors whale balance changes | `packages/market-intel/src/regime.ts`, `packages/market-intel/src/vol.ts`, `packages/market-intel/src/whales.ts` |
| **Security & Audits** | On-chain contract bytecode inspection, honeypot detection, mintable/admin checks | `packages/security/src/audit.ts`, `packages/security/src/pool-resolver.ts` |
| **Risk Gates** | Deterministic gate pipeline (G0-G5), circuit breaker drawdown checks, and Kelly position sizing | `packages/risk-gates/src/gates.ts`, `packages/risk-gates/src/circuit-breaker.ts`, `packages/risk-gates/src/kelly.ts` |
| **Executor** | Transforms gated decisions into executable blockchain transactions; supports Paper and Live modes | `packages/executor/src/index.ts`, `packages/executor/src/order-builder.ts`, `packages/executor/src/continuous.ts` |
| **Acton Wallet** | Interacts with smart contract wallets, validates gas guards, and computes minimum token output | `packages/executor/src/acton/acton-wallet.ts`, `packages/executor/src/acton/gas-guard.ts` |
| **DEX Router** | Calculates optimal swap routes and slippage tolerances across STON.fi and DeDust AMM pools | `packages/dex/src/router.ts` |
| **Exit Manager** | Tracks open positions, calculates dynamic Chandelier trailing stops, and triggers TPSL exits | `packages/exit-manager/src/position.ts`, `packages/exit-manager/src/decide.ts` |
| **Storage** | Synchronous WAL-mode SQLite database storing positions, daily PnL, decision records, and wallet metadata | `packages/storage/src/store.ts` |
| **Shared Core** | Core Zod schemas, envelope models, ID generation (`newId`), and rotated append-only NDJSON journaling | `packages/shared/src/schemas.ts`, `packages/shared/src/journal.ts`, `packages/shared/src/signal.ts` |
| **Backtesting Engine** | Historical market data fetcher, fee modeling, parameter grid search (Hyperopt), and drift monitoring | `packages/backtest/src/engine.ts`, `packages/backtest/src/hyperopt.ts`, `packages/backtest/src/drift.ts` |
| **Smart Contracts** | Native Tolk smart contracts compiled and tested using the Acton CLI toolchain | `contracts/Counter.tolk`, `Acton.toml` |

## Pattern Overview

**Overall Pattern:** Event-Driven, Multi-Agent Autonomous Pipeline with Deterministic Guardrails.

**Key Characteristics:**
1. **Separation of Cognitive and Execution Authority:** LLMs / Agents propose ideas and analyze regimes, but deterministic code (Risk Gates G0-G5, Tier Coordinator, Safety Caps) strictly controls all fund movements and signing.
2. **Fail-Closed Gate Design:** If an external feed fails, API rate limits trigger, or market volatility spikes beyond thresholds, the gate defaults to `reject` or `halt`.
3. **Single Execution Persona:** OpenClaw capability rules enforce that ONLY the `executor` persona possesses `exec` / `write` tools; all other agents are strictly read-only observers.
4. **Append-Only Event Journaling:** Every signal, gated decision, order, fill, and agent bus dispatch is written to rotated NDJSON logs for full replayability.

## Layers

**1. Presentation & Control Layer (`packages/api`):**
- Fastify server exposing REST routes (`/api/decisions`, `/health/ready`) and `/ws` WebSocket stream.
- Consumes `packages/storage` and provides health probes for Fly.io.

**2. Agent & Orchestration Layer (`packages/agents`, `packages/orchestration`, `openclaw/`):**
- Redis-based `AgentBus` distributing events between isolated processes.
- OpenClaw persona definitions configuring tool permissions and A2A allowlists.
- `TierCoordinator` tracking capital allocations (low: 1 TON, mid: 3 TON, high: 5 TON).

**3. Ingestion & Market Intelligence Layer (`packages/scanner`, `packages/market-intel`, `packages/security`):**
- Real-time scanner pulling from TonAPI, performing bytecode checks, and generating `IngestedEnvelope`.
- Market intel annotating envelopes with volatility (`volPct`), regime, and whale flow indicators.

**4. Deterministic Risk & Decision Layer (`packages/risk-gates`):**
- Evaluates G0 (Kill Switch), G1 (20% Max Drawdown Circuit Breaker), G2 (Token Cooldown), G3 (Sector & Portfolio Limits), G4 (Kelly Sizing & Minimum R:R), G5 (Sniper Liquidity Thresholds).
- Emits `GatedEnvelope` with `verdict: "pass" | "reject" | "halt"`.

**5. Execution & Routing Layer (`packages/executor`, `packages/dex`, `packages/wallet`):**
- Converts passed envelopes into `OrderRequest` objects.
- In `paper` mode, simulates fills using `packages/backtest` fee models.
- In `auto` (live) mode, routes swaps through STON.fi / DeDust AMMs or Acton smart contracts.

**6. Position Lifecycle & Exits Layer (`packages/exit-manager`):**
- Monitors open positions against tick updates.
- Executes dynamic exit strategies: Take-Profit, Break-Even Stop (+2x fee coverage), Chandelier Trailing Stop, and Supertrend Reversal Flips.

**7. Persistence & Analytics Layer (`packages/storage`, `packages/shared`, `packages/backtest`):**
- SQLite tables: `positions`, `daily_pnl`, `decision_journal`, `agentic_wallets`.
- Rotated NDJSON journals (`signals-*.ndjson`, `orders-*.ndjson`, `fills-*.ndjson`).
- Backtest engine running replay verification and parameter hyperoptimization.

## Data Flow

### Primary Signal-to-Execution Flow

```text
1. [Scanner Tick] (packages/scanner/src/pipeline.ts)
   └── Discovers token via TonAPI → runs safety audit (packages/security/src/audit.ts)
       → generates IngestedEnvelope with unique ID `sig_*`

2. [Market Annotation] (packages/market-intel/src/annotate.ts)
   └── Adds market regime, ATR volatility, and whale delta percentages

3. [Risk Gate Evaluation] (packages/risk-gates/src/gates.ts)
   └── Checks Kill Switch → Drawdown → Cooldown → Portfolio Caps → Kelly Sizing
       → outputs GatedEnvelope with `meta.gate{verdict, sizeTon, rRatio, reasons}`

4. [Tier Coordination & Graph Check] (packages/orchestration/src/coordinator.ts)
   └── Validates balance, tier limits, and active position counts

5. [Order Construction & Routing] (packages/executor/src/order-builder.ts)
   └── Computes minimum output with slippage bounds (packages/dex/src/router.ts)
       → generates OrderRequest `ord_*`

6. [Transaction Execution] (packages/executor/src/acton/acton-wallet.ts / wallet.ts)
   └── Submits swap message to TON blockchain (or records paper fill)

7. [Position Registration] (packages/exit-manager/src/position.ts)
   └── Opens position record in SQLite (`packages/storage/src/store.ts`)

8. [Exit Monitoring Loop] (packages/exit-manager/src/decide.ts)
   └── Evaluates price against Chandelier Stop Loss / Take Profit → triggers exit
```

### Secondary Backtesting & Hyperopt Flow

```text
1. [Data Ingestion] (packages/backtest/src/fetch.ts)
   └── Pulls historical daily/hourly candle series from Binance & CoinGecko

2. [Simulation Loop] (packages/backtest/src/engine.ts)
   └── Feeds historical bars through scanner, gates, and exit manager with fee routing

3. [Hyperopt Grid Search] (packages/backtest/src/hyperopt.ts)
   └── Explores volatility/RR parameter space to identify optimal expectancy configurations

4. [Report Generation] (packages/backtest/src/report.ts)
   └── Computes Sharpe, Sortino, max drawdown, and outputs evaluation report JSON
```

## Key Abstractions

- `IngestedEnvelope` (`packages/shared/src/signal.ts`): Standardized signal representation containing token metadata, initial price, liquidity, and safety score.
- `GatedEnvelope` (`packages/shared/src/schemas.ts`): Signal envelope enriched with deterministic risk gate evaluation, sizing decisions, and execution reasons.
- `TradeDecision` (`packages/shared/src/trade-decision.ts`): Orchestrator-level decision record bridging market analysis to concrete order intent.
- `Position` (`packages/exit-manager/src/position.ts`): State model of an active trade tracking entry price, remaining quantity, high-water mark, trailing stop, and exit triggers.
- `OrderRequest` (`packages/shared/src/order.ts`): Concrete trade order payload specifying side, jetton master address, TON amount, min-out tokens, and slippage ceiling.
- `FillResult` (`packages/executor/src/acton/acton-wallet.ts`): Immutable record of trade execution status (`filled`, `bounced`, `pending_reconcile`), transaction hash, and executed price.
- `GateContext` (`packages/risk-gates/src/gates.ts`): Ephemeral and historical risk state (bankroll, active drawdown %, sector exposure, cooldown map).
- `AgentMessage` (`packages/shared/src/schemas.ts`): Inter-agent message envelope containing routing headers (`from`, `to`, `kind`, `cycleId`) and payload data.

## Entry Points

**Production Unified Entry Point:**
- `scripts/start-unified.sh`: Container bootstrap script that launches Fastify API (port 3000), Scanner (port 8080), Risk Gates, and Executor (port 8081) with SIGTERM/SIGINT process handling.

**Individual Package Entry Points:**
- `packages/api/src/index.ts`: Fastify HTTP/WebSocket server.
- `packages/scanner/src/index.ts`: Signal ingestion scanner loop.
- `packages/risk-gates/src/continuous.ts`: Continuous gated signal processor.
- `packages/executor/src/continuous.ts`: Continuous order executor and fill reconciler.
- `packages/agents/src/index.ts`: Agent bus subscriber.
- `packages/backtest/src/index.ts`: Backtest simulation, replay, and hyperopt runner.

## Architectural Constraints

1. **Deterministic Gate Priority:** LLM reasoning is strictly advisory; deterministic risk gate functions in `packages/risk-gates` hold unconditional veto and sizing authority.
2. **Single Writer Principle:** Only `packages/executor` (and the `executor` persona) may hold on-chain private keys or execute swap transactions.
3. **Observation-Only Production Default:** Default configuration sets `OBSERVE_ONLY=true` and `EXECUTION_MODE=notify_only`; live on-chain execution requires explicit acknowledgement (`GATES_G1_G3_ACK=1`).
4. **Drawdown Circuit Breakers:** Global 20% drawdown breach immediately freezes new position entries.
5. **Database Concurrency:** SQLite is configured with WAL mode (`journal_mode = WAL`) in `packages/storage/src/store.ts` for safe multi-process reading.

## Anti-Patterns to Avoid

### 1. Direct LLM-to-Chain Execution
- **What happens:** An LLM agent generates and submits transactions directly to the TON blockchain.
- **Why it's wrong:** High risk of hallucinations, incorrect sizing, or slippage exploitation.
- **Do this instead:** Route all proposed trades through `evaluateGates` in `packages/risk-gates` and `OrderBuilder` in `packages/executor`.

### 2. Bypassing Safety Caps with Raw Swaps
- **What happens:** Executing swaps via `packages/dex` without querying the `TierCoordinator` or `evaluateTradeGate`.
- **Why it's wrong:** Violates position count and per-tier capital limits.
- **Do this instead:** Always execute through `TierCoordinator.executeForTier` (`packages/orchestration/src/coordinator.ts`).

### 3. Relative Cross-Package Imports
- **What happens:** Importing across packages using `../../packages/shared/src/...`.
- **Why it's wrong:** Breaks package encapsulation and TypeScript project references.
- **Do this instead:** Import via workspace package names (e.g. `import { logger } from "@openclaw-ton-agent/core"`).

## Error Handling & Resilience

- **Fail-Closed Risk Logic:** If external market feeds (e.g. Binance macro feed) time out or return errors, the gate returns `{ riskOff: true }` or blocks execution.
- **Gas & Slippage Guards:** All swaps compute `minOutTokenQty` with strict BPS caps (`computeMinOut`) before constructing messages.
- **Process Supervision:** `scripts/start-unified.sh` traps `SIGTERM`/`SIGINT` to gracefully terminate child PIDs (`kill -TERM "$api_pid" "$scanner_pid" ...`).

## Cross-Cutting Concerns

- **Logging:** Structured logging using `packages/core/src/logger.ts` with timestamped JSON envelopes.
- **Validation:** Runtime Zod validation on every external boundary (REST inputs, WebSocket payloads, on-chain trace data, NDJSON entries).
- **Security:** Strict separation of duties, environment-variable-only secret injection, and non-root Docker execution (UID 1001).

---

*Architecture analysis: 2026-08-16*
