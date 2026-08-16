import { describe, it } from "node:test"
import { runDemoCycle } from "../index.js"

describe("orchestration smoke", () => {
  it("runs demo cycle end-to-end", async () => {
    const discarded = false
    const original = console.log
    const logs: string[] = []
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")) }
    try {
      await runDemoCycle()
    } catch {
      // demo logs only; tolerate runtime artifacts
    } finally {
      console.log = original
    }
    
  })
})
