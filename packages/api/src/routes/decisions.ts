import type { FastifyPluginAsync } from "fastify"
import { Journal } from "@openclaw-ton-agent/shared"
import { store } from "@openclaw-ton-agent/storage"
import * as path from "node:path"

const decisionsRoutes: FastifyPluginAsync = async (app) => {
  const dataDir = process.env.DATA_DIR || process.env.JOURNAL_DIR || "./data"
  const network = process.env.TON_NETWORK || "testnet"
  const journal = new Journal(path.join(dataDir, "decisions.ndjson"))
  const ordersJournal = new Journal(path.join(dataDir, `orders-${network}.ndjson`))
  const fillsJournal = new Journal(path.join(dataDir, `fills-${network}.ndjson`))
  const gatedJournal = new Journal(path.join(dataDir, `gated-${network}.ndjson`))
  const signalsJournal = new Journal(path.join(dataDir, `signals-${network}.ndjson`))

  app.get("/", async () => ({ count: journal.tail().length }))
  app.get("/recent", async () => ({ items: journal.tail(100).reverse() }))

  app.get("/orders", async () => ({ count: ordersJournal.tail().length, items: ordersJournal.tail(50).reverse() }))
  app.get("/fills", async () => ({ count: fillsJournal.tail().length, items: fillsJournal.tail(50).reverse() }))
  app.get("/gated", async () => ({ count: gatedJournal.tail().length, items: gatedJournal.tail(50).reverse() }))
  app.get("/signals", async () => ({ count: signalsJournal.tail().length, items: signalsJournal.tail(50).reverse() }))

  app.post("/", async (req, reply) => {
    try {
      const payload = req.body as Record<string, unknown>
      const now = Date.now()
      const row = {
        id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
        cycle_id: String(payload.cycle_id || ""),
        agent: String(payload.agent || "api"),
        input_hash: String(payload.input_hash || ""),
        cap_check_result: String(payload.cap_check_result || ""),
        final_action: String(payload.final_action || "queued"),
        output: JSON.stringify(payload.output || {}),
        created_at: now,
      }

      try {
        store.insert("decision_journal", row)
      } catch (insertErr) {
        const msg = insertErr instanceof Error ? insertErr.message : String(insertErr)
        return reply.code(500).send({ error: "storage_unavailable", detail: msg })
      }

      try {
        journal.append(row)
      } catch (journalErr) {
        const msg = journalErr instanceof Error ? journalErr.message : String(journalErr)
        return reply.code(500).send({ error: "journal_failed", detail: msg })
      }

      const wsServer = (app.server as unknown as { websocketServer?: { clients?: Set<unknown> } }).websocketServer
      if (wsServer?.clients?.size) {
        const payload = JSON.stringify({ type: "decision", data: row })
        for (const client of wsServer.clients) {
          try {
            const c = client as { readyState?: number; send: (data: string) => void }
            if (c.readyState === 1) c.send(payload)
          } catch {
            // ignore dead websocket clients
          }
        }
      }

      return reply.code(201).send(row)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: "decision_failed", detail: msg })
    }
  })
}

export default decisionsRoutes
