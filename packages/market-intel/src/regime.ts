/**
 * Regime classification — deterministic, series-based, honest.
 * Uses EMA (Exponential Moving Average) crossover for faster signals
 * plus an ATR breakout probe. Insufficient data → `unknown` (never fabricated).
 */
export type Regime =
  | "trending_up"
  | "trending_down"
  | "sideways"
  | "breakout_up"
  | "breakout_down"
  | "unknown";

export interface SeriesPoint {
  ts: number;
  priceTon: number;
}

export interface RegimeResult {
  regime: Regime;
  confidence: number; // 0..1
  slopePerDayPct: number | null;
  r2: number | null;
  emaFast?: number;
  emaSlow?: number;
}

export interface RegimeOpts {
  /** Min points required before classification. Default 10. */
  minPoints?: number;
  /** |log-price trend| per day that qualifies as "trending". Default 0.02. */
  trendThreshold?: number;
  /** R² required to trust the trend. Default 0.6. */
  minR2?: number;
  /** ATR multiple for breakout probe. Default 2.0. */
  breakoutAtrMult?: number;
  /** EMA fast period. Default 12. */
  emaFastPeriod?: number;
  /** EMA slow period. Default 26. */
  emaSlowPeriod?: number;
}

/** Calculate EMA (Exponential Moving Average) */
function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  return values.reduce((acc, v) => v * k + acc * (1 - k), values[0]);
}

export function classifySeries(points: SeriesPoint[], opts: RegimeOpts = {}): RegimeResult {
  const { 
    minPoints = 10, 
    trendThreshold = 0.02, 
    minR2 = 0.6, 
    breakoutAtrMult = 2.0,
    emaFastPeriod = 12,
    emaSlowPeriod = 26,
  } = opts;
  
  if (points.length < minPoints || points.every((p) => p.priceTon <= 0)) {
    return { regime: "unknown", confidence: 0, slopePerDayPct: null, r2: null };
  }

  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const t0 = sorted[0].ts;
  const xs = sorted.map((p) => (p.ts - t0) / 86_400_000); // days
  const ys = sorted.map((p) => Math.log(p.priceTon));
  const prices = sorted.map((p) => p.priceTon);

  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const xm = mean(xs);
  const ym = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - xm;
    const dy = ys[i] - ym;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slopePerDay = sxx > 0 ? sxy / sxx : 0;
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;

  // EMA crossover for regime detection (faster than SMA)
  const emaFast = ema(prices, emaFastPeriod);
  const emaSlow = ema(prices, emaSlowPeriod);
  const emaBullish = emaFast > emaSlow;
  const emaBearish = emaFast < emaSlow;

  // Breakout probe: a single-step JUMP beyond the recent ATR, sustained past
  // the EMA band. A steady trend never trips this (per-step change ≈ ATR);
  // only a genuine velocity spike does.
  const window = sorted.slice(-20);
  const emaFastRecent = ema(window.map(p => p.priceTon), emaFastPeriod);
  let atr = 0;

  if (window.length >= 3) {
    const diffs: number[] = [];
    for (let i = 1; i < window.length; i++) diffs.push(Math.abs(window[i].priceTon - window[i - 1].priceTon));
    atr = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  }
  const last = sorted[sorted.length - 1].priceTon;
  const prev = window[window.length - 2].priceTon;
  const lastJump = last - prev;
  const jumpSpike = Math.abs(lastJump) > breakoutAtrMult * atr;
  const upBreakout = jumpSpike && lastJump > 0 && last > emaFastRecent;
  const downBreakout = jumpSpike && lastJump < 0 && last < emaFastRecent;

  if (upBreakout) return { regime: "breakout_up", confidence: 0.8, slopePerDayPct: slopePerDay * 100, r2, emaFast, emaSlow };
  if (downBreakout) return { regime: "breakout_down", confidence: 0.8, slopePerDayPct: slopePerDay * 100, r2, emaFast, emaSlow };

  // EMA crossover takes precedence over linear regression for regime
  if (emaBullish && r2 >= minR2 && slopePerDay >= trendThreshold) {
    return { regime: "trending_up", confidence: Math.min(0.95, 0.6 + Math.abs(slopePerDay) * 8 + (r2 - minR2)), slopePerDayPct: slopePerDay * 100, r2, emaFast, emaSlow };
  }
  if (emaBearish && r2 >= minR2 && slopePerDay <= -trendThreshold) {
    return { regime: "trending_down", confidence: Math.min(0.95, 0.6 + Math.abs(slopePerDay) * 8 + (r2 - minR2)), slopePerDayPct: slopePerDay * 100, r2, emaFast, emaSlow };
  }
  // Fallback to regression-only if EMA doesn't confirm
  if (r2 >= minR2 && slopePerDay >= trendThreshold) {
    return { regime: "trending_up", confidence: Math.min(0.95, 0.6 + Math.abs(slopePerDay) * 8 + (r2 - minR2)), slopePerDayPct: slopePerDay * 100, r2, emaFast, emaSlow };
  }
  if (r2 >= minR2 && slopePerDay <= -trendThreshold) {
    return { regime: "trending_down", confidence: Math.min(0.95, 0.6 + Math.abs(slopePerDay) * 8 + (r2 - minR2)), slopePerDayPct: slopePerDay * 100, r2, emaFast, emaSlow };
  }
  return { regime: "sideways", confidence: 0.5, slopePerDayPct: slopePerDay * 100, r2, emaFast, emaSlow };
}

/** Curve-position band (curve sanity from ton-agent sniper scoring). */
export function curveBand(curvePct: number | null, opts: { sweetMin?: number; sweetMax?: number } = {}): "sweet" | "early_curve" | "late_curve" | "unknown" {
  if (curvePct === null) return "unknown";
  const { sweetMin = 30, sweetMax = 70 } = opts;
  if (curvePct >= sweetMin && curvePct <= sweetMax) return "sweet";
  if (curvePct < sweetMin) return "early_curve";
  return "late_curve";
}
