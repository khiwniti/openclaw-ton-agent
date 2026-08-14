# Codebase Structure

**Analysis Date:** 2026-08-14

## Directory Layout

```
openclaw-ton-agent/
├── workspace/          # Agent personas — one dir per agent (AGENTS.md + SOUL.md)
│   ├── trader-ui/      # Trade UI / display agent
│   ├── executor/       # Execution agent (only write/exec-capable agent)
│   ├── risk-analyst/   # Risk & gate analysis agent
│   ├── market-intel/   # Market intelligence agent (vol/macro feeds)
│   └── scanner-ops/    # Signal scanner agent (read-only by construction)
├── packages/           # TypeScript monorepo — 7 packages, src/index.ts boundary
│   ├── scanner/        # Signal ingestion (raw signals → envelopes)
│   ├── shared/         # Shared envelope types & utilities
│   ├── executor/       # Gated envelope execution (paper/live)
│   ├── exit-manager/   # TPSL position exit management
│   ├── market-intel/   # Volatility / macro data feeds
│   ├── risk-gates/     # G1–G4 risk gate evaluation + sizing
│   └── backtest/       # Simulation, paper engine, eval, hyperopt
├── skills/             # 9 local agent skills (SKILL.md per skill)
├── scripts/            # Validation & helper scripts
├── data/               # Runtime state: NDJSON/JSON envelopes, sqlite DB, eval reports
├── openclaw/           # OpenClaw runtime config (openclaw.json)
├── docs/               # Architecture docs & decision records
├── .planning/          # GSD planning artifacts (codebase maps, plans)
├── .omo/               # OpenClaw session/task runtime state
├── .remember/          # Agent memory store
├── .claude/            # Claude Code skills/config
├── fly.toml            # Fly.io deployment config
├── Dockerfile          # Multi-stage container build (non-root appuser 1001)
├── package.json        # Root manifest — npm workspaces over packages/*
└── tsconfig.json       # Root TypeScript configuration
```

## Directory Purposes

**`workspace/`:**
- Purpose: One directory per agent persona. Each contains `AGENTS.md` (role definition, capabilities) and `SOUL.md` (identity). Five personas: `trader-ui`, `executor`, `risk-analyst`, `market-intel`, `scanner-ops`.
- Contains: `AGENTS.md`, `SOUL.md` per persona.
- Key files: `workspace/executor/AGENTS.md`, `workspace/scanner-ops/AGENTS.md` (read-only persona), `workspace/executor/SOUL.md`.

**`packages/`:**
- Purpose: TypeScript monorepo packages. Each package exposes its public API through `src/index.ts`; internal modules stay package-private.
- Contains: `src/` (implementation + co-located `*.test.ts`), package-local `package.json`.
- Key files: `packages/scanner/src/index.ts`, `packages/executor/src/index.ts`, `packages/risk-gates/src/gates.ts`, `packages/backtest/src/index.ts`.

**`skills/`:**
- Purpose: 9 local skills consumed by agents in `openclaw/openclaw.json` (e.g. `ton-signal-ingest`, `ton-risk-gates`, `ton-execute`, `ton-audit`).
- Contains: `SKILL.md` per skill.
- Key files: `skills/ton-risk-gates/SKILL.md`, `skills/ton-execute/SKILL.md`.

**`scripts/`:**
- Purpose: Repo-level validation and helper scripts, not runtime application code.
- Contains: Node ESM scripts.
- Key files: `scripts/validate-openclaw-config.mjs` (asserts agent capabilities; skips `sperax:*` skills).

**`data/`:**
- Purpose: Runtime state produced by agents — gated envelopes, eval reports, sqlite DB. Not a config source of truth.
- Contains: `paper-orders.ndjson`, `gated-mainnet.ndjson`, `eval-report.json`, `agent.db`, `.openclaw/` state dir.
- Key files: `data/gated-mainnet.ndjson` (`sig_*` envelopes with `meta.gate` verdicts), `data/eval-report.json` (`kind:"synthetic-candidate"`).

**`openclaw/`:**
- Purpose: OpenClaw runtime configuration — agent definitions, shared defaults, A2A wiring.
- Contains: `openclaw.json`.
- Key files: `openclaw/openclaw.json` (defaults model `anthropic/claude-sonnet-4-6`, 6 shared skills, `tools.agentToAgent` with `allow` list).

