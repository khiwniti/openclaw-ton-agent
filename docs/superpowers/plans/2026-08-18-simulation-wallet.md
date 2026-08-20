# Simulation Wallet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a preflight and dry-run simulation layer before `auto` mode broadcast to prevent on-chain bounces, returning simulated bounce events to the fills journal without spending gas.

**Architecture:** A `SimulationWallet` decorator that wraps `ActonWallet` or `PaperWallet`. It intercepts `swap()` calls to run a two-phase check: Phase 1 (preflight) reads live TON and jetton balances; Phase 2 (dry-run) hits the Ston.fi V1 router `get_expected_outputs` method.

**Tech Stack:** TypeScript, `@ton/ton` (TonClient, Address, beginCell).

**Spec:** `docs/superpowers/specs/2026-08-18-simulation-wallet-design.md`

## Global Constraints

- Must return a `bounced` FillResult if simulation fails, matching the existing executor contract.
- Must honor `SIMULATE_FAIL_OPEN` and `SIMULATE_LOG_ONLY` fallback env flags.
- Real executor code must not depend on external UI layer; logging goes to unstructured `createLogger` only.

---

### Task 1: Create SimulationWallet Class

**Files:**
- Create: `packages/executor/src/simulation-wallet.ts`

**Interfaces:**
- Consumes: `WalletAdapter`, `OrderRequest`, `FillResult` from `@openclaw-ton-agent/shared` and `./wallet.js`
- Produces: `SimulationWallet` class implementing `WalletAdapter`

- [ ] **Step 1: Write class skeleton and types**

```typescript
import type { OrderRequest } from "@openclaw-ton-agent/shared";
import { createLogger } from "@openclaw-ton-agent/shared";
import type { WalletAdapter, FillResult } from "./wallet.js";
import { TonClient, Address, beginCell } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";

export interface SimulationResult {
  pass: boolean;
  phase: "preflight" | "dryrun" | "rpc_error";
  reason: string;
  details?: Record<string, unknown>;
}

export class SimulationWallet implements WalletAdapter {
  readonly name = "simulation";
  private log = createLogger("simulation-wallet");

  constructor(
    private inner: WalletAdapter,
    private client: TonClient,
    private opts: { failOpen: boolean; logOnly: boolean; network: "mainnet" | "testnet" }
  ) {}

  async swap(order: OrderRequest): Promise<FillResult> {
    // To be implemented in next step
    return this.inner.swap(order);
  }
}
```

- [ ] **Step 2: Implement swap control flow**

```typescript
  async swap(order: OrderRequest): Promise<FillResult> {
    const preflight = await this.preflight(order);
    if (!preflight.pass && (!this.opts.failOpen || preflight.phase !== "rpc_error")) {
      if (!this.opts.logOnly) {
        return this.bounced(order, preflight.reason, preflight.phase);
      }
      this.log.warn("simulation preflight failed but logOnly is true", { reason: preflight.reason, orderId: order.id });
    } else if (preflight.pass) {
      const dryrun = await this.dryRun(order);
      if (!dryrun.pass && (!this.opts.failOpen || dryrun.phase !== "rpc_error")) {
        if (!this.opts.logOnly) {
          return this.bounced(order, dryrun.reason, dryrun.phase);
        }
        this.log.warn("simulation dryrun failed but logOnly is true", { reason: dryrun.reason, orderId: order.id });
      }
    }

    return this.inner.swap(order);
  }

  private bounced(order: OrderRequest, reason: string, phase: string): FillResult {
    return {
      status: "bounced",
      txHash: null,
      filledAmountTon: 0,
      filledTokenQty: 0,
      minOutTokenQty: order.minOutTokenQty,
      slippageBps: order.slippageBps,
      mode: "auto",
      reason: `${reason} [simPhase:${phase}]`,
    };
  }
```

- [ ] **Step 3: Implement Phase 1 (Preflight)**

