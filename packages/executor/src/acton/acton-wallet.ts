import type { OrderRequest } from "@openclaw-ton-agent/shared";
import type { WalletAdapter } from "../wallet.js";
import { evaluateBuyGasGuard, evaluateSellGasGuard, type ActonCommandOptions } from "./index.js";
import { Address, beginCell, toNano, TonClient, WalletContractV5R1, SendMode, internal } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";

export interface ActonWalletOptions extends ActonCommandOptions {
  mode: "auto";
  gatesG1G3Ack: boolean;
  network: "mainnet" | "testnet";
  balanceTon?: number;
  mnemonic?: string;
}

export type FillStatus = "filled" | "bounced" | "pending_reconcile";

export interface FillResult {
  status: FillStatus;
  txHash: string | null;
  filledAmountTon: number;
  filledTokenQty: number;
  minOutTokenQty: number;
  slippageBps: number;
  mode: "paper" | "auto";
  reason?: string;
}

export interface SwapPayload {
  side: "buy" | "sell";
  jettonMaster: string;
  amountTon: number;
  jettonAmountNano?: string;
  minOutTokenQty: number;
  slippageBps: number;
  dex: "stonfi" | "dedust";
}

export class ActonWallet implements WalletAdapter {
  readonly name = "acton";

  constructor(private readonly opts: ActonWalletOptions) {
    if (opts.mode !== "auto") {
      throw new Error("ActonWallet: live execution requires EXECUTION_MODE=auto");
    }
    if (!opts.gatesG1G3Ack) {
      throw new Error("ActonWallet: G1–G3 gate progression not acknowledged (GATES_G1_G3_ACK=1 required before live money)");
    }
  }

  async swap(order: OrderRequest): Promise<FillResult> {
    if (order.mode !== "auto") {
      return this.bounced(order, "ActonWallet: order was built in a non-auto mode — refusing to execute");
    }
    if (order.confirmRequired) {
      return this.bounced(order, "ActonWallet: order requires operator confirmation (confirm-first) — surface to trader-ui");
    }

    const payload = this.toSwapPayload(order);

    try {
      const balanceTon = this.opts.balanceTon ?? Number.POSITIVE_INFINITY;
      if (payload.side === "buy") {
        const guard = evaluateBuyGasGuard(balanceTon, payload.amountTon);
        if (!guard.ok) {
          return this.bounced(order, guard.error);
        }
      } else {
        const guard = evaluateSellGasGuard(balanceTon);
        if (!guard.ok) {
          return this.bounced(order, guard.error);
        }
      }

      if (payload.side === "buy" && order.expectedTokenQty < order.minOutTokenQty) {
        return this.bounced(order, "ActonWallet: quoted output below minOut after slippage");
      }

      const send = await this.sendSwapDirect(payload);
      if (!send.ok) {
        return this.bounced(order, `broadcast failed: ${send.error}`);
      }

      return {
        status: "pending_reconcile",
        txHash: send.txHash ?? null,
        filledAmountTon: payload.amountTon,
        filledTokenQty: payload.side === "buy" ? order.expectedTokenQty : 0,
        minOutTokenQty: payload.minOutTokenQty,
        slippageBps: payload.slippageBps,
        mode: "auto",
        reason: "signed and broadcast",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.bounced(order, `swap failed: ${msg}`);
    }
  }

  private toSwapPayload(order: OrderRequest): SwapPayload {
    return {
      side: order.side,
      jettonMaster: order.token.address,
      amountTon: order.amountTon,
      jettonAmountNano: order.expectedTokenQty.toString(),
      minOutTokenQty: order.minOutTokenQty,
      slippageBps: order.slippageBps,
      dex: "stonfi",
    };
  }

  private safeAddress(raw: string, fallback = "EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt"): string {
    try {
      return Address.parse(raw).toString();
    } catch {
      return fallback;
    }
  }

  private async sendSwapDirect(payload: SwapPayload): Promise<{ ok: boolean; txHash?: string; error?: string }> {
    const mnemonic = this.opts.mnemonic ?? process.env.WALLET_MASTER_MNEMONIC;
    if (!mnemonic) {
      return { ok: false, error: "WALLET_MASTER_MNEMONIC is required for broadcast" };
    }

    const rpcEndpoint = (process.env.TON_RPC_ENDPOINT || "").replace(/\/+$/, "");
    const base = (process.env.TONAPI_BASE || "").replace(/\/+$/, "");
    const defaultForNetwork = this.opts.network === "mainnet"
      ? "https://toncenter.com/api/v2/jsonRPC"
      : "https://testnet.toncenter.com/api/v2/jsonRPC";
    const endpoint = rpcEndpoint && rpcEndpoint.includes(this.opts.network)
      ? rpcEndpoint
      : (base || defaultForNetwork);

    try {
      const client = new TonClient({ endpoint });
      const key = await mnemonicToPrivateKey(mnemonic.split(" "));
      const workchain = 0;
      const walletId = this.opts.network === "testnet" ? { networkGlobalId: -3 } : undefined;
      const wallet = WalletContractV5R1.create({ workchain, publicKey: key.publicKey, walletId });
      const contract = client.open(wallet);
      const seqno = await contract.getSeqno().catch(() => 0);
      const stateInit = seqno === 0 ? wallet.init : undefined;

      const jettonMasterAddr = Address.parse(this.safeAddress(payload.jettonMaster));
      let body;
      if (payload.side === "buy") {
        body = beginCell()
          .storeUint(0x25938561, 32)
          .storeCoins(toNano(payload.amountTon.toString()))
          .storeAddress(jettonMasterAddr)
          .storeCoins(BigInt(payload.minOutTokenQty.toString()))
          .endCell();
      } else {
        const forward = beginCell()
          .storeUint(0x25938561, 32)
          .storeCoins(BigInt(payload.jettonAmountNano ?? "0"))
          .storeAddress(jettonMasterAddr)
          .storeCoins(BigInt(payload.minOutTokenQty.toString()))
          .endCell();
        body = beginCell()
          .storeUint(0xf8a7ea5, 32)
          .storeUint(Date.now(), 64)
          .storeCoins(BigInt(payload.jettonAmountNano ?? "0"))
          .storeAddress(jettonMasterAddr)
          .storeAddress(contract.address)
          .storeBit(0)
          .storeCoins(toNano("0.05"))
          .storeBit(1)
          .storeRef(forward)
          .endCell();
      }

      const routerAddr = this.opts.network === "testnet"
        ? "kQBsGx9ArADUrREB34W-ghgsCgBShvfUr4Jvlu-0KGc33a1n"
        : "EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt";
      const msg = internal({
        to: Address.parse(this.safeAddress(routerAddr)),
        value: toNano(payload.side === "buy" ? (payload.amountTon + 0.15).toFixed(4) : "0.15"),
        body,
      });

      const transfer = contract.createTransfer({
        seqno,
        secretKey: key.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
        messages: [msg],
      });

      await client.sendExternalMessage(wallet, transfer);
      return { ok: true, txHash: `seqno-${seqno}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, error: msg };
    }
  }

  private bounced(order: OrderRequest, reason: string): FillResult {
    return {
      status: "bounced",
      txHash: null,
      filledAmountTon: 0,
      filledTokenQty: 0,
      minOutTokenQty: order.minOutTokenQty,
      slippageBps: order.slippageBps,
      mode: "auto",
      reason,
    };
  }
}
