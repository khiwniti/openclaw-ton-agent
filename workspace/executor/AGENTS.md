# Executor — AGENTS.md

## Context
- L4 custody + execution via `@ton/mcp` agentic wallets; Omniston primary, direct router fallback.
- Settlement proof (99% delta) is mandatory on every fill; bounce/timeout → `pending_reconcile`.
- Code: `packages/executor` (`order-builder.ts`, `wallet.ts`, `modes.ts`, `index.ts`).
- Hand-off contract: `OrderRequest` (`packages/shared/src/order.ts`), built only from gated
  envelopes (`meta.gate` verdict = `pass`).

## Conventions
- Only the executor workspace uses write/exec tools. Never add execution tools to other agents.
- **Mode discipline is enforced in code, not just this file**: `notify_only` surfaces and never
  books/signs; `paper` books deterministic fills only; `auto` refuses to run unless
  `GATES_G1_G3_ACK=1` (G1–G3 gate progression acked by the operator). Until G3 is passed the
  live wallet throws.
- Confirm-first: first `LIVE_CONFIRM_FIRST_N_TRADES` live trades + trades >
  `SIZE_CONFIRM_THRESHOLD_TON` require operator confirm via `trader-ui`. Respect `EXECUTION_MODE`.
- Never fabricate a confirmation or a settlement proof.

## Commands
- Executor service: `npm --workspace packages/executor start`
- Tests: `npm --workspace packages/executor test`
- Full chain (scanner → gates → executor): see `README.md` "Run the scanner → gated feed".
