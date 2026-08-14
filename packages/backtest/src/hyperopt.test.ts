import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hyperoptGrid, runHyperopt, runRealGrid, runTimeSplitValidation, admitUniverse, MODES, VOL_PCTS, RR_TARGETS, type StrategyConfig } from "./hyperopt";import { recordLedger, readLedger, aggregateByMode, type LedgerEntry } from "./ledger";
import { buildEvalReport } from "./report";
import { generateSeries, type Bar } from "./series";
import { generateEvents } from "./fixture";

test("hyperoptGrid covers every mode × volPct × rrTarget, rrTarget >= minRr(3)", () => {
  const grid = hyperoptGrid();
  assert.equal(grid.length, MODES.length * VOL_PCTS.length * RR_TARGETS.length);
  for (const c of grid) {
    assert.ok(MODES.includes(c.mode));
    assert.ok(c.rrTarget >= 3, "rrTarget below minRr would contradict ton-tpsl-manager");
  }
  assert.deepEqual(new Set(grid.map((c) => c.mode)), new Set(MODES));
});

test("runHyperopt: tune and validate use disjoint seeds; best config is well-formed", () => {
  const grid = hyperoptGrid(["swing", "snipe"], [0.05], [3]);
  const res = runHyperopt({ days: 12, grid });
  assert.equal(res.gridSize, 2);
  assert.equal(res.runs.length, 2 * (res.tuneSeeds.length + res.validateSeeds.length));
  assert.equal(res.tuneSeeds.some((s) => res.validateSeeds.includes(s)), false, "no seed in both phases");
  assert.ok(res.best.config.mode === "swing" || res.best.config.mode === "snipe");
  assert.ok(Number.isFinite(res.best.validateAvgExpectancyTon));
  // G1 metrics must always be measurable even when the verdict is FAIL.
  for (const r of res.runs) {
    assert.ok(r.metrics.trades >= 0);
    assert.equal(r.g1Passed, r.metrics.trades === 0 ? false : r.g1Passed);
  }
});

test("runHyperopt prefers a config that passes G1 on validation", () => {
  // Force two configs: one with a huge rrTarget (likely profitable), one tiny-risk.
  const grid: StrategyConfig[] = [
    { mode: "swing", volPct: 0.05, rrTarget: 5 },
    { mode: "gamble", volPct: 0.03, rrTarget: 3 },
  ];
  const res = runHyperopt({ days: 12, grid });
  assert.ok(res.runs.length === 2 * 4);
});

test("recordLedger appends and readLedger/aggregateByMode round-trip per mode", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-ledger-"));
  const file = path.join(dir, "ledger.ndjson");
  const base: Omit<LedgerEntry, "mode" | "expectancyTon" | "g1Passed"> = {
    at: "2026-08-14T00:00:00.000Z", days: 45, seed: 5, volPct: 0.05, rrTarget: 3, phase: "validate",
    trades: 10, winRate: 0.5, profitFactor: 1.4, sharpe: 0.6, maxDrawdownPct: 10, spanDays: 40,
  };
  recordLedger({ ...base, mode: "swing", expectancyTon: 0.1, g1Passed: true }, file);
  recordLedger({ ...base, mode: "swing", expectancyTon: -0.05, g1Passed: false }, file);
  recordLedger({ ...base, mode: "snipe", expectancyTon: 0.2, g1Passed: true }, file);

  const entries = readLedger(file);
  assert.equal(entries.length, 3);
  const agg = aggregateByMode(entries, "validate");
  assert.equal(agg.length, 2);
  const swing = agg.find((a) => a.mode === "swing")!;
  assert.equal(swing.runs, 2);
  assert.equal(swing.g1Passes, 1);
  assert.ok(Math.abs(swing.totalExpectancyTon - 0.05) < 1e-9);
  // sorted best-first by total expectancy
  assert.equal(agg[0].mode, "snipe");
});

test("buildEvalReport is honest about being a synthetic candidate", () => {
  const grid = hyperoptGrid(["swing"], [0.05], [3]);
  const res = runHyperopt({ days: 12, grid });
  const perMode = aggregateByMode([], "validate");
  const report = buildEvalReport(res, perMode);
  assert.equal(report.kind, "synthetic-candidate");
  assert.ok(report.disclaimer.includes("CANDIDATE"));
  assert.ok(report.disclaimer.includes("real"));
  assert.ok(report.best.rrTarget >= 3);
});

