/**
 * G2 drift monitor (architecture §12.2 gate 2, ton-reporting §drift monitor).
 *
 * Compares realized fill slippage against the expected slippage the order
 * allowed. PaperWallet fills at the quoted entry exactly (realized = expected,
 * drift = 0), so a clean paper run always passes — the monitor's job is to
 * catch divergence when real fills arrive (G3): a fill whose realized slippage
 * exceeds its expected allowance by more than `toleranceBps` is a violation.
 *
 * Consumes the executor journals: `orders-*.ndjson` (OrderRequest lines) and
 * `fills-*.ndjson` (FillResult + orderId lines).
 */
import { readJournal, type OrderRequest } from "@openclaw-ton-agent/shared";

/** Structural view of an executor fill journal line (FillResult + orderId). */
export interface PaperFillRecord {
  orderId: string;
  ts?: number;
  status: string;
  txHash: string | null;
  filledAmountTon: number;
  filledTokenQty: number;
  minOutTokenQty: number;
  slippageBps: number;
  mode: "paper" | "auto";
}

export interface DriftFill {
  orderId: string;
  ticker: string;
  ts: number;
  expectedSlippageBps: number;
  realizedSlippageBps: number;
  /** realized − expected; positive means the fill paid more than allowed. */
  driftBps: number;
  mode: "paper" | "auto";
}

export interface DriftOptions {
  ordersFile: string;
  fillsFile: string;
  /** Maximum allowed excess drift over expected (bps). Default 50 = 0.5%. */
  toleranceBps?: number;
}

export interface DriftResult {
  fills: DriftFill[];
  maxDriftBps: number;
  meanDriftBps: number;
  violations: DriftFill[];
  toleranceBps: number;
  /** Convenience: max drift bps over a subset of fills. */
  driftBps: (f: DriftFill[]) => number;
  /** pass = no fill paid more than expected + tolerance. */
  verdict: "pass" | "fail";
}

/** Realized slippage of a fill relative to the order's quoted entry. */
export function realizedSlippageBps(order: OrderRequest, fill: PaperFillRecord): number {
  if (order.entryTon <= 0 || fill.filledAmountTon <= 0 || fill.filledTokenQty <= 0) return 0;
  const realizedPrice = fill.filledAmountTon / fill.filledTokenQty;
  return ((realizedPrice - order.entryTon) / order.entryTon) * 10_000;
}

export function runDriftMonitor(opts: DriftOptions): DriftResult {
  const toleranceBps = opts.toleranceBps ?? 50;
  const orderRows = readJournal(opts.ordersFile);
  const fillRows = readJournal(opts.fillsFile);

  const orders = new Map<string, OrderRequest>();
  for (const row of orderRows) {
    if (typeof row !== "object" || row === null) continue;
    const o = row as OrderRequest;
    if (typeof o.id !== "string") continue;
    orders.set(o.id, o);
  }

  const fills: DriftFill[] = [];
  for (const row of fillRows) {
    if (typeof row !== "object" || row === null) continue;
    const f = row as PaperFillRecord;
    if (typeof f.orderId !== "string") continue;
    const order = orders.get(f.orderId);
    if (!order) continue; // fill without a matching order: unmeasurable, skip
    const realized = realizedSlippageBps(order, f);
    fills.push({
      orderId: f.orderId,
      ticker: order.token.ticker,
      ts: f.ts ?? order.ts,
      expectedSlippageBps: order.slippageBps,
      realizedSlippageBps: realized,
      driftBps: realized - order.slippageBps,
      mode: f.mode ?? order.mode,
    });
  }

  const violations = fills.filter((f) => f.driftBps > toleranceBps);
  const maxDriftBps = fills.length ? Math.max(...fills.map((f) => f.driftBps)) : 0;
  const meanDriftBps = fills.length ? fills.reduce((s, f) => s + f.driftBps, 0) / fills.length : 0;
  const maxDrift = (f: DriftFill[]) => (f.length ? Math.max(...f.map((x) => x.driftBps)) : 0);
  return { fills, maxDriftBps, meanDriftBps, violations, toleranceBps, driftBps: maxDrift, verdict: violations.length ? "fail" : "pass" };
}
