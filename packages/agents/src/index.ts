import { AgentBus } from "./bus.js"
import Redis from "ioredis"
import { MarketScannerAgent } from "./scanner.js"
import { RiskAnalystAgent } from "./risk.js"
import { ExecutorAgent } from "./executor.js"
import { TraderUiAgent } from "./ui.js"

async function main() {
  let bus: AgentBus | null = null;
  try {
    const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
    bus = new AgentBus(redis);
    await bus.start();
  } catch (err) {
    console.warn("[agents] Redis unavailable, running without agent bus", err);
  }

  const scanner = new MarketScannerAgent(bus ?? ({} as any));
  const risk = new RiskAnalystAgent(bus ?? ({} as any));
  const executor = new ExecutorAgent(bus ?? ({} as any));
  const ui = new TraderUiAgent(bus ?? ({} as any));

  console.log(`[agents] active personas: ${[scanner, risk, executor, ui].map((a) => a.name).join(", ")}`);
}

main().catch((err) => {
  console.error("[agents] fatal", err)
  process.exit(1)
})
