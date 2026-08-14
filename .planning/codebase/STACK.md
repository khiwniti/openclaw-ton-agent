# Technology Stack

**Analysis Date:** 2026-08-14

## Languages

**Primary:**
- TypeScript — all application code across the 7 workspace packages (`.ts` sources under `packages/`, plus the `openclaw/` persona/plugin configuration and `scripts/`)

**Secondary:**
- JSON5 — `openclaw/openclaw.json` (orchestrator configuration; 127 lines)
- Shell — Docker build/runtime orchestration in `Dockerfile` (Alpine)

## Runtime

**Environment:**
- Node.js — root `package.json` declares `engines.node >=26.0.0`, but the production `Dockerfile` bases on `node:24-alpine` (discrepancy; local dev runs whatever `tsx`/`nodemon` uses)

**Package Manager:**
- npm workspaces — root `package.json` `workspaces` field; lockfile `package-lock.json` present (single lockfile for the monorepo; `npm ci --ignore-scripts` used in the Docker build)

## Frameworks

**Core:**
- None — this is a plain TypeScript Node monorepo; no web framework. `openclaw` (external orchestrator process) drives the agents via `openclaw/openclaw.json`

**Testing:**
- Node's built-in `node:test` runner — test files named `*.test.ts` (e.g. `packages/scanner/src/signal-out.test.ts`); run via `tsx` (no jest/vitest)

**Build/Dev:**
- `tsx` — runs TypeScript directly (dev scripts and the Docker runtime entrypoint)
- `nodemon` — watch-mode dev scripts
- `npm run typecheck` — run in the Docker builder stage as the compile gate

## Key Dependencies

**Critical:**
- `@ton/mcp` — TON blockchain custody + Omniston swap tooling, exposed to agents through the OpenClaw plugin `ton` (`clawhub:ton-mcp` in `openclaw/openclaw.json` `plugins.entries`)
- OpenClaw (external) — agent orchestrator; `openclaw/openclaw.json` defines 5 personas (risk-analyst, executor, trader-ui, scanner-ops, market-intel) with skill allow/deny lists

**Infrastructure:**
- TimescaleDB (PostgreSQL) — series data, `DATABASE_URL` (`postgres://postgres:postgres@localhost:5432/tonagent`)
- SQLite — operational agent state, `SQLITE_PATH` (`./data/agent.db`)

## Configuration

**Environment:**
- `.env`/`.env.example` (60 lines) — network, API keys, signal-out webhook, kill switch, risk gate thresholds (`GATE_*`), execution mode (`EXECUTION_MODE`, `OBSERVE_ONLY`), Telegram bots
- `openclaw/openclaw.json` — persona definitions, Telegram channel/bot wiring, plugin (MCP) entries

**Build:**
- `Dockerfile` (multi-stage): builder runs `npm ci --ignore-scripts` + `npm run typecheck` (installs `python3 make g++` via `apk`); runtime installs ALL deps (including devDependency `tsx`, which executes the app), runs as non-root `appuser`/`appgroup` (uid/gid 1001) with `dumb-init`, state under `/app/data`
- `fly.toml` — Fly.io deployment; overrides `TONAPI_BASE=https://tonapi.io/v2`
- `tsconfig.json` at root (workspace-level TypeScript config)

## Platform Requirements

**Development:**
- Node.js >= 26 (per `engines`), npm workspaces, local `.env` with API keys (see `INTEGRATIONS.md`)

**Production:**
- Deployed on Fly.io (`fly.toml`); containerized with the multi-stage `Dockerfile`; `/app/data` volume for journals/state

## Workspace Structure (packages/)

- `packages/shared` — shared types/utilites; leaf dependency
- `packages/scanner`, `packages/market-intel`, `packages/exit-manager`, `packages/risk-gates` — depend on `shared`
- `packages/executor`, `packages/backtest` — depend on the above (executor orchestrates scanner + risk-gates + exit-manager; backtest replays scanner/market-intel data)

---

*Stack analysis: 2026-08-14*
