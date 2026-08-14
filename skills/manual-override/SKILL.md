---
name: manual-override
description: Operator-only commands to force-close, halt, or flip risk posture. The trader-ui persona surfaces these; nothing else invokes them.
---

# manual-override

Emergency and override surface for the operator (via `trader-ui`).

## Commands
- `/forcesell <pool> <pct>` — force-close a position at live `minOut`.
- `/halt` — kill switch: freeze scanning AND execution; only operator unhalts.
- `/reset` — clear cooldowns/journal state (post-mortem only).

## Rules
- Overrides bypass the LLM loop but NEVER bypass settlement proof or minOut.
- Every override is journaled with `operator`, `reason`, `ts`.
- Kill switch stays operator-invokable at all times (G4 enforcement path).
