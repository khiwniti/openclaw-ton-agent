import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { evaluateTradeGate } from "../gate.js"

describe("evaluateTradeGate", () => {
  it("allows clean trade", () => {
    const result = evaluateTradeGate({
      killSwitchActive: false,
      dailyLossBreached: false,
      requestedTon: 1,
      tier: { tier: "low", openPositions: 0, maxOpen: 3, balanceTon: 10, maxPositionTon: 5 },
    })
    assert.equal(result.allowed, true)
    assert.deepEqual(result.reasons, [])
  })

  it("rejects kill switch", () => {
    const result = evaluateTradeGate({
      killSwitchActive: true,
      dailyLossBreached: false,
      requestedTon: 1,
      tier: { tier: "low", openPositions: 0, maxOpen: 3, balanceTon: 10, maxPositionTon: 5 },
    })
    assert.equal(result.allowed, false)
    assert.ok(result.reasons.includes("kill_switch_active"))
  })

  it("rejects insufficient balance", () => {
    const result = evaluateTradeGate({
      killSwitchActive: false,
      dailyLossBreached: false,
      requestedTon: 11,
      tier: { tier: "low", openPositions: 0, maxOpen: 3, balanceTon: 10, maxPositionTon: 5 },
    })
    assert.equal(result.allowed, false)
    assert.ok(result.reasons.includes("insufficient_balance"))
  })
})
