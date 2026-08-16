import { randomUUID } from "node:crypto"
import { AgentBus } from "./bus.js"
import { AgentMessage, Journal } from "@openclaw-ton-agent/shared"

export type AgentPersona = {
  name: string
  role: string
  capabilities: string[]
  safetyMode: "readonly" | "paper" | "auto"
  rateLimitMs: number
}

export abstract class BaseAgent {
  readonly name: string
  readonly role: string
  protected readonly bus: AgentBus
  protected lastActionMs = 0
  protected readonly journal = new Journal()

  constructor(persona: AgentPersona, bus: AgentBus) {
    this.name = persona.name
    this.role = persona.role
    this.bus = bus
    this.registerBus()
  }

  protected abstract registerBus(): void

  protected async emit(kind: string, to: string, payload: Record<string, unknown>) {
    const message: AgentMessage = {
      id: randomUUID(),
      from: this.name,
      to,
      kind,
      payload: { ...payload, _agent: this.name },
      ts: Date.now(),
    }
    await this.bus.send(message)
  }

  protected async enqueue(kind: string, to: string, payload: Record<string, unknown>) {
    const now = Date.now()
    const persona = this.persona()
    if (now - this.lastActionMs < persona.rateLimitMs) {
      return
    }
    this.lastActionMs = now
    await this.emit(kind, to, payload)
  }

  protected persona(): AgentPersona {
    return {
      name: this.name,
      role: this.role,
      capabilities: [],
      safetyMode: "readonly",
      rateLimitMs: 1000,
    }
  }
}
