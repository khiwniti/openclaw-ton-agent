/**
 * Order builder — deterministic translation of a gated envelope (meta.gate)
 * into an OrderRequest. Recomputes the point setup so stop/target/expected-win
 * are exactly what the risk gates evaluated (§12 consistency).
 */
import { newOrderId, type IngestedEnvelope, type OrderRequest, type ExecutionMode } from "@openclaw-ton-agent/shared";
import { pointSetup, GATE_CONFIG } from "@openclaw-ton-agent/risk-gates";

export interface BuildOrderOptions {
  mode: ExecutionMode;
  /** count of live trades already placed (for confirm-first-N). */
  liveTradeCount?: number;
  sizeConfirmThresholdTon?: number;
  liveConfirmFirstNTrades?: number;
  slippageBps?: number;
  /** ttl in ms; order expires if not executed in time. */
  orderTtlMs?: number;
  /** minimum order size in TON; recommended default aligns with low-tier ceiling */
  minOrderTon?: number;
  now?: number;
}

/** Read the gate verdict an envelope carries; reject anything not `pass`. */
export function gatedMetaOf(envelope: IngestedEnvelope): { verdict: "pass"; sizeTon: number; tier: "low" | "mid" | "high"; rRatio: number; expectedValueTon: number } | null {
  const gate = (envelope.meta as { gate?: Record<string, unknown> } | undefined)?.gate;
  if (!gate) return null;
  const verdict = gate.verdict;
  const sizeTon = gate.sizeTon;
  const tier = gate.tier;
  const rRatio = gate.rRatio;
  const expectedValueTon = gate.expectedValueTon;
  if (verdict !== "pass" || typeof sizeTon !== "number" || sizeTon <= 0) return null;
  if (tier !== "low" && tier !== "mid" && tier !== "high") return null;
  if (typeof rRatio !== "number" || typeof expectedValueTon !== "number") return null;
  return { verdict, sizeTon, tier, rRatio, expectedValueTon };
}

export function buildOrderRequest(envelope: IngestedEnvelope, opts: BuildOrderOptions): OrderRequest | { error: string } {
  const gated = gatedMetaOf(envelope);
  if (!gated) return { error: `envelope ${envelope.id} is not a gated PASS (no usable meta.gate)` };

  if (gated.sizeTon < (opts.minOrderTon ?? 0.25)) {
    return { error: `order size ${gated.sizeTon.toFixed(4)} TON below minimum ${(opts.minOrderTon ?? 0.25)} TON` };
  }

  const priceTon = envelope.token.priceTon ?? null;
  if (!priceTon || priceTon <= 0) return { error: `envelope ${envelope.id} has no usable quote` };

  const curvePct = envelope.token.curvePct ?? 50;
  const setup = pointSetup({ entryTon: priceTon, curvePct, volPct: GATE_CONFIG.volPct });
  const slippageBps = opts.slippageBps ?? GATE_CONFIG.spreadBpsAllowance;
  const now = opts.now ?? Date.now();
  const orderTtlMs = opts.orderTtlMs ?? 60_000;

  const expectedTokenQty = gated.sizeTon / priceTon;
  const minOutTokenQty = expectedTokenQty * (1 - slippageBps / 10_000);

  const sizeConfirmThresholdTon = opts.sizeConfirmThresholdTon ?? 1.0;
  const liveConfirmFirstNTrades = opts.liveConfirmFirstNTrades ?? 10;
  const confirmRequired = gated.sizeTon > sizeConfirmThresholdTon || (opts.liveTradeCount ?? 0) < liveConfirmFirstNTrades;

  return {
    id: newOrderId(),
    ts: now,
    gatedEnvelopeId: envelope.id,
    source: envelope.source,
    mode: opts.mode,
    side: "buy",
    token: { address: envelope.token.address, ticker: envelope.token.ticker, decimals: envelope.token.decimals },
    amountTon: gated.sizeTon,
    entryTon: priceTon,
    stopLossTon: setup.stopLoss,
    takeProfitTon: setup.takeProfit,
    expectedWinTon: setup.expectedWinTon,
    expectedTokenQty,
    minOutTokenQty,
    slippageBps,
    tier: gated.tier,
    rRatio: gated.rRatio,
    expectedValueTon: gated.expectedValueTon,
    confirmRequired,
    deadlineMs: now + orderTtlMs,
  };
}