**`docs/`:**
- Purpose: Architecture documentation and decision records.
- Key files: `docs/architecture.md` (§15 implementation status, decisions 1–7, G1–G4 gates).

## Key File Locations

**Entry Points:**
- `packages/*/src/index.ts`: public boundary for each package (the only importable surface).
- `packages/scanner/src/index.ts`: signal ingestion entry.
- `packages/executor/src/index.ts`: execution entry (gated envelopes → paper/live).
- `packages/backtest/src/replay.ts`: replay/paper runner entry.
- `Dockerfile`: container entrypoint chain (`dumb-init`, non-root).

**Configuration:**
- `openclaw/openclaw.json`: agent personas, skills, capabilities, A2A config.
- `fly.toml`: deployment (app `openclaw-ton-agent`, region `sin`, port 8080, env like `GATES_G1_G3_ACK`, `CIRCUIT_BREAKER_DRAWDOWN_PCT`).
- `packages/risk-gates/src/config.ts`: gate thresholds / tier caps.
- `package.json`, `tsconfig.json`: workspace + TS settings.

**Core Logic:**
- `packages/risk-gates/src/gates.ts`: G1–G4 evaluation; `kelly.ts`: position sizing; `point-setup.ts`, `macro-feed.ts`.
- `packages/backtest/src/engine.ts`: sim engine; `metrics.ts`, `hyperopt.ts`, `drift.ts`, `ledger.ts`.
- `packages/market-intel/src/vol.ts`: volatility feed.
- `packages/shared/src/`: envelope types shared across packages.

**Testing:**
- Co-located `*.test.ts` next to source, e.g. `packages/backtest/src/metrics.test.ts`.
- Fixtures under `data/` (`*.ndjson` samples).

## Naming Conventions

**Files:**
- camelCase for TypeScript modules: `gates.ts`, `point-setup.ts`, `kelly.ts`, `metrics.test.ts`.
- `*.test.ts` co-located with the module it tests.
- Runtime data as `*.ndjson` (envelope streams) and `*.json` (reports).

**Directories:**
- kebab-case: `trader-ui`, `exit-manager`, `market-intel`, `scanner-ops`, `risk-gates`.
- Packages singular: `scanner`, `shared`, `executor`, `backtest`.

**Envelope/entity IDs:**
- Prefixes: `ord_*` (orders), `env_*` (gated envelopes), `sig_*` (signals).
- `source` tags distinguish origin: `"paper-sim"`, `"audit"`, `"synthetic-candidate"`.

## Where to Add New Code

**New Feature:**
- Implementation: in the relevant `packages/<name>/src/` module; export through `packages/<name>/src/index.ts`. Do not import across packages except via `src/index.ts` boundaries.
- Tests: co-located `packages/<name>/src/<module>.test.ts`.

**New Component/Module:**
- A new package: `packages/<name>/` with `src/index.ts` and package-local `package.json`; register in root `package.json` workspaces.

**New Agent/Persona:**
- Create `workspace/<name>/AGENTS.md` + `workspace/<name>/SOUL.md`, register the agent in `openclaw/openclaw.json` (workspace, skills, capabilities), and keep `scripts/validate-openclaw-config.mjs` passing (only `executor` may hold write capability).

**New Skill:**
- Add `skills/<name>/SKILL.md`; reference it in the relevant agent's `skills` array in `openclaw/openclaw.json`.

**Utilities:**
- Shared helpers go in `packages/shared/src/`; never duplicate them in another package.

**Runtime state:**
- Append envelopes to `data/*.ndjson`; write reports to `data/*.json`. Never commit secrets; local `.env` files exist and must never be read or committed.

## Special Directories

**`node_modules`:**
- Purpose: installed dependencies (root + per-package).
- Generated: Yes. Committed: No.

**`data/`:**
- Purpose: runtime state (envelopes, eval reports, `agent.db`, `.openclaw/` state dir).
- Generated: Yes (agent-produced). Committed: No.

**`.planning/` / `.omo/` / `.remember/`:**
- Purpose: GSD planning artifacts / OpenClaw runtime state / agent memory.
- Generated: Yes (tooling-produced). Committed: `.planning/` yes, `.omo/` + `.remember/` no.

---

*Structure analysis: 2026-08-14*
