import { describe, it } from "node:test"
import assert from "node:assert/strict"
import Fastify from "fastify"
import decisions from "../routes/decisions.js"

describe("api decisions", () => {
  it("accepts decision journal entry", async () => {
    const app = Fastify({ logger: false })
    await app.register(decisions, { prefix: "/api/decisions" })
    const response = await app.inject({
      method: "POST",
      url: "/api/decisions",
      payload: { cycle_id: "api-1", final_action: "queued" },
    })
    assert.equal(response.statusCode, 201)
    const body = JSON.parse(response.payload)
    assert.equal(body.final_action, "queued")
    assert.ok(body.id)
    await app.close()
  })

  it("returns recent decisions", async () => {
    const app = Fastify({ logger: false })
    await app.register(decisions, { prefix: "/api/decisions" })
    const response = await app.inject({ method: "GET", url: "/api/decisions/recent" })
    assert.equal(response.statusCode, 200)
    const body = JSON.parse(response.payload)
    assert.ok(Array.isArray(body.items))
    await app.close()
  })
})
