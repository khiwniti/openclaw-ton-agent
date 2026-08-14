/**
 * Risk-gate config — env-driven, defaults are the G1-era conservative values.
 * The fee model (0.1 TON/side) is the non-negotiable economic floor:
 * every gate and size check is relative to it.
 */
function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export const GATE_CONFIG = {
  networkFeeTon: num("GATE_NETWORK_FEE_TON", 0.1),
  feeSides: Math.max(1, num("GATE_FEE_SIDES", 2)),
  spreadBpsAllowance: num("GATE_SPREAD_BPS_ALLOWANCE", 200), // 2% slippage allowance
  minRr: num("GATE_MIN_RR", 3),
  minWinProbability: num("GATE_MIN_WIN_PROBABILITY", 0.35),
  kellyFraction: num("GATE_KELLY_FRACTION", 0.25),
  cooldownMs: num("GATE_COOLDOWN_MS", 15 * 60_000),
  maxDrawdownPct: num("GATE_MAX_DRAWDOWN_PCT", 20),
  bankrollTon: num("GATE_BANKROLL_TON", 100),
  tierCeilingTon: {
    low: num("GATE_TIER_LOW_CAP_TON", 1),
    mid: num("GATE_TIER_MID_CAP_TON", 5),
    high: num("GATE_TIER_HIGH_CAP_TON", 20),
  },
  // Minimum position so a winner covers the round-trip fee × feeCoverageMult.
  feeCoverageMult: num("GATE_FEE_COVERAGE_MULT", 10),
  // Point-setup defaults (ton-tpsl-manager P3 port; P2 uses curve-derived vol).
  volPct: num("GATE_VOL_PCT", 0.05),
  curveBandVolFactor: { early_curve: 1.2, sweet: 1.0, late_curve: 1.5 },
  tradeFloorScore: num("GATE_TRADE_FLOOR_SCORE", 70),
  // Lot-size intelligence (P3): when measured volatility is available, size is
  // capped so the stop loss (size × vol) risks at most riskPerTradePct of
  // bankroll; volFloorPct/volCapPct bound the measured ATR before it reaches
  // point-setup/sizing so pathological bars cannot explode or vanish a stop.
  riskPerTradePct: num("GATE_RISK_PER_TRADE_PCT", 0.01),
  volFloorPct: num("GATE_VOL_FLOOR_PCT", 0.02),
  volCapPct: num("GATE_VOL_CAP_PCT", 0.25),
  atrPeriod: Math.max(3, num("GATE_ATR_PERIOD", 20)),
  macroPollIntervalMs: num("GATE_MACRO_POLL_INTERVAL_MS", 60_000),
  macroRiskOffEnabled: num("GATE_MACRO_RISK_OFF_ENABLED", 0),
} as const;

export function roundTripFeeTon(): number {
  return GATE_CONFIG.networkFeeTon * GATE_CONFIG.feeSides;
}

export function totalCostTon(): number {
  return roundTripFeeTon() * (1 + GATE_CONFIG.spreadBpsAllowance / 10_000);
}
