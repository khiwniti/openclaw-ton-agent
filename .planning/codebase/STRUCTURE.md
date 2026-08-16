# Codebase Structure

**Analysis Date:** 2026-08-16

## Directory Layout

```
openclaw-ton-agent/
├── packages/                   # 15 npm workspace packages (TypeScript)
│   ├── agents/                 # Redis-backed agent runtime & communication bus
│   ├── api/                    # Fastify v5 REST & WebSocket control plane
│   ├── backtest/               # Simulation engine, historical fetcher, hyperopt, drift monitor
│   ├── core/                   # Shared logging, core configuration loader, utilities
│   ├── dex/                    # STON.fi and DeDust AMM swap routers & slippage math
│   ├── executor/               # Order builder, Acton smart contract wallet, live/paper runner
│   ├── exit-manager/           # TPSL management, Chandelier trailing stops, Supertrend flips
│   ├── market-intel/           # Regime detection, ATR volatility, whale watching
│   ├── orchestration/          # Multi-agent state graph, tier coordinator, safety caps
│   ├── risk-gates/             # Deterministic Risk Gates G0-G5, circuit breaker, Kelly sizing
│   ├── scanner/                # Real-time on-chain signal ingestion & token safety scoring
│   ├── security/               # Token contract bytecode audit, honeypot detection, pool resolver
│   ├── shared/                 # Zod schemas, envelope types, rotated NDJSON journaling
│   ├── storage/                # SQLite persistence (better-sqlite3 WAL) for positions & journals
│   └── wallet/                 # Native TON wallet client initialization & balance queries
├── contracts/                  # TON blockchain smart contracts (Tolk)
│   └── Counter.tolk            # Sample Tolk contract for on-chain state verification
├── scripts/                    # Helper, deployment, and bootstrap scripts
│   ├── deploy.tolk             # Tolk contract deployment script
│   ├── init-wallet.tolk        # Tolk wallet initialization script
│   ├── test-swap.tolk          # Tolk swap testing script
│   ├── deploy-testnet-wallet.ts# Testnet wallet deployment script
│   ├── start-unified.sh        # Unified container process supervisor
│   └── validate-openclaw-config.mjs # OpenClaw configuration & capability validator
├── tests/                      # Smart contract test suites
│   └── Counter.test.tolk       # Native Acton contract test suite
├── wrappers/                   # Smart contract wrappers
│   └── Counter.gen.tolk        # Generated Tolk wrapper
├── openclaw/                   # OpenClaw multi-agent gateway configuration
│   └── openclaw.json           # JSON5 persona definitions, A2A permissions, and MCP plugins
├── data/                       # Local runtime state, SQLite database, and NDJSON logs
│   ├── agent.db                # SQLite database (WAL mode)
│   ├── signals-mainnet.ndjson  # Raw ingested signal stream
│   ├── gated-mainnet.ndjson    # Risk-gate evaluated signal stream
│   ├── orders-mainnet.ndjson   # Executed order stream
│   ├── fills-mainnet.ndjson    # Confirmed fill records
│   └── bus.ndjson              # Agent bus message history
├── docs/                       # Architecture documentation and decision records
├── .planning/                  # GSD planning artifacts and codebase maps
│   └── codebase/               # 7 structured codebase documentation files
├── Acton.toml                  # TON smart contract manifest and build settings
├── Dockerfile                  # Multi-stage Alpine container build
├── fly.toml                    # Fly.io production deployment spec
├── fly.testnet.toml            # Fly.io testnet deployment spec
├── package.json                # Monorepo root manifest with npm workspaces
└── tsconfig.json               # Root TypeScript configuration
```

## Directory Purposes

### Workspace Packages (`packages/`)

**`packages/agents/`:**
- Purpose: Distributed agent runtime and Redis pub/sub message bus (`AgentBus`).
- Key files: `src/bus.ts`, `src/base.ts`, `src/scanner.ts`, `src/risk.ts`, `src/executor.ts`, `src/ui.ts`.

**`packages/api/`:**
- Purpose: Fastify v5 control plane exposing REST endpoints for health and decisions, plus WebSocket streams.
- Key files: `src/index.ts`, `src/routes/health.ts`, `src/routes/decisions.ts`, `src/routes/ws.ts`.

