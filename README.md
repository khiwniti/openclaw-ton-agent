# openclaw-ton-agent

Professional autonomous AI multi-agent TON trading system.

- **OpenClaw** = multi-agent orchestrator + brain (personas, skills, MCP, channels, cron).
- **ton-agent (existing)** = reused as a **read-only scanning layer** (radar, x1000 memepad,
  Ston.fi/DeDust market pollers, security audit, pool resolution).
- **@ton/mcp** = custody (agentic wallets, split owner/operator keys) + Omniston swap execution.
- **Missing layers (via deepwiki research)** get built here: explicit TP/SL point setup,
  trailing/break-even/ROI-table exits, regime & sentiment intel, backtesting/hyperopt, reporting.

## Docs
- [High-Level Architecture](docs/architecture.md) — layers, agents, skills, signals, exits, risk,
  custody, backtest, roadmap, open decisions.

## Status
**P0 done. P1 done. P2 done. P3 done. P4 (exit-manager + backtest replay harness) done.
P5 (real-data replay input + hyperopt + per-mode ledger + eval report) done — the static eval
report is the dashboard input for trader-ui; G1 still awaits a real-data backtest.**
Decisions 1–7 in §15 locked (2026-08-14). **Edge gates G1–G4 are binding** — live trading is
paused until measured expectancy is positive, and the live wallet hard-refuses until
`GATES_G1_G3_ACK=1`.

Repo layout:
- `openclaw/openclaw.json` — gateway config: 5 personas, executor-only write, A2A allowlist.
  Validate: `npm run gateway:config`.
- `workspace/<agent>/` — per-agent `SOUL.md` + `AGENTS.md` (scanner-ops, market-intel,
  risk-analyst, executor, trader-ui).
- `skills/` — 9 local `SKILL.md` skeletons; `sperax:*` skills come from ClawHub.
- `packages/shared` — contracts: SignalEnvelope (§7), `OrderRequest` hand-off, NDJSON `Journal`.
- `packages/scanner` — read-only L1 fork: TONAPI source + replay fixture source, audit,
  subtractive score, HMAC `signal-out`, pipeline (audit → score → journal → emit).
- `packages/market-intel` — regime classifier (trend/breakout via single-step jump probe),
  curve band, whale/sentiment; `annotateEnvelope` appends `meta.annotation`, never mutates core.
- `packages/risk-gates` — deterministic pre-trade gates: R:R floor, fee-coverage, Kelly sizing
  with tier ceiling + fee floor, cooldown, correlation, drawdown breaker, kill switch.
- `packages/exit-manager` — poll-based exit decisions (no native TON stops, §9): TP/SL,
  break-even at +2× fee, trailing, time-stop; snipe/swing/gamble/diamond mode configs.
- `packages/executor` — L4 hand-off: order-builder (gated envelope → `OrderRequest`), mode
  enforcement (`notify_only`/`paper`/`auto`), `PaperWallet` + guarded `TonMcpWallet`.
- `packages/backtest` — cost-aware replay harness (same code path as live: gates → pointSetup →
  exit-manager), fee drag per trade, metrics (expectancy/PF/Sharpe/maxDD) + G1 evaluation.
  Real-data input: replays the scanner journal (`data/signals-mainnet.ndjson`) against a
  per-token bar NDJSON; missing bars are synthesized and labeled as such. Hyperopt grid sweep
  (mode × volPct × rrTarget) with disjoint tune/validate seeds, per-mode win/loss ledger
  (`data/ledger-modes.ndjson`), and a self-contained eval report (`data/eval-report.html`).
  80 tests green across all packages.

