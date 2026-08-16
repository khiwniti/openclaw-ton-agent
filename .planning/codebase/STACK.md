# Technology Stack

**Analysis Date:** 2026-08-16

## Languages

**Primary:**
- TypeScript — entire backend codebase across all 15 workspace packages (`packages/*`), scripts (`scripts/deploy-testnet-wallet.ts`), and tests. Targeted to ES2022 / ESNext with strict type-checking.

**Secondary:**
- Tolk (`.tolk`) — TON blockchain smart contracts (`contracts/Counter.tolk`, `scripts/deploy.tolk`, `scripts/init-wallet.tolk`, `scripts/test-swap.tolk`, `tests/Counter.test.tolk`, `wrappers/Counter.gen.tolk`).
- JSON5 — `openclaw/openclaw.json` (OpenClaw multi-agent gateway configuration with comments and trailing commas).
- Shell (POSIX sh/bash) — Container orchestration (`scripts/start-unified.sh`), Docker build steps (`Dockerfile`).
- SQL — SQLite schemas and WAL pragmas (`packages/storage/src/store.ts`).

## Runtime

**Environment:**
- Node.js — `package.json` specifies `engines.node >=22.0.0`; Docker runtime uses `node:22-alpine` with `dumb-init` for signal management.
- Acton Toolchain — TON smart contract development and testing CLI for compiling Tolk contracts and running native contract test suites (`Acton.toml`).
- Redis (Optional / Agent Bus) — `ioredis` agent communication backbone on `redis://localhost:6379`.

**Package Manager:**
- npm workspaces — monorepo configured via `workspaces: ["packages/*"]` in root `package.json`.
- Lockfile: `package-lock.json` present and committed.

## Frameworks

**Core & API:**
- Fastify v5 (`fastify ^5.2.1`) — high-performance HTTP server in `packages/api` with plugins:
  - `@fastify/websocket ^11.3.0` — real-time WebSocket client streaming (`packages/api/src/routes/ws.ts`)
  - `@fastify/cors ^11.3.0` — cross-origin resource sharing
  - `@fastify/helmet ^13.1.0` — security headers
  - `@fastify/rate-limit ^11.2.0` — API request rate limiting

**Agent Orchestration:**
- OpenClaw — external multi-agent gateway defined in `openclaw/openclaw.json` (5 personas: `scanner-ops`, `market-intel`, `risk-analyst`, `executor`, `trader-ui`).
- Internal Agent Graph & Bus — `packages/orchestration` (LangGraph-style trade state machine) and `packages/agents` (Redis-backed `AgentBus`).

**Testing:**
- Node.js built-in test runner (`node:test`) + `node:assert/strict` executed via `tsx --test`.
- Acton contract test runner (`acton test`) for `.tolk` contract suites (`tests/Counter.test.tolk`).

**Build & Dev Tools:**
- `tsx ^4.19.2` — native TypeScript execution for development, test running, and container entrypoint.
- `typescript ^5.7.2` — workspace typechecker (`tsc --noEmit`).
- `concurrently ^9.1.0` — multi-package development process runner (`npm run dev`).
- `json5 ^2.2.3` — parser for OpenClaw gateway configuration.

## Key Dependencies

**Critical Blockchain & Execution:**
- `@ton/ton ^15.1.0` — official TON TypeScript SDK (Cells, Slices, BOC serialization, Address handling, WalletContractV5R1, TonClient) used in `packages/executor`, `packages/wallet`, `packages/dex`, `packages/security`, `packages/orchestration`.
- `@ton/crypto ^3.3.0` — cryptographic keypair derivation, mnemonic validation, signature verification.
- `@openclaw-ton-agent/*` — internal monorepo package suite (15 packages).
- `@ton/mcp` (OpenClaw plugin) — agentic wallet management and Omniston swap execution.

**Validation & Schema:**
- `zod ^3.23.8` — schema definitions, parse-at-boundary validation, and inferred TypeScript types in `packages/shared`, `packages/core`, `packages/api`, `packages/storage`, `packages/dex`, `packages/security`, `packages/orchestration`.

