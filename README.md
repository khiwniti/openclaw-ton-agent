# openclaw-ton-agent

Professional autonomous AI multi-agent TON trading system.

## Tech stack
- Runtime: Node.js >=22
- Orchestration: OpenClaw gateway + internal agent bus
- Runtime services: Redis for event transport, Postgres/SQLite for durable state
- Transport: Fastify HTTP API + WebSocket feed for decisions/events
- Trading kernel: @ton/ton + @ton/crypto, Omniston swap execution
- Observability: structured logs, /health live+ready, decision journal
- Deployment: Docker multi-stage + Fly.io app with Redis + optional Postgres

## Run
```bash
cp .env.example .env
npm install
docker compose up -d
npm run dev
```

## Agents
- scanner-ops — read-only signal publication
- risk-analyst — gating, drawdown policy
- executor — mode-enforced order path
- trader-ui — review surface + reporting