## Run the scanner → gated feed → executor → backtest
```bash
cp .env.example .env
npm install
# no keys → replay fixture mode (deterministic, never executes)
npm run scanner:start
# gate every emitted envelope (deterministic; nothing trades until G1–G3):
npx tsx packages/risk-gates/src/run-gated-feed.ts --input ./data/signals-mainnet.ndjson --output ./data/gated-mainnet.ndjson
# hand gated orders to the executor (from packages/executor; mode from EXECUTION_MODE):
EXECUTION_MODE=notify_only npm --workspace packages/executor start   # surfaces → trader-ui
EXECUTION_MODE=paper npm --workspace packages/executor start          # books paper fills
# EXECUTION_MODE=auto will REFUSE until GATES_G1_G3_ACK=1 and G3 is passed
# backtest replay + G1 report (45-day synthetic demo):
npx tsx packages/backtest/src/index.ts
# hyperopt sweep → per-mode ledger + eval report (data/eval-report.html):
npx tsx packages/backtest/src/index.ts --hyperopt
# or via npm (cwd-independent):
npm run backtest:hyperopt
# replay the actual scanner journal (no bar file → synthetic prices, labeled):
npm run backtest:replay
# replay with a real per-token bar file ({tokenAddress,ts,priceTon} NDJSON per line):
npx tsx packages/backtest/src/index.ts --replay --signals data/signals-mainnet.ndjson --bars data/bars-mainnet.ndjson
# fetch real TON-denominated jetton bars from public CEX OHLC and replay them:
#   base leg TON/USD = CoinGecko (Binance TONUSDT is BREAK since ~2026-06-30),
#   quote leg = Binance klines for NOT/HMSTR/DOGS vs USDT → cross-rate into TON.
npx tsx packages/backtest/src/index.ts --fetch-bars --days 180
npx tsx packages/backtest/src/index.ts --replay --bars data/bars-mainnet.ndjson
# regime gate (only trade confirmed uptrends) + time-based Sharpe on 365d bars:
npx tsx packages/backtest/src/index.ts --fetch-bars --days 365 --out data/bars-365d.ndjson
npx tsx packages/backtest/src/index.ts --eval-real --bars data/bars-365d.ndjson --windows 16,20 --regime 60
# sweep the whole strategy grid against real bars and merge into the eval report;
# --window sweeps the signal lookback (default 24); --windows 12,16,20 sweeps several:
npx tsx packages/backtest/src/index.ts --eval-real --bars data/bars-mainnet.ndjson
npx tsx packages/backtest/src/index.ts --eval-real --bars data/bars-mainnet.ndjson --windows 12,16,20
# honest out-of-sample G1: tune 60% by time, validate the chosen config on the
# held-out 40% (real-data analog of the tune/validate seed split); --risk-isolated
# gives each token an equal sub-account (bankroll/N) instead of one shared bankroll:
npx tsx packages/backtest/src/index.ts --eval-split --bars data/bars-me.ndjson --windows 16,20
npx tsx packages/backtest/src/index.ts --eval-split --bars data/bars-365d.ndjson --windows 16,20 --regime 60 --risk-isolated
# universe construction as a gate: admit only tokens that clear in-window G1 on
# their own full bankroll, then run the portfolio on the admitted universe:
npx tsx packages/backtest/src/index.ts --admit-universe --bars data/bars-365d.ndjson --windows 16,20 --regime 60
# G2 paper-mode tracking (gate 2): replay real bars FORWARD through the same
# gated pipeline (risk gates -> point setup -> deterministic paper fill -> exit
# manager), journaling every decision to data/decision-journal.ndjson. The tail
# past the 60% tune cut is the forward-only paper slice on the held-out regime.
# Each fill is ALSO booked as an executor-format order+fill pair (paper-orders/
# paper-fills ndjson) so the G2 drift monitor can measure realized vs expected
# slippage over the accumulated paper trace:
npx tsx packages/backtest/src/index.ts --paper --bars data/bars-hmstr.ndjson --window 20 --regime 60 --mode diamond --vol 0.05 --rr 5 --skip-bars 219
# G2 drift monitor standalone (paper vs expected slippage, §12.2 gate 2): reads
# executor journals, computes realized fill slippage vs each order's allowance,
# and FAILs when a fill pays more than expected + tolerance. Paper fills realize
# exactly the quoted entry (0 slippage), so a clean paper trace always passes;
# the monitor exists to catch divergence when real fills arrive at G3.
npx tsx packages/backtest/src/index.ts --drift --orders data/paper-orders.ndjson --fills data/paper-fills.ndjson
# lot-size intelligence (P3 sizing): the engine now measures realized ATR from
# pre-entry bars and risk-targets position size — cap = bankroll × GATE_RISK_PER_TRADE_PCT / vol,
# clamped to [GATE_VOL_FLOOR_PCT, GATE_VOL_CAP_PCT]. Same --paper/--eval commands; knobs:
#   GATE_RISK_PER_TRADE_PCT=0.01  (1% of bankroll risked per trade)
#   GATE_VOL_FLOOR_PCT=0.02 GATE_VOL_CAP_PCT=0.25 GATE_ATR_PERIOD=20
# live TONAPI requires TONAPI_KEY and, to receive signals, SIGNAL_OUT_URL + secret
```

