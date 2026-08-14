/**
 * Hyperopt — grid sweep of the strategy knobs against the same replay engine
 * G1 measures. Knobs: exit mode (L4) + point-setup volPct/rrTarget (L3).
 *
 * Honesty rules (architecture §12.2):
 *  - tuning and validation use DISJOINT seed sets (parity split), so the
 *    "best" config is chosen on data it never tuned on;
 *  - a passing config is reported as "synthetic candidate" — G1 must still be
 *    measured on the real ≥30d data harness before it counts (§14 P3 gate).
 */
import { generateSeries, type Bar } from "./series";
import { generateEvents } from "./fixture";
import { runBacktest, type Trade } from "./engine";
import { computeMetrics, evaluateG1, type BacktestMetrics } from "./metrics";
import { GATE_CONFIG } from "@openclaw-ton-agent/risk-gates";
import type { ExitMode } from "@openclaw-ton-agent/exit-manager";
import type { IngestedEnvelope } from "@openclaw-ton-agent/shared";

export interface StrategyConfig {
  mode: ExitMode;
  volPct: number;
  rrTarget: number;
}

export interface HyperoptRun {
  config: StrategyConfig;
  seed: number;
  phase: "tune" | "validate";
  metrics: BacktestMetrics;
  g1Passed: boolean;
  trades: Trade[];
}

export interface HyperoptResult {
  gridSize: number;
  tuneSeeds: number[];
  validateSeeds: number[];
  runs: HyperoptRun[];
  best: {
    config: StrategyConfig;
    tuneG1Passes: number;
    validateG1Passes: number;
    validateAvgExpectancyTon: number;
    g1PassingValidate: boolean;
  };
}

export const MODES: ExitMode[] = ["snipe", "swing", "gamble", "diamond"];
export const VOL_PCTS = [0.03, 0.05, 0.08];
export const RR_TARGETS = [3, 4, 5]; // rrTarget < minRr(3) would contradict ton-tpsl-manager
export const TUNE_SEEDS = [5, 6];
export const VALIDATE_SEEDS = [7, 8];

export function hyperoptGrid(
  modes: ExitMode[] = MODES,
  volPcts: number[] = VOL_PCTS,
  rrTargets: number[] = RR_TARGETS,
): StrategyConfig[] {
  const out: StrategyConfig[] = [];
  for (const mode of modes) for (const volPct of volPcts) for (const rrTarget of rrTargets) out.push({ mode, volPct, rrTarget });
  return out;
}

function seriesFor(seed: number, days: number) {
  const bars = generateSeries({ startTon: 10, days, barsPerDay: 48, driftPerDay: 0.01, volPerBar: 0.015, seed });
  return new Map<string, Bar[]>([["EQA-bt-fixture", bars]]);
}

export function runHyperopt(opts: {
  days?: number;
  grid?: StrategyConfig[];
  tuneSeeds?: number[];
  validateSeeds?: number[];
  bankrollTon?: number;
}): HyperoptResult {
  const days = opts.days ?? 45;
  const grid = opts.grid ?? hyperoptGrid();
  const tuneSeeds = opts.tuneSeeds ?? TUNE_SEEDS;
  const validateSeeds = opts.validateSeeds ?? VALIDATE_SEEDS;
  const bankrollTon = opts.bankrollTon ?? GATE_CONFIG.bankrollTon;

  const runs: HyperoptRun[] = [];
  for (const config of grid) {
    for (const seed of tuneSeeds) runs.push(evalConfig(config, seed, "tune", days, bankrollTon));
    for (const seed of validateSeeds) runs.push(evalConfig(config, seed, "validate", days, bankrollTon));
  }

  const byConfig = (c: StrategyConfig) => runs.filter((r) => sameConfig(r.config, c));
  let best: HyperoptResult["best"] | null = null;
  for (const config of grid) {
    const rs = byConfig(config);
    const validate = rs.filter((r) => r.phase === "validate");
    const tune = rs.filter((r) => r.phase === "tune");
    const validateG1Passes = validate.filter((r) => r.g1Passed).length;
    const tuneG1Passes = tune.filter((r) => r.g1Passed).length;
    const validateAvgExpectancyTon = mean(validate.map((r) => r.metrics.expectancyTon));
    const candidate = { config, tuneG1Passes, validateG1Passes, validateAvgExpectancyTon, g1PassingValidate: validateG1Passes === validate.length };
    if (best === null || betterThan(candidate, best)) best = candidate;
  }

  return { gridSize: grid.length, tuneSeeds, validateSeeds, runs, best: best as HyperoptResult["best"] };
}

