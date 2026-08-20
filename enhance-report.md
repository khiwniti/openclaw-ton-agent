# OpenClaw TON Trading Agent — Architecture Design Document
**Document Version:** `1.0.0` **System Classification:** Autonomous 
Agentic Trading & Multi-Chain DEX Execution Engine **Runtime 
Environment:** Node.js ≥ 22.0.0, TypeScript, Fly.io (MicroVMs), SQLite 
WAL, TON Blockchain ---
## 1. System Overview & Core Objectives
The **OpenClaw TON Trading Agent** is a professional, multi-layered 
autonomous trading and execution system designed for high-frequency 
token discovery, automated risk evaluation, multi-DEX routing, and 
mathematical exit management on the TON blockchain and cross-chain EVM 
networks.
### Primary Design Pillars
1. **Deterministic Risk-First Architecture**: Risk gates strictly 
outrank and override any probabilistic/LLM predictions. 2. 
**Asynchronous Non-Blocking Execution**: Signal ingestion, market 
scanning, and position stepping are completely decoupled from on-chain 
transaction confirmation. 3. **Multi-DEX & Multi-Hop Liquidity 
Aggregation**: Dynamic routing across STON.fi V1/V2, DeDust V2, and 
USDT multi-hop pools. 4. **8-Tier Exit Waterfall**: Priority 1 hard 
time-stop safety ceiling, momentum profit-lock, tight ATR trailing 
stops, and structure-based risk management. 5. **Fail-Closed Custody & 
Gas Safety**: Zero mock calculations on live capital; sequence number 
locking, gas reserve guards, and slippage ceilings. ---
## 2. High-Level Pipeline Architecture
The system is organized into **7 distinct layers** across a monorepo 
architecture (`packages/*`): ```
                                  System Pipeline Overview 
  ┌────────────────────────────────────────────────────────────────────────────────────────┐ 
  │ L1: Token Scanner & Safety Audit (packages/scanner, 
  packages/security) │ │ • TONAPI event stream + STON.fi DEX radar │ │ 
  • Renounced ownership, liquidity lock, honeypot analysis │ │ • 
  Emits: IngestedEnvelope (sig_*) │ 
  └──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             ▼ 
  ┌────────────────────────────────────────────────────────────────────────────────────────┐ 
  │ L2: Market Intelligence (packages/market-intel) │ │ • Volatility 
  estimation (ATR), Bonding curve state, Whale flow analysis │ │ • 
  Emits: AnnotatedEnvelope │ 
  └──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             ▼ 
  ┌────────────────────────────────────────────────────────────────────────────────────────┐ 
  │ L3: Risk Gates (packages/risk-gates) │ │ • G0: Kill-Switch & Macro 
  Risk-Off │ │ • G1: 20% Equity Drawdown Circuit Breaker │ │ • G2: 
  Anti-Spam & Token Cooldown Guard (15s) │ │ • G3: Portfolio 
  Correlation & Sector Exposure Limits │ │ • G4: Kelly Criterion 
  Position Sizing & Economic Fee Floor Coverage │ │ • Emits: 
  GatedEnvelope (PASS / REJECT / HALT) │ 
  └──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             ▼ 
  ┌────────────────────────────────────────────────────────────────────────────────────────┐ 
  │ L4: Priority Order Queue Manager 
  (packages/executor/src/order-queue.ts) │ │ • HIGH PRIORITY: Exits 
  (Time-Stop, Take-Profit, Stop-Loss, Momentum Reversal) │ │ • NORMAL 
  PRIORITY: New Buys (Dispatched continuously without batch waiting) │ 
  │ • Dynamic Slot Wakeup: Dispatches next buy immediately when any 
  position closes │ 
  └──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             ▼ 
  ┌────────────────────────────────────────────────────────────────────────────────────────┐ 
  │ L5: Multi-DEX & Multi-Hop Execution Engine 
  (packages/executor/src/acton) │ │ • ActonWallet on-chain BOC builder 
  & TVM signer │ │ • Automatic route selector: STON.fi V1/V2, DeDust 
  V2, USDT Multi-Hop │ │ • Non-blocking sequential lock with seqno 
  confirmation polling │ 
  └──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             ▼ 
  ┌────────────────────────────────────────────────────────────────────────────────────────┐ 
  │ L6: Exit Manager (packages/exit-manager/src/decide.ts) │ │ • 
  8-Tier Exit Waterfall stepped every 5s │ │ • Mode-aware 1.2x ATR 
  trailing stop & 50%-65% peak giveback protection │ │ • 
  Top-precedence 30-minute Hard Time-Stop │ 
  └──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             ▼ 
  ┌────────────────────────────────────────────────────────────────────────────────────────┐ 
  │ L7: Storage, Control API & Observability (packages/storage, 
  packages/api) │ │ • Append-only NDJSON Journals + SQLite WAL mode │ 
  │ • Fastify REST & WebSocket live telemetry on Port 3000 │ │ • 
  Health endpoints: /health/ready, /health/live on ports 3000, 8080, 
  8081 │ 
  └────────────────────────────────────────────────────────────────────────────────────────┘
``` ---
## 3. Subsystem Breakdown
### 3.1. Scanner & Safety Audit Layer (`packages/scanner`, 
### `packages/security`)
* **Radar Sources**: Polls TONAPI `/jettons` and STON.fi `/assets` 
every 10 seconds. * **Probing**: Probes direct TON liquidity reserves 
and intermediate USDT pools. * **Audit Checklist**:
  - Renounced admin rights (`renounced`) - Liquidity lock verification 
  (`locked`) - HoneyPot simulation test (`honeypot`) - Top 10 holder 
  concentration percentage (`holders`)
