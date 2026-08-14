---
name: ton-settlement
description: Verify a fill by measuring on-chain balance delta against an expected amount (99% tolerance). Use after any swap to prove execution before booking PnL.
---

# ton-settlement

Port from ton-agent `sniper/settlement.ts` (kept import-free; reads `SETTLEMENT_DELTA_THRESHOLD_*` env).

## Workflow
1. Record pre-swap balance (or expected amounts) at submit time.
2. Poll post-swap balance; compare delta.
3. `|delta − expected| / expected ≤ tolerance (99%)` → `proven`; else `unproven`.
4. Unproven fills are NOT booked; they remain `pending_reconcile` and are surfaced to the operator.

## Output
`{ proven: boolean, expected, actual, tolerance, txHash }`.