function evalConfig(config: StrategyConfig, seed: number, phase: "tune" | "validate", days: number, bankrollTon: number): HyperoptRun {
  const series = seriesFor(seed, days);
  const events = generateEvents(series.get("EQA-bt-fixture")!, "EQA-bt-fixture", "BT-1");
  const result = runBacktest({
    events,
    series,
    mode: config.mode,
    strategy: { volPct: config.volPct, rrTarget: config.rrTarget },
    bankrollTon,
  });
  const metrics = computeMetrics(result.trades, { bankrollTon });
  const g1Passed = evaluateG1(metrics).passed;
  return { config, seed, phase, metrics, g1Passed, trades: result.trades };
}

function sameConfig(a: StrategyConfig, b: StrategyConfig): boolean {
  return a.mode === b.mode && a.volPct === b.volPct && a.rrTarget === b.rrTarget;
}

/** Prefer a config that passes G1 on validation; else the highest validation expectancy. */
function betterThan(candidate: HyperoptResult["best"], incumbent: HyperoptResult["best"]): boolean {
  if (candidate.g1PassingValidate !== incumbent.g1PassingValidate) return candidate.g1PassingValidate;
  if (candidate.validateG1Passes !== incumbent.validateG1Passes) return candidate.validateG1Passes > incumbent.validateG1Passes;
  return candidate.validateAvgExpectancyTon > incumbent.validateAvgExpectancyTon;
}

function mean(v: number[]): number {
  return v.length === 0 ? 0 : v.reduce((s, x) => s + x, 0) / v.length;
}

export interface RealGridRun {
  config: StrategyConfig;
  /** Signal lookback window the events were generated with (also a grid knob). */
  window: number;
  metrics: BacktestMetrics;
  g1Passed: boolean;
  g1Checks: ReturnType<typeof evaluateG1>["checks"];
}

/**
 * Evaluate the same strategy grid against real bar data (no seeds, no
 * synthetic series). This is the closest the harness gets to a live G1
 * measurement — honest label: real bars, CEX cross-rate prices.
 */
export function runRealGrid(opts: {
  bars: Map<string, Bar[]>;
  grid?: StrategyConfig[];
  bankrollTon?: number;
  window?: number;
  /** Optional: sweep a set of lookback windows (each gets its own events). */
  windows?: number[];
  /** Regime gate (bars): only emit events when sma(window) > sma(regimeSlow). */
  regimeSlow?: number;
  /**
   * Per-token risk isolation: each token gets an equal sub-account
   * (bankroll / N), sized and circuit-broken independently; PnL then
   * aggregates at portfolio level. This is the honest way to run a
   * multi-token universe — the shared-bankroll default lets one token's
   * losers consume the same capital as another token's winners.
   */
  riskIsolated?: boolean;
}): RealGridRun[] {
  const bars = opts.bars;
  const grid = opts.grid ?? hyperoptGrid();
  const bankrollTon = opts.bankrollTon ?? GATE_CONFIG.bankrollTon;
  const windows = opts.windows ?? [opts.window ?? 24];
  const regimeSlow = opts.regimeSlow ?? 0;
  const riskIsolated = opts.riskIsolated ?? false;
  const perToken = riskIsolated ? bankrollTon / Math.max(1, bars.size) : bankrollTon;
  const out: RealGridRun[] = [];
  for (const window of windows) {
    // group events by token so isolation can run each sub-account separately
    const byToken = new Map<string, Array<{ ts: number; envelope: IngestedEnvelope }>>();
    for (const [addr, series] of bars) {
      byToken.set(addr, generateEvents(series, addr, addr.slice(0, 6), window, "real", regimeSlow));
    }
    const events = [...byToken.values()].flat();
    for (const config of grid) {
      let trades: Trade[];
      if (riskIsolated) {
        trades = [];
        for (const [addr, evts] of byToken) {
          const r = runBacktest({ events: evts, series: new Map([[addr, bars.get(addr)!]]), mode: config.mode, strategy: { volPct: config.volPct, rrTarget: config.rrTarget }, bankrollTon: perToken });
          trades.push(...r.trades);
        }
      } else {
        trades = runBacktest({ events, series: bars, mode: config.mode, strategy: { volPct: config.volPct, rrTarget: config.rrTarget }, bankrollTon }).trades;
      }
      const metrics = computeMetrics(trades, { bankrollTon });
      const g1 = evaluateG1(metrics);
      out.push({ config, window, metrics, g1Passed: g1.passed, g1Checks: g1.checks });
    }
  }
  return out.sort((a, b) => b.metrics.expectancyTon - a.metrics.expectancyTon);
}