* **Seen Cache**: Uses a 15-second TTL cache (`SeenCache`) to ensure 
active tokens are continually re-evaluated against real-time price 
changes.
### 3.2. Risk Gates Layer (`packages/risk-gates`)
* **Kelly Position Sizing**: Calculates position size dynamically 
  based on win probability $p$, reward-to-risk ratio $b$, and capital 
  tier ceilings (`low`: 0.15 TON, `mid`: 0.35 TON, `high`: 0.50 TON).
* **Economic Fee Floor**: Rejects any position size where the 
potential profit cannot cover round-trip blockchain gas and DEX fees 
($2 \times \text{networkFee}$). * **Active Position Binding**: 
Continuously reads active positions from `positions-mainnet.ndjson` to 
prevent duplicate or over-correlated exposure.
### 3.3. Asynchronous Order Queue Manager 
### (`packages/executor/src/order-queue.ts`)
* **Decoupled Architecture**: Eliminates the bottleneck of sequential 
for-loops. * **Queue Priority**:
  - `HIGH`: Exits and stop-losses jump directly to the front of the 
  queue to guarantee capital preservation. - `NORMAL`: Buy orders are 
  queued and dispatched as soon as portfolio capacity ($< 
  \text{maxOpenPositions}$) is available.
* **Instant Event Dispatch**: As soon as an exit transaction completes 
on-chain, the queue wakes up and dispatches the next waiting buy 
order.
### 3.4. Multi-DEX & Multi-Hop Execution Engine 
### (`packages/executor/src/acton`)
* **On-Chain Acton Wallet**: Native cell serialization using 
`@ton/ton` for both `WalletContractV4` and `WalletContractV5R1`. * 
**Routing Strategy**:
  1. **Direct STON.fi**: `pTON` ⇄ `Target Jetton` via STON.fi router 
  (`0x25938561`). 2. **Direct DeDust V2**: `TON` ⇄ `Target Jetton` via 
  DeDust factory (`0xea06185d` buy, `0xe3a0d482` sell). 3. **Multi-Hop 
  STON.fi via USDT**: `TON` → `USDT` → `Target Jetton` for tokens 
  without direct TON pairs. 4. **Multi-Hop DeDust V2 via USDT**: `USDT 
  Asset` ⇄ `Target Jetton` pool step routing.