**`packages/backtest/`:**
- Purpose: Historical simulation, fee calculation, hyperopt parameter search, and statistical drift monitoring.
- Key files: `src/engine.ts`, `src/fetch.ts`, `src/hyperopt.ts`, `src/drift.ts`, `src/report.ts`, `src/ledger.ts`.

**`packages/core/`:**
- Purpose: Base logging framework and shared configuration schemas.
- Key files: `src/logger.ts`, `src/config.ts`, `src/index.ts`.

**`packages/dex/`:**
- Purpose: DEX routing across STON.fi and DeDust, quote fetching, and minimum token output math.
- Key files: `src/router.ts`, `src/index.ts`.

**`packages/executor/`:**
- Purpose: Transforms gated decisions into executable blockchain transactions via Acton wallets or native v5r1 contracts.
- Key files: `src/index.ts`, `src/order-builder.ts`, `src/continuous.ts`, `src/acton/acton-wallet.ts`, `src/acton/gas-guard.ts`.

**`packages/exit-manager/`:**
- Purpose: Dynamic position exit management, Chandelier trailing stops, Supertrend reversal detection, and time stops.
- Key files: `src/position.ts`, `src/decide.ts`, `src/modes.ts`, `src/index.ts`.

**`packages/market-intel/`:**
- Purpose: Market regime classification, ATR-based volatility measurement, and whale wallet flow tracking.
- Key files: `src/regime.ts`, `src/vol.ts`, `src/whales.ts`, `src/annotate.ts`.

**`packages/orchestration/`:**
- Purpose: Multi-agent coordination state graph, capital tier allocations, and safety caps.
- Key files: `src/graph.ts`, `src/coordinator.ts`, `src/safetycaps.ts`, `src/nodes/*`.

**`packages/risk-gates/`:**
- Purpose: Deterministic Risk Gates (G0-G5), circuit breaker drawdown checks, and Kelly fraction position sizing.
- Key files: `src/gates.ts`, `src/circuit-breaker.ts`, `src/kelly.ts`, `src/sniper.ts`, `src/macro-feed.ts`.

**`packages/scanner/`:**
- Purpose: Real-time on-chain signal discovery via TonAPI, radar/sniper loops, and initial safety scoring.
- Key files: `src/pipeline.ts`, `src/tonapi.ts`, `src/score.ts`, `src/audit.ts`, `src/signal-out.ts`.

**`packages/security/`:**
- Purpose: Token smart contract bytecode analysis, mintable/admin checks, honeypot detection, and pool resolution.
- Key files: `src/audit.ts`, `src/pool-resolver.ts`, `src/index.ts`.

**`packages/shared/`:**
- Purpose: Central domain Zod schemas, envelope definitions (`IngestedEnvelope`, `GatedEnvelope`), ID generation, and rotated NDJSON journaling.
- Key files: `src/schemas.ts`, `src/signal.ts`, `src/order.ts`, `src/journal.ts`, `src/newid.ts`.

**`packages/storage/`:**
- Purpose: High-performance local SQLite storage using `better-sqlite3` with WAL mode.
- Key files: `src/store.ts`, `src/index.ts`.

**`packages/wallet/`:**
- Purpose: Native TON client initialization, v5r1 wallet contract binding, and balance checks.
- Key files: `src/wallet.ts`, `src/index.ts`.

---

### Non-Package Root Directories

**`contracts/` & `tests/`:**
- Purpose: TON Tolk smart contracts and native test suites compiled via the Acton CLI.
- Key files: `contracts/Counter.tolk`, `tests/Counter.test.tolk`, `Acton.toml`.

**`openclaw/`:**
- Purpose: OpenClaw runtime configuration for multi-agent personas, Telegram channel routing, and MCP plugins.
- Key files: `openclaw/openclaw.json`.

**`scripts/`:**
- Purpose: Container startup supervision, config validation, and contract deployment scripts.
- Key files: `scripts/start-unified.sh`, `scripts/validate-openclaw-config.mjs`.

**`data/`:**
- Purpose: Local runtime persistence directory mounted to persistent volumes in production.

---

## Key File Locations

