# Architecture

## Objective
Operate an autonomous AI multi-agent TON trading system with explicit trading-system guardrails:
pre-trade gating, regime-aware execution, kill-switch safety, paper-first progression, durable
event journals, and live review/override surfaces.

## Principles
1. Safety over throughput.
2. Deterministic gating and exit logic.
3. Human review points for mode changes and risk parameter updates.
4. Observability by default: every decision and error is journaled.

## Stack
- Node 22 + TypeScript
- OpenClaw for orchestration
- Redis for agent event bus
- Postgres for durable state, SQLite for local journals
- Fastify for API and WebSocket feeds
- Fly.io for always-on processes

## Layering
- L1: scanner-ops agent / scanner package
- L2: market-intel agent
- L3: risk-analyst agent + risk gates
- L4: executor agent + exit manager
- L5: trader-ui agent + API
