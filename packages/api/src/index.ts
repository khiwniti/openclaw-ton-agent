import Fastify from "fastify"
import cors from "@fastify/cors"
import helmet from "@fastify/helmet"
import rateLimit from "@fastify/rate-limit"
import websocket from "@fastify/websocket"
import health from "./routes/health.js"
import decisions from "./routes/decisions.js"
import ws from "./routes/ws.js"

export async function build() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || "info" },
  })

  await app.register(cors)
  await app.register(helmet)
  await app.register(rateLimit, { global: true, max: 200, timeWindow: "1 minute" })
  await app.register(websocket)

  await app.register(health, { prefix: "/health" })
  await app.register(decisions, { prefix: "/api/decisions" })
  await app.register(ws, { prefix: "/ws" })

  return app
}

async function start() {
  const app = await build()
  const port = Number(process.env.API_PORT || 3000)
  const host = process.env.API_HOST || "0.0.0.0"

  app.listen({ port, host }).catch((err) => {
    app.log.error(err)
    process.exit(1)
  })

  app.log.info(`[api] listening on ${host}:${port}`)
}

if (process.argv[1] && process.argv[1].includes("index.ts")) {
  start().catch((err) => {
    console.error("[api] fatal", err)
    process.exit(1)
  })
}