Next: **P6** — the G1 gate: real ≥30d data backtest through this same harness. The `--fetch-bars`
path now produces genuine ≥30d TON-denominated CEX cross-rate bars (`data/bars-mainnet.ndjson`,
`data/bars-365d.ndjson`). Three fixes found and landed during the hunt for a durable reading:
(1) the backtest circuit breaker now fires on EQUITY drawdown (bankroll-anchored), not the old
PnL-peak measure that never tripped; (2) the signal lookback `window` is a real grid knob
(`--windows`); (3) **a regime gate (`--regime <bars>`)** — events are only emitted when the
signal SMA is above a slower SMA, so tokens in a sustained decline generate zero events and
cannot drag down a portfolio (the principled replacement for hand-curating the universe);
(4) **time-based Sharpe** — the gate now measures annualized mean/std of DAILY account-equity
returns instead of per-trade returns, which structurally capped lumpy-momentum edges near 0.31
regardless of expectancy.

Current real-data G1 reading on the full 6-jetton universe (365d, regime-gated) is **FAIL** —
the shared-bankroll backtest sizes every token off the same 100 TON, so losing tokens' positions
dilute the winner. Per-token, the picture is honest:

- **hmstr — G1 PASS in-window.** `w20 diamond vol=0.05 rr=5..12`, regime 60:
  PF 1.7–3.0, expectancy +0.5 to +1.7 TON, time-Sharpe 0.61–0.82. The `--eval-split` honesty
  check is **INCONCLUSIVE**, not PASS: the tune half (first 60% of the year) is a decline with
  0/72 tune G1 passes (a regime-gated strategy has no tradeable tune regime there), but the
  held-out validate half carries 27/72 G1 passes — the edge is real but regime-dependent: it
  lives in the year's uptrend half, exactly what the regime gate selects for.
- me (PF 1.23) and dogs (PF 1.16) are marginal; not/cati/red lose under regime-gated momentum.
- The earlier **ME-only pass was regime-dependent and is superseded**: over the full year ME
  degrades to PF 1.23, and its only rally sits entirely in any validate tail.

The corrected narrative: the strategy has a single genuine, in-window-validated edge (hmstr,
regime-gated, time-Sharpe) whose out-of-sample status is honestly INCONCLUSIVE because the
available 365d window has no second, independent uptrend regime to validate against.

Why the 6-token portfolio still fails even with a fix in place: `--risk-isolated` was added —
each token now gets an equal sub-account (`bankroll/N`) with its own circuit breaker, the honest
way to size a multi-token universe. But isolation does NOT rescue the portfolio, and the reason
is economic, not allocational:

- The losers genuinely lose on their own sub-accounts too (not/cati/red are negative regardless
  of how capital is split) — so dropping them is universe construction, not allocation.
