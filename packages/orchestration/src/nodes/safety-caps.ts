import type { GramTradeState, CapCheckResult } from "../state.js"
import { authorizeTicket } from "../safetycaps.js"
import { logger } from "@openclaw-ton-agent/core"

export interface CapCheckContext {
  killSwitchActive: boolean
  dailyLossBreached: boolean
  tier: { balanceTon: number; openPositions: number; maxOpen: number; maxPositionTon: number }
}

export function buildCapContext(input: CapCheckContext): CapCheckContext {
  return {
    killSwitchActive: input.killSwitchActive,
    dailyLossBreached: input.dailyLossBreached,
    tier: { ...input.tier },
  }
}

export function makeSafetyCapsNode(getContext: () => CapCheckContext) {
  return (state: GramTradeState) => {
    const ticket = state.proposed_ticket
    if (!ticket) {
      logger.warn("SAFETY_CAPS", "No proposed ticket; discarding")
      return { discarded: true, discard_reason: "no_ticket" } as const
    }

    const ctx = getContext()
    const cap: CapCheckResult = authorizeTicket(ticket, ctx)

    logger.info("SAFETY_CAPS", JSON.stringify({ cycle_id: ticket.cycle_id, ok: cap.ok, reason: cap.reason }))
    return { cap_check_result: cap, discarded: !cap.ok, discard_reason: cap.ok ? undefined : cap.reason } as const
  }
}
