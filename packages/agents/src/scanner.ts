import { BaseAgent } from "./base.js"
import { AgentBus } from "./bus.js"
import { SignalEnvelope } from "@openclaw-ton-agent/shared"

export class MarketScannerAgent extends BaseAgent {
  constructor(bus: AgentBus) {
    super(
      {
        name: "scanner-ops",
        role: "read-only market scanner and signal emitter",
        capabilities: ["emit.signals", "emit.audit"],
        safetyMode: "readonly",
        rateLimitMs: 500,
      },
      bus,
    )
  }

  protected registerBus() {
    this.bus.on("signal.request", async () => {
      // In production, this iterates TONAPI pools/jettons and emits signals.
      // For now this agent advertises its capability; actual scan loop stays
      // in packages/scanner for deterministic coverage and replay fixtures.
      await this.emit("agent.status", "broadcast", {
        status: "ready",
        capability: "emit.signals",
      })
    })
  }

  async publishSignal(signal: SignalEnvelope) {
    await this.emit("signal.published", "risk-gate", signal)
    this.journal.append("signals.ndjson", signal)
  }
}
