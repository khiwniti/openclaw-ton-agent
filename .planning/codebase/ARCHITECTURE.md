<!-- refreshed: 2026-08-14 -->
# Architecture

**Analysis Date:** 2026-08-14

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                        Personas (Agent Workspaces)                    │
│  `workspace/trader-ui/`  `workspace/risk-analyst/`  `workspace/scanner-ops/`  │
│  `workspace/executor/`   `workspace/market-intel/`                          │
│  (5 isolated agents; executor is the ONLY write/exec-capable agent)    │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ A2A messaging (scanner → gated executor)
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Execution Pipeline (Packages)                      │
│  `packages/scanner/` → `packages/market-intel/` → `packages/risk-gates/` │
│  → `packages/executor/` → `packages/exit-manager/` → on-chain settlement │
│  parallel: `packages/backtest/` (validation)  `packages/shared/` (types) │
└───────────────────────────┬──────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Store / Output                                                     │
│  `data/paper-orders.ndjson`  `data/gated-mainnet.ndjson`            │
│  `data/eval-report.json`  SQLite (`SQLITE_PATH=/app/data/agent.db`) │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Personas | 5 isolated agents (trader-ui, executor, risk-analyst, market-intel, scanner-ops); each has own `AGENTS.md` + `SOUL.md` | `workspace/*/{AGENTS.md,SOUL.md}` |
| Skills | 9 local skills (ton-signal-ingest, ton-risk-gates, ton-reporting, ton-execute, ton-settlement, ton-exit-modes, ton-tpsl-manager, ton-audit, ton-manual-override) encode gates G1–G4, execution modes, TPSL rules | `skills/*/SKILL.md` |
| Scanner | Signal ingestion; read-only by construction | `packages/scanner/src/index.ts` |
| Market Intel | Volatility / regime analysis | `packages/market-intel/src/index.ts` (+ `vol.ts`) |
| Risk Gates | Gate checks G1–G4 (live trading paused until expectancy positive) | `packages/risk-gates/src/index.ts` (+ `gates.ts`, `kelly.ts`, `point-setup.ts`, `macro-feed.ts`, `run-gated-feed.ts`) |
| Executor | Execute orders via gates; mode discipline (`OBSERVE_ONLY=true` in production) | `packages/executor/src/index.ts` |
| Exit Manager | TPSL exits (ton-tpsl-manager, ton-exit-modes) | `packages/exit-manager/src/index.ts` |
| Backtest | Paper simulation, metrics, hyperopt, drift/replay validation | `packages/backtest/src/index.ts` (+ `engine.ts`, `paper.ts`, `report.ts`, `metrics.ts`, `hyperopt.ts`, `replay.ts`, `ledger.ts`, `drift.ts`, `fetch.ts`, `fixture.ts`) |
| Shared | Common types/utilities | `packages/shared/src/index.ts` |

## Pattern Overview

**Overall:** Multi-agent orchestration with a gate-driven execution pipeline.

**Key Characteristics:**
- 5 isolated persona agents coordinate via agent-to-agent (A2A) messaging
- `scripts/validate-openclaw-config.mjs` enforces that only `executor` may have write capability
- Decisions 1–7 locked (`docs/architecture.md` §15); edge gates G1–G4 binding
- Live trading paused until measured expectancy is positive (`data/eval-report.json`: `validateAvgExpectancyTon: 2.5891` for best backtest mode)
- Production runs with `EXECUTION_MODE=trade` + `OBSERVE_ONLY=true`

## Layers

**Persona Layer:**
- Purpose: Agent identity, capabilities, and isolation
- Location: `workspace/`
- Contains: `AGENTS.md`, `SOUL.md` per agent
- Depends on: skills (referenced by name in `openclaw/openclaw.json`)
- Used by: `openclaw` runtime (`agents.defaults` + per-agent entries)

**Skill Layer:**
- Purpose: Domain procedures (signal ingest, risk gates, execution, settlement, exits, TPSL, audit, manual override)
- Location: `skills/`
- Contains: `SKILL.md` per skill
- Depends on: package code
- Used by: personas

**Package Layer:**
- Purpose: Executable domain logic
- Location: `packages/`
- Contains: `scanner`, `shared`, `executor`, `exit-manager`, `market-intel`, `risk-gates`, `backtest`
- Depends on: each other (scanner → market-intel → risk-gates → executor → exit-manager)
- Used by: skills and personas

**Data Layer:**
- Purpose: Persistent state and paper/live records
- Location: `data/`
- Contains: `paper-orders.ndjson`, `gated-mainnet.ndjson`, `eval-report.json`; SQLite at `SQLITE_PATH=/app/data/agent.db`

## Data Flow

### Primary Request Path (Signal → Gated Execution)

