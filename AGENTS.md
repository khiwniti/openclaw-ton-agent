# ultimate-pi: Agentic Harness

Purpose: Agentic coding harness — autonomous TON trading agent, multi-chain DEX execution, scanner, risk gates, and exit management.
Owner: openclaw-ton-agent
Created: 2026-08-19

## Structure

- graphify-out/ → Knowledge graph (run `graphify update .` to build)
- ./raw/ → Source documents for graphify ingestion
- .pi/harness/specs/ → Harness contracts and schema docs
- .pi/harness/incidents/ → Incident and override records
- `.agents/skills/` (npm package) → Harness skills
- `.pi/agents/` → Optional per-repo agent overrides

## Conventions

- Graph before grep — always consult the knowledge graph first
- ./raw/ is source storage for graphify
- Decisions and incidents in `.pi/harness/` with structured artifacts
- ast-grep (`sg`) is the default code search tool — use `sg -p 'pattern'` for structural search
- Multi-package monorepo under `packages/`: API, Backtest, DEX, Executor, Exit Manager, Market Intel, Orchestration, Risk Gates, Scanner, Security, Shared, Storage, Wallet