* **Gas Protection**: Allocated 0.35 TON on DeDust sells and 0.20 TON 
on STON.fi sells to eliminate out-of-gas bounces on congested mainnet.
### 3.5. 8-Tier Exit Precedence Waterfall 
### (`packages/exit-manager/src/decide.ts`)
Every open position is evaluated every 5 seconds through a 
deterministic exit waterfall: 1. **Hard Time-Stop Ceiling**: Now - 
EntryTs ≥ 30 min (Immediate Exit) 2. **Laddered Exits**: Scale out 
predefined tranches at price targets 3. **Partial Take-Profit**: Sell 
50% at +30%, 30% at +50% 4. **Momentum Fade / Peak Giveback 
Protection**:
   - Peak Gain ≥ +8%: Exit if price retraces > 35% from peak (Locks 
   65% profit) - Peak Gain ≥ +3.5%: Exit if price retraces > 50% from 
   peak (Locks 50% profit)
5. **Supertrend / Chandelier Reversal**: Price crosses 1.2x ATR 
trendline 6. **Protective Stops**: Chandelier trailing stop & 
Break-Even stop (+2x fee) 7. **Structure Stop-Loss**: Candle close 
confirmed below swing low + ATR buffer 8. **Fixed Take-Profit (+50%) & 
Initial Stop-Loss (-5%)** ---
## 4. State Management & Persistence
### 4.1. Append-Only NDJSON Journals
The system writes and rotates structured NDJSON journals under 
`/app/data/`: * `signals-mainnet.ndjson`: Raw token radar signals 
emitted by L1 Scanner. * `gated-mainnet.ndjson`: Risk-evaluated 
signals with deterministic pass/reject metadata. * 
`orders-mainnet.ndjson`: Validated order requests dispatched by L4 
Executor. * `fills-mainnet.ndjson`: On-chain fill results with 
transaction hashes and seqnos. * `positions-mainnet.ndjson`: Position 
lifecycle events (`position.open`, `position.closed`).
### 4.2. SQLite WAL Database (`packages/storage`)
Local SQLite database (`agent.db`) operates in `WAL` (Write-Ahead 
Logging) mode with `busy_timeout = 5000ms` for zero-lock contention 
across concurrent processes. ---
## 5. Deployment Topology & Production Runtime
### 5.1. Multi-Process Container Topology (Fly.io)
Unified container orchestrated via `scripts/start-unified.sh` under 
`dumb-init`: * **Process 1 (API)**: Fastify HTTP REST + WebSocket 
Server on Port `3000`. * **Process 2 (Scanner)**: Token discovery and 
DEX probing with Health listener on Port `8080`. * **Process 3 (Risk 
Gates)**: Continuous stream evaluation from `signals-mainnet.ndjson`. 
* **Process 4 (Executor)**: Order Queue Manager & on-chain TVM signer 
on Port `8081`. ---
## 6. Manual Trading CLI Interface
In addition to autonomous trading, the system exposes a manual trading 
suite: ```bash
# Get real-time price & liquidity quote
npm run swap -- quote --token USDT --amount 0.2
# Execute manual Buy order on TON
npm run swap -- buy --token NOT --amount 0.20 --slippage 250
# Execute manual Sell order on TON
npm run swap -- sell --token STON
# Liquidate all remaining Jetton holdings back to TON
npm run sell-all ``` ---
## 7. Quality Assurance & Verification Standards
* **100% Type-Safe**: Zero TypeScript compile errors (`tsc --noEmit`). 
* **Complete Test Coverage**: Verified unit, integration, and 
backtesting test suites across all 10 monorepo packages. * **On-Chain 
Proven**: Verified on TON mainnet via Tonscan transactions and seqno 
increments.