export interface AdmittedToken {
  address: string;
  ticker: string;
  /** Best in-window G1 row for this token (highest expectancy among passes). */
  best: RealGridRun;
  /** Count of in-window G1-passing configs for this token. */
  g1Passes: number;
  /** Total grid rows evaluated for this token. */
  gridRows: number;
}

export interface UniverseAdmission {
  admitted: AdmittedToken[];
  excluded: { address: string; ticker: string; reason: string; best: RealGridRun }[];
}

/**
 * Per-token G1 admission: run each token's in-window grid on its own full
 * bankroll and keep only tokens that clear G1. This is universe construction
 * as a gate — losers are excluded on evidence, not by hand. Trades the winner
 * at FULL bankroll, matching what the per-token G1 measured.
 */
export function admitUniverse(opts: {
  bars: Map<string, Bar[]>;
  grid?: StrategyConfig[];
  bankrollTon?: number;
  window?: number;
  windows?: number[];
  regimeSlow?: number;
}): UniverseAdmission {
  const bars = opts.bars;
  const grid = opts.grid ?? hyperoptGrid();
  const bankrollTon = opts.bankrollTon ?? GATE_CONFIG.bankrollTon;
  const windows = opts.windows ?? [opts.window ?? 24];
  const regimeSlow = opts.regimeSlow ?? 0;
  const admitted: AdmittedToken[] = [];
  const excluded: UniverseAdmission["excluded"] = [];
  for (const [addr, series] of bars) {
    const single = new Map<string, Bar[]>([[addr, series]]);
    const rows = runRealGrid({ bars: single, grid, windows, bankrollTon, regimeSlow });
    const passes = rows.filter((r) => r.g1Passed);
    const ticker = addr.replace(/^EQA-[^:]*:/, "");
    if (passes.length > 0) {
      admitted.push({ address: addr, ticker, best: passes[0], g1Passes: passes.length, gridRows: rows.length });
    } else {
      const best = rows[0];
      excluded.push({
        address: addr,
        ticker,
        reason:
          best.metrics.trades === 0
            ? "no tradeable events (regime gate suppressed all signals)"
            : best.metrics.expectancyTon <= 0
              ? `negative expectancy (${best.metrics.expectancyTon.toFixed(3)} TON)`
              : "failed G1 thresholds (PF/Sharpe/span)",
        best,
      });
    }
  }
  return { admitted, excluded };
}

export interface TimeSplitResult {
  /** The best tune-segment row (config + window), selected without seeing the validate segment. */
  selected: RealGridRun | null;
  tuneRows: RealGridRun[];
  /** Same grid re-run on the held-out validate segment; selected is in here if it still holds. */
  validateRows: RealGridRun[];
  /** The selected config's row on the held-out validate segment (if present). */
  selectedOnValidate?: RealGridRun;
  tuneG1Passes: number;
  validateG1Passes: number;
  /**
   * pass — selected config clears G1 on BOTH segments (holds out-of-sample).
   * fail — a tradeable tune config was selectable but did not hold on validate.
   * inconclusive — no config cleared G1 on the tune segment, so selection would
   *   be noise (regime-gated strategy may simply have had no tradeable tune
   *   regime). Not a verdict either way.
   */
  verdict: "pass" | "fail" | "inconclusive";
  /** Why the split verdict is what it is (empty tune, no hold, etc.). */
  reason: string;
  passed: boolean;
}