- Even the winner is bankroll-sensitive: hmstr clears G1 at a 100 TON bankroll (28 trades,
  PF 1.66) but collapses to fee-dominated losses at 50 TON (14 trades) and 16.67 TON (9 trades,
  every one −0.39 TON). The `totalCostTon × feeCoverageMult` floor rejects the small Kelly sizes
  a 6-way split produces, throttling the strategy to its worst signals.

So universe construction is now a first-class gate: **`--admit-universe`** runs each token's
in-window G1 grid on its own full bankroll and admits only the tokens that clear it. On 365d
regime-60 data that admits **exactly one token — hmstr** (w20 diamond vol=0.05 rr=5, exp +0.546 T,
PF 1.66, Sharpe 0.61) and excludes not/cati/red on negative expectancy and dogs/me on PF/Sharpe
thresholds. The portfolio on the admitted universe is then exactly what was measured: the hmstr
G1 pass, on a full 100 TON account.

So the G1 candidate universe is **{hmstr} on a full 100 TON account**, not a 6-token split.
Collecting more regime variety (a second independent uptrend) is required before declaring the
edge durable. A synthetic hyperopt candidate is not a G1 pass. Then paper-mode tracking (G2) and
supervised low-tier auto.

G2 paper reading on that candidate is now in place. The paper runner (`--paper`) is the *same
gated engine* with a decision-journal hook — it cannot diverge from the backtest (that's the
point: G2 requires the same code path, fills + settlement proof, not simulated prices). The
cross-checks confirm byte-identical behavior:

- Full-year paper (28 fills, +15.3 TON net) == eval-real full-year (28 trades, exp +0.546 × 28).
- Forward-only tail past the 60% tune cut (19 fills) == eval-real tail slice (19 trades,
  exp +1.428 × 19 = +27.1 TON). The held-out tail carries the regime the strategy actually
  trades — PF 3.41, time-Sharpe 2.01 on that forward slice.

So G2's honest statement today: the admitted candidate reproduces its G1 edge forward through the
same pipeline, and the G2 drift monitor passes over the accumulated paper trace (paper fills
realize exactly the quoted entry, 0 slippage, so drift is always within the 50 bps excess
tolerance) — but the "2-week paper window" is simulated by replaying real bars forward, not live
envelopes. A live 14-day paper run still requires TONAPI keys; the drift monitor's real job is
catching slippage divergence when live fills arrive at G3.

### Lot-size intelligence (P3 sizing)

Position size no longer uses the fixed 5% constant. The engine now measures **realized ATR**
(`realizedVolPct` in market-intel: mean absolute per-bar log-return over `GATE_ATR_PERIOD` bars)
from the bars *before* entry — never lookahead — and risk-targets the position so the stop
(size × vol) risks at most `GATE_RISK_PER_TRADE_PCT` (1%) of bankroll:

```
effectiveVol = max(strategy volPct floor, measured ATR clamped to [volFloor, volCap])
size         = min(kelly, tier ceiling, bankroll × riskPerTradePct / effectiveVol)
```

Both the gates and point-setup receive the same effective vol, so R:R, fee economics and the
stop distance are all consistent. High-ATR tokens get smaller positions and wider stops; calm
tokens stay tier-capped. Knobs: `GATE_RISK_PER_TRADE_PCT`, `GATE_VOL_FLOOR_PCT`,
`GATE_VOL_CAP_PCT`, `GATE_ATR_PERIOD` (all env-overridable).

Real reading after the change (hmstr, w20 diamond vol=0.05 rr=5, regime 60, 100 TON bankroll):
the 365d full-year G1 grid now passes 3 configs at PF ≥ 1.74 (top exp +0.628 T), and the G2
forward-only tail (19 fills) books **+28.1 TON net** (up from +27.1 with fixed sizing) with the
drift monitor still PASS over the accumulated paper trace. Sizing is now volatility-adaptive, so
a genuinely quiet token sizes up to the tier ceiling while a volatile one is risk-capped.
