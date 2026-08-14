---
name: ton-exit-modes
description: Select and operate exit modes (snipe/swing/gamble/diamond) with staged TP, trailing, break-even, and time-stop. Use when managing an open position's exit policy.
---

# ton-exit-modes

Because TON has no native stop orders, ALL exits are off-chain poll-based (10s loop). See `docs/architecture.md` §9.
Code: `packages/exit-manager` — `stepPosition(pos, priceTon, now)` is a pure per-tick decision.

## Modes
- **snipe** — fast in/out; trailing TP, tight SL, hard time-stop.
- **swing** — staged TP (50/30/20), trailing stop, break-even at +2× fee.
- **gamble** — loose SL, high target, small size (tier floor).
- **diamond** — hold for regime; trailing only; no time-stop.

## Rules (`decide.ts`)
- The effective protective stop is the TIGHTER of break-even and trailing
  (`max(breakEven, trailingStop)`), so trailing is reachable, not dead code.
- Exit precedence when levels cross: break-even/trail (tightest) → take-profit →
  stop-loss → time-stop.
- Every exit checks `minOut` from live reserves; never market-dump without a check.
- Bounced/unknown fills → `pending_reconcile`, never assume exit success.

## Output
`{ action: hold|tp|sl|trail|break_even|time_stop, exitPriceTon, pos }` per poll.

## Tests
`npm --workspace packages/exit-manager test`
