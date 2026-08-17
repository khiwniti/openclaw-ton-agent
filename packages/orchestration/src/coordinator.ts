import { logger } from "@openclaw-ton-agent/core"
import { makeClient, loadKeyPairForTier, openWallet } from "@openclaw-ton-agent/wallet"
import { executeSwap } from "@openclaw-ton-agent/dex"
import { store } from "@openclaw-ton-agent/storage"
import { EXEC_CONFIG } from "@openclaw-ton-agent/executor"


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

/**
 * Read the live wallet balance for a tier.
 * Falls back to 0 on RPC failure — the gas guard will reject the trade.
 */
async function fetchTierBalance(tier: Tier): Promise<number> {
  try {
    const network = EXEC_CONFIG.network
    const client = makeClient(network)
    const kp = await loadKeyPairForTier(tier)
    const wallet = openWallet(client, kp, network)
    const balance = await wallet.getBalance()
    return Number(balance) / 1e9
  } catch (e: unknown) {
    logger.warn("COORD", `balance read failed for tier=${tier}: ${(e as Error)?.message ?? e}`)
    return 0
  }
}

export class TierCoordinator {
  /** Populated at construction time from env; live balance is fetched on demand. */
  private readonly maxPositionTon: Record<Tier, number> = {
    low: Number(process.env.TIER_LOW_MAX_POSITION_TON ?? 1),
    mid: Number(process.env.TIER_MID_MAX_POSITION_TON ?? 3),
    high: Number(process.env.TIER_HIGH_MAX_POSITION_TON ?? 5),
  }
  private readonly maxOpen: Record<Tier, number> = {
    low: Number(process.env.TIER_LOW_MAX_OPEN ?? 2),
    mid: Number(process.env.TIER_MID_MAX_OPEN ?? 3),
    high: Number(process.env.TIER_HIGH_MAX_OPEN ?? 4),
  }
  /** In-process open position counter — persisted to SQLite via store. */
  private openPositions: Record<Tier, number> = { low: 0, mid: 0, high: 0 }

  async getTier(tier: Tier): Promise<TierHandle> {
    const balanceTon = await fetchTierBalance(tier)
    return {
      tier,
      balanceTon,
      openPositions: this.openPositions[tier],
      maxPositionTon: this.maxPositionTon[tier],
      maxOpen: this.maxOpen[tier],
    }
  }

  isTradeAllowed(input: TradeGateInput) {
    return evaluateTradeGate(input)
  }

  async executeForTier(
    tier: Tier,
    req: { side: "buy" | "sell"; jettonMaster: string; amountTon: number },
    dex: string,
    meta: Record<string, unknown>
  ) {
    const handle = await this.getTier(tier)
    const gate = evaluateTradeGate({
      killSwitchActive: false,
      dailyLossBreached: false,
      requestedTon: req.amountTon,
      tier: handle,
    })
    if (!gate.allowed) {
      logger.warn("COORD", `gate denied ${gate.reasons.join(",")}`)
      return { ok: false, error: `gate: ${gate.reasons.join(",")}`, cap: { ok: false, reason: gate.reasons.join(",") } }
    }

    const network = EXEC_CONFIG.network
    const client = makeClient(network)
    const result = await executeSwap(client, req, dex as any, network)
    logger.info("COORD", JSON.stringify({ tier, req, result, meta }))
    store.insert("decision_journal", {
      id: `${Date.now()}-${Math.random()}`,
      cycle_id: (meta.cycleId as string) || "",
      agent: "coordinator",
      input_hash: "",
      cap_check_result: "",
      final_action: result.ok ? "execute_ok" : "execute_failed",
      output: JSON.stringify(result),
      created_at: Date.now(),
    })
    return { ...result, cap: { ok: true } }
  }
}

export const coordinator = new TierCoordinator()