```typescript
  private async preflight(order: OrderRequest): Promise<SimulationResult> {
    try {
      const mnemonic = process.env.WALLET_MASTER_MNEMONIC || process.env.WALLET_MNEMONIC;
      if (!mnemonic) return { pass: false, phase: "rpc_error", reason: "sim_error: missing WALLET_MASTER_MNEMONIC" };

      const key = await mnemonicToPrivateKey(mnemonic.split(" "));
      const wallet = await this.resolveWallet(key.publicKey);
      const contract = this.client.open(wallet);

      const balStr = await contract.getBalance().catch(() => null);
      if (balStr === null) return { pass: false, phase: "rpc_error", reason: "sim_error: could not fetch TON balance" };
      const balanceTon = Number(balStr) / 1e9;

      if (order.side === "buy") {
        const requiredTon = order.amountTon + 0.20;
        if (balanceTon < requiredTon) {
          return { pass: false, phase: "preflight", reason: `sim_rejected: insufficient TON balance: have ${balanceTon.toFixed(3)}, need ${requiredTon.toFixed(3)}` };
        }
      } else {
        if (balanceTon < 0.20) return { pass: false, phase: "preflight", reason: `sim_rejected: insufficient TON for gas: have ${balanceTon.toFixed(3)}, need 0.20` };

        const masterAddr = Address.parse(order.token.address);
        let userJettonWallet: Address;
        try {
          const jRes = await this.client.runMethod(masterAddr, "get_wallet_address", [{ type: "slice", cell: beginCell().storeAddress(wallet.address).endCell() }]);
          userJettonWallet = jRes.stack.readAddress();
        } catch {
          return { pass: false, phase: "rpc_error", reason: `sim_error: could not resolve jetton wallet for ${order.token.ticker}` };
        }

        let actualJettonBalanceNano = 0n;
        try {
          const balRes = await this.client.runMethod(userJettonWallet, "get_wallet_data");
          actualJettonBalanceNano = balRes.stack.readBigNumber();
        } catch {
           return { pass: false, phase: "preflight", reason: `sim_rejected: jetton wallet not deployed or unreadable` };
        }

        if (actualJettonBalanceNano <= 0n) return { pass: false, phase: "preflight", reason: `sim_rejected: zero jetton balance available to sell` };
      }

      return { pass: true, phase: "preflight", reason: "ok" };
    } catch (e) {
      return { pass: false, phase: "rpc_error", reason: `sim_error: ${(e as Error)?.message || String(e)}` };
    }
  }

  // NOTE: Helper to resolve V4/V5 wallets omitted for brevity, identical to ActonWallet implementation
```

- [ ] **Step 4: Implement Phase 2 (Dry Run)**

```typescript
  private async dryRun(order: OrderRequest): Promise<SimulationResult> {
    try {
      const decimals = order.token.decimals ?? 9;
      const toNanoAmount = (human: number) => BigInt(Math.floor(human * 10 ** decimals));

      const routerStr = this.opts.network === "testnet" ? "kQBsGx9ArADUrREB34W-ghgsCgBShvfUr4Jvlu-0KGc33a1n" : "EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt";
      const ptonStr = "EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez"; 

      const routerAddr = Address.parse(routerStr);
      const ptonAddr = Address.parse(ptonStr);
      const masterAddr = Address.parse(order.token.address);

      let routerPtonWallet: Address;
      try {
        const ptonRes = await this.client.runMethod(ptonAddr, "get_wallet_address", [{ type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }]);
        routerPtonWallet = ptonRes.stack.readAddress();
      } catch {
        return { pass: false, phase: "rpc_error", reason: "sim_error: could not resolve router pTON wallet" };
      }

      let routerJettonWallet: Address;
      try {
        const rRes = await this.client.runMethod(masterAddr, "get_wallet_address", [{ type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }]);
        routerJettonWallet = rRes.stack.readAddress();
      } catch {
        return { pass: false, phase: "rpc_error", reason: "sim_error: could not resolve router target jetton wallet" };
      }

      const offerAmountNano = order.side === "buy" ? BigInt(Math.floor(order.amountTon * 1e9)) : toNanoAmount(order.expectedTokenQty);
      const offerWallet = order.side === "buy" ? routerPtonWallet : routerJettonWallet;
      const askWallet = order.side === "buy" ? routerJettonWallet : routerPtonWallet;

      let minOutActual: bigint;
      try {
        const res = await this.client.runMethod(routerAddr, "get_expected_outputs", [
          { type: "int", value: offerAmountNano },
          { type: "slice", cell: beginCell().storeAddress(offerWallet).endCell() },
          { type: "slice", cell: beginCell().storeAddress(askWallet).endCell() }
        ]);
        minOutActual = res.stack.readBigNumber();
      } catch {
        return { pass: false, phase: "dryrun", reason: `sim_rejected: router dry-run failed (pool might not exist or no liquidity)` };
      }

      if (minOutActual <= 0n) return { pass: false, phase: "dryrun", reason: `sim_rejected: router dry-run returned 0 output` };

      const requiredOutNano = order.side === "buy" ? toNanoAmount(order.minOutTokenQty) : BigInt(Math.floor(order.minOutTokenQty * 1e9));
      if (minOutActual < requiredOutNano) return { pass: false, phase: "dryrun", reason: `sim_rejected: router dry-run output ${minOutActual} < minOut ${requiredOutNano}` };

      return { pass: true, phase: "dryrun", reason: "ok" };
    } catch (e) {
      return { pass: false, phase: "rpc_error", reason: `sim_error: ${(e as Error)?.message || String(e)}` };
    }
  }
```