**Entry Points:**
- `scripts/start-unified.sh`: Container multi-process entrypoint.
- `packages/api/src/index.ts`: Fastify HTTP/WebSocket server entry.
- `packages/scanner/src/index.ts`: Scanner polling loop entry.
- `packages/executor/src/continuous.ts`: Continuous execution engine entry.
- `packages/risk-gates/src/continuous.ts`: Continuous risk evaluation entry.

**Core Configuration:**
- `openclaw/openclaw.json`: OpenClaw agent definitions and tool permissions.
- `Acton.toml`: Smart contract manifest.
- `fly.toml` / `fly.testnet.toml`: Fly.io production/testnet infrastructure.
- `packages/risk-gates/src/config.ts`: Risk gate thresholds and Kelly multipliers.
- `packages/core/src/config.ts`: Base application configuration.

**Testing:**
- Root: `npm test --workspaces --if-present`.
- Typecheck: `npm run typecheck` (`tsc --noEmit`).
- Smart Contracts: `acton test` (runs `tests/*.test.tolk`).

---

## Naming Conventions

**Files:**
- TypeScript modules: kebab-case or camelCase (e.g. `order-builder.ts`, `circuit-breaker.ts`, `gates.ts`).
- Test files: `<module>.test.ts` placed in the same directory or `src/__tests__/`.
- Tolk contracts: PascalCase (`Counter.tolk`, `Counter.test.tolk`).
- Shell scripts: kebab-case with `.sh` extension (`start-unified.sh`).

**Entity Identifiers:**
- Signal IDs: `sig_<timestamp>_<random>` (e.g. `sig_1723636800000_abc123`).
- Gated Envelope IDs: `env_<timestamp>_<random>`.
- Order IDs: `ord_<timestamp>_<random>`.
- Position IDs: `pos_<timestamp>_<random>`.

**Database Tables & Columns:**
- Tables: snake_case plural (`positions`, `daily_pnl`, `decision_journal`, `agentic_wallets`).
- Columns: snake_case (`wallet_tier`, `jetton_master`, `amount_ton`, `tx_hash`, `opened_at`).

---

## Where to Add New Code

**Adding a New Risk Gate:**
1. Define gate logic and reasons in `packages/risk-gates/src/gates.ts`.
2. Add any new thresholds to `packages/risk-gates/src/config.ts`.
3. Add corresponding unit tests in `packages/risk-gates/src/gates.test.ts`.

**Adding a New DEX Integration:**
1. Implement swap quote and transaction builder functions in `packages/dex/src/router.ts`.
2. Add DEX identifier to the `Dex` union type (`"stonfi" | "dedust" | "newdex"`).
3. Update `packages/executor/src/acton/router.ts` if smart-contract routing is required.
4. Add route tests in `packages/dex/src/router.test.ts`.

**Adding a New API Route:**
1. Create a route handler module in `packages/api/src/routes/<route-name>.ts`.
2. Register the route plugin in `packages/api/src/index.ts` with appropriate prefix.
3. Add route tests in `packages/api/src/__tests__/<route-name>.test.ts`.

**Adding a New Agent Persona:**
1. Add persona entry to `openclaw/openclaw.json` with strict tool allow/deny lists.
2. If using internal agent bus, implement agent worker in `packages/agents/src/<agent-name>.ts`.
3. Run `node scripts/validate-openclaw-config.mjs` to ensure permission rules pass.

**Adding a New Smart Contract:**
1. Place the `.tolk` contract source in `contracts/<ContractName>.tolk`.
2. Register the contract in `Acton.toml` under `[contracts.<ContractName>]`.
3. Write unit tests in `tests/<ContractName>.test.tolk`.
4. Compile with `acton build` and test with `acton test`.

---

## Special & Generated Directories

**`node_modules/`:**
- Dependencies for workspace root and packages. (Generated: Yes. Committed: No.)

**`data/`:**
- Local runtime state, SQLite files, NDJSON journals. (Generated: Yes. Committed: No.)

**`build/` & `gen/` (Acton):**
- Acton smart contract build artifacts and generated wrappers. (Generated: Yes. Committed: No.)

**`.planning/`:**
- GSD roadmap, state, and codebase documentation. (Generated: Yes. Committed: Yes.)

---

*Structure analysis: 2026-08-16*
