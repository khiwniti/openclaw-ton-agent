---
name: ton-execute
description: Execute swaps through @ton/mcp agentic wallets (Omniston) or the direct Ston.fi/DeDust router fallback, with settlement proof and gas guards. Use for any buy/sell of TON assets. Owned exclusively by the executor persona.
---

# ton-execute

The ONLY execution path in the system; owned exclusively by the `executor` persona.
Code lives in `packages/executor` (`config.ts`, `order-builder.ts`, `wallet.ts`, `modes.ts`).

## Hand-off contract
Input is an `OrderRequest` (`packages/shared/src/order.ts`), built deterministically from a
gated envelope (`meta.gate`, verdict must be `pass`). Nothing else may reach a wallet.

## Hard rules (enforced in code, not just prompts)
1. **Mode discipline** — `notify_only` surfaces to `trader-ui` and never books or signs;
   `paper` books a deterministic fill only; `auto` is the ONLY mode that can touch live funds.
2. **G1–G3 gate progression** — live swaps throw unless `EXECUTION_MODE=auto` AND
   `GATES_G1_G3_ACK=1` (see `TonMcpWallet` guards). Until G3 is passed this always fails.
3. **Confirm-first** — first `LIVE_CONFIRM_FIRST_N_TRADES` live trades + any trade >
   `SIZE_CONFIRM_THRESHOLD_TON` require operator confirm via `trader-ui`
   (`confirmRequired` on the order).
4. **Compute minOut from live reserves + `slippage_bps`**, never API quotes.
5. **Settlement proof** — verify 99% balance delta before booking; bounce/timeout →
   `pending_reconcile`. Never fabricate a confirmation.

## Workflow
1. Read the gated feed (`data/gated-*.ndjson`) → `buildOrderRequest` (executor).
2. Validate the `OrderRequest` (`validateOrderRequest`) — malformed orders never sign.
3. Run through `Executor.submit` under the active `EXECUTION_MODE`.
4. Journal order + fill (`orders-*.ndjson`, `fills-*.ndjson`).

## Output
`{ txHash, mode, filledAmount, minOut, slippageBps, status: filled|bounced|pending_reconcile }`.

## Tests
`npm --workspace packages/executor test`
