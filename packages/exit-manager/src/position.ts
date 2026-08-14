/**
 * Position model (L4 exit side). A position is opened from a validated
 * OrderRequest + the same pointSetup the risk gates used, so stop/target are
 * deterministic and fee-aware.
 */
import { newId } from "@openclaw-ton-agent/shared";

export type ExitMode = "snipe" | "swing" | "gamble" | "diamond";

export interface Position {
  id: string;
  orderId: string;
  tokenAddress: string;
  ticker: string;
  /** entry price, TON per token. */
  entryTon: number;
  /** token qty = amountTon / entryTon. */
  qty: number;
  /** TON capital committed. */
  amountTon: number;
  stopLossTon: number;
  takeProfitTon: number;
  entryTs: number;
  mode: ExitMode;
  /** round-trip cost charged on this position. */
  feesTon: number;
  /** highest price seen since entry. */
  highWaterTon: number;
  /** trailing stop once armed; null until price reaches the activation level. */
  trailingStopTon: number | null;
  /** break-even stop (moves SL to entry) once armed. */
  breakEvenAtTon: number | null;
  /** hard time-stop; null = no time-stop (diamond). */
  timeStopMs: number | null;
}

export interface OpenPositionInput {
  orderId: string;
  tokenAddress: string;
  ticker: string;
  entryTon: number;
  amountTon: number;
  stopLossTon: number;
  takeProfitTon: number;
  entryTs: number;
  mode: ExitMode;
  feesTon: number;
  timeStopMs: number | null;
}

export function openPosition(input: OpenPositionInput): Position {
  if (input.entryTon <= 0 || input.amountTon <= 0) throw new Error("openPosition: entryTon and amountTon must be positive");
  return {
    id: newId("pos"),
    ...input,
    qty: input.amountTon / input.entryTon,
    highWaterTon: input.entryTon,
    trailingStopTon: null,
    breakEvenAtTon: null,
  };
}

/** Break-even activation = +2× fee, matching ton-tpsl-manager's rule. */
export function breakEvenActivatePct(feesTon: number, amountTon: number): number {
  return amountTon > 0 ? (2 * feesTon) / amountTon : 0.02;
}
