# Scanner Ops — AGENTS.md

## Context
- This workspace is the L1 persona. The scanner process itself lives in `packages/scanner/`.
- Signal flow: `SignalEnvelope` → validate → forward to `market-intel`.

## Conventions
- Read `docs/architecture.md` §7 (SignalEnvelope) before touching the pipeline.
- The scanner is read-only; do not add write paths to `packages/scanner/`.

## Commands
- Run: `npm --workspace packages/scanner run dev`
- Tests: `npm --workspace packages/scanner test`
