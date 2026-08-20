/**
 * Position model (L4 exit side). A position is opened from a validated
 * OrderRequest + the same pointSetup the risk gates used, so stop/target are
 * deterministic and fee-aware.
 */
import { newId } from "@openclaw-ton-agent/shared";
import type { LifecycleState } from "@openclaw-ton-agent/shared";

export type ExitMode = "snipe" | "swing" | "gamble" | "diamond";

/** Trend state for Supertrend/Chandelier logic */
export type TrendState = "uptrend" | "downtrend" | "unknown";

export interface Position {
  id: string;
  orderId: string;
  tokenAddress: string;
  ticker: string;
  /** entry price, TON per token. */
  entryTon: number;
  /** token qty = amountTon / entryTon. */
  qty: number;
  /** remaining qty after partial exits. */
  remainingQty: number;
  /** TON capital committed. */
  amountTon: number;
  /** Initial stop loss (structure-based). */
  initialStopLossTon: number;
  /** Dynamic stop loss (Chandelier/ATR trailing). */
  stopLossTon: number;
  takeProfitTon: number;
  entryTs: number;
  mode: ExitMode;
  /** round-trip cost charged on this position. */
  feesTon: number;
  /** highest price seen since entry. */
  highWaterTon: number;
  /** lowest price seen since entry (for short positions). */
  lowWaterTon: number;
  /** Chandelier/ATR trailing stop. */
  trailingStopTon: number | null;
  /** break-even stop (moves SL to entry) once armed. */
  breakEvenAtTon: number | null;
  /** Supertrend/Parabolic SAR flip price - trend reversal trigger. */
  trendFlipPrice: number | null;
  /** Current trend state. */
  trendState: TrendState;
  /** ATR value at entry (for volatility reference). */
  atrAtEntry: number;
  /** Swing low/high for structure-based SL. */
  swingLow: number | null;
  swingHigh: number | null;
  /** hard time-stop; null = no time-stop (diamond). */
  timeStopMs: number | null;
  /** Indices of partial takes already executed. */
  partialTakesHit: number[];
  /** Laddered exit config (scale-out tranches). */
  ladderExits: LadderExit[];
  /** Number of consecutive exit sell bounces for this position. */
  bounceCount: number;
  /** State of the position lifecycle. */
  lifecycleState: LifecycleState;
  /** ID of an active exit order to prevent duplicate exits. */
  activeExitOrderId: string | null;
}

export interface LadderExit {
  /** Price level (TON per token) to exit this tranche. */
  priceTon: number;
  /** Fraction of remaining position to exit (0-1). */
  sizePct: number;
  /** Label for logging. */
  label: string;
  /** Whether this tranche has been executed. */
  executed: boolean;
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
  /** ATR at entry for Chandelier trailing. */
  atrAtEntry: number;
  /** Swing low/high for structure-based SL. */
  swingLow: number | null;
  swingHigh: number | null;
  /** Laddered exit tranches. */
  ladderExits: LadderExit[];
}

export function openPosition(input: OpenPositionInput): Position {
  if (input.entryTon <= 0 || input.amountTon <= 0) throw new Error("openPosition: entryTon and amountTon must be positive");
  const qty = input.amountTon / input.entryTon;
  return {
    id: newId("pos"),
    ...input,
    qty,
    initialStopLossTon: input.stopLossTon,
    remainingQty: qty,
    highWaterTon: input.entryTon,
    lowWaterTon: input.entryTon,
    trailingStopTon: null,
    breakEvenAtTon: null,
    trendFlipPrice: null,
    trendState: "unknown",
    partialTakesHit: [],
    ladderExits: input.ladderExits.map(le => ({ ...le, executed: false })),
    bounceCount: 0,
    lifecycleState: "OPEN",
    activeExitOrderId: null,
  };
}

/** Break-even activation = +2× fee, matching ton-tpsl-manager's rule. */
export function breakEvenActivatePct(feesTon: number, amountTon: number): number {
  return amountTon > 0 ? (2 * feesTon) / amountTon : 0.02;
}

/** Chandelier Exit: trailing stop = highWater - (atrMultiplier * ATR) */
export function chandelierStop(highWater: number, atr: number, multiplier: number): number {
  return highWater - (multiplier * atr);
}

/** Supertrend flip: close when price crosses the trend line */
export function supertrendFlip(price: number, trendLine: number, trendState: TrendState): boolean {
  if (trendState === "uptrend") return price <= trendLine;
  if (trendState === "downtrend") return price >= trendLine;
  return false;
}
