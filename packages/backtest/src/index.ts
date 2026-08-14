/**
 * Backtest — minimal replay harness (decision §15.4). CLI runs a deterministic
 * 45-day synthetic demo through the full stack: signal → risk gates → point
 * setup → exit-manager → G1 report.
 *
 *   npx tsx packages/backtest/src/index.ts [--seed 42] [--days 45] [--mode swing]
 *   npx tsx packages/backtest/src/index.ts --hyperopt          # sweep + ledger + eval report
 *   npx tsx packages/backtest/src/index.ts --fetch-bars [--jettons not,hmstr,dogs] [--days 45] [--interval 1d] [--out data/bars-mainnet.ndjson]
 *   npx tsx packages/backtest/src/index.ts --replay [--bars data/bars-mainnet.ndjson] [--mode swing]
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { generateSeries, type Bar } from "./series";
import { runBacktest } from "./engine";
import { computeMetrics, evaluateG1 } from "./metrics";
import { generateEvents } from "./fixture";
import { runHyperopt, runRealGrid, runTimeSplitValidation, admitUniverse, type StrategyConfig } from "./hyperopt";
import { runPaper } from "./paper";
import { runDriftMonitor } from "./drift";
import type { BacktestMetrics } from "./metrics";
import { recordLedger, readLedger, aggregateByMode } from "./ledger";
import { buildEvalReport, writeEvalReport, type EvalReport } from "./report";
import { replayFromFiles, replayFromBars, loadBars } from "./replay";
import { fetchTonJettonsBars, writeBarsNdjson, DEFAULT_JETTONS } from "./fetch";

export { generateSeries, mulberry32, smaAt } from "./series";
export type { Bar, SeriesOptions } from "./series";
export { runBacktest } from "./engine";
export type { BacktestEvent, BacktestResult, RunBacktestOptions, Trade, EngineDecision } from "./engine";
export { computeMetrics, evaluateG1, timeSharpe } from "./metrics";
export type { BacktestMetrics, G1Check, G1Verdict } from "./metrics";
export { makeFixtureEnvelope, generateEvents } from "./fixture";
export type { FixtureEvent } from "./fixture";
export { runHyperopt, hyperoptGrid, MODES, VOL_PCTS, RR_TARGETS, TUNE_SEEDS, VALIDATE_SEEDS, runRealGrid, runTimeSplitValidation, admitUniverse } from "./hyperopt";export type { HyperoptResult, HyperoptRun, StrategyConfig, RealGridRun, TimeSplitResult, UniverseAdmission, AdmittedToken } from "./hyperopt";
export { runPaper } from "./paper";
export type { PaperOptions, PaperResult } from "./paper";
export { runDriftMonitor, realizedSlippageBps } from "./drift";
export type { DriftOptions, DriftResult, DriftFill, PaperFillRecord } from "./drift";
export { recordLedger, readLedger, aggregateByMode } from "./ledger";
export type { LedgerEntry, ModeAggregate } from "./ledger";
export { buildEvalReport, writeEvalReport } from "./report";
export type { EvalReport } from "./report";
export { replayFromFiles, loadReplayInput, loadSignals, loadBars, exportBarsToNdjson, replayFromBars } from "./replay";
export type { ReplayInput, ReplayOptions, ReplayOutcome, ReplayBar, ReplayBarsOptions } from "./replay";
export { fetchTonJettonsBars, fetchKlines, parseBinanceKlines, crossRates, writeBarsNdjson, DEFAULT_JETTONS, fetchTonUsdBars, parseCoinGeckoPrices, resampleDaily, resampleTo, barsPerDayFor, intervalMsFor } from "./fetch";
export type { Kline, PricePoint } from "./fetch";

/** Default output dir: repo-root ./data regardless of cwd. */
export function defaultDataDir(): string {
  return path.resolve(__dirname, "../../../data");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function runDemo(opts: { days?: number; seed?: number; mode?: "snipe" | "swing" | "gamble" | "diamond" }) {
  const days = opts.days ?? 45;
  const seed = opts.seed ?? 5;
  const mode = opts.mode ?? "swing";
  const bars = generateSeries({ startTon: 10, days, barsPerDay: 48, driftPerDay: 0.01, volPerBar: 0.015, seed });
  const series = new Map<string, typeof bars>([["EQA-bt-fixture", bars]]);
  const events = generateEvents(bars, "EQA-bt-fixture", "BT-1");
  const result = runBacktest({ events, series, mode });
  const metrics = computeMetrics(result.trades);
  const g1 = evaluateG1(metrics);

  const line = (name: string, v: number, t: number, ok: boolean) => `${ok ? "PASS" : "FAIL"}  ${name.padEnd(24)} ${fmt(v)}  (need ${fmt(t)})`;
  console.log(`=== Backtest replay (${days}d, seed ${seed}, mode ${mode}) ===`);
  console.log(`events=${result.eventsEvaluated} gatedPass=${result.gatedPassed} trades=${metrics.trades}`);
  console.log(`spanDays=${metrics.spanDays.toFixed(1)} winRate=${(metrics.winRate * 100).toFixed(1)}% PF=${fmt(metrics.profitFactor)}`);
  console.log(`expectancy=${fmt(metrics.expectancyTon)} TON (${metrics.expectancyPct.toFixed(2)}%) sharpe=${metrics.sharpe.toFixed(3)}`);
  console.log(`maxDD=${metrics.maxDrawdownTon.toFixed(2)} TON (${metrics.maxDrawdownPct.toFixed(1)}%) feeDrag=${metrics.feeDragTon.toFixed(2)} TON`);
  console.log(`exits: ${Object.entries(metrics.exitMix).map(([k, v]) => `${k}(${v})`).join(" ")}`);
  console.log("--- G1 gate ---");
  for (const c of g1.checks) console.log(line(c.name, c.value, c.threshold, c.passed));
  console.log(`=== G1 verdict: ${g1.passed ? "PASS — edge measured positive" : "FAIL — not profitable enough yet"} ===`);
  return { result, metrics, g1 };
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "0";
  return v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toFixed(5);
}

export function runHyperoptCli(opts: { days?: number; out?: string } = {}) {
  const days = opts.days ?? 45;
  const outDir = opts.out ?? defaultDataDir();
  const ledgerFile = path.join(outDir, "ledger-modes.ndjson");
  const jsonPath = path.join(outDir, "eval-report.json");
  const htmlPath = path.join(outDir, "eval-report.html");

  const result = runHyperopt({ days });
  const now = new Date().toISOString();
  for (const r of result.runs) {
    recordLedger(
      {
        at: now,
        days,
        seed: r.seed,
        mode: r.config.mode,
        volPct: r.config.volPct,
        rrTarget: r.config.rrTarget,
        phase: r.phase,
        trades: r.metrics.trades,
        winRate: r.metrics.winRate,
        expectancyTon: r.metrics.expectancyTon,
        profitFactor: r.metrics.profitFactor,
        sharpe: r.metrics.sharpe,
        maxDrawdownPct: r.metrics.maxDrawdownPct,
        spanDays: r.metrics.spanDays,
        g1Passed: r.g1Passed,
      },
      ledgerFile,
    );
  }
  const perMode = aggregateByMode(readLedger(ledgerFile), "validate");
  const report = buildEvalReport(result, perMode);
  writeEvalReport(report, jsonPath, htmlPath);

  const b = report.best;
  const c = result.best.config;
  console.log(`=== Hyperopt (${result.gridSize} configs, ${days}d, tune=${result.tuneSeeds.join(",")} validate=${result.validateSeeds.join(",")}) ===`);
  console.log(`best: mode=${c.mode} volPct=${c.volPct} rrTarget=${c.rrTarget}`);
  console.log(`  tune G1: ${b.tuneG1Passes}/${result.tuneSeeds.length}   validate G1: ${b.validateG1Passes}/${result.validateSeeds.length}`);
  console.log(`  validate avg expectancy: ${b.validateAvgExpectancyTon.toFixed(5)} TON`);
  console.log(`verdict: ${b.g1PassingValidate ? "PASS candidate (synthetic — G1 still needs real data)" : "FAIL on validation seeds"}`);
  console.log(`ledger: ${ledgerFile}   report: ${htmlPath}`);
  return { result, report };
}

export function runReplayCli(opts: { signalsFile?: string; barsFile?: string; mode?: "snipe" | "swing" | "gamble" | "diamond" }) {
  const mode = opts.mode ?? "swing";
  const out = opts.signalsFile
    ? replayFromFiles({ signalsFile: opts.signalsFile, barsFile: opts.barsFile, mode })
    : replayFromBars({ barsFile: opts.barsFile!, mode });
  const { input, metrics, result, signalSource } = out;
  const g1 = evaluateG1(metrics);
  console.log(`=== Replay (${input.tokens.length} tokens, mode ${mode}, signals: ${signalSource}) ===`);
  if (signalSource === "momentum-bars") console.log(`data: ${input.syntheticBars ? "SYNTHETIC" : "REAL bars"} (CEX cross-rate; NOT DEX execution prices)`);
  else console.log(`bars: ${input.syntheticBars ? "SYNTHETIC (no bar file / missing tokens)" : "real bars"}  skippedNoBars=${input.skippedNoBars} eventsUsed=${input.eventsUsed}`);
  console.log(`events=${result.eventsEvaluated} gatedPass=${result.gatedPassed} trades=${metrics.trades}`);
  console.log(`spanDays=${metrics.spanDays.toFixed(1)} winRate=${(metrics.winRate * 100).toFixed(1)}% PF=${fmt(metrics.profitFactor)}`);
  console.log(`expectancy=${fmt(metrics.expectancyTon)} TON (${metrics.expectancyPct.toFixed(2)}%) sharpe=${metrics.sharpe.toFixed(3)}`);
  console.log(`maxDD=${metrics.maxDrawdownTon.toFixed(2)} TON (${metrics.maxDrawdownPct.toFixed(1)}%) feeDrag=${metrics.feeDragTon.toFixed(2)} TON`);
  console.log(`exits: ${Object.entries(metrics.exitMix).map(([k, v]) => `${k}(${v})`).join(" ")}`);
  for (const c of g1.checks) console.log(`${c.passed ? "PASS" : "FAIL"}  ${c.name.padEnd(24)} ${fmt(c.value)}  (need ${fmt(c.threshold)})`);
  console.log(`=== G1 verdict: ${g1.passed ? "PASS — edge measured positive" : "FAIL — not profitable enough yet"} ===`);
  return { result, input, metrics, g1 };
}

export async function runEvalRealCli(opts: { barsFile?: string; jettons?: string[]; days?: number; window?: number; windows?: number[]; regime?: number; out?: string }) {
  const window = opts.window ?? 24;
  let bars: Map<string, Bar[]>;
  if (opts.barsFile) {
    bars = loadBars(opts.barsFile);
  } else {
    const jettons = opts.jettons ?? DEFAULT_JETTONS;
    const days = opts.days ?? 180;
    bars = await fetchTonJettonsBars({ jettons, interval: "1d", days });
    const outFile = opts.out ?? path.join(defaultDataDir(), "bars-mainnet.ndjson");
    writeBarsNdjson(bars, outFile);
  }
  const rows = runRealGrid({ bars, window, windows: opts.windows, regimeSlow: opts.regime });
  const g1Passing = rows.filter((r) => r.g1Passed).length;
  const tokens = bars.size;
  const sample = bars.values().next().value as Bar[] | undefined;
  const windowsLabel = opts.windows ? `windows ${opts.windows.join(",")}` : `window ${window}`;
  const regimeLabel = opts.regime ? `, regime ${opts.regime}` : "";

  console.log(`=== Real-data G1 grid (${tokens} tokens, ${sample?.length ?? 0} bars, ${windowsLabel}${regimeLabel}) ===`);
  console.log(`data: REAL bars (CEX cross-rate; NOT DEX execution prices)`);
  console.log(`${rows.length} configs · G1 passing: ${g1Passing}`);
  console.log(`top by expectancy:`);
  for (const r of rows.slice(0, 6)) {
    const m = r.metrics;
    console.log(`  w${r.window} ${r.config.mode.padEnd(7)} vol=${r.config.volPct} rr=${r.config.rrTarget} trades=${String(m.trades).padStart(3)} span=${m.spanDays.toFixed(0).padStart(3)}d exp=${fmt(m.expectancyTon).padStart(9)}T PF=${m.profitFactor.toFixed(2).padStart(5)} sharpe=${m.sharpe.toFixed(2).padStart(5)} ${r.g1Passed ? "PASS" : "FAIL"}`);
  }

  const jsonPath = path.join(defaultDataDir(), "eval-report.json");
  const htmlPath = path.join(defaultDataDir(), "eval-report.html");
  const existing = readEvalReport(jsonPath);
  if (existing) {
    const report = { ...existing, at: new Date().toISOString(), realData: { dataLabel: `CEX cross-rate ${tokens} tokens × ${sample?.length ?? 0} bars (${windowsLabel}${regimeLabel})`, tokens, bars: sample?.length ?? 0, window, windows: opts.windows, regime: opts.regime, rows: rows as any, g1Passing } };
    writeEvalReport(report as any, jsonPath, htmlPath);
    console.log(`updated report: ${htmlPath}`);
  } else {
    console.log(`no eval-report.json yet — run --hyperopt once first, then --eval-real merges the real grid`);
  }
  return rows;
}

export async function runAdmitUniverseCli(opts: { barsFile?: string; windows?: number[]; regime?: number }) {
  if (!opts.barsFile) {
    console.error("--admit-universe requires --bars <file>");
    process.exit(1);
  }
  const bars = loadBars(opts.barsFile);
  const admission = admitUniverse({ bars, windows: opts.windows, regimeSlow: opts.regime });
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : String(v));

  console.log(`=== Universe admission (${bars.size} tokens × ${bars.values().next().value?.length ?? 0} bars, windows ${opts.windows?.join(",") ?? "20,24"}, regime ${opts.regime ?? "off"}) ===`);
  console.log(`ADMITTED (clears in-window G1 on own full bankroll): ${admission.admitted.length}`);
  for (const t of admission.admitted) {
    const m = t.best.metrics;
    console.log(`  ${t.ticker.padEnd(6)} w${t.best.window} ${t.best.config.mode.padEnd(7)} vol=${t.best.config.volPct} rr=${t.best.config.rrTarget} trades=${String(m.trades).padStart(3)} exp=${fmt(m.expectancyTon).padStart(9)}T PF=${m.profitFactor.toFixed(2).padStart(5)} sharpe=${m.sharpe.toFixed(2).padStart(5)} (${t.g1Passes}/${t.gridRows} grid rows)`);
  }
  console.log(`EXCLUDED (no in-window G1 pass): ${admission.excluded.length}`);
  for (const t of admission.excluded) {
    const m = t.best.metrics;
    console.log(`  ${t.ticker.padEnd(6)} ${t.reason} [best: trades=${m.trades} exp=${fmt(m.expectancyTon)}T PF=${m.profitFactor.toFixed(2)} sharpe=${m.sharpe.toFixed(2)}]`);
  }

  if (admission.admitted.length === 0) {
    console.log("RESULT: empty universe — no token clears in-window G1 on its own bankroll");
    return admission;
  }

  const admittedBars = new Map<string, Bar[]>(admission.admitted.map((t) => [t.address, bars.get(t.address)!]));
  const rows = runRealGrid({ bars: admittedBars, windows: opts.windows, regimeSlow: opts.regime });
  const g1Passing = rows.filter((r) => r.g1Passed).length;
  console.log(`\nPortfolio on admitted universe (${admission.admitted.length} token${admission.admitted.length === 1 ? "" : "s"}, full bankroll each):`);
  console.log(`${rows.length} configs · G1 passing: ${g1Passing}`);
  for (const r of rows.slice(0, 4)) {
    const m = r.metrics;
    console.log(`  w${r.window} ${r.config.mode.padEnd(7)} vol=${r.config.volPct} rr=${r.config.rrTarget} trades=${String(m.trades).padStart(3)} exp=${fmt(m.expectancyTon).padStart(9)}T PF=${m.profitFactor.toFixed(2).padStart(5)} sharpe=${m.sharpe.toFixed(2).padStart(5)} ${r.g1Passed ? "PASS" : "FAIL"}`);
  }

  const jsonPath = path.join(defaultDataDir(), "eval-report.json");
  const htmlPath = path.join(defaultDataDir(), "eval-report.html");
  const existing = readEvalReport(jsonPath);
  if (existing) {
    const report = {
      ...existing,
      at: new Date().toISOString(),
      universeAdmission: {
        dataLabel: `CEX cross-rate ${bars.size} tokens × ${bars.values().next().value?.length ?? 0} bars (windows ${opts.windows?.join(",") ?? "20,24"}, regime ${opts.regime ?? "off"})`,
        admitted: admission.admitted.map((t) => ({ ticker: t.ticker, address: t.address, best: t.best, g1Passes: t.g1Passes, gridRows: t.gridRows })),
        excluded: admission.excluded.map((t) => ({ ticker: t.ticker, address: t.address, reason: t.reason })),
        portfolioG1Passing: g1Passing,
        portfolioRows: rows as any,
      },
    };
    writeEvalReport(report as any, jsonPath, htmlPath);
    console.log(`updated report: ${htmlPath}`);
  }
  return admission;
}

