import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { authorizeTicket, hashTradeTicket, CAPS_VERSION } from "../safetycaps.js"

describe("safety caps", () => {
  it("issues authorization when healthy", () => {
    const ticket = { cycle_id: "c1", tier: "low" as const, side: "buy" as const, jetton_master: "EQ1", amount_ton: 1, slippage_pct: 0.5 }
    const cap = authorizeTicket(ticket, { killSwitchActive: false, dailyLossBreached: false, tier: { balanceTon: 10, openPositions: 0, maxOpen: 3, maxPositionTon: 5 } })
    assert.equal(cap.ok, true)
    assert.ok(cap.ticket_hash)
    assert.equal(cap.cycle_id, "c1")
    assert.equal(cap.issued_at !== undefined, true)
  })

  it("blocks on kill switch", () => {
    const ticket = { cycle_id: "c2", tier: "low" as const, side: "buy" as const, jetton_master: "EQ1", amount_ton: 1, slippage_pct: 0.5 }
    const cap = authorizeTicket(ticket, { killSwitchActive: true, dailyLossBreached: false, tier: { balanceTon: 10, openPositions: 0, maxOpen: 3, maxPositionTon: 5 } })
    assert.equal(cap.ok, false)
    assert.equal(cap.reason, "kill_switch_active")
  })

  it("has stable binding when ticket unchanged", () => {
    const ticket = { cycle_id: "c3", tier: "low" as const, side: "buy" as const, jetton_master: "EQ1", amount_ton: 1, slippage_pct: 0.5 }
    const first = hashTradeTicket(ticket)
    const second = hashTradeTicket(ticket)
    assert.equal(first, second)
  })

  it("exposes cap version", () => {
    assert.equal(typeof CAPS_VERSION, "number")
  })
})
