import type { Tier, TierHandle } from "./state.js"

export const ALL_TIERS: Tier[] = ["low", "mid", "high"]

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
