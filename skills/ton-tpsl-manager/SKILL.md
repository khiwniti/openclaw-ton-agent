---
name: ton-tpsl-manager
description: Configure take-profit and stop-loss for a position based on ATR + volatility + tier. Also derive point-setup for snipe/swing/gamble/diamond exit modes. Use when opening or sizing a position.
---

# ton-tpsl-manager

Determines entry validation, TP/SL levels, and point-setup for a position, all fee-aware.
Code: `packages/exit-manager` (`position.ts`, `decide.ts`, `modes.ts`) + `packages/risk-gates` (`point-setup.ts`).

## Point setup (derived, not guessed)
- `stopLoss = entry − k × ATR(14)` where `k` scales with tier and exit mode.
- `takeProfit = entry + rrTarget × |entry − stopLoss|`, with `rrTarget ≥ 3` to cover the 0.1 TON round-trip fee.
- Volatility band from `spread_bps` (live reserves), not API quotes.

## Exit modes (`modes.ts`, per `ton-exit-modes`)
- `snipe` — tight, fast: BE at +2%, trailing 50% from half-way to TP, 30-min time-stop.
- `swing` — staged: BE at +2× fee, trailing 35% from 60% to TP, 6-h time-stop.
- `gamble` — loose SL, high target: BE at +5%, trailing 25% from 80%, 24-h time-stop.
- `diamond` — regime hold: BE at +10%, trailing 20% from TP, no time-stop.

## Output
`{ entryValid, stopLoss, takeProfit, rr, mode, breakEvenAt }` consumed by `ton-exit-modes`.

## Tests
`npm --workspace packages/exit-manager test`
