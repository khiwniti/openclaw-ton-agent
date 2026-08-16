import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildGramSupervisorGraph } from "../graph.js"

describe("gram supervisor graph", () => {
  it("discards cycles when risk rejects", async () => {
    const graph = buildGramSupervisorGraph(() => ({ killSwitchActive: false, dailyLossBreached: false, tier: { balanceTon: 10, openPositions: 0, maxOpen: 3, maxPositionTon: 5 } }))
    const state = await graph.run({
      cycle_id: "graph-risk-reject",
      tier: "low",
      seed_jetton_master: "EQ-placeholder-jetton-master",
      open_positions: 0,
      discarded: false,
      todo_plan: [],
    })
    assert.equal(state.discarded, true)
    assert.equal(state.discard_reason, "risk_rejected")
  })
})
