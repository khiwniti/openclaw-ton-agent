import type { FastifyPluginAsync } from "fastify"

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/live", async () => ({ status: "ok", ts: Date.now() }))
  app.get("/ready", async () => {
    // Extend with datastore checks when available.
    return { status: "ok", ts: Date.now() }
  })
}

export default healthRoutes
