/**
 * Backtest metrics + G1 evaluation (architecture §12.2).
 *
 * G1 (measured, binding): ≥30 days, expectancy > 0, profit factor > 1.3,
 * Sharpe > 0.5 — all AFTER fees, slippage and gas. The metrics here are
 * exactly what the gate reads.
 *
 * Sharpe is TIME-BASED: annualized mean/std of daily returns on the account
 * equity curve (each trade's PnL marks equity on its exit day). Per-trade
 * Sharpe structurally caps out for lumpy momentum (a 21% win rate with large
 * winners produces high per-trade variance regardless of expectancy), so the
 * gate measures the volatility the account actually experiences over time.
 */
import type { Trade } from "./engine";

export interface BacktestMetrics {
  trades: number;
  spanDays: number;
  winRate: number;
  profitFactor: number;
  expectancyTon: number;
  expectancyPct: number;
  maxDrawdownTon: number;
  maxDrawdownPct: number;
  sharpe: number;
  feeDragTon: number;
  exitMix: Record<string, number>;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

const DAY_MS = 86_400_000;

/**
 * Annualized Sharpe from the DAILY account equity curve. Trades mark their
 * PnL on the exit day; equity is piecewise-constant between exits. Daily
 * returns are (E[i] - E[i-1]) / E[i-1], annualized with sqrt(365).
 * Flat days (no exits) contribute 0 returns — the honest cadence of PnL.
 */
export function timeSharpe(trades: Trade[], bankrollTon: number): number {
  if (trades.length === 0) return 0;

  const minTs = Math.min(...trades.map((t) => t.entryTs));
  const maxTs = Math.max(...trades.map((t) => t.exitTs));
  const startDay = Math.floor(minTs / DAY_MS);
  const endDay = Math.floor(maxTs / DAY_MS);
  const days = endDay - startDay + 1;
  if (days < 2) return 0;

  // daily PnL keyed by exit day
  const byDay = new Map<number, number>();
  for (const t of trades) {
    const d = Math.floor(t.exitTs / DAY_MS);
    byDay.set(d, (byDay.get(d) ?? 0) + t.netPnLTon);
  }

  const dailyReturns: number[] = [];
  let equity = bankrollTon;
  for (let d = startDay; d <= endDay; d++) {
    const prev = equity;
    equity += byDay.get(d) ?? 0;
    if (equity <= 0) equity = 0;
    if (prev > 0) dailyReturns.push((equity - prev) / prev);
  }

  const sd = std(dailyReturns);
  if (sd === 0) return 0;
  return (mean(dailyReturns) / sd) * Math.sqrt(365);
}

export function computeMetrics(trades: Trade[], opts: { bankrollTon?: number } = {}): BacktestMetrics {
  const n = trades.length;
  if (n === 0) {
    return { trades: 0, spanDays: 0, winRate: 0, profitFactor: 0, expectancyTon: 0, expectancyPct: 0, maxDrawdownTon: 0, maxDrawdownPct: 0, sharpe: 0, feeDragTon: 0, exitMix: {} };
  }

  const nets = trades.map((t) => t.netPnLTon);
  const grossProfit = nets.filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const grossLoss = -nets.filter((v) => v < 0).reduce((s, v) => s + v, 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const winRate = trades.filter((t) => t.netPnLTon > 0).length / n;
  const expectancyTon = mean(nets);
  const expectancyPct = mean(trades.map((t) => t.netPnlPct));

  // max drawdown on account equity (starts at the bankroll, never below 0).
  const bankroll = opts.bankrollTon ?? 100;
  let equity = bankroll;
  let peak = bankroll;
  let maxDdTon = 0;
  let maxDdPct = 0;
  for (const v of nets) {
    equity += v;
    if (equity > peak) peak = equity;
    maxDdTon = Math.max(maxDdTon, peak - equity);
    maxDdPct = Math.max(maxDdPct, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }

  const sharpe = timeSharpe(trades, bankroll);

  const minTs = Math.min(...trades.map((t) => t.entryTs));
  const maxTs = Math.max(...trades.map((t) => t.exitTs));
  const spanDays = (maxTs - minTs) / DAY_MS;

  const exitMix: Record<string, number> = {};
  for (const t of trades) exitMix[t.exitAction] = (exitMix[t.exitAction] ?? 0) + 1;

  return {
    trades: n,
    spanDays,
    winRate,
    profitFactor,
    expectancyTon,
    expectancyPct,
    maxDrawdownTon: maxDdTon,
    maxDrawdownPct: maxDdPct,
    sharpe,
    feeDragTon: trades.reduce((s, t) => s + t.feesTon, 0),
    exitMix,
  };
}

export interface G1Check {
  name: string;
  passed: boolean;
  value: number;
  threshold: number;
}

export interface G1Verdict {
  passed: boolean;
  checks: G1Check[];
}

export function evaluateG1(metrics: BacktestMetrics, overrides: Partial<{ minSpanDays: number; minProfitFactor: number; minSharpe: number }> = {}): G1Verdict {
  const minSpanDays = overrides.minSpanDays ?? 30;
  const minProfitFactor = overrides.minProfitFactor ?? 1.3;
  const minSharpe = overrides.minSharpe ?? 0.5;

  const checks: G1Check[] = [
    { name: "span (days)", passed: metrics.spanDays >= minSpanDays, value: metrics.spanDays, threshold: minSpanDays },
    { name: "expectancy > 0 (TON)", passed: metrics.expectancyTon > 0, value: metrics.expectancyTon, threshold: 0 },
    { name: "expectancy > 0 (%)", passed: metrics.expectancyPct > 0, value: metrics.expectancyPct, threshold: 0 },
    { name: "profit factor > threshold", passed: metrics.profitFactor > minProfitFactor, value: metrics.profitFactor, threshold: minProfitFactor },
    { name: "sharpe > threshold", passed: metrics.sharpe > minSharpe, value: metrics.sharpe, threshold: minSharpe },
  ];
  return { passed: checks.every((c) => c.passed), checks };
}
