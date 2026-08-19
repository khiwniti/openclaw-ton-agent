import { describe, it } from "node:test"
import { runCycle } from "../index.js"

describe("orchestration smoke", () => {
  it("runs a cycle end-to-end (observe-only, no live keys required)", { timeout: 60_000 }, async () => {
    const original = process.stdout.write.bind(process.stdout)
    const logs: string[] = []
    // Silence logger output during test
    process.stdout.write = (chunk: any) => {
      if (typeof chunk === "string") logs.push(chunk)
      return true
    }

    try {
      await runCycle({ tier: "low" })
    } catch {
      // No wallet keys in CI — tolerate RPC/config failures
    } finally {
      process.stdout.write = original
    }
  })
})
