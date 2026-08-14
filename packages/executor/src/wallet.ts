/**
 * Wallet adapters (L4 custody).
 *
 *  - `PaperWallet`: deterministic fill simulation — never touches a chain.
 *  - `TonMcpWallet`: real @ton/mcp custody. REFUSES by default: only operable
 *    in `auto` mode with `GATES_G1_G3_ACK=1`. Until G3 is passed this is a
 *    hard runtime guard, not a suggestion.
 */
import type { OrderRequest } from "@openclaw-ton-agent/shared";

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

/** Deterministic paper fill. Simulates a fill at the quoted entry with minOut
 *  enforced; used by `notify_only` (no booking) and `paper` (books the fill). */
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

/**
 * Real @ton/mcp custody. Guarded: throws unless the operator has explicitly
 * opted into live execution (EXECUTION_MODE=auto AND GATES_G1_G3_ACK=1).
 * The actual swap is delegated to the executor persona's ton-execute skill
 * (@ton/mcp Omniston tools); this adapter exists so the guard and the hand-off
 * contract are enforced in code, not just in a persona prompt.
 */
export class TonMcpWallet implements WalletAdapter {
  readonly name = "ton-mcp";
  constructor(private opts: { mode: "auto"; gatesG1G3Ack: boolean; network: "mainnet" | "testnet" }) {}

  async swap(order: OrderRequest): Promise<FillResult> {
    if (this.opts.mode !== "auto") throw new Error("TonMcpWallet: live execution requires EXECUTION_MODE=auto");
    if (!this.opts.gatesG1G3Ack) throw new Error("TonMcpWallet: G1–G3 gate progression not acknowledged (GATES_G1_G3_ACK=1 required before live money)");
    if (order.mode !== "auto") throw new Error("TonMcpWallet: order was built in a non-auto mode — refusing to execute");
    if (order.confirmRequired) throw new Error("TonMcpWallet: order requires operator confirmation (confirm-first) — surface to trader-ui, do not auto-execute");

    // v0: swaps are performed by the executor persona via @ton/mcp Omniston
    // tools (ton-swap/ton-execute skills). This code path is unreachable until
    // the operator passes G3 — by then it wires the ton-cli adapter here.
    throw new Error("TonMcpWallet: live swap adapter not wired until G1–G3 are passed (operator requirement, architecture §12.2)");
  }
}
