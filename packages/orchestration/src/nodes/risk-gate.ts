import type { GramTradeState } from "../state.js"
import { logger } from "@openclaw-ton-agent/core"

export function riskGateNode(state: GramTradeState) {
  const risk = state.risk_assessment
  if (!risk) {
    return { discarded: true, discard_reason: "no_risk_assessment" } as const
  }
  if (risk.verdict === "reject") {
    logger.warn("RISK_GATE", `reject cycle_id=${state.cycle_id}`)
    return { discarded: true, discard_reason: "risk_rejected" } as const
  }
  logger.info("RISK_GATE", `allow cycle_id=${state.cycle_id} score=${risk.score}`)
  return { discarded: false } as const
}
