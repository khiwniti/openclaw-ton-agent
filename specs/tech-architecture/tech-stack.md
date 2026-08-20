# Project Context & Technical Architecture

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

**Deployment**
- Docker multi-stage (builder → runtime with `dumb-init`, non-root UID 1001)
- Fly.io (Singapore `sin` region), persistent volume `/app/data`
- Process supervisor `scripts/start-unified.sh` manages API (3000), Scanner (8080), Risk Gates, Executor (8081)

---

## Architecture

**Overall Pattern:** Event-Driven, Multi-Agent Autonomous Pipeline with Asynchronous Priority Order Queueing and Deterministic Guardrails.

```
                           Autonomous Trading Pipeline
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ L1: Scanner (packages/scanner)                                              │
  │     • TONAPI + STON.fi radar streams                                        │
  │     • Multi-pool discovery (Direct TON + USDT pairs)                        │
  │     • Safety Audit & honeypot filtering (packages/security)                 │
  └──────────────────────────────────────┬──────────────────────────────────────┘
                                         ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ L2: Risk Gates (packages/risk-gates)                                        │
  │     • Kelly Criterion sizing + ATR volatility-scaled stops                  │
  │     • Portfolio correlation check (active positions journal binding)        │
  │     • 10-position concurrent tier capacity + fast 15s cooldown              │
  └──────────────────────────────────────┬──────────────────────────────────────┘
                                         ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ L3: Asynchronous Order Queue Manager (packages/executor/src/order-queue.ts) │
  │     • HIGH PRIORITY: Exits (Time-Stop, TP, SL, Momentum Reversal)           │
  │     • NORMAL PRIORITY: Buys (Dispatched continuously without batch wait)    │
  │     • Dynamic event trigger: wakes immediately when any position closes     │
  └──────────────────────────────────────┬──────────────────────────────────────┘
                                         ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ L4: Multi-DEX & Multi-Hop Execution (packages/executor/src/acton)          │
  │     • STON.fi V1/V2 (pTON ⇄ Token)                                          │
  │     • DeDust V2 (TON ⇄ Token)                                               │
  │     • Multi-Hop Routing via USDT (TON ⇄ USDT ⇄ Token)                       │
  │     • Cross-Chain EVM / PancakeSwap V2/V3 support                           │
  └──────────────────────────────────────┬──────────────────────────────────────┘
                                         ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ L5: Exit Manager (packages/exit-manager/src/decide.ts)                      │
  │     • Priority 1: Hard Time-Stop (30 min auto-close ceiling)                │
  │     • Priority 2: Laddered Exits (Tranche scale-out)                        │
  │     • Priority 3: Partial Take-Profit                                       │
  │     • Priority 4: Momentum Fade & Peak Giveback Protection (50%-65% lock)   │
  │     • Priority 5: Supertrend / Chandelier Reversal (1.2x ATR for snipe)     │
  │     • Priority 6: Dynamic Trailing Stop & Break-Even Stop                   │
  │     • Priority 7: Structure-Based SL & Fixed Targets                        │
  └─────────────────────────────────────────────────────────────────────────────┘
```

---

## Conventions (Observed)

**Package & Import Discipline**
- 15 workspace packages, each with `src/index.ts` public boundary.
- Cross-package imports **MUST** use workspace names: `@openclaw-ton-agent/shared`, `@openclaw-ton-agent/core`, etc.
- Relative imports across package boundaries (`../../shared/src/...`) are strictly prohibited.
- Import order: Node builtins → external dependencies → workspace packages → local modules.

**Type Safety & Validation**
- `strict: true`, `noEmit: true`, `noUnusedLocals: true`, `noUnusedParameters: true`.
- Schema-first: all external data validated with Zod at boundaries (`validateIngested`, `validateEnvelope`, `validateOrderRequest`).
- Missing numeric fields = `null`, never fabricated as `0`.

**Error Handling & Safety**
- Structured result objects over unhandled exceptions: `{ ok: boolean, error?: string, ... }`.
- Fail-closed risk gates: network timeout / missing data → `reject` or `halt`.
- 3-bounce circuit breaker: force-clears stuck or dead positions after 3 consecutive failed sell attempts.
- Async network operations bounded with strict `AbortSignal.timeout(ms)`.

**Logging & Observability**
- Structured JSON logging via `@openclaw-ton-agent/shared` logger (`pino`).
- Append-only NDJSON journals (`signals-*.ndjson`, `gated-*.ndjson`, `orders-*.ndjson`, `fills-*.ndjson`, `positions-*.ndjson`).
- Health endpoints: `/health`, `/health/ready` on API (3000), Scanner (8080), Executor (8081).

---

## Active Considerations & Architecture Signals

1. **Non-Blocking Queue Management**:
   - Signal ingestion and concurrent position monitoring run independently from the on-chain sequential transaction worker.
2. **Deterministic Safety Caps**:
   - `hashTradeTicket` is purely cryptographic and deterministic.
3. **Cross-Chain / Multi-Hop Readiness**:
   - Fully supports multi-hop routing on TON via USDT pairs and intra-TON DeDust/STON.fi fallback.
   - EVM/BSC web3 execution scripts integrated for cross-chain routing to PancakeSwap.
