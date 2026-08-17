import { buildGramSupervisorGraph } from "./graph.js"
import { logger } from "@openclaw-ton-agent/core"


/**
 * Run one orchestration cycle. The seed jetton master is read from the
 * environment (SEED_JETTON_MASTER) or left undefined so the market scanner
 * node performs a live scan via TonAPI.
 */
export async function runCycle(opts?: {
  seedJettonMaster?: string
  tier?: "low" | "mid" | "high"
}) {
  const tier = opts?.tier ?? "low"
  const seedJettonMaster = opts?.seedJettonMaster ?? process.env.SEED_JETTON_MASTER

  const graph = buildGramSupervisorGraph(() => ({
    killSwitchActive: false,
    dailyLossBreached: false,
    tier: {
      balanceTon: Number(process.env.TIER_BALANCE_TON ?? 10),
      openPositions: 0,
      maxOpen: Number(process.env.MAX_OPEN_POSITIONS_PER_TIER ?? 3),
      maxPositionTon: Number(process.env.MAX_POSITION_TON ?? 5),
    },
  }))

  const state = await graph.run({
    cycle_id: `cycle-${Date.now()}`,
    tier,
    seed_jetton_master: seedJettonMaster,
    candidate: undefined,
    risk_assessment: undefined,
    proposed_ticket: undefined,
    cap_check_result: undefined,
    execution_result: undefined,
    open_positions: 0,
    discarded: false,
    discard_reason: undefined,
    todo_plan: [],
    journal_ref: undefined,
  })

  logger.info("ORCHESTRATION", JSON.stringify({
    discarded: state.discarded,
    reason: state.discard_reason,
    txHash: state.execution_result?.txHash,
  }))

  return state
}

if (process.argv[1] && process.argv[1].includes("index.ts")) {
  runCycle().catch((err) => {
    logger.err("ORCHESTRATION", `fatal: ${(err as Error)?.message ?? err}`)
    process.exit(1)
  })
}