export async function runPaperCli(opts: { barsFile?: string; signalsFile?: string; window?: number; regime?: number; mode?: string; vol?: number; rr?: number; journal?: string; skipBars?: number; ordersFile?: string; fillsFile?: string; driftToleranceBps?: number }) {
  if (!opts.barsFile) {
    console.error("--paper requires --bars <file>");
    process.exit(1);
  }
  const journalFile = opts.journal ?? path.join(defaultDataDir(), "decision-journal.ndjson");
  const ordersFile = opts.ordersFile ?? path.join(defaultDataDir(), "paper-orders.ndjson");
  const fillsFile = opts.fillsFile ?? path.join(defaultDataDir(), "paper-fills.ndjson");
  const p = runPaper({
    barsFile: opts.barsFile,
    signalsFile: opts.signalsFile,
    window: opts.window ?? 20,
    regimeSlow: opts.regime,
    mode: (opts.mode ?? "swing") as "snipe" | "swing" | "gamble" | "diamond",
    volPct: opts.vol,
    rrTarget: opts.rr,
    journalFile,
    ordersFile,
    fillsFile,
    skipBars: opts.skipBars,
  });
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
  console.log(`=== G2 paper run (${p.events} events, ${p.fills} fills, ${p.exits} exits) ===`);
  console.log(`data: REAL bars${opts.skipBars ? `, forward-only from bar ${opts.skipBars}` : ""}${opts.regime ? `, regime ${opts.regime}` : ""}`);
  console.log(`net PnL: ${fmt(p.netPnLTon)} TON`);
  for (const t of p.trades.slice(0, 8)) {
    console.log(`  ${t.ticker.padEnd(6)} ${new Date(t.entryTs).toISOString().slice(0, 10)} → ${new Date(t.exitTs).toISOString().slice(0, 10)} ${t.exitAction.padEnd(10)} ${fmt(t.netPnLTon).padStart(8)} TON`);
  }
  const drift = runDriftMonitor({ ordersFile, fillsFile, toleranceBps: opts.driftToleranceBps });
  console.log(`drift: ${drift.verdict.toUpperCase()} (${drift.fills.length} fills, max excess ${drift.maxDriftBps.toFixed(2)} bps vs ${drift.toleranceBps} tolerance, ${drift.violations.length} violations)`);
  console.log(`journal: ${journalFile} (${p.journalLines} lines)`);
  return p;
}

