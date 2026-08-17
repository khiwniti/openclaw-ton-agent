import type { OrderRequest } from "@openclaw-ton-agent/shared";
import { logger } from "@openclaw-ton-agent/core";


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
      return {
        status: "bounced",
        txHash: null,
        filledAmountTon: 0,
        filledTokenQty: 0,
        minOutTokenQty: order.minOutTokenQty,
        slippageBps: order.slippageBps,
        mode: "paper",
        reason: "paper minOut not satisfiable",
      };
    }
    logger.trade("PAPER_WALLET", `[${order.id}] paper swap: side=${order.side} amountTon=${order.amountTon}`);
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

/**
 * TonMcpWallet — production live-execution adapter.
 *
 * Validates EXECUTION_MODE=auto + GATES_G1_G3_ACK=1, then delegates
 * to ActonWallet which is the single canonical live-signing code path.
 * Having one signing path eliminates dual-maintenance of broadcast logic.
 */
export class TonMcpWallet implements WalletAdapter {
  readonly name = "ton-mcp";

  constructor(private opts: {
    mode: "auto";
    gatesG1G3Ack: boolean;
    network: "mainnet" | "testnet";
  }) {
    if (this.opts.mode !== "auto") {
      throw new Error("TonMcpWallet: live execution requires EXECUTION_MODE=auto");
    }
    if (!this.opts.gatesG1G3Ack) {
      throw new Error("TonMcpWallet: G1–G3 gate progression not acknowledged (GATES_G1_G3_ACK=1 required before live money)");
    }
  }

  async swap(order: OrderRequest): Promise<FillResult> {
    if (order.mode !== "auto") {
      throw new Error("TonMcpWallet: order was built in a non-auto mode — refusing to execute");
    }
    if (order.confirmRequired) {
      throw new Error("TonMcpWallet: order requires operator confirmation (confirm-first) — surface to trader-ui, do not auto-execute");
    }

    // Delegate to ActonWallet — the single canonical live-signing path
    const { ActonWallet } = await import("./acton/acton-wallet.js");
    const wallet = new ActonWallet({
      mode: "auto",
      gatesG1G3Ack: this.opts.gatesG1G3Ack,
      network: this.opts.network,
      mnemonic: process.env.WALLET_MASTER_MNEMONIC || process.env.WALLET_MNEMONIC,
    });
    return wallet.swap(order);
  }
}