- [ ] **Step 5: Run compilation check**

Run: `npx tsc --noEmit`
Expected: Passes with no errors

- [ ] **Step 6: Commit**

```bash
git add packages/executor/src/simulation-wallet.ts
git commit -m "feat(executor): implement simulation wallet preflight and dry-run layer"
```

---

### Task 2: Wire Simulation into Continuous Executor

**Files:**
- Modify: `packages/executor/src/continuous.ts`

**Interfaces:**
- Consumes: `SimulationWallet`

- [ ] **Step 1: Modify walletForMode factory**

Update `walletForMode` in `continuous.ts` to wrap `ActonWallet` when conditions are met:

```typescript
import { SimulationWallet } from "./simulation-wallet.js";
import { TonClient } from "@ton/ton";

function walletForMode(mode: ExecutionMode, client?: TonClient) {
  if (mode !== "auto") return new PaperWallet();
  const base = new ActonWallet({
    mode: "auto",
    gatesG1G3Ack: EXEC_CONFIG.gatesG1G3Ack,
    network: EXEC_CONFIG.network,
    projectPath: EXEC_CONFIG.acton.projectPath,
    contractAddress: EXEC_CONFIG.acton.contractAddress,
    routerAddress: EXEC_CONFIG.acton.routerAddress,
  });

  if (mode === "auto" && String(process.env.SIMULATE_BEFORE_EXEC) === "true" && client) {
    return new SimulationWallet(base, client, {
      failOpen: process.env.SIMULATE_FAIL_OPEN !== "false",
      logOnly: process.env.SIMULATE_LOG_ONLY === "true",
      network: EXEC_CONFIG.network,
    });
  }
  return base;
}
```

- [ ] **Step 2: Provide TonClient to walletForMode**

Around line 133 in `continuous.ts`, instantiate the `TonClient` and pass it to `walletForMode`:

```typescript
  const endpoint = EXEC_CONFIG.network === "mainnet"
    ? "https://toncenter.com/api/v2/jsonRPC"
    : "https://testnet.toncenter.com/api/v2/jsonRPC";
  const toncenterApiKey = process.env.TONCENTER_API_KEY || process.env.TON_API_KEY;
  const client = new TonClient({ endpoint, apiKey: toncenterApiKey });

  const executor = new Executor({ mode, ordersJournal, fillsJournal, surface, wallet: walletForMode(mode, client) });
```

- [ ] **Step 3: Run compilation check**

Run: `npx tsc --noEmit`
Expected: Passes with no errors

- [ ] **Step 4: Commit**

```bash
git add packages/executor/src/continuous.ts
git commit -m "feat(executor): wire simulation wallet into continuous mode"
```