export async function runEvalSplitCli(opts: { barsFile?: string; windows?: number[]; tuneFraction?: number; regime?: number; riskIsolated?: boolean }) {
  if (!opts.barsFile) {
    console.error("--eval-split requires --bars <file>");
    process.exit(1);
  }
  const bars = loadBars(opts.barsFile);
  const split = runTimeSplitValidation({ bars, windows: opts.windows, tuneFraction: opts.tuneFraction, regimeSlow: opts.regime, riskIsolated: opts.riskIsolated });
  const s = split.selected;
  const sv = split.selectedOnValidate;
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
  const rowLine = (r: { config: StrategyConfig; window: number; metrics: BacktestMetrics; g1Passed: boolean }) =>
    `  w${r.window} ${r.config.mode.padEnd(7)} vol=${r.config.volPct} rr=${r.config.rrTarget} trades=${String(r.metrics.trades).padStart(3)} span=${r.metrics.spanDays.toFixed(0).padStart(3)}d exp=${fmt(r.metrics.expectancyTon).padStart(9)}T PF=${r.metrics.profitFactor.toFixed(2).padStart(5)} sharpe=${r.metrics.sharpe.toFixed(2).padStart(5)} ${r.g1Passed ? "PASS" : "FAIL"}`;

  console.log(`=== Time-split G1 validation (${bars.size} tokens, windows ${opts.windows?.join(",") ?? "20,24"}, regime ${opts.regime ?? "off"}${opts.riskIsolated ? ", per-token risk isolation" : ""}) ===`);
  console.log(`data: REAL bars (CEX cross-rate; tune 60% / validate 40% by time)`);
  console.log(`selected on TUNE (best expectancy, ${split.tuneRows.length} rows):`);
  if (s) console.log(rowLine(s));
  else console.log(`  (no config produced a trade on the tune segment)`);
  console.log(`same config on VALIDATE (held-out):`);
  if (sv) console.log(rowLine(sv));
  else if (s) console.log(`  (selected config not in validate grid — unexpected)`);
  else console.log(`  (nothing selected)`);
  console.log(`validate grid: ${split.validateRows.length} rows · ${split.tuneG1Passes} tune G1 passes · ${split.validateG1Passes} validate G1 passes`);
  console.log(`RESULT: ${split.verdict.toUpperCase()} — ${split.reason}`);

  const jsonPath = path.join(defaultDataDir(), "eval-report.json");
  const htmlPath = path.join(defaultDataDir(), "eval-report.html");
  const existing = readEvalReport(jsonPath);
  if (existing) {
    const report = {
      ...existing,
      at: new Date().toISOString(),
      realSplit: {
        dataLabel: `CEX cross-rate ${bars.size} tokens × ${bars.values().next().value?.length ?? 0} bars (regime ${opts.regime ?? "off"}${opts.riskIsolated ? ", per-token risk isolation" : ""})`,
        tokens: bars.size,
        bars: bars.values().next().value?.length ?? 0,
        windows: opts.windows ?? [20, 24],
        regime: opts.regime,
        tuneRows: split.tuneRows.length,
        validateRows: split.validateRows.length,
        tuneG1Passes: split.tuneG1Passes,
        validateG1Passes: split.validateG1Passes,
        selected: split.selected,
        selectedOnValidate: sv ?? null,
        verdict: split.verdict,
        reason: split.reason,
      },
    };
    writeEvalReport(report as EvalReport, jsonPath, htmlPath);
    console.log(`updated report: ${htmlPath}`);
  } else {
    console.log(`no eval-report.json yet — run --hyperopt once first, then --eval-split merges into the report`);
  }
  return split;
}