1. `scanner-ops` persona ingests on-chain signal (via `ton-signal-ingest` skill + `packages/scanner/src/index.ts`)
2. Signal sent via A2A to `executor` (only write/exec-capable agent)
3. `executor` runs gate checks G1–G4 (`packages/risk-gates/src/index.ts`, `gates.ts`) — gated envelope carries `meta.gate{verdict, tier, sizeTon, rRatio, expectedValueTon, cooldownUntil, reasons}` (see `data/gated-mainnet.ndjson`: `source:"audit"`, verdict `"reject"`)
4. Execution mode decides target: paper (`data/paper-orders.ndjson`, `ord_*` ids, `source:"paper-sim"`) or live
5. `exit-manager` applies TPSL exits (`ton-tpsl-manager`, `ton-exit-modes`)
6. Settlement recorded (`ton-settlement` skill)

### Secondary Flow (Validation/Backtest)

1. `packages/backtest/src/index.ts` runs paper engine (`engine.ts`, `paper.ts`)
2. Hyperopt (`hyperopt.ts`) searches grid (best mode: diamond `volPct:0.08`/`rrTarget:4`)
3. Metrics + report (`metrics.ts`, `report.ts`) → `data/eval-report.json`
4. Replay/drift checks (`replay.ts`, `drift.ts`) validate candidate before live enablement

**State Management:**
- NDJSON append logs in `data/` for orders and gated signals
- SQLite for agent state (`SQLITE_PATH=/app/data/agent.db`)
- OpenClaw state dir `OPENCLAW_STATE_DIR=/app/data/.openclaw`

## Key Abstractions

**Gated Envelope:**
- Purpose: A signal + gate verdict + sizing decision, passed between scanner and executor
- Examples: `data/gated-mainnet.ndjson`, `data/paper-orders.ndjson` (`gatedEnvelopeId env_*`)
- Pattern: annotated envelope (`meta.annotation{regime, regimeConfidence, curveBand, whale, whaleDeltaPct, sentiment, sources}`) + `meta.gate`

**Execution Mode:**
- Purpose: Paper vs live routing with observation-only safety
- Examples: `EXECUTION_MODE=trade`, `OBSERVE_ONLY=true` in `fly.toml`; `data/paper-orders.ndjson` (`amountTon:20`, `slippageBps:200`, `tier:"low"`, rRatio ~5.0)

## Entry Points

**Package entry points:**
- Location: `packages/*/src/index.ts` (7 packages; 64 `.ts` files under `packages/*/src/` incl. tests)
- Triggers: invoked by skills/personas
- Responsibilities: each package's domain boundary

**Agent entry points:**
- Location: `openclaw/openclaw.json` (`agents.defaults` + per-agent `workspace`/`skills`)
- Triggers: agent runtime startup
- Responsibilities: agent identity, skill wiring, capability grants/denies

## Architectural Constraints

- **Threading:** Single-threaded agent runtime; A2A messaging is the coordination channel
- **Global state:** `GATES_G1_G3_ACK=0` — live wallet refuses until explicitly acknowledged; live trading paused until expectancy positive
- **Capability isolation:** Only `executor` may have `write`/`edit`/`apply_patch`/`exec`; scanner and market-intel deny `write/edit/apply_patch/exec/browser/cron` (validated by `scripts/validate-openclaw-config.mjs`)
- **Circuit breaker:** `CIRCUIT_BREAKER_DRAWDOWN_PCT=20`; kill switch secret (`KILL_SWITCH_URL`) available
- **Tier caps:** `MAX_OPEN_POSITIONS_PER_TIER=3`

## Anti-Patterns

### Per-Agent Capability Drift

**What happens:** Persona configs can be edited to grant write/exec to more agents.
**Why it's wrong:** The whole security model (only executor acts on-chain) collapses.
**Do this instead:** Run `scripts/validate-openclaw-config.mjs` after any `openclaw/openclaw.json` change; it fails unless only `executor` has write capability and `tools.agentToAgent.enabled` is true with all EXPECTED_AGENTS allowed.

### Unvalidated Mode Flip

**What happens:** Setting `OBSERVE_ONLY=false` before expectancy is proven.
**Why it's wrong:** Live trading is paused until measured expectancy positive (`data/eval-report.json`).
**Do this instead:** Keep `OBSERVE_ONLY=true` in production; only enable live after `packages/backtest/` reports positive expectancy (e.g., `validateAvgExpectancyTon: 2.5891` for the winning diamond mode) and gates G1–G4 pass on real signals.

## Error Handling

**Strategy:** Fail-safe with hard external tripwires.

**Patterns:**
- Kill switch (external webhook secret `KILL_SWITCH_URL`) halts execution
- Circuit breaker at 20% drawdown (`CIRCUIT_BREAKER_DRAWDOWN_PCT`)
- Gate rejections persist `cooldownUntil` + `reasons` in `meta.gate` (`data/gated-mainnet.ndjson`)

## Cross-Cutting Concerns

**Logging:** NDJSON append logs in `data/` (`paper-orders.ndjson`, `gated-mainnet.ndjson`)
**Validation:** `scripts/validate-openclaw-config.mjs` (workspace + skills + capability + A2A + skill-file assertions); backtest drift/replay checks
**Authentication:** Secrets via Fly secrets (TONCENTER_API_KEY, DATABASE_URL, PUBLIC_WEBHOOK_URL, KILL_SWITCH_URL) — never in source

---

*Architecture analysis: 2026-08-14*
