import { logger } from "@openclaw-ton-agent/core"
import { makeClient } from "@openclaw-ton-agent/wallet"
import { executeSwap } from "@openclaw-ton-agent/dex"
import { store } from "@openclaw-ton-agent/storage"

export type Tier = "low" | "mid" | "high"

export interface TierHandle {
  tier: Tier
  balanceTon: number
  openPositions: number
  maxPositionTon: number
  maxOpen: number
  address?: string
}

export interface TradeGateInput {
  killSwitchActive: boolean
  dailyLossBreached: boolean
  requestedTon: number
  tier: TierHandle
}

export function evaluateTradeGate(input: TradeGateInput) {
  const reasons: string[] = []
  if (input.killSwitchActive) reasons.push("kill_switch_active")
  if (input.dailyLossBreached) reasons.push("daily_loss_breached")
  if (input.tier.openPositions >= input.tier.maxOpen) reasons.push("max_open_reached")
  if (input.requestedTon > input.tier.maxPositionTon) reasons.push("tier_cap_exceeded")
  if (input.requestedTon > input.tier.balanceTon) reasons.push("insufficient_balance")
  return { allowed: reasons.length === 0, reasons }
}

export class TierCoordinator {
  private tiers: Record<Tier, TierHandle> = {
    low: { tier: "low", balanceTon: 10, openPositions: 0, maxPositionTon: 1, maxOpen: 2 },
    mid: { tier: "mid", balanceTon: 10, openPositions: 0, maxPositionTon: 3, maxOpen: 3 },
    high: { tier: "high", balanceTon: 10, openPositions: 0, maxPositionTon: 5, maxOpen: 4 },
  }

  getTier(tier: Tier): TierHandle {
    return this.tiers[tier]
  }

  isTradeAllowed(input: TradeGateInput) {
    return evaluateTradeGate(input)
  }

  async executeForTier(tier: Tier, req: { side: "buy" | "sell"; jettonMaster: string; amountTon: number }, dex: string, meta: Record<string, unknown>) {
    const handle = this.getTier(tier)
    const gate = evaluateTradeGate({ killSwitchActive: false, dailyLossBreached: false, requestedTon: req.amountTon, tier: handle })
    if (!gate.allowed) {
      logger.warn("COORD", `gate denied ${gate.reasons.join(",")}`)
      return { ok: false, error: `gate: ${gate.reasons.join(",")}`, cap: { ok: false, reason: gate.reasons.join(",") } }
    }
    const client = makeClient()
    const result = await executeSwap(client, req, dex as any)
    logger.info("COORD", JSON.stringify({ tier, req, result, meta }))
    store.insert("decision_journal", { id: `${Date.now()}-${Math.random()}`, cycle_id: (meta.cycleId as string) || "", agent: "coordinator", input_hash: "", cap_check_result: "", final_action: result.ok ? "execute_ok" : "execute_failed", output: JSON.stringify(result), created_at: Date.now() })
    return { ...result, cap: { ok: true } }
  }
}

export const coordinator = new TierCoordinator()
