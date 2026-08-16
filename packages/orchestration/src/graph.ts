import type { GramTradeState } from "./state.js"

export type CompiledGramGraph = {
  run: (state: GramTradeState) => Promise<GramTradeState>
}

export function buildGramSupervisorGraph(
  getContext: () => import("./nodes/safety-caps.js").CapCheckContext
): CompiledGramGraph {
  return {
    async run(state: GramTradeState): Promise<GramTradeState> {
      const { supervisorNode } = await import("./nodes/supervisor.js")
      const { makeSafetyCapsNode } = await import("./nodes/safety-caps.js")
      const safetyCaps = makeSafetyCapsNode(getContext)

      let current = state
      for (let step = 0; step < 20; step++) {
        const next = current.proposed_ticket ? "safety_caps" : "supervisor"
        if (next === "supervisor") {
          const out = await supervisorNode(current, async (tier) => ({ balance_ton: 10, open_positions: current.open_positions, max_position_ton: 5, max_open: 3 }))
          current = { ...current, ...(out.state as any), discarded: current.discarded || out.state.discarded || false, discard_reason: out.state.discard_reason || current.discard_reason }
          if (out.next === "end" || out.next === "execution" || out.next === "postmortem") break
          continue
        }

        const capOut = safetyCaps(current)
        current = { ...current, ...(capOut as any), discarded: current.discarded || (capOut as any).discarded }
        break
      }

      return current
    },
  }
}
