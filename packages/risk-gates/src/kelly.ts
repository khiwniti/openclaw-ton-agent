/**
 * Kelly criterion + position sizing. Port of the openclaw-trader Kelly pattern
 * (referenced, not copied) with ton-agent's tier-ceiling cap and an economic
 * floor so gas never dominates a position.
 */
import { GATE_CONFIG, totalCostTon } from "./config";

/** f* = (b·p − q) / b, with b = payoff ratio (reward/risk), q = 1 − p.
 *  winProb is clamped to (0, 0.999]: a "certain" win is never zeroed, and an
 *  impossible one never bets. f* is capped at 1 (never bet more than bankroll). */
export function kellyFraction(winProb: number, payoffRatio: number): number {
  if (payoffRatio <= 0) return 0;
  const p = Math.min(Math.max(winProb, 0), 0.999);
  if (p <= 0) return 0;
  const q = 1 - p;
  const f = (payoffRatio * p - q) / payoffRatio;
  return Math.min(1, Math.max(0, f));
}

export interface SizeInput {
  winProb: number;
  payoffRatio: number;
  bankrollTon: number;
  tierCeilingTon: number;
  /** Optional explicit min position (fee floor). Defaults from GATE_CONFIG. */
  feeCoverageMult?: number;
  /**
   * Measured volatility (fraction, e.g. 0.05 = 5% ATR). Drives the
   * risk-targeted cap: size ≤ bankroll × riskPerTradePct / vol. When omitted
   * the cap is the Kelly size itself (historic behavior). Provide measured vol
   * so high-vol tokens get smaller positions (lot-size intelligence, P3).
   */
  volPct?: number;
  /** Fraction of bankroll risked per trade to the stop. Default 1%. */
  riskPerTradePct?: number;
  /** Override for the kelly fraction (GATE_CONFIG.kellyFraction). */
  kellyFraction?: number;
}

export interface SizeResult {
  sizeTon: number;
  reason: string;
  floorTon: number;
  cappedBy: "tier" | "kelly" | "risk" | null;
}

export function sizedPositionTon(input: SizeInput): SizeResult {
  const feeCoverageMult = input.feeCoverageMult ?? GATE_CONFIG.feeCoverageMult;
  const floorTon = totalCostTon() * feeCoverageMult;
  const f = kellyFraction(input.winProb, input.payoffRatio);
  const kellyTon = f * input.bankrollTon * (input.kellyFraction ?? GATE_CONFIG.kellyFraction);

  // Lot-size intelligence: with measured vol, cap the position so the stop
  // loss (size × vol) risks at most riskPerTradePct of bankroll. A 5% ATR
  // token at 1% risk caps at size = bankroll × 0.01 / 0.05 = 20% of bankroll;
  // a 25% ATR token caps at 4%. High-vol tokens get smaller positions.
  const riskPerTradePct = input.riskPerTradePct ?? GATE_CONFIG.riskPerTradePct;
  const volPct = input.volPct;
  let riskCapTon = Infinity;
  let cappedBy: SizeResult["cappedBy"] = null;
  if (volPct !== undefined && volPct > 0) {
    riskCapTon = (input.bankrollTon * riskPerTradePct) / volPct;
  }
  const capped = Math.min(kellyTon, input.tierCeilingTon, riskCapTon);
  cappedBy = capped === riskCapTon && riskCapTon < input.tierCeilingTon && riskCapTon < kellyTon ? "risk" : capped === input.tierCeilingTon && capped <= kellyTon ? "tier" : "kelly";

  if (capped < floorTon) {
    return {
      sizeTon: 0,
      reason: `position ${capped.toFixed(4)} TON < fee floor ${floorTon.toFixed(4)} TON — fees would dominate`,
      floorTon,
      cappedBy: null,
    };
  }
  return {
    sizeTon: capped,
    reason: `kelly=${f.toFixed(3)} → ${kellyTon.toFixed(3)} TON${volPct !== undefined ? `, risk-cap=${riskCapTon.toFixed(3)} TON (${(riskPerTradePct * 100).toFixed(1)}% / vol ${(volPct * 100).toFixed(1)}%)` : ""} capped by ${cappedBy}`,
    floorTon,
    cappedBy,
  };
}
