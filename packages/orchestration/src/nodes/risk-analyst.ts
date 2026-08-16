import type { RiskAnalystInput, RiskAssessment } from "../state.js"
import { logger } from "@openclaw-ton-agent/core"

export async function riskAnalystNode(input: RiskAnalystInput): Promise<{ assessment: RiskAssessment }> {
  const score = input.candidate?.holders ? Math.min(100, Math.floor((input.candidate.liquidity_ton ?? 0) / 10) + 20) : 20
  const verdict: RiskAssessment["verdict"] = score >= 60 ? "pass" : score >= 35 ? "caution" : "reject"
  const reasons = [`liquidity_ton=${input.candidate?.liquidity_ton ?? 0}`, `holders=${input.candidate?.holders ?? 0}`]
  logger.info("RISK_ANALYST", JSON.stringify({ cycle_id: input.cycle_id, score, verdict }))
  return { assessment: { score, verdict, reasons } }
}