/**
 * Honest real-data G1 protocol: split each series in time (default 60/40 tune /
 * validate). Select the best config on the TUNE segment only, then measure the
 * SAME grid on the held-out VALIDATE segment. A pass requires the selected
 * config to still clear G1 on data it never tuned on — the real-data analog of
 * the synthetic tune/validate seed split (§12.2 honesty rules).
 */
export function runTimeSplitValidation(opts: {
  bars: Map<string, Bar[]>;
  grid?: StrategyConfig[];
  windows?: number[];
  tuneFraction?: number;
  bankrollTon?: number;
  /** Regime gate (bars): only emit events when sma(window) > sma(regimeSlow). */
  regimeSlow?: number;
  /** Per-token risk isolation (equal sub-accounts) instead of one shared bankroll. */
  riskIsolated?: boolean;
}): TimeSplitResult {
  const bars = opts.bars;
  const grid = opts.grid ?? hyperoptGrid();
  const bankrollTon = opts.bankrollTon ?? GATE_CONFIG.bankrollTon;
  const tuneFraction = opts.tuneFraction ?? 0.6;
  const windows = opts.windows ?? [20, 24];
  const regimeSlow = opts.regimeSlow ?? 0;
  const riskIsolated = opts.riskIsolated ?? false;

  const tuneBars = new Map<string, Bar[]>();
  const validateBars = new Map<string, Bar[]>();
  for (const [addr, series] of bars) {
    const cut = Math.max(1, Math.floor(series.length * tuneFraction));
    tuneBars.set(addr, series.slice(0, cut));
    validateBars.set(addr, series.slice(cut));
  }

  const tuneRows = runRealGrid({ bars: tuneBars, grid, windows, bankrollTon, regimeSlow, riskIsolated });
  const selected = pickBest(tuneRows);

  const validateRows = runRealGrid({ bars: validateBars, grid, windows, bankrollTon, regimeSlow, riskIsolated });
  const selectedOnValidate = selected
    ? validateRows.find(
        (r) => r.config.mode === selected.config.mode && r.config.volPct === selected.config.volPct && r.config.rrTarget === selected.config.rrTarget && r.window === selected.window,
      )
    : undefined;
  const validateG1Passes = validateRows.filter((r) => r.g1Passed).length;
  const tuneG1Passes = tuneRows.filter((r) => r.g1Passed).length;

  let reason: string;
  let verdict: TimeSplitResult["verdict"];
  if (!selected) {
    reason = "tune segment produced zero tradable signals for every config — nothing to select";
    verdict = "inconclusive";
  } else if (tuneG1Passes === 0) {
    reason = `no config cleared G1 on the tune segment (${tuneRows.length} rows, ${tuneG1Passes} tune passes) — selection would be noise; tune regime was not tradeable`;
    verdict = "inconclusive";
  } else if (!selectedOnValidate) {
    reason = `selected config not found in validate grid (unexpected)`;
    verdict = "fail";
  } else if (selectedOnValidate.g1Passed) {
    reason = `selected config clears G1 on both tune and the held-out validate segment`;
    verdict = "pass";
  } else {
    reason = `selected config clears G1 on tune but not on the held-out validate segment`;
    verdict = "fail";
  }

  return {
    selected,
    tuneRows,
    validateRows,
    selectedOnValidate,
    tuneG1Passes,
    validateG1Passes,
    verdict,
    reason,
    passed: verdict === "pass",
  };
}

/**
 * Selection rule for the tune segment: never pick a 0-trade degenerate row
 * (expectancy 0.0 outranks negative rows in a plain sort). Prefer a G1-passing
 * config with real trades; otherwise the highest-expectancy config with trades.
 * Returns null when no config produced a single trade on the tune segment.
 */
function pickBest(rows: RealGridRun[]): RealGridRun | null {
  const withTrades = rows.filter((r) => r.metrics.trades > 0);
  if (withTrades.length === 0) return null;
  const passing = withTrades.filter((r) => r.g1Passed);
  const pool = passing.length > 0 ? passing : withTrades;
  return pool.reduce((best, r) => (r.metrics.expectancyTon > best.metrics.expectancyTon ? r : best));
}
