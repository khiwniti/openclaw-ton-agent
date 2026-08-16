import type { StrategyInput, StrategyOutput } from "../state.js"
import { logger } from "@openclaw-ton-agent/core"

export function calculateMaxSize(input: StrategyInput): number {
  const maxSize = Math.min(input.tier_state.max_position_ton, input.tier_state.balance_ton)
  if (maxSize <= 0) return 0
  return Math.floor(maxSize * 1000) / 1000
}

export async function strategyNode(input: StrategyInput): Promise<StrategyOutput> {
  const { cycle_id, candidate, risk_assessment, tier_state } = input
  const maxSize = calculateMaxSize(input)
  if (maxSize <= 0) {
    return { cycle_id, ticket: null, rationale: `sizing=0 max=${maxSize}` }
  }
  const ticket = {
    cycle_id,
    tier: input.tier,
    side: "buy",
    jetton_master: candidate.jetton_master,
    amount_ton: maxSize,
    slippage_pct: 0.5,
    pool_tvl_ton: candidate.pool_tvl_ton,
    ai_score: risk_assessment.score,
  } as const
  const rationale = `Size ${maxSize} TON = min(tier cap ${tier_state.max_position_ton}, balance ${tier_state.balance_ton})`
  logger.info("STRATEGY", JSON.stringify({ cycle_id, ticket, rationale }))
  return { cycle_id, ticket, rationale }
}
