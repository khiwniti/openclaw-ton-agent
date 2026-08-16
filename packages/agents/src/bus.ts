import { AgentMessage, Journal } from "@openclaw-ton-agent/shared"
import Redis from "ioredis"

type BusHandler = (message: AgentMessage) => Promise<void> | void

export class AgentBus {
  private redis: Redis
  private handlers = new Map<string, BusHandler[]>()
  private journal = new Journal()

  constructor(redis: Redis) {
    this.redis = redis
  }

  async start() {
    await this.redis.subscribe("agents.broadcast", "agents.direct")
    this.redis.on("message", (_channel, raw) => {
      this.dispatch(raw).catch(() => {})
    })
  }

  async send(message: AgentMessage) {
    const channel = message.to === "broadcast" ? "agents.broadcast" : `agents.direct.${message.to}`
    this.journal.append("bus.ndjson", message)
    await this.redis.publish(channel, JSON.stringify(message))
  }

  on(kind: string, handler: BusHandler) {
    const list = this.handlers.get(kind) || []
    list.push(handler)
    this.handlers.set(kind, list)
  }

  private async dispatch(raw: string) {
    let message: AgentMessage
    try {
      message = JSON.parse(raw) as AgentMessage
    } catch {
      return
    }
    const handlers = this.handlers.get(message.kind) || []
    for (const handler of handlers) {
      await handler(message)
    }
  }
}
