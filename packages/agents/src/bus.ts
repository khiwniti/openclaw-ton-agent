import { AgentMessage, Journal } from "@openclaw-ton-agent/shared"
import Redis from "ioredis"

type BusHandler = (message: AgentMessage) => Promise<void> | void

export class AgentBus {
  private redis: Redis | null
  private handlers = new Map<string, BusHandler[]>()
  private journal = new Journal()

  constructor(redis?: Redis | null) {
    this.redis = redis ?? null
  }

  async start() {
    if (this.redis) {
      await this.redis.subscribe("agents.broadcast", "agents.direct")
      this.redis.on("message", (_channel, raw) => {
        this.dispatch(raw).catch(() => {})
      })
    }
  }

  async send(message: AgentMessage) {
    const channel = message.to === "broadcast" ? "agents.broadcast" : `agents.direct.${message.to}`
    this.journal.append(message as unknown as Record<string, unknown>)


    if (this.redis) {
      await this.redis.publish(channel, JSON.stringify(message))
    }
    await this.dispatch(JSON.stringify(message))
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
