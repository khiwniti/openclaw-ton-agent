---
name: ton-risk-gates
description: Deterministic gating and sizing for candidate trades — R:R pre-filter, Kelly sizing against tier ceilings, cooldown, correlation reduction, and drawdown checks. Use before any execution verdict.
---

# ton-risk-gates

Applies deterministic risk gates that OUTRANK any LLM verdict. Port from ton-agent `risk/` and `safetycaps/`.

## Gates (all must pass)
1. **R:R pre-filter** — expected win must cover `2 × network_fee (0.1 TON/side)` + spread; else reject.
2. **Kelly sizing** — `f* = (p·b − (1−p)) / b`, capped by tier ceiling; position floor such that fees do not dominate.
3. **Cooldown** — per-token `COOLDOWN_MS` (config).
4. **Correlation** — reject a candidate that mirrors an open position beyond threshold.
5. **Drawdown / circuit breaker** — rolling drawdown ≥ `CIRCUIT_BREAKER_DRAWDOWN_PCT` → halt.
6. **Kill switch** — poll `KILL_SWITCH_URL`; flipped → all gates fail closed.

## Output
`{ verdict: pass|reject, reason, sizeTon, rRatio, expectedValue }` → journaled.
