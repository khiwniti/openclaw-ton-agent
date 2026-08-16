import type { CapCheckResult, ExecutionOutput, ExecutionResult, GramTradeState } from "../state.js"
import { authorizeTicket, hashTradeTicket } from "../safetycaps.js"
import { logger } from "@openclaw-ton-agent/core"

export interface ExecutionInput {
  cycle_id: string
  ticket: {
    cycle_id: string
    tier: "low" | "mid" | "high"
    side: "buy" | "sell"
    jetton_master: string
    amount_ton: number
    slippage_pct: number
    pool_tvl_ton?: number
    ai_score?: number
  }
  cap: CapCheckResult
  dex_override?: "stonfi" | "dedust"
}

export async function executionNode(input: ExecutionInput): Promise<ExecutionOutput> {
  const { cycle_id, ticket, cap, dex_override } = input
  if (!cap.ok) {
    const reason = cap.reason || "cap_not_ok"
    logger.err("EXEC", `[${cycle_id}] ${reason}`)
    return { cycle_id, ok: false, result: null, error: reason }
  }
  if (hashTradeTicket(ticket as any) !== cap.ticket_hash) {
    const reason = "ticket_hash_mismatch"
    logger.err("EXEC", `[${cycle_id}] ${reason}`)
    return { cycle_id, ok: false, result: null, error: reason }
  }

  logger.trade("EXEC", `[${cycle_id}] ${ticket.side} ${ticket.amount_ton} TON ${ticket.jetton_master.slice(0, 8)} via ${ticket.tier}`)
  const result: ExecutionResult = { ok: true, txHash: "simulated_tx", amountTokens: 0, dex: dex_override || "stonfi" }
  logger.ok("EXEC", `[${cycle_id}] Swap OK tx=${result.txHash?.slice(0, 16)} tokens=${result.amountTokens}`)
  return { cycle_id, ok: true, result, error: undefined }
}

export function makeAuthorizedExecution(ticket: ExecutionInput["ticket"], cap: CapCheckResult) {
  return { ticket, cap }
}
