import type { FastifyPluginAsync } from "fastify"

const healthRoutes: FastifyPluginAsync = async (app) => {
  const ok = async () => ({ status: "ok", ts: Date.now() })
  app.get("/", ok)
  app.get("/live", ok)
  app.get("/ready", ok)
}

export default healthRoutes
