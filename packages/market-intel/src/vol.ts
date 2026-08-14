/**
 * Lot-size intelligence (P3): measure a token's REALIZED volatility (ATR-style)
 * from its recent price series and convert it to the `volPct` the risk gates
 * use for point-setup and position sizing. Replaces the fixed `GATE_VOL_PCT`
 * constant that point-setup historically relied on (P2 curve-band only).
 *
 * Honest: no bars → `null` (never fabricated); few bars → `null` (not enough
 * to measure); a flat series → a floor of `minVolPct`.
 */
import type { SeriesPoint } from "./regime";

export interface RealizedVolOpts {
  /** ATR window in bars. Default 20. */
  atrPeriod?: number;
  /** Absolute floor on the returned vol fraction. Default 0.02 (2%). */
  minVolPct?: number;
  /** Absolute cap on the returned vol fraction. Default 0.25 (25%). */
  maxVolPct?: number;
}

/**
 * Mean absolute per-bar log-return over the trailing window (ATR as a
 * fraction of price). Clamped to [minVolPct, maxVolPct]; `null` when there is
 * no series or the window is too short.
 */
export function realizedVolPct(points: SeriesPoint[] | null | undefined, opts: RealizedVolOpts = {}): number | null {
  const { atrPeriod = 20, minVolPct = 0.02, maxVolPct = 0.25 } = opts;
  if (!points || points.length < 3) return null;

  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const window = sorted.slice(-Math.max(atrPeriod, 2));
  const diffs: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1].priceTon;
    if (!(prev > 0)) continue;
    diffs.push(Math.abs(Math.log(window[i].priceTon / prev)));
  }
  if (diffs.length < 2) return null;

  const meanAbsLogRet = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  // log-return ≈ relative change for small moves; this is the ATR fraction.
  const raw = Math.exp(meanAbsLogRet) - 1;
  return Math.min(maxVolPct, Math.max(minVolPct, raw));
}
