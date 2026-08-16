import { BaseAgent } from "./base.js"
import { AgentBus } from "./bus.js"
import { TradeDecision } from "@openclaw-ton-agent/shared"

export class TraderUiAgent extends BaseAgent {
  constructor(bus: AgentBus) {
    super(
      {
        name: "trader-ui",
        role: "surface events for review, override, and reporting",
        capabilities: ["report.decision", "report.system"],
        safetyMode: "readonly",
        rateLimitMs: 1000,
      },
      bus,
    )
  }

  protected registerBus() {
    this.bus.on("decision.written", async (m) => {
      const decision = m.payload as TradeDecision
      await this.emit("ui.decision", "broadcast", {
        decision,
        humanAction: "review",
      })
    })
  }
}
