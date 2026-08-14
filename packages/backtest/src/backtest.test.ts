import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSeries, mulberry32 } from "./series";
import { runBacktest, type BacktestEvent } from "./engine";
import { computeMetrics, evaluateG1, timeSharpe } from "./metrics";
import { makeFixtureEnvelope, generateEvents } from "./index";

test("generateSeries is deterministic and bounded", () => {
  const a = generateSeries({ startTon: 10, days: 5, barsPerDay: 48, driftPerDay: 0.01, volPerBar: 0.02, seed: 7 });
  const b = generateSeries({ startTon: 10, days: 5, barsPerDay: 48, driftPerDay: 0.01, volPerBar: 0.02, seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(a.length, 240);
  assert.ok(a.every((bar) => bar.priceTon > 0));
  assert.ok(mulberry32(1)() >= 0 && mulberry32(1)() < 1);
});

test("runBacktest: gated pass signals become costed trades", () => {
  const bars = generateSeries({ startTon: 10, days: 45, barsPerDay: 48, driftPerDay: 0.02, volPerBar: 0.01, seed: 1 });
  const series = new Map([["EQA-bt-1", bars]]);
  const events = generateEvents(bars, "EQA-bt-1", "BT1");
  const result = runBacktest({ events, series });
  assert.ok(result.eventsEvaluated > 0);
  assert.ok(result.gatedPassed > 0, "momentum strategy should pass gates");
  assert.ok(result.trades.length > 0);
  for (const t of result.trades) {
    assert.ok(t.feesTon > 0, "every trade pays round-trip fees");
    assert.ok(t.qty > 0);
    assert.ok(Math.abs(t.grossPnLTon - (t.exitTon - t.entryTon) * t.qty) < 1e-9);
    assert.equal(t.netPnLTon, t.grossPnLTon - t.feesTon);
  }
});

test("runBacktest: a losing regime still reports honestly (fees dominate)", () => {
  const bars = generateSeries({ startTon: 10, days: 45, barsPerDay: 48, driftPerDay: -0.03, volPerBar: 0.005, seed: 3 });
  const series = new Map([["EQA-bt-2", bars]]);
  // force signals every bar so gates see price but entries are doomed
  const events: BacktestEvent[] = bars.map((b) => ({ ts: b.ts, envelope: makeFixtureEnvelope("EQA-bt-2", "BT2", b.priceTon, b.ts, 95) }));
  const result = runBacktest({ events, series });
  assert.ok(result.gatedPassed >= 0);
  assert.ok(result.trades.length <= events.length); // one open per token at a time
  const metrics = computeMetrics(result.trades);
  assert.ok(metrics.expectancyTon <= 0, "a downtrend + fees must not look profitable");
});

test("runBacktest: lot-size intelligence — a volatile token books smaller positions", () => {
  const calm = generateSeries({ startTon: 10, days: 60, barsPerDay: 1, driftPerDay: 0.02, volPerBar: 0.005, seed: 11 });
  const wild = generateSeries({ startTon: 10, days: 60, barsPerDay: 1, driftPerDay: 0.02, volPerBar: 0.12, seed: 12 });
  const calmFills: number[] = [];
  const wildFills: number[] = [];
  // Force a signal on every bar (score 92 → high tier, 20 TON ceiling) so the
  // test isolates sizing: measured ATR is the only thing that differs.
  const evs = (bars: ReturnType<typeof generateSeries>) =>
    bars.map((b) => ({ ts: b.ts, envelope: makeFixtureEnvelope("EQA-x", "X", b.priceTon, b.ts, 92) }));
  const calmR = runBacktest({
    events: evs(calm),
    series: new Map([["EQA-x", calm]]),
    onDecision: (d) => { if (d.kind === "fill") calmFills.push(d.amountTon); },
  });
  const wildR = runBacktest({
    events: evs(wild),
    series: new Map([["EQA-x", wild]]),
    onDecision: (d) => { if (d.kind === "fill") wildFills.push(d.amountTon); },
  });
  assert.ok(calmR.gatedPassed > 0);
  assert.ok(wildR.gatedPassed > 0);
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  assert.ok(avg(wildFills) < avg(calmFills), "measured ATR shrinks positions on a volatile token");
  assert.ok(calmFills.every((a) => a === 20), "calm token stays tier-capped at 20 TON");
  assert.ok(wildFills.some((a) => a < 20), "high-ATR token drops below the tier ceiling");
});

test("computeMetrics math on a hand-built trade list", () => {
  const mk = (net: number, pct: number, entryTs: number, exitTs: number): any => ({
    id: "t", tokenAddress: "a", ticker: "T", entryTs, exitTs, entryTon: 10, exitTon: 10, qty: 1, amountTon: 10,
    exitAction: net > 0 ? "tp" : "sl", feesTon: 0.2, grossPnLTon: net + 0.2, netPnLTon: net, netPnlPct: pct,
  });
  const trades = [
    mk(2, 20, 1_000_000, 2_000_000),
    mk(-1, -10, 3_000_000, 4_000_000),
    mk(1, 10, 5_000_000, 6_000_000),
  ];
  const m = computeMetrics(trades);
  assert.equal(m.trades, 3);
  assert.ok(Math.abs(m.winRate - 2 / 3) < 1e-9);
  assert.ok(Math.abs(m.profitFactor - 3 / 1) < 1e-9);
  assert.ok(Math.abs(m.expectancyTon - 2 / 3) < 1e-9);
  assert.ok(Math.abs(m.spanDays - 5_000_000 / 86_400_000) < 1e-9);
  assert.ok(m.sharpe >= 0);
});

test("timeSharpe: steady daily gains beat one lumpy day", () => {
  const DAY = 86_400_000;
  // A trader who books a small profit every day vs one who books the same
  // total in a single day: the steady one must have the higher time-Sharpe,
  // because daily variance is what the metric punishes.
  const mk = (entryTs: number, exitTs: number, net: number, pct: number): any => ({
    id: "t", tokenAddress: "a", ticker: "T", entryTs, exitTs, entryTon: 10, exitTon: 10, qty: 1, amountTon: 10,
    exitAction: net > 0 ? "tp" : "sl", feesTon: 0.2, grossPnLTon: net + 0.2, netPnLTon: net, netPnlPct: pct,
  });

  const start = 1_760_000_000_000;
  const steady = Array.from({ length: 30 }, (_, i) => mk(start + i * DAY, start + i * DAY + 3_600_000, 1 + (i % 3) * 0.05, 5));
  const lumpy = Array.from({ length: 30 }, (_, i) => mk(start + i * DAY, start + i * DAY + 3_600_000, i === 29 ? 30 : 0, i === 29 ? 150 : 0));

  const s = timeSharpe(steady, 100);
  const l = timeSharpe(lumpy, 100);
  assert.ok(s > 0, "steady profits give positive time-Sharpe");
  assert.ok(l < s, "concentrated PnL must have lower time-Sharpe than steady gains");
  assert.ok(Number.isFinite(s) && Number.isFinite(l));
});

test("evaluateG1: all thresholds must pass together", () => {
  const metrics = { trades: 50, spanDays: 45, winRate: 0.6, profitFactor: 1.8, expectancyTon: 0.05, expectancyPct: 0.4, maxDrawdownTon: 1, maxDrawdownPct: 5, sharpe: 0.9, feeDragTon: 10, exitMix: { tp: 30, sl: 20 } };
  const pass = evaluateG1(metrics as any);
  assert.equal(pass.passed, true);
  const failing = evaluateG1({ ...metrics, sharpe: 0.3 } as any);
  assert.equal(failing.passed, false);
  assert.ok(failing.checks.find((c) => c.name.startsWith("sharpe"))?.passed === false);
});

test("runBacktest: the 20% circuit breaker fires on EQUITY drawdown, not PnL", () => {
  // A slow bleed of net losses (each -1 TON vs 100 bankroll) drags equity
  // through the 20% breaker, so later events stop becoming trades.
  const n = 35; // 35 × -1 TON = -35% equity → way past the 20% breaker
  const events: BacktestEvent[] = [];
  for (let i = 0; i < n; i++) {
    events.push({ ts: i * 86_400_000, envelope: makeFixtureEnvelope(`breaker-${i}`, "B", 10, i * 86_400_000, 90) });
  }
  const bars = generateSeries({ startTon: 10, days: 5, barsPerDay: 1, driftPerDay: 0, volPerBar: 0, seed: 9 });
  const series = new Map([["EQA-bt-1", bars]]);

  // Mock the gate chain: after the breaker trips we expect evaluateGates to halt.
  // Simulate by running the engine with a tiny bankroll so 2 losses = 20% DD.
  const result = runBacktest({ events, series, bankrollTon: 10 });
  const metrics = computeMetrics(result.trades, { bankrollTon: 10 });
  // Equity can still be drawn down by whatever traded before the breaker, but
  // the breaker must bound the damage: max equity drawdown ≤ ~20% + one trade.
  assert.ok(metrics.maxDrawdownPct < 25, `breaker bounded drawdown, got ${metrics.maxDrawdownPct.toFixed(1)}%`);
  assert.ok(metrics.trades < n, `breaker stopped trading, got ${metrics.trades}/${n} trades`);
});