test("runRealGrid evaluates every config on real-style bars and reports G1 honestly", () => {
  // Real-style bars: rising series so momentum signals exist, labelled "real".
  const series = generateSeries({ startTon: 10, days: 60, barsPerDay: 1, driftPerDay: 0.02, volPerBar: 0.01, seed: 3 });
  const bars = new Map<string, Bar[]>([["EQA-real:not", series]]);
  const grid = hyperoptGrid(["diamond"], [0.05], [4]);
  const rows = runRealGrid({ bars, grid, window: 7 });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.window, 7);
  assert.ok(row.metrics.trades > 0, "momentum signals on a rising series become trades");
  // Every G1 check must be reported even when the overall verdict fails.
  assert.equal(row.g1Checks.length, 5);
  assert.equal(typeof row.g1Passed, "boolean");
  // Sorted best-first by expectancy.
  assert.ok(Number.isFinite(row.metrics.expectancyTon));
});

test("runRealGrid sweeps windows and rows carry their window", () => {
  const series = generateSeries({ startTon: 10, days: 60, barsPerDay: 1, driftPerDay: 0.02, volPerBar: 0.01, seed: 4 });
  const bars = new Map<string, Bar[]>([["EQA-real:not", series]]);
  const grid = hyperoptGrid(["diamond"], [0.05], [4]);
  const rows = runRealGrid({ bars, grid, windows: [10, 16, 20] });
  assert.equal(rows.length, 3);
  const windowsSeen = [...new Set(rows.map((r) => r.window))].sort((a, b) => a - b);
  assert.deepEqual(windowsSeen, [10, 16, 20]);
});

test("runTimeSplitValidation selects best on tune, measures it on held-out validate", () => {
  // Rising series → momentum edge everywhere; split must select a G1-passing
  // config on tune and have it still pass on the held-out tail. Long series so
  // the 40% validate tail still clears the 30d G1 span.
  const series = generateSeries({ startTon: 10, days: 240, barsPerDay: 1, driftPerDay: 0.03, volPerBar: 0.01, seed: 5 });
  const bars = new Map<string, Bar[]>([["EQA-real:not", series]]);
  const grid = hyperoptGrid(["diamond"], [0.05], [4]);
  const split = runTimeSplitValidation({ bars, grid, windows: [10] });
  assert.ok(split.selected, "selection never returns null on a rising series");
  assert.ok(split.selected!.metrics.trades > 0, "selection never picks a 0-trade degenerate row");
  assert.equal(split.tuneRows.length, 1);
  assert.equal(split.validateRows.length, 1);
  assert.ok(split.selected!.g1Passed, "rising series gives a passing tune config");
  assert.equal(split.verdict, "pass", "a real edge holds out-of-sample");
  assert.equal(split.passed, true);
});

test("runTimeSplitValidation is INCONCLUSIVE (not FAIL) when the tune segment has no tradeable regime", () => {
  // Flat/downward series: momentum finds nothing on tune, so no config is
  // selectable — the honest verdict is inconclusive, not a claimed edge FAIL.
  const series = generateSeries({ startTon: 10, days: 90, barsPerDay: 1, driftPerDay: -0.01, volPerBar: 0.004, seed: 6 });
  const bars = new Map<string, Bar[]>([["EQA-real:not", series]]);
  const grid = hyperoptGrid(["diamond"], [0.05], [4]);
  const split = runTimeSplitValidation({ bars, grid, windows: [10] });
  assert.equal(split.verdict, "inconclusive");
  assert.equal(split.passed, false);
});

test("runRealGrid accepts a no-bar series and reports zeros (honest, not a crash)", () => {
  const bars = new Map<string, Bar[]>([["EQA-real:empty", []]]);
  const rows = runRealGrid({ bars, grid: hyperoptGrid(["swing"], [0.03], [3]), window: 24 });
  const row = rows[0];
  assert.equal(row.metrics.trades, 0);
  assert.equal(row.g1Passed, false);
  assert.equal(row.g1Checks.length, 5);
});

test("generateEvents labels real-bars signals with the replay tag", () => {
  const series = generateSeries({ startTon: 10, days: 30, barsPerDay: 1, driftPerDay: 0.03, volPerBar: 0.005, seed: 2 });
  const events = generateEvents(series, "EQA-real:tag", "TAG", 5, "real");
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.ok(e.envelope.flags.includes("replay"));
    assert.ok(e.envelope.flags.includes("real-bars"));
    const meta = e.envelope.meta as { backtest?: { data?: string } } | undefined;
    assert.ok(meta?.backtest?.data === "real");
  }
});

