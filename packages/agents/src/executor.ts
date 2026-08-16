import { BaseAgent } from "./base.js"
import { AgentBus } from "./bus.js"

export class ExecutorAgent extends BaseAgent {
  constructor(bus: AgentBus) {
    super(
      {
        name: "executor",
        role: "mode-enforced order execution and custody policy",
        capabilities: ["execute.order", "execute.paper"],
        safetyMode: "paper",
        rateLimitMs: 200,
      },
      bus,
    )
  }

  protected registerBus() {
    this.bus.on("order.gated", async (m) => {
      await this.emit("decision.written", "broadcast", {
        decisionId: crypto.randomUUID(),
        orderId: (m.payload.orderId as string) || crypto.randomUUID(),
        outcome: "queued",
      })
    })
  }
}
