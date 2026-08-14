---
name: ton-reporting
description: Produce PnL, expectancy, win-rate and drift reports (per exit mode and per tier) from the journal. Use for /profit, /status, weekly reporting, and gate evaluation.
---

# ton-reporting

Honest measurement layer. Feeds G1–G4 gates (`docs/architecture.md` §12).

## Reports
- **Expectancy** — `E = Σ(win·prob) − Σ(loss·prob)` over rolling 7-day window.
- **Per-mode ledger** — win rate / payoff by exit mode → drives `score_to_mode` selection.
- **Drift monitor** — paper fills vs expected slippage; drift outside tolerance halts progression.
- **Break-even check** — min position size so a winner covers `2 × fee`; surface when violated.

## Gate hooks
- G1 backtest, G2 paper, G3 live-demo, G4 kill are all evaluated from these numbers.

## Output
`{ expectancy, profitFactor, sharpe, winRate, driftBps, verdict }` → `trader-ui` / dashboard.
