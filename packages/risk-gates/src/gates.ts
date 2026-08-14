/**
 * Deterministic risk gates (L3). Verdicts OUTRANK any LLM call (architecture
 * §10). Evaluated in order; the first hard failure halts with a reason.
 *
 *   kill switch → drawdown → cooldown → correlation → trade floor →
 *   quote/entry → R:R floor → fee coverage → win probability → Kelly size.
 */
import { GATE_CONFIG } from "./config";
import { sizedPositionTon } from "./kelly";
import { pointSetup } from "./point-setup";
import type { IngestedEnvelope } from "@openclaw-ton-agent/shared";

export type GateVerdict = "pass" | "reject" | "halt";

export interface GateContext {
  now: number;
  /** token address → cooldown-until (ms). Mutable so a runner persists it. */
  cooldowns: Map<string, number>;
  /** open positions for correlation + drawdown evaluation. */
  openPositions: Array<{ address: string; group?: string; pnlPct: number | null }>;
  /** current rolling drawdown in % (0-100). */
  drawdownPct: number;
  killSwitchFlipped: boolean;
  macroRiskOff?: boolean;
  bankrollTon: number;
  /** override win probability (0-1); defaults to score.soft/100. */
  winProbOverride?: number;
  tierCeilingTon?: number;
  /** Measured realized vol (fraction). When provided, gates size with
   *  risk-targeting (lot-size intelligence) and point-setup uses it in place
   *  of the fixed GATE_VOL_PCT. Clamped to GATE_CONFIG.volFloor/Cap. */
  volPct?: number;
  /** group resolver for correlation (address → group id). */
  correlationGroup?: (address: string) => string | null;
}

export interface GateResult {
  verdict: GateVerdict;
  reasons: string[];
  tier: "low" | "mid" | "high" | null;
  sizeTon: number;
  rRatio: number | null;
  expectedValueTon: number;
  cooldownUntil: number | null;
}

function tierForScore(soft: number): "low" | "mid" | "high" | null {
  if (soft >= 90) return "high";
  if (soft >= 80) return "mid";
  if (soft >= GATE_CONFIG.tradeFloorScore) return "low";
  return null;
}

export function evaluateGates(envelope: IngestedEnvelope, ctx: GateContext): GateResult {
  const reasons: string[] = [];
  const base: GateResult = { verdict: "reject", reasons, tier: null, sizeTon: 0, rRatio: null, expectedValueTon: 0, cooldownUntil: null };

  if (ctx.killSwitchFlipped) {
    reasons.push("KILL SWITCH flipped");
    return { ...base, verdict: "halt" };
  }
  if (ctx.macroRiskOff) {
    reasons.push("macro risk-off active");
    return { ...base, verdict: "halt" };
  }
  if (ctx.drawdownPct >= GATE_CONFIG.maxDrawdownPct) {
    reasons.push(`drawdown ${ctx.drawdownPct}% ≥ limit ${GATE_CONFIG.maxDrawdownPct}% (circuit breaker)`);
    return { ...base, verdict: "halt" };
  }

  const address = envelope.token.address;
  const until = ctx.cooldowns.get(address);
  if (until !== undefined && until > ctx.now) {
    reasons.push(`cooldown active until ${until}`);
    return base;
  }

  const group = ctx.correlationGroup?.(address) ?? null;
  if (group) {
    const overlap = ctx.openPositions.some((p) => (p.group ?? null) === group);
    if (overlap) {
      reasons.push(`correlated to open position in group ${group}`);
      return base;
    }
  }

  const soft = envelope.score?.soft ?? 0;
  const tier = tierForScore(soft);
  if (!tier) {
    reasons.push(`score ${soft} < trade floor ${GATE_CONFIG.tradeFloorScore}`);
    return base;
  }

  const entryTon = envelope.token.priceTon;
  if (entryTon === null || entryTon <= 0) {
    reasons.push("no quote (priceTon null) — cannot size");
    return base;
  }

  const setup = pointSetup({ entryTon, curvePct: envelope.token.curvePct, volPct: ctx.volPct });
  if (setup.rr < GATE_CONFIG.minRr) {
    reasons.push(`R:R ${setup.rr.toFixed(2)} < floor ${GATE_CONFIG.minRr}`);
    return base;
  }

  const winProb = ctx.winProbOverride ?? Math.min(1, soft / 100);
  if (winProb < GATE_CONFIG.minWinProbability) {
    reasons.push(`win probability ${(winProb * 100).toFixed(1)}% < floor ${GATE_CONFIG.minWinProbability * 100}%`);
    return base;
  }

  const size = sizedPositionTon({
    winProb,
    payoffRatio: setup.rr,
    bankrollTon: ctx.bankrollTon,
    tierCeilingTon: ctx.tierCeilingTon ?? GATE_CONFIG.tierCeilingTon[tier],
    volPct: ctx.volPct,
  });
  if (size.sizeTon <= 0) {
    reasons.push(size.reason); // includes the position-level fee floor
    return base;
  }

  // Position-level economics: qty × per-token win = size × vol × rr; stop
  // loss = size × vol. Per-token price magnitude is irrelevant to whether a
  // position covers fees — only the size is. (kelly's fee floor enforces the
  // "winner covers feeCoverageMult × round-trip cost" rule on that size.)
  const winTon = size.sizeTon * setup.volPct * setup.rr;
  const lossTon = size.sizeTon * setup.volPct;
  const expectedValueTon = winProb * winTon - (1 - winProb) * lossTon;
  if (expectedValueTon <= 0) {
    reasons.push(`expected value ${expectedValueTon.toFixed(4)} TON ≤ 0`);
    return base;
  }

  const cooldownUntil = ctx.now + GATE_CONFIG.cooldownMs;
  ctx.cooldowns.set(address, cooldownUntil);
  return {
    verdict: "pass",
    reasons: [size.reason, `expectedValue=${expectedValueTon.toFixed(4)} TON`],
    tier,
    sizeTon: size.sizeTon,
    rRatio: setup.rr,
    expectedValueTon,
    cooldownUntil,
  };
}

export function gatedMeta(result: GateResult) {
  return {
    gate: {
      verdict: result.verdict,
      tier: result.tier,
      sizeTon: result.sizeTon,
      rRatio: result.rRatio,
      expectedValueTon: result.expectedValueTon,
      cooldownUntil: result.cooldownUntil,
      reasons: result.reasons,
      ts: Date.now(),
    },
  };
}
