import type { TradeTicket } from "./state.js"

export const CAPS_VERSION = 1

export function hashTradeTicket(ticket: TradeTicket): string {
  const payload = JSON.stringify(ticket)
  let hash = 0
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i)
    hash = ((hash << 5) - hash + c) | 0
  }
  return `ticket_${Math.abs(hash).toString(16)}`
}

export function authorizeTicket(
  ticket: TradeTicket,
  ctx: { killSwitchActive: boolean; dailyLossBreached: boolean; tier: { balanceTon: number; openPositions: number; maxOpen: number; maxPositionTon: number } }
): { ok: boolean; reason?: string; ticket_hash?: string; cycle_id?: string; issued_at?: number } {
  if (ctx.killSwitchActive) {
    return { ok: false, reason: "kill_switch_active", ticket_hash: hashTradeTicket(ticket), cycle_id: ticket.cycle_id, issued_at: Date.now() }
  }
  if (ctx.dailyLossBreached) {
    return { ok: false, reason: "daily_loss_limit_breached", ticket_hash: hashTradeTicket(ticket), cycle_id: ticket.cycle_id, issued_at: Date.now() }
  }
  if (ctx.tier.openPositions >= ctx.tier.maxOpen) {
    return { ok: false, reason: "max_open_positions_reached", ticket_hash: hashTradeTicket(ticket), cycle_id: ticket.cycle_id, issued_at: Date.now() }
  }
  if (ticket.amount_ton > ctx.tier.maxPositionTon) {
    return { ok: false, reason: "tier_position_cap_exceeded", ticket_hash: hashTradeTicket(ticket), cycle_id: ticket.cycle_id, issued_at: Date.now() }
  }
  if (ticket.amount_ton > ctx.tier.balanceTon) {
    return { ok: false, reason: "insufficient_balance", ticket_hash: hashTradeTicket(ticket), cycle_id: ticket.cycle_id, issued_at: Date.now() }
  }
  return { ok: true, ticket_hash: hashTradeTicket(ticket), cycle_id: ticket.cycle_id, issued_at: Date.now() }
}

export function verifyCapBinding(ticket: TradeTicket, cap: { ok: boolean; ticket_hash?: string; cycle_id?: string }): boolean {
  return cap.ok && cap.ticket_hash === hashTradeTicket(ticket) && cap.cycle_id === ticket.cycle_id
}

export function consumeAuthorization(_cap: { ok: boolean }): void {
  // deterministic single-use policy hook
}
