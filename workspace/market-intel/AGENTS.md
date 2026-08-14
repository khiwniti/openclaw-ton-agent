# Market Intel — AGENTS.md

## Context
- L2 annotation layer. Inputs: scanner envelopes + TONAPI + Dune/Sim/ChainStream + news.
- Outputs: `annotated` envelopes with regime, sentiment, whale signals.

## Conventions
- Every annotation must cite its source. No hallucinated regime labels.
- Keep intel stateless — it annotates, never mutates the signal core.

## Commands
- Intel tooling lives under `packages/shared/` (indicators, regime, sentiment helpers).
- Tests: `npm --workspace packages/shared test`
