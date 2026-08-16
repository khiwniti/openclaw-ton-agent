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
import { createLogger } from "@openclaw-ton-agent/shared";

const log = createLogger("executor");

export interface ExecutorResult {
  order: OrderRequest;
  action: "surface" | "booked" | "executed" | "rejected";
  fill: FillResult | null;
  journaled: boolean;
}

export interface RequoteGuardConfig {
  /** Maximum allowed slippage drift from original quote (basis points). Default 150 bps = 1.5%. */
  maxDriftBps: number;
  /** Re-quote function: takes order and returns updated expected output. */
  requote: (order: OrderRequest) => Promise<{ expectedTokenQty: number; minOutTokenQty: number }>;
}

export class Executor {
  constructor(
    private opts: {
      mode: ExecutionMode;
      ordersJournal: Journal;
      fillsJournal: Journal;
      surface: (order: OrderRequest) => Promise<void> | void;
      wallet?: WalletAdapter;
      /** Pre-send re-quote / slippage guard configuration. */
      requoteGuard?: RequoteGuardConfig;
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

    // auto — live. Run pre-send re-quote guard before executing.
    if (this.opts.requoteGuard) {
      const guardResult = await this.runRequoteGuard(order);
      if (!guardResult.pass) {
        log.warn("Requote guard rejected order", {
          orderId: order.id,
          ticker: order.token.ticker,
          driftBps: guardResult.driftBps,
          reason: guardResult.reason,
        });
        return { 
          order, 
          action: "rejected", 
          fill: { 
            status: "bounced", 
            txHash: null, 
            filledAmountTon: 0, 
            filledTokenQty: 0, 
            minOutTokenQty: order.minOutTokenQty, 
            slippageBps: order.slippageBps, 
            mode: "auto", 
            reason: `Requote guard: ${guardResult.reason}` 
          }, 
          journaled: false 
        };
      }
      // Update order with fresh quote if it passed
      if (guardResult.updatedOrder) {
        order = guardResult.updatedOrder;
      }
    }

    // auto — live. The wallet adapter itself enforces G1–G3 ack + confirm.
    const liveWallet = this.opts.wallet ?? new TonMcpWallet({ mode: "auto", gatesG1G3Ack: false, network: "mainnet" });
    const fill = await liveWallet.swap(order);
    this.opts.ordersJournal.append(order);
    this.opts.fillsJournal.append({ orderId: order.id, ...fill });
    return { order, action: "executed", fill, journaled: true };
  }

  private async runRequoteGuard(order: OrderRequest): Promise<{ pass: boolean; driftBps: number; reason: string; updatedOrder?: OrderRequest }> {
    const { maxDriftBps = 150, requote } = this.opts.requoteGuard!;
    
    try {
      const freshQuote = await requote(order);
      const originalExpected = order.expectedTokenQty;
      const freshExpected = freshQuote.expectedTokenQty;
      
      if (freshExpected <= 0) {
        return { pass: false, driftBps: 0, reason: "Requote returned zero or negative expected output" };
      }
      
      // Calculate drift in basis points: (fresh - original) / original * 10000
      const driftBps = Math.floor(((freshExpected - originalExpected) / originalExpected) * 10000);
      
      if (driftBps < -maxDriftBps) {
        return { 
          pass: false, 
          driftBps: Math.abs(driftBps), 
          reason: `Slippage drift ${Math.abs(driftBps)}bps exceeds max ${maxDriftBps}bps (price moved against us)` 
        };
      }
      
      // If drift is positive (better price), update the order with fresh quote
      if (driftBps > 0) {
        const updatedOrder = { ...order, expectedTokenQty: freshExpected, minOutTokenQty: freshQuote.minOutTokenQty };
        return { pass: true, driftBps, reason: `Price improved by ${driftBps}bps`, updatedOrder };
      }
      
      return { pass: true, driftBps, reason: "Within tolerance" };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { pass: false, driftBps: 0, reason: `Requote failed: ${msg}` };
    }
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
