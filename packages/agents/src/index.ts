import { AgentBus } from "./bus.js"
import Redis from "ioredis"
import { MarketScannerAgent } from "./scanner.js"
import { RiskAnalystAgent } from "./risk.js"
import { ExecutorAgent } from "./executor.js"
import { TraderUiAgent } from "./ui.js"

async function main() {
  let bus: AgentBus
  const redisUrl = process.env.REDIS_URL
  if (redisUrl && redisUrl !== "none" && redisUrl !== "disabled") {
    try {
      const redis = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        enableOfflineQueue: false,
      })
      redis.on("error", () => {})
      await redis.connect()
      bus = new AgentBus(redis)
      await bus.start()
      console.log("[agents] connected to Redis agent bus")
    } catch {
      console.warn("[agents] Redis unavailable, running in-memory agent bus")
      bus = new AgentBus(null)
    }
  } else {
    bus = new AgentBus(null)
  }

  const scanner = new MarketScannerAgent(bus)
  const risk = new RiskAnalystAgent(bus)
  const executor = new ExecutorAgent(bus)
  const ui = new TraderUiAgent(bus)

  console.log(`[agents] active personas: ${[scanner, risk, executor, ui].map((a) => a.name).join(", ")}`)
}

main().catch((err) => {
  console.error("[agents] fatal", err)
  process.exit(1)
})
