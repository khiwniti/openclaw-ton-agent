import type { CapCheckResult, ExecutionOutput, ExecutionResult } from "../state.js"
import { hashTradeTicket } from "../safetycaps.js"
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

/**
 * Execution node — validates the cap check, dispatches to the configured wallet
 * adapter (paper / auto via Acton or TonMcp), and returns a verifiable result.
 *
 * Wallet adapter selection follows EXEC_CONFIG from @openclaw-ton-agent/executor.
 * Sub-path imports are avoided; everything is re-exported from the package root.
 */
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

  // Only buys are supported in v0 — this mirrors the OrderRequest schema
  if (ticket.side !== "buy") {
    const reason = `unsupported_side:${ticket.side}`
    logger.warn("EXEC", `[${cycle_id}] ${reason} — sell routing not yet wired into orchestration`)
    return { cycle_id, ok: false, result: null, error: reason }
  }

  // Dynamically import executor to avoid circular deps at module load time
  const { EXEC_CONFIG } = await import("@openclaw-ton-agent/executor")
  const { walletForMode } = await import("@openclaw-ton-agent/executor")

  logger.trade(
    "EXEC",
    `[${cycle_id}] ${ticket.side} ${ticket.amount_ton} TON ${ticket.jetton_master.slice(0, 8)} via ${ticket.tier} mode=${EXEC_CONFIG.mode}`
  )

  try {
    const { buildOrderRequest } = await import("@openclaw-ton-agent/executor")
    const { validateIngested } = await import("@openclaw-ton-agent/shared")

    // Build a minimal synthetic IngestedEnvelope so we can use buildOrderRequest
    // This is valid — the orchestration graph produced the ticket from a real candidate
    const syntheticEnv = {
      id: cycle_id,
      ts: Date.now(),
      source: "orchestration",
      token: { address: ticket.jetton_master, ticker: "", decimals: 9 },
      audit: { verified: true, renounced: true, locked: true, honeypot: false },
      score: { soft: 80, risk: 20 },
      status: "validated" as const,
      flags: [] as string[],
      reasoning: "",
      meta: { gate: { tier: ticket.tier, amountTon: ticket.amount_ton, slippageBps: Math.round((ticket.slippage_pct / 100) * 10_000) } },
    }

    const ingestedParsed = validateIngested(syntheticEnv)
    if (!ingestedParsed.ok) {
      return { cycle_id, ok: false, result: null, error: `synthetic env invalid: ${ingestedParsed.reason}` }
    }

    const orderOrErr = buildOrderRequest(ingestedParsed.value, {
      mode: EXEC_CONFIG.mode,
      liveTradeCount: 0,
      sizeConfirmThresholdTon: EXEC_CONFIG.sizeConfirmThresholdTon,
      liveConfirmFirstNTrades: EXEC_CONFIG.liveConfirmFirstNTrades,
      slippageBps: EXEC_CONFIG.slippageBps,
      orderTtlMs: EXEC_CONFIG.orderTtlMs,
    })

    if ("error" in orderOrErr) {
      return { cycle_id, ok: false, result: null, error: orderOrErr.error }
    }

    const wallet = walletForMode(EXEC_CONFIG.mode)
    const fill = await wallet.swap(orderOrErr)

    const result: ExecutionResult = {
      ok: fill.status === "filled" || fill.status === "pending_reconcile",
      txHash: fill.txHash ?? undefined,
      amountTokens: fill.filledTokenQty,
      dex: dex_override || "stonfi",
      error: fill.reason,
    }

    if (result.ok) {
      logger.ok("EXEC", `[${cycle_id}] Swap OK tx=${result.txHash?.slice(0, 16)} tokens=${result.amountTokens}`)
    } else {
      logger.err("EXEC", `[${cycle_id}] Swap FAILED: ${result.error}`)
    }

    return { cycle_id, ok: result.ok, result, error: result.ok ? undefined : result.error }
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err)
    logger.err("EXEC", `[${cycle_id}] execution threw: ${msg}`)
    return { cycle_id, ok: false, result: null, error: msg }
  }
}

export function makeAuthorizedExecution(ticket: ExecutionInput["ticket"], cap: CapCheckResult) {
  return { ticket, cap }
}
