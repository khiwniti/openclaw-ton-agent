/**
 * Point setup — entry validation, SL/TP levels (ton-tpsl-manager P3 port).
 * P2 derives volatility from the curve band; P3 measures it from the price
 * series (`volPct` input) and clamps it so pathological bars cannot explode a
 * stop. Honest: when there is no quote there is no setup — the gate rejects.
 */
import { GATE_CONFIG, totalCostTon } from "./config";
import { curveBand } from "@openclaw-ton-agent/market-intel";

export interface PointSetupInput {
  entryTon: number;
  curvePct: number | null;
  rrTarget?: number;
  /** Measured realized vol (fraction). Defaults to GATE_CONFIG.volPct. */
  volPct?: number;
}

export interface PointSetup {
  stopLoss: number;
  takeProfit: number;
  rr: number;
  volPct: number;
  expectedWinTon: number;
  totalCostTon: number;
}

export function pointSetup(input: PointSetupInput): PointSetup {
  const { entryTon, curvePct, rrTarget = GATE_CONFIG.minRr } = input;
  const band = curveBand(curvePct);
  const factor = band === "unknown" ? 1.2 : GATE_CONFIG.curveBandVolFactor[band];
  // Measured ATR wins over the fixed constant when provided; clamp it so a
  // flat series (floor) still gives a sane stop and a spike (cap) can't blow
  // out risk budgeting. Then the curve-band factor adjusts for stage of life.
  const baseVol = input.volPct ?? GATE_CONFIG.volPct;
  const vol = Math.min(GATE_CONFIG.volCapPct, Math.max(GATE_CONFIG.volFloorPct, baseVol)) * factor;
  const stopLoss = entryTon * (1 - vol);
  const takeProfit = entryTon * (1 + vol * rrTarget);
  return {
    stopLoss,
    takeProfit,
    rr: rrTarget,
    volPct: vol,
    expectedWinTon: takeProfit - entryTon,
    totalCostTon: totalCostTon(),
  };
}