function readEvalReport(jsonPath: string): EvalReport | null {
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8")) as EvalReport;
  } catch {
    return null;
  }
}

export async function runFetchBarsCli(opts: { jettons?: string[]; days?: number; interval?: string; out?: string }) {
  const jettons = opts.jettons ?? DEFAULT_JETTONS;
  const days = opts.days ?? 45;
  const interval = opts.interval ?? "1d";
  const outFile = opts.out ?? path.join(defaultDataDir(), "bars-mainnet.ndjson");
  console.log(`Fetching ${days}d ${interval} bars for ${jettons.join(", ")} (cross-rate vs TON/USD, CEX)…`);
  const bars = await fetchTonJettonsBars({ jettons, interval, days });
  writeBarsNdjson(bars, outFile);
  for (const [addr, series] of bars) {
    const first = series[0];
    const last = series[series.length - 1];
    if (series.length === 0) {
      console.log(`  ${addr}: 0 bars (no aligned days)`);
      continue;
    }
    const span = ((last.ts - first.ts) / 86_400_000).toFixed(1);
    console.log(`  ${addr}: ${series.length} bars, span ${span}d, ${first.priceTon.toFixed(6)} → ${last.priceTon.toFixed(6)} TON`);
  }
  console.log(`wrote ${outFile}`);
  return bars;
}