**Storage & Messaging:**
- `better-sqlite3 ^11.6.0` — synchronous, high-throughput SQLite engine for position tracking and decision logs (`packages/storage/src/store.ts`).
- `ioredis ^5.4.1` — Redis client for distributed pub/sub agent communication (`packages/agents/src/bus.ts`).
- `dotenv ^16.4.5` — environment configuration loader.

## Configuration

**Environment:**
- `.env` / `.env.example` — environment variables for RPC endpoints, risk thresholds, API keys, and execution mode.
- `packages/risk-gates/src/config.ts` — risk gate defaults (drawdown limits, tier caps, Kelly fractions, volatility boundaries).
- `packages/core/src/config.ts` — shared application configuration schema.

**Build & Deployment:**
- `tsconfig.json` — root TypeScript configuration with `target: ES2022`, `moduleResolution: bundler`, `strict: true`.
- `Dockerfile` — multi-stage Alpine Docker build with native C++ toolchain (`python3 make g++`) to compile `better-sqlite3`, non-root user `appuser` (UID 1001), and `dumb-init`.
- `fly.toml` — Fly.io production deployment spec (Singapore region `sin`, internal port 3000 for Fastify, health checks at `/health/ready`).
- `fly.testnet.toml` — Fly.io testnet deployment configuration.
- `Acton.toml` — TON smart contract manifest defining contracts, build directories, format settings, and testnet endpoints.

## Platform Requirements

**Development:**
- Node.js >= 22.0.0, npm >= 10.0.0.
- Build tools: `python3`, `make`, `g++` (required for native `better-sqlite3` compilation).
- Optional: Acton CLI (`acton`) for compiling and testing Tolk smart contracts.
- Optional: Local Redis instance (`redis://localhost:6379`) for running `packages/agents`.

**Production:**
- Fly.io microVM (1 CPU, 1024MB RAM minimum).
- Persistent volume mounted at `/app/data` for SQLite database (`agent.db`) and NDJSON journals (`signals-mainnet.ndjson`, `orders-mainnet.ndjson`, `fills-mainnet.ndjson`).

## Workspace Packages (15 Monorepo Packages)

| Package | Name | Primary Role |
|---------|------|--------------|
| `packages/api` | `@openclaw-ton-agent/api` | Fastify HTTP + WebSocket control plane |
| `packages/agents` | `@openclaw-ton-agent/agents` | Redis pub/sub agent runtime |
| `packages/backtest` | `@openclaw-ton-agent/backtest` | Simulation engine, hyperopt, drift monitor |
| `packages/core` | `@openclaw-ton-agent/core` | Core utilities, logging, config loader |
| `packages/dex` | `@openclaw-ton-agent/dex` | DeDust and STON.fi swap router |
| `packages/executor` | `@openclaw-ton-agent/executor` | Order builder, Acton smart contract wallet, live/paper runner |
| `packages/exit-manager` | `@openclaw-ton-agent/exit-manager` | TPSL management, Chandelier trailing stops, Supertrend |
| `packages/market-intel` | `@openclaw-ton-agent/market-intel` | Volatility estimation, regime detection, whale tracking |
| `packages/orchestration` | `@openclaw-ton-agent/orchestration` | Multi-agent state graph, tier coordinator, safety caps |
| `packages/risk-gates` | `@openclaw-ton-agent/risk-gates` | Deterministic Risk Gates G0-G5, circuit breaker, Kelly sizing |
| `packages/scanner` | `@openclaw-ton-agent/scanner` | On-chain signal ingestion, radar/sniper scans, token scoring |
| `packages/security` | `@openclaw-ton-agent/security` | Token contract audit, honeypot detection, pool resolution |
| `packages/shared` | `@openclaw-ton-agent/shared` | Zod schemas, envelope types, NDJSON journal rotation |
| `packages/storage` | `@openclaw-ton-agent/storage` | SQLite persistence (`better-sqlite3`) for positions & decisions |
| `packages/wallet` | `@openclaw-ton-agent/wallet` | TON Wallet v5r1 client initialization and balance checks |

---

*Stack analysis: 2026-08-16*
