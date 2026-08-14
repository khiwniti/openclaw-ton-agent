# Codebase Concerns

**Analysis Date:** 2026-08-14

## Tech Debt

**Backtest data honesty gap (CEX vs DEX):**
- Issue: Backtest prices come from CEX sources (CoinGecko base leg, Binance quote leg) while the engine will execute on TON DEXes (Ston.fi/Dedust). `packages/backtest/src/fetch.ts` (lines 19-20) labels runs as `cex-cross-rate` data, but downstream consumers treat these prices as ground truth.
- Files: `packages/backtest/src/fetch.ts` (19-20), `packages/backtest/src/drift.ts`
- Impact: Measured expectancy and drift metrics may not reflect real execution prices, which directly feeds the G1 gate decision.
- Fix approach: Keep the cex-cross-rate labeling, but treat `driftBps` as an upper-bound error model; validate against real DEX fills before any live un-pause; add a DEX fills capture path.

**G1 gate unvalidated:**
- Issue: README marks P0-P5 "done" and states "G1 still awaits a real-data backtest" — the positive-expectancy gate that live trading is paused on has never been measured with real data.
- Files: `README.md`, `packages/backtest/src/index.ts` (280, 436-440), `packages/backtest/src/report.ts` (51)
- Impact: "Done" markers can be misread as ready-for-live; the safety-critical gate has no empirical basis yet.
- Fix approach: Run a backtest on real DEX fills before un-pausing live; annotate README P0-P5 items with "backtest-only" scope so they are not read as live-ready.

**`GATES_G1_G3_ACK` env override:**
- Issue: Live wallet "hard-refuses" until `GATES_G1_G3_ACK=1` is set. An environment variable can override a safety gate, which invites misconfiguration bypass.
- Files: `README.md`, `workspace/executor/AGENTS.md`
- Impact: If the flag is set casually, edge gates G1/G3 lose their binding force.
- Fix approach: Keep gates authoritative in code; make the ACK flag acknowledge current status only, never bypass checks; log prominently when set.

## Known Bugs

**No persisted replay data:**
- Issue: `writeBarsNdjson` in `packages/backtest/src/fetch.ts` (207-214) writes replay NDJSON, but no `data/*.ndjson` files exist in the repo.
- Files: `packages/backtest/src/fetch.ts`, `data/` (empty of ndjson)
- Trigger: A run that relies on replay data for eval reproducibility will have nothing pinned.
- Workaround: None; runs regenerate data at execution time.

## Security Considerations

**No secrets handling issues found:**
- Risk: None identified in scanned code. `fetch.ts` uses no API keys; token pairs are hardcoded symbol strings.
- Files: `packages/backtest/src/fetch.ts`
- Current mitigation: No credential-bearing code paths detected in the backtest package.
- Recommendations: Ensure `.env`/`GATES_G1_G3_ACK` values are never logged or committed.

## Performance Bottlenecks

**None significant identified:**
- Problem: The backtest pipeline is single-threaded and synchronous (`packages/backtest/src/fetch.ts` uses `await` sequences), but data volumes are small (daily bars), so this is not a current bottleneck.
- Files: `packages/backtest/src/fetch.ts`
- Improvement path: Parallelize per-pair fetches if symbol count grows; cache historical bars across runs.

## Fragile Areas

**Binance BREAK status → single-source base leg:**
- Files: `packages/backtest/src/fetch.ts` (header + `fetchKlines` fallback)
- Why fragile: As of 2026-08, all Binance TON pairs (TONUSDT, TONUSDC, TONBTC) are in BREAK status and klines stop at 2026-06-30. The CoinGecko base leg is the only live source; if it fails, the fallback is a halted Binance source.
- Safe modification: Add a second independent base-leg source; alert when CoinGecko fails and fallback becomes the sole source; cache historical bars.
- Test coverage: Gaps — no tests for CoinGecko failure fallback behavior or BREAK-status handling.

**CoinGecko 1h→daily resample semantics:**
- Files: `packages/backtest/src/fetch.ts` (151-172)
- Why fragile: 1h CoinGecko data is resampled to daily 00:00 UTC bars (`cgDays` clamps to 90, `1d → max(days,2)`). Timestamp semantics are implicit and not asserted.
- Safe modification: Document the resample rule; assert 00:00 UTC timestamps; store the raw 1h series for auditability.

**`crossRates` silent skips:**
- Files: `packages/backtest/src/fetch.ts` (175-186)
- Why fragile: Missing or ≤0 jetton prices (NOT/HMSTR/DOGS) are silently skipped via `tonByOpen` Map alignment with `Number.isFinite` guard — data gaps produce shorter series without warnings.
- Safe modification: Log skip counts; fail loudly when skip rate exceeds a threshold.

## Scaling Limits

**Backtest input scale:**
- Current capacity: Daily-bar backtests with a handful of jettons; `hyperopt.test.ts` runs verdict assertions on synthetic fills.
- Limit: No streaming/live-fill ingestion; `runDriftMonitor` in `packages/backtest/src/index.ts` (279, 433) is fed from `ordersFile`/`fillsFile` only.
- Scaling path: Add live fill capture (DEX indexers) to close the G1 real-data gap.

## Dependencies at Risk

**Binance market data (halting):**
- Risk: TON pairs in BREAK status — data stops at 2026-06-30.
- Impact: Quote-leg (jetton) and fallback base-leg data go stale.
- Migration plan: Adopt a DEX-based price source (Ston.fi/Dedust API) as primary; keep Binance/CoinGecko as cross-check only.

## Missing Critical Features

**Real DEX execution data:**
- Problem: No DEX fill capture exists; G1 (positive expectancy) cannot be measured honestly with current CEX-derived data.
- Blocks: The stated safety gate "live trading is paused until measured expectancy is positive" cannot be satisfied.

## Test Coverage Gaps

**Data-pipeline failure paths:**
- What's not tested: CoinGecko fetch failure → Binance fallback; BREAK-status klines; `crossRates` alignment with missing jetton data.
- Files: `packages/backtest/src/fetch.ts`, `packages/backtest/src/hyperopt.test.ts`
- Risk: Pipeline silently degrades (shorter series, fallback data) without tripping the drift/expectancy gates.
- Priority: Medium

---

*Concerns audit: 2026-08-14*