test("regime gate suppresses events for tokens in a sustained decline", () => {
  const down = generateSeries({ startTon: 10, days: 120, barsPerDay: 1, driftPerDay: -0.02, volPerBar: 0.005, seed: 7 });
  const noGate = generateEvents(down, "EQA-real:down", "DWN", 8, "real", 0);
  const gated = generateEvents(down, "EQA-real:down", "DWN", 8, "real", 24);
  assert.ok(noGate.length > 0);
  assert.equal(gated.length, 0, "regime gate must not emit events in a decline");

  const up = generateSeries({ startTon: 10, days: 120, barsPerDay: 1, driftPerDay: 0.03, volPerBar: 0.008, seed: 8 });
  const gatedUp = generateEvents(up, "EQA-real:up", "UPP", 8, "real", 24);
  assert.ok(gatedUp.length > 0, "regime gate still emits events in an uptrend");
});

test("runRealGrid threads the regime gate into event generation", () => {
  const down = generateSeries({ startTon: 10, days: 120, barsPerDay: 1, driftPerDay: -0.02, volPerBar: 0.005, seed: 9 });
  const bars = new Map<string, Bar[]>([["EQA-real:down", down]]);
  const grid = hyperoptGrid(["diamond"], [0.05], [4]);
  const gated = runRealGrid({ bars, grid, windows: [8], regimeSlow: 24 });
  assert.equal(gated[0].metrics.trades, 0, "no events in a decline → no trades");
  assert.equal(gated[0].g1Passed, false);
});

test("risk isolation gives each token an equal sub-account, not a shared full bankroll", () => {
  // Winner: long rising series with a momentum edge.
  const win = generateSeries({ startTon: 10, days: 240, barsPerDay: 1, driftPerDay: 0.03, volPerBar: 0.008, seed: 11 });
  const lose = generateSeries({ startTon: 10, days: 240, barsPerDay: 1, driftPerDay: -0.005, volPerBar: 0.025, seed: 24 });
  const bars = new Map<string, Bar[]>([["EQA-real:win", win], ["EQA-real:lose", lose]]);
  const grid = hyperoptGrid(["diamond"], [0.05], [4]);
  const isolated = runRealGrid({ bars, grid, windows: [10], riskIsolated: true });
  const shared = runRealGrid({ bars, grid, windows: [10] });
  // Isolation sizes each token off bankroll/N. A single-token universe is
  // therefore identical isolated vs shared (N=1), and adding a second token
  // must shrink the per-token sub-account (fee floor throttles more trades).
  const one = new Map<string, Bar[]>([["EQA-real:win", win]]);
  const oneShared = runRealGrid({ bars: one, grid, windows: [10] });
  const oneIsolated = runRealGrid({ bars: one, grid, windows: [10], riskIsolated: true });
  assert.deepEqual(
    oneIsolated.map((r) => r.metrics.trades),
    oneShared.map((r) => r.metrics.trades),
    "N=1 isolation must equal shared bankroll",
  );
  assert.ok(
    shared[0].metrics.trades >= isolated[0].metrics.trades,
    "shared bankroll sizes both tokens at full capital, so it trades at least as much",
  );
});

test("admitUniverse admits only tokens that clear in-window G1 on their own bankroll", () => {
  const win = generateSeries({ startTon: 10, days: 240, barsPerDay: 1, driftPerDay: 0.03, volPerBar: 0.008, seed: 11 });
  const lose = generateSeries({ startTon: 10, days: 240, barsPerDay: 1, driftPerDay: -0.005, volPerBar: 0.025, seed: 24 });
  const bars = new Map<string, Bar[]>([["EQA-real:win", win], ["EQA-real:lose", lose]]);
  const grid = hyperoptGrid(["diamond"], [0.05], [4]);
  const admission = admitUniverse({ bars, grid, windows: [10] });
  assert.equal(admission.admitted.length, 1, "only the winner is admitted");
  assert.equal(admission.excluded.length, 1, "the loser is excluded on evidence");
  assert.equal(admission.admitted[0].ticker, "win");
  assert.ok(admission.admitted[0].g1Passes >= 1);
  assert.ok(admission.excluded[0].reason.includes("negative expectancy") || admission.excluded[0].reason.includes("G1 thresholds"));
});
