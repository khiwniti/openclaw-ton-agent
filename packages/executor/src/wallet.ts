import type { OrderRequest } from "@openclaw-ton-agent/shared";
import { TonClient, type WalletContractV5R1 } from "@ton/ton";

export { ActonWallet } from "./acton/acton-wallet.js";

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

export interface WalletAdapter {
  readonly name: string;
  swap(order: OrderRequest): Promise<FillResult>;
}

export class PaperWallet implements WalletAdapter {
  readonly name = "paper";
  async swap(order: OrderRequest): Promise<FillResult> {
    const filledTokenQty = order.expectedTokenQty;
    if (filledTokenQty < order.minOutTokenQty) {
      return { status: "bounced", txHash: null, filledAmountTon: 0, filledTokenQty: 0, minOutTokenQty: order.minOutTokenQty, slippageBps: order.slippageBps, mode: "paper", reason: "paper minOut not satisfiable" };
    }
    return {
      status: "filled",
      txHash: `paper-${order.id}`,
      filledAmountTon: order.amountTon,
      filledTokenQty,
      minOutTokenQty: order.minOutTokenQty,
      slippageBps: order.slippageBps,
      mode: "paper",
    };
  }
}

export class TonMcpWallet implements WalletAdapter {
  readonly name = "ton-mcp";
  private network: "mainnet" | "testnet";
  private initialized = false;

  constructor(private opts: {
    mode: "auto";
    gatesG1G3Ack: boolean;
    network: "mainnet" | "testnet"
  }) {
    if (this.opts.mode !== "auto") throw new Error("TonMcpWallet: live execution requires EXECUTION_MODE=auto");
    if (!this.opts.gatesG1G3Ack) throw new Error("TonMcpWallet: G1–G3 gate progression not acknowledged (GATES_G1_G3_ACK=1 required before live money)");

    this.network = this.opts.network;
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) throw new Error("TonMcpWallet not initialized");
  }

  async swap(order: OrderRequest): Promise<FillResult> {
    await this.ensureInitialized();
    if (order.mode !== "auto") throw new Error("TonMcpWallet: order was built in a non-auto mode — refusing to execute");
    if (order.confirmRequired) throw new Error("TonMcpWallet: order requires operator confirmation (confirm-first) — surface to trader-ui, do not auto-execute");

    return {
      status: "bounced",
      txHash: null,
      filledAmountTon: 0,
      filledTokenQty: 0,
      minOutTokenQty: order.minOutTokenQty,
      slippageBps: order.slippageBps,
      mode: "auto",
      reason: "TonMcpWallet.on-chain swap not implemented yet",
    };
  }
}
