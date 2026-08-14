/**
 * Execution modes (L4). The ONLY place that decides what a gated order is
 * allowed to do. Ordering is strict:
 *
 *   notify_only → build + validate + surface to trader-ui; NEVER book or sign.
 *   paper       → simulate the fill and book it; NEVER signs.
 *   auto        → live; requires the wallet adapter's own guards (G1–G3 ack +
 *                 confirm-first) to pass before a single TON moves.
 *
 * Mode escalation is a one-way street (notify_only → paper → auto), enforced
 * at the caller. Every order and fill is journaled.
 */
import { Journal, validateOrderRequest, type ExecutionMode, type OrderRequest } from "@openclaw-ton-agent/shared";
import { PaperWallet, TonMcpWallet, type FillResult, type WalletAdapter } from "./wallet";

export interface ExecutorResult {
  order: OrderRequest;
  action: "surface" | "booked" | "executed";
  fill: FillResult | null;
  journaled: boolean;
}

export class Executor {
  constructor(
    private opts: {
      mode: ExecutionMode;
      ordersJournal: Journal;
      fillsJournal: Journal;
      surface: (order: OrderRequest) => Promise<void> | void;
      wallet?: WalletAdapter;
    },
  ) {}

  private get wallet(): WalletAdapter {
    if (this.opts.wallet) return this.opts.wallet;
    if (this.opts.mode === "auto") throw new Error("Executor: auto mode requires a live wallet adapter");
    return new PaperWallet();
  }

  async submit(order: OrderRequest): Promise<ExecutorResult> {
    const checked = validateOrderRequest(order);
    if (!checked.ok) throw new Error(checked.reason);

    if (this.opts.mode === "notify_only") {
      // Surface only. Never book, never sign.
      await this.opts.surface(order);
      this.opts.ordersJournal.append(order);
      return { order, action: "surface", fill: null, journaled: true };
    }

    if (this.opts.mode === "paper") {
      const fill = await this.wallet.swap(order); // PaperWallet — deterministic
      this.opts.ordersJournal.append(order);
      this.opts.fillsJournal.append({ orderId: order.id, ...fill });
      return { order, action: "booked", fill, journaled: true };
    }

    // auto — live. The wallet adapter itself enforces G1–G3 ack + confirm.
    const liveWallet = this.opts.wallet ?? new TonMcpWallet({ mode: "auto", gatesG1G3Ack: false, network: "mainnet" });
    const fill = await liveWallet.swap(order);
    this.opts.ordersJournal.append(order);
    this.opts.fillsJournal.append({ orderId: order.id, ...fill });
    return { order, action: "executed", fill, journaled: true };
  }
}

/** Escalation check — you can only move forward, never back. */
export function canEscalate(from: ExecutionMode, to: ExecutionMode): boolean {
  const rank: Record<ExecutionMode, number> = { notify_only: 0, paper: 1, auto: 2 };
  return rank[to] > rank[from];
}

export function toPaperWallet(): PaperWallet {
  return new PaperWallet();
}