if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  if (process.argv.includes("--hyperopt")) {
    runHyperoptCli({});
  } else if (process.argv.includes("--fetch-bars")) {
    const jettons = (arg("--jettons") ?? DEFAULT_JETTONS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
    const days = Number(arg("--days") ?? 45);
    const interval = arg("--interval") ?? "1d";
    const out = arg("--out");
    runFetchBarsCli({ jettons, days, interval, out }).catch((e) => {
      console.error(`fetch-bars failed: ${e.message}`);
      process.exit(1);
    });
  } else if (process.argv.includes("--eval-real")) {
    const barsFile = arg("--bars");
    const jettons = (arg("--jettons") ?? DEFAULT_JETTONS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
    const days = Number(arg("--days") ?? 180);
    const window = Number(arg("--window") ?? 24);
    const windowsArg = arg("--windows");
    const windows = windowsArg ? windowsArg.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) : undefined;
    const regime = arg("--regime") ? Number(arg("--regime")) : undefined;
    runEvalRealCli({ barsFile, jettons, days, window, windows, regime }).catch((e) => {
      console.error(`eval-real failed: ${e.message}`);
      process.exit(1);
    });
  } else if (process.argv.includes("--eval-split")) {
    const barsFile = arg("--bars");
    const windowsArg = arg("--windows");
    const windows = windowsArg ? windowsArg.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) : undefined;
    const regime = arg("--regime") ? Number(arg("--regime")) : undefined;
    const riskIsolated = process.argv.includes("--risk-isolated");
    runEvalSplitCli({ barsFile, windows, regime, riskIsolated }).catch((e) => {
      console.error(`eval-split failed: ${e.message}`);
      process.exit(1);
    });
  } else if (process.argv.includes("--admit-universe")) {
    const barsFile = arg("--bars");
    const windowsArg = arg("--windows");
    const windows = windowsArg ? windowsArg.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) : undefined;
    const regime = arg("--regime") ? Number(arg("--regime")) : undefined;
    runAdmitUniverseCli({ barsFile, windows, regime }).catch((e) => {
      console.error(`admit-universe failed: ${e.message}`);
      process.exit(1);
    });
  } else if (process.argv.includes("--paper")) {
    const barsFile = arg("--bars");
    const signalsFile = arg("--signals");
    const window = arg("--window") ? Number(arg("--window")) : undefined;
    const regime = arg("--regime") ? Number(arg("--regime")) : undefined;
    const mode = arg("--mode");
    const vol = arg("--vol") ? Number(arg("--vol")) : undefined;
    const rr = arg("--rr") ? Number(arg("--rr")) : undefined;
    const journal = arg("--journal");
    const skipBars = arg("--skip-bars") ? Number(arg("--skip-bars")) : undefined;
    runPaperCli({ barsFile, signalsFile, window, regime, mode, vol, rr, journal, skipBars }).catch((e) => {
      console.error(`paper failed: ${e.message}`);
      process.exit(1);
    });
  } else if (process.argv.includes("--drift")) {
    const ordersFile = arg("--orders") ?? path.join(defaultDataDir(), "orders-mainnet.ndjson");
    const fillsFile = arg("--fills") ?? path.join(defaultDataDir(), "fills-mainnet.ndjson");
    const toleranceBps = arg("--tolerance-bps") ? Number(arg("--tolerance-bps")) : undefined;
    const d = runDriftMonitor({ ordersFile, fillsFile, toleranceBps });
    const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
    console.log(`=== G2 drift monitor (${d.fills.length} fills) ===`);
    console.log(`max drift: ${fmt(d.maxDriftBps)} bps   mean: ${fmt(d.meanDriftBps)} bps   violations: ${d.violations.length}`);
    for (const v of d.violations.slice(0, 8)) {
      console.log(`  VIOLATION ${v.orderId} ${v.ticker} expected=${v.expectedSlippageBps}bps realized=${fmt(v.realizedSlippageBps)}bps drift=+${fmt(v.driftBps)}bps`);
    }
    console.log(`verdict: ${d.verdict.toUpperCase()}`);
  } else if (process.argv.includes("--replay")) {
    const signalsFile = arg("--signals");
    const barsFile = arg("--bars");
    const mode = (arg("--mode") ?? "swing") as "snipe" | "swing" | "gamble" | "diamond";
    if (!signalsFile && !barsFile) {
      console.error("--replay requires --signals <file> and/or --bars <file>");
      process.exit(1);
    }
    runReplayCli({ signalsFile, barsFile, mode });
  } else {
    const days = Number(arg("--days") ?? 45);
    const seed = Number(arg("--seed") ?? 5);
    const mode = (arg("--mode") ?? "swing") as "snipe" | "swing" | "gamble" | "diamond";
    runDemo({ days, seed, mode });
  }
}
