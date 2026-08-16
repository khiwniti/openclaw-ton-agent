import type { FastifyPluginAsync } from "fastify"

const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: { type: string; data?: Record<string, unknown> }; Querystring: { stream?: string } }>(
    "/decisions",
    { websocket: true },
    (connection) => {
      connection.socket.on("message", (raw: any) => {
        try {
          const msg = JSON.parse(String(raw))
          if (msg.type === "subscribe") {
            connection.socket.send(JSON.stringify({ type: "subscribed", stream: msg.stream || "decisions.ndjson" }))
          }
        } catch {
          // ignore malformed client messages
        }
      })

      connection.socket.send(JSON.stringify({ type: "system", status: "connected" }))
    }
  )
}

export default wsRoutes
