# Simulation Wallet Design

**Date:** 2026-08-18  
**Status:** Approved  
**Scope:** `packages/executor/src/simulation-wallet.ts` + one wrap in `continuous.ts`

---

## Problem

Live swap broadcasts fail on-chain with no pre-warning: insufficient balance, missing jetton wallet, zero-liquidity pool, or bad message params. These errors only surface after a transaction is broadcast and bounced — wasting gas and generating noise in fills journal.

## Goal

Run a simulation pass before every `auto` mode broadcast. If simulation detects a would-fail condition, return a `bounced` fill immediately — the inner wallet is never called, no gas spent.

---

## Architecture

### Files touched

| File | Change |
|------|--------|
| `packages/executor/src/simulation-wallet.ts` | **New** — `SimulationWallet` class |
| `packages/executor/src/continuous.ts` | Wrap `walletForMode()` result when `SIMULATE_BEFORE_EXEC=true` |
| `packages/executor/src/modes.ts` | None |
| `packages/executor/src/acton/acton-wallet.ts` | None |
| `packages/executor/src/wallet.ts` | None |

### Pattern

`SimulationWallet` implements `WalletAdapter`. It wraps any other `WalletAdapter`. The executor layer sees no difference — it calls `.swap(order)` as usual.

```
Executor.submit(order)
  └─ SimulationWallet.swap(order)
       ├─ Phase 1: preflight()   ← cheap RPC reads
       ├─ Phase 2: dryRun()      ← router runMethod
       ├─ FAIL → return bounced fill (inner never called)
       └─ PASS → inner.swap(order)   ← real broadcast
```

---

## Simulation Phases

### Phase 1 — Preflight (on-chain state reads)

Runs `runMethod` / `getBalance` reads against `TonClient`.

**Buy orders:**
- Fetch wallet on-chain TON balance
- Assert balance ≥ `order.amountTon + 0.20` TON (gas reserve)
- Fetch live seqno — assert > 0 (wallet deployed) or seqno === 0 and stateInit will be sent

**Sell orders:**
- Resolve user jetton wallet address via `get_wallet_address` on jetton master
- Call `get_wallet_data` on the jetton wallet — assert balance > 0
- Assert jetton wallet is deployed (non-zero balance sufficient)

**Failure output:**
```json
{ "status": "bounced", "reason": "sim_rejected: insufficient TON balance: have 0.8, need 1.2", "simPhase": "preflight" }
```

### Phase 2 — Router Dry-run

One `runMethod` call to the Ston.fi V1 router: `get_expected_outputs`.

Inputs: `offer_amount` (nanotons), `offer_jetton_wallet` (router's pTON wallet for buys, user jetton wallet for sells), `ask_jetton_wallet`.

Asserts:
- Returned `min_out` ≥ `order.minOutTokenQty`
- Returned output > 0 (pool has liquidity)

**Failure output:**
```json
{ "status": "bounced", "reason": "sim_rejected: router dry-run output 0 < minOut 1000000", "simPhase": "dryrun" }
```

---

## Env Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `SIMULATE_BEFORE_EXEC` | `false` | Enable simulation layer |
| `SIMULATE_FAIL_OPEN` | `true` | If simulation RPC itself errors, pass through to real exec |
| `SIMULATE_LOG_ONLY` | `false` | Run simulation but never block — shadow mode for rollout |

### Deployment stages

1. `SIMULATE_LOG_ONLY=true` — observe simulation verdicts without blocking any trades
2. `SIMULATE_FAIL_OPEN=true` (blocking, but RPC errors pass through)
3. `SIMULATE_FAIL_OPEN=false` — maximum protection; any sim error blocks

---

## Interface

```typescript
export interface SimulationResult {
  pass: boolean;
  phase: "preflight" | "dryrun" | "rpc_error";
  reason: string;
  details?: Record<string, unknown>;
}

export class SimulationWallet implements WalletAdapter {
  readonly name = "simulation";
  constructor(
    private inner: WalletAdapter,
    private client: TonClient,
    private opts?: { failOpen?: boolean; logOnly?: boolean }
  ) {}

  async swap(order: OrderRequest): Promise<FillResult>;
  private async preflight(order: OrderRequest): Promise<SimulationResult>;
  private async dryRun(order: OrderRequest): Promise<SimulationResult>;
}
```

---

## Fill Journal Entry (on sim reject)

```json
{
  "orderId": "ord_xxx",
  "status": "bounced",
  "reason": "sim_rejected: insufficient TON balance: have 0.800, need 1.200",
  "simPhase": "preflight",
  "txHash": null,
  "filledAmountTon": 0,
  "filledTokenQty": 0,
  "mode": "auto"
}
```

---

## `continuous.ts` change

```typescript
function walletForMode(mode: ExecutionMode, client?: TonClient): WalletAdapter {
  const base = mode !== "auto" ? new PaperWallet() : new ActonWallet({ ... });
  if (mode === "auto" && String(process.env.SIMULATE_BEFORE_EXEC) === "true" && client) {
    return new SimulationWallet(base, client, {
      failOpen: process.env.SIMULATE_FAIL_OPEN !== "false",
      logOnly: process.env.SIMULATE_LOG_ONLY === "true",
    });
  }
  return base;
}
```

---

## Testing

| Test | Assertion |
|------|-----------|
| Preflight fails (low balance) | Inner wallet NOT called; bounced fill returned |
| Preflight passes, dryrun fails (zero output) | Inner wallet NOT called; bounced fill returned |
| Both pass | Inner wallet called exactly once |
| Simulation RPC throws + failOpen=true | Inner wallet called (pass-through) |
| Simulation RPC throws + failOpen=false | Inner wallet NOT called; bounced returned |
| logOnly=true + sim fails | Inner wallet called; failure logged |

All tests use mocked `TonClient` — no network calls.

---

## Out of Scope

- Simulation for `paper` mode (PaperWallet is already deterministic)
- DeduEx / DeDust router dry-run (only Ston.fi V1 in scope)
- Simulation result surfaced to trader-UI (fills journal is sufficient)
