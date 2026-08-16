import { buildGramSupervisorGraph } from "./graph.js"
import { executionNode, makeAuthorizedExecution } from "./nodes/execution.js"



export async function runDemoCycle() {
  const graph = buildGramSupervisorGraph(() => ({
    killSwitchActive: false,
    dailyLossBreached: false,
    tier: { balanceTon: 10, openPositions: 0, maxOpen: 3, maxPositionTon: 5 },
  }))
  const state = await graph.run({
    cycle_id: `cycle-${Date.now()}`,
    tier: "low",
    seed_jetton_master: "EQ-placeholder-jetton-master",
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
  console.info("GRAPH", JSON.stringify({ discarded: state.discarded, reason: state.discard_reason }))
}

if (process.argv[1] && process.argv[1].includes("index.ts")) {
  runDemoCycle().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
