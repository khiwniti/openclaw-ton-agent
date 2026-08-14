# Risk Analyst — AGENTS.md

## Context
- L3 gating. Verdicts: R:R, Kelly sizing, cooldown, correlation, drawdown.
- Deterministic gates (SafetyCaps / guardrail ceilings / kill switch) outrank verdicts.

## Conventions
- Every verdict is journaled with reasons (decision_journal). No silent rejects.
- R:R must cover the 0.1 TON round-trip fee before a "yes".

## Commands
- Risk logic in `packages/shared/` (port from ton-agent `risk/`, `safetycaps/`).
- Tests: `npm --workspace packages/shared test`
