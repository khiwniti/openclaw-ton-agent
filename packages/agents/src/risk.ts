import { BaseAgent } from "./base.js"
import { AgentBus } from "./bus.js"

export class RiskAnalystAgent extends BaseAgent {
  constructor(bus: AgentBus) {
    super(
      {
        name: "risk-analyst",
        role: "pre-trade gating and circuit breaker policy",
        capabilities: ["gate.trades", "monitor.drawdown"],
        safetyMode: "paper",
        rateLimitMs: 250,
      },
      bus,
    )
  }

  protected registerBus() {
    this.bus.on("order.request", async (m) => {
      await this.emit("order.gated", "executor", {
        orderId: (m.payload.orderId as string) || crypto.randomUUID(),
        allowed: false,
        reason: "risk-analyst-agent-default-deny",
        original: m.payload,
      })
    })
  }

  async gateDecision(payload: Record<string, unknown>) {
    await this.enqueue("order.request", "executor", payload)
  }
}
