---
name: ton-signal-ingest
description: Validate and normalize SignalEnvelope objects emitted by the read-only scanner before routing them into the intelligence pipeline. Use whenever scanner output enters the system.
---

# ton-signal-ingest

Validates scanner output against the `SignalEnvelope` schema (see `docs/architecture.md` §7) and normalizes it for downstream personas.

## When to use
- A new envelope arrives from `scanner-ops`.
- You must verify a signal's schema, completeness, and audit fields.

## Workflow
1. **Validate required fields** — `chain`, `dex`, `poolAddress`, `token0`, `token1`, `price`, `liquidity`, `volume24h`, `score`, `scannedAt`.
2. **Normalize** — coerce decimals, clip timestamps, attach `ingestId`.
3. **Annotate** — drop or mark `flag: "incomplete"`; never fabricate.
4. **Forward** — to `market-intel` with `status: "validated"`.

## Output
A `SignalEnvelope` with `status: validated|incomplete|drop`.
