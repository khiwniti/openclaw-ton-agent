---
name: ton-audit
description: Read-only jetton/pool audit — holder concentration, liquidity depth, honeypot/renounce flags, curve sanity. Use before any candidate reaches the risk analyst.
---

# ton-audit

Read-only verification of a token/pool. Port from ton-agent `security/audit.ts` + `security/pool-resolver.ts`.

## Checks
- Holder concentration (top-10% cap) — hard gate.
- Liquidity depth vs min liquidity — hard gate.
- Honeypot / renounce / owner-modifiable flags — hard gate.
- Curve sanity (buy-side liquidity band) — soft gate, contributes to `score`.

## Output
`{ pass: hard[], soft: { curveBand, holders } , auditTtlMs }` cached per `CONFIG.security`.
