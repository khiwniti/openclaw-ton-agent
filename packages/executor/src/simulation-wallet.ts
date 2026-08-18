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

  private async preflight(order: OrderRequest): Promise<SimulationResult> {
    try {
      const mnemonic = process.env.WALLET_MASTER_MNEMONIC || process.env.WALLET_MNEMONIC;
      if (!mnemonic) {
        return { pass: false, phase: "rpc_error", reason: "sim_error: missing WALLET_MASTER_MNEMONIC" };
      }

      const key = await mnemonicToPrivateKey(mnemonic.split(" "));
      const wallet = await this.resolveWallet(key.publicKey);
      const contract = this.client.open(wallet);

      const balStr = await contract.getBalance().catch(() => null);
      if (balStr === null) {
        return { pass: false, phase: "rpc_error", reason: "sim_error: could not fetch TON balance" };
      }
      const balanceTon = Number(balStr) / 1e9;

      if (order.side === "buy") {
        const requiredTon = order.amountTon + 0.20; // swap amount + gas reserve
        if (balanceTon < requiredTon) {
          return { pass: false, phase: "preflight", reason: `sim_rejected: insufficient TON balance: have ${balanceTon.toFixed(3)}, need ${requiredTon.toFixed(3)}` };
        }
      } else {
        // Sell
        if (balanceTon < 0.20) {
          return { pass: false, phase: "preflight", reason: `sim_rejected: insufficient TON for gas: have ${balanceTon.toFixed(3)}, need 0.20` };
        }

        const masterAddr = Address.parse(order.token.address);
        let userJettonWallet: Address;
        try {
          const jRes = await this.client.runMethod(masterAddr, "get_wallet_address", [
            { type: "slice", cell: beginCell().storeAddress(wallet.address).endCell() }
          ]);
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

        if (actualJettonBalanceNano <= 0n) {
          return { pass: false, phase: "preflight", reason: `sim_rejected: zero jetton balance available to sell` };
        }
      }

      return { pass: true, phase: "preflight", reason: "ok" };
    } catch (e) {
      return { pass: false, phase: "rpc_error", reason: `sim_error: ${(e as Error)?.message || String(e)}` };
    }
  }

  private async dryRun(order: OrderRequest): Promise<SimulationResult> {
    try {
      const decimals = order.token.decimals ?? 9;
      const toNanoAmount = (human: number) => BigInt(Math.floor(human * 10 ** decimals));

      const routerStr = this.opts.network === "testnet"
        ? "kQBsGx9ArADUrREB34W-ghgsCgBShvfUr4Jvlu-0KGc33a1n"
        : "EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt";
      const ptonStr = "EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez"; // same both networks

      const routerAddr = Address.parse(routerStr);
      const ptonAddr = Address.parse(ptonStr);
      const masterAddr = Address.parse(order.token.address);

      // We need router's pTON wallet and router's target jetton wallet
      let routerPtonWallet: Address;
      try {
        const ptonRes = await this.client.runMethod(ptonAddr, "get_wallet_address", [
          { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }
        ]);
        routerPtonWallet = ptonRes.stack.readAddress();
      } catch {
        return { pass: false, phase: "rpc_error", reason: "sim_error: could not resolve router pTON wallet" };
      }

      let routerJettonWallet: Address;
      try {
        const rRes = await this.client.runMethod(masterAddr, "get_wallet_address", [
          { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }
        ]);
        routerJettonWallet = rRes.stack.readAddress();
      } catch {
        return { pass: false, phase: "rpc_error", reason: "sim_error: could not resolve router target jetton wallet" };
      }

      const offerAmountNano = order.side === "buy"
        ? BigInt(Math.floor(order.amountTon * 1e9))
        : toNanoAmount(order.expectedTokenQty);

      const offerWallet = order.side === "buy" ? routerPtonWallet : routerJettonWallet;
      const askWallet = order.side === "buy" ? routerJettonWallet : routerPtonWallet;

      // run_method get_expected_outputs(offer_amount, offer_jetton_wallet, ask_jetton_wallet)
      let minOutActual: bigint;
      try {
        const res = await this.client.runMethod(routerAddr, "get_expected_outputs", [
          { type: "int", value: offerAmountNano },
          { type: "slice", cell: beginCell().storeAddress(offerWallet).endCell() },
          { type: "slice", cell: beginCell().storeAddress(askWallet).endCell() }
        ]);

        minOutActual = res.stack.readBigNumber(); // out_amount
      } catch {
        return { pass: false, phase: "dryrun", reason: `sim_rejected: router dry-run failed (pool might not exist or no liquidity)` };
      }

      if (minOutActual <= 0n) {
        return { pass: false, phase: "dryrun", reason: `sim_rejected: router dry-run returned 0 output` };
      }

      const requiredOutNano = order.side === "buy"
        ? toNanoAmount(order.minOutTokenQty)
        : BigInt(Math.floor(order.minOutTokenQty * 1e9));

      if (minOutActual < requiredOutNano) {
        return { pass: false, phase: "dryrun", reason: `sim_rejected: router dry-run output ${minOutActual} < minOut ${requiredOutNano}` };
      }

      return { pass: true, phase: "dryrun", reason: "ok" };

    } catch (e) {
      return { pass: false, phase: "rpc_error", reason: `sim_error: ${(e as Error)?.message || String(e)}` };
    }
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

  private async resolveWallet(publicKey: Buffer) {
    const preferredVersion = (process.env.WALLET_VERSION || "").toLowerCase();
    const walletId = this.opts.network === "testnet" ? { networkGlobalId: -3 } : undefined;
    const w5 = WalletContractV5R1.create({ workchain: 0, publicKey, walletId });
    const w4 = WalletContractV4.create({ workchain: 0, publicKey });

    if (preferredVersion === "v4" || preferredVersion === "v4r2") {
      return w4;
    }
    if (preferredVersion === "v5" || preferredVersion === "v5r1") {
      return w5;
    }

    try {
      const c4 = this.client.open(w4);
      const b4 = await c4.getBalance().catch(() => 0n);
      if (b4 > 0n) return w4;
    } catch {}

    try {
      const c5 = this.client.open(w5);
      const b5 = await c5.getBalance().catch(() => 0n);
      if (b5 > 0n) return w5;
    } catch {}

    return w4;
  }
}
