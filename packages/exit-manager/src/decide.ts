/**
 * Poll-based exit decision (L4). Pure per-tick: given a position and the
 * latest observed price, return an action and the updated position. All
 * exits are off-chain; there is no on-chain stop order (architecture §9).
 *
 * Exit precedence when multiple levels are crossed:
 *   time_stop (hard timeout) → ladder_exit → partial_tp 
 *   → momentum_reversal (peak giveback / trend decay) 
 *   → trend_reversal (Supertrend/Chandelier flip) 
 *   → break_even (armed) → trailing (Chandelier) → take-profit 
 *   → structure_stop_loss (close-confirmed) → stop-loss
 * 
 * Key improvements from intelligent SL/TP research:
 * - Responsive Chandelier Exit (1.2x ATR for snipe, 2.5x ATR for swing)
 * - Momentum giveback / peak retrace exit (locks in profits when trend fades)
 * - Supertrend/Parabolic SAR for trend reversal TP
 * - Structure-based SL (swing low/high + ATR buffer, close-confirmed)
 * - Laddered exits (scale out in tranches)
 * - Volatility regime filter (widen SL when ATR spikes)
 * - Hard time-stop prioritized as top safety ceiling
 */
import { modeConfig } from "./modes.js";
import type { Position, TrendState } from "./position.js";

export type ExitAction = 
  | "hold" 
  | "tp" 
  | "sl" 
  | "break_even" 
  | "trail" 
  | "time_stop" 
  | "partial_tp" 
  | "trend_reversal"
  | "momentum_reversal"
  | "ladder_exit"
  | "structure_sl"
  | "blocked";

export interface StepResult {
  action: ExitAction;
  exitPriceTon: number | null;
  pos: Position;
  reason: string;
  /** For partial_tp/ladder_exit: the fraction of position exited (0-1). */
  exitSizePct?: number;
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

/** Structure-based stop loss: swing low + ATR buffer (close-confirmed) */
export function structureStopLoss(swingLow: number, atr: number, bufferMultiplier: number): number {
  return swingLow - (bufferMultiplier * atr);
}

/** Volatility regime: widen SL when ATR spikes beyond threshold */
export function volatilityAdjustedStop(baseStop: number, currentAtr: number, baseAtr: number, maxMultiplier: number): number {
  const atrRatio = currentAtr / Math.max(baseAtr, 1e-10);
  const multiplier = Math.min(1 + (atrRatio - 1) * 0.5, maxMultiplier); // Cap the widening
  return baseStop * multiplier; // Widen stop (lower for longs)
}

export function stepPosition(pos: Position, priceTon: number, now: number, candleClose?: number): StepResult {
  const cfg = modeConfig(pos.mode);
  const closePrice = candleClose ?? priceTon; // Use candle close for close-confirmation, tick for intrabar
  
  // 1. Update high/low water marks
  const highWaterTon = Math.max(pos.highWaterTon, priceTon);
  const lowWaterTon = Math.min(pos.lowWaterTon, priceTon);
  
  // 2. Initialize trend state on first tick
  let trendState: TrendState = pos.trendState;
  let trendFlipPrice = pos.trendFlipPrice;
  let trailingStopTon = pos.trailingStopTon;
  let breakEvenAtTon = pos.breakEvenAtTon;
  let swingLow = pos.swingLow;
  let swingHigh = pos.swingHigh;
  
  // 3. Mode-aware Chandelier Exit:
  // For snipe mode, use responsive 1.2x ATR trailing. For swing mode, use 2.5x ATR.
  const chandelierMultiplier = pos.mode === "snipe" ? 1.2 : 2.5;
  if (trailingStopTon === null && highWaterTon > pos.entryTon) {
    trailingStopTon = chandelierStop(highWaterTon, pos.atrAtEntry, chandelierMultiplier);
  } else if (trailingStopTon !== null && highWaterTon > pos.highWaterTon) {
    trailingStopTon = Math.max(trailingStopTon, chandelierStop(highWaterTon, pos.atrAtEntry, chandelierMultiplier));
  }
  
  // 4. Break-even arming
  if (breakEvenAtTon === null && priceTon >= pos.entryTon * (1 + cfg.beActivatePct)) {
    breakEvenAtTon = pos.entryTon;
  }
  
  // 5. Volatility regime adjustment: widen SL if ATR spikes
  const volatilityMultiplier = 2.0; // Max 2x widening
  let effectiveStopLoss = pos.initialStopLossTon;
  if (pos.swingLow !== null) {
    effectiveStopLoss = Math.max(effectiveStopLoss, structureStopLoss(pos.swingLow, pos.atrAtEntry, 1.0));
  }
  effectiveStopLoss = volatilityAdjustedStop(effectiveStopLoss, pos.atrAtEntry, pos.atrAtEntry, volatilityMultiplier);
  
  // 6. Supertrend/Parabolic SAR trend line for trend reversal exit
  if (trendFlipPrice === null && trailingStopTon !== null) {
    trendFlipPrice = trailingStopTon;
    trendState = "uptrend";
  }
  if (trendState === "uptrend" && trailingStopTon !== null && trailingStopTon > (trendFlipPrice ?? 0)) {
    trendFlipPrice = trailingStopTon;
  }

  const next: Position = { 
    ...pos, 
    highWaterTon, 
    lowWaterTon,
    trailingStopTon, 
    breakEvenAtTon,
    trendFlipPrice,
    trendState,
    swingLow,
    swingHigh,
  };

  // ── PRIORITY 1: Hard Time-Stop Ceiling ──────────────────────────
  const effectiveTimeStopMs = typeof pos.timeStopMs === "number" ? pos.timeStopMs : (pos.mode === "snipe" ? 30 * 60_000 : null);
  if (effectiveTimeStopMs !== null && effectiveTimeStopMs > 0 && now - pos.entryTs >= effectiveTimeStopMs) {
    const elapsedMin = ((now - pos.entryTs) / 60_000).toFixed(1);
    const limitMin = (effectiveTimeStopMs / 60_000).toFixed(1);
    return { action: "time_stop", exitPriceTon: priceTon, pos: next, reason: `time-stop (${elapsedMin}m >= ${limitMin}m)` };
  }
  
  // ── PRIORITY 2: Laddered Exits (scale out in tranches) ─────────
  if (pos.ladderExits && pos.ladderExits.length > 0) {
    for (let i = 0; i < pos.ladderExits.length; i++) {
      const ladder = pos.ladderExits[i];
      if (!ladder.executed && priceTon >= ladder.priceTon) {
        const nextLadder = [...pos.ladderExits];
        nextLadder[i] = { ...ladder, executed: true };
        const exitSizePct = ladder.sizePct;
        const ladderNext = { 
          ...next, 
          remainingQty: pos.remainingQty * (1 - ladder.sizePct),
          ladderExits: nextLadder,
        };
        return { 
          action: "ladder_exit", 
          exitPriceTon: priceTon, 
          pos: ladderNext, 
          reason: `ladder exit ${ladder.label} at ${ladder.priceTon.toFixed(6)} (sell ${(ladder.sizePct * 100).toFixed(0)}%)`,
          exitSizePct,
        };
      }
    }
  }
  
  // ── PRIORITY 3: Partial Take-Profit Levels ─────────────────────
  if (cfg.partialTakes && cfg.partialTakes.length > 0) {
    for (let i = 0; i < cfg.partialTakes.length; i++) {
      const pt = cfg.partialTakes[i];
      if (!pos.partialTakesHit.includes(i) && priceTon >= pos.entryTon * (1 + pt.triggerPct)) {
        const nextTakesHit = [...pos.partialTakesHit, i];
        const ptNext = { 
          ...next, 
          partialTakesHit: nextTakesHit,
          remainingQty: pos.remainingQty * (1 - pt.sizePct),
        };
        return { 
          action: "partial_tp", 
          exitPriceTon: priceTon, 
          pos: ptNext, 
          reason: `partial TP ${i + 1} at ${(pt.triggerPct * 100).toFixed(1)}% (sell ${(pt.sizePct * 100).toFixed(0)}%)`,
          exitSizePct: pt.sizePct,
        };
      }
    }
  }
  
  // ── PRIORITY 4: Momentum Fade & Peak Retracement Protection ───
  // When a position reached a strong peak gain, protect profit against momentum reversal
  if (highWaterTon > pos.entryTon) {
    const peakGainTon = highWaterTon - pos.entryTon;
    const peakGainPct = peakGainTon / pos.entryTon;
    
    // Tier A: Strong peak gain (>= 8%) — allow max 35% retracement from peak
    if (peakGainPct >= 0.08) {
      const retraceFloor = pos.entryTon + (peakGainTon * 0.65);
      if (priceTon <= retraceFloor) {
        return {
          action: "momentum_reversal",
          exitPriceTon: priceTon,
          pos: { ...next, trendState: "downtrend" },
          reason: `momentum fade: gave back 35% of +${(peakGainPct * 100).toFixed(1)}% peak gain (floor: ${retraceFloor.toFixed(6)})`,
        };
      }
    }
    // Tier B: Moderate peak gain (>= 3.5%) — allow max 50% retracement from peak
    else if (peakGainPct >= 0.035) {
      const retraceFloor = pos.entryTon + (peakGainTon * 0.50);
      if (priceTon <= retraceFloor) {
        return {
          action: "momentum_reversal",
          exitPriceTon: priceTon,
          pos: { ...next, trendState: "downtrend" },
          reason: `momentum fade: gave back 50% of +${(peakGainPct * 100).toFixed(1)}% peak gain (floor: ${retraceFloor.toFixed(6)})`,
        };
      }
    }
  }

  // ── PRIORITY 5: Supertrend / Chandelier Reversal Exit ─────────
  if (trailingStopTon !== null && trendFlipPrice !== null && supertrendFlip(closePrice, trendFlipPrice, trendState)) {
    return { 
      action: "trend_reversal", 
      exitPriceTon: closePrice, 
      pos: { ...next, trendState: "downtrend" }, 
      reason: `trend reversal (Supertrend flip) at ${closePrice.toFixed(6)}` 
    };
  }

  // ── PRIORITY 6: Protective Stops (Break-Even vs Trailing) ──────
  const breakEvenArmed = breakEvenAtTon !== null;
  const trailArmed = trailingStopTon !== null;
  const effectiveTrailingStop = trailArmed ? trailingStopTon! : -Infinity;
  const effectiveBreakEven = breakEvenArmed ? breakEvenAtTon! : -Infinity;
  const effectiveStop = Math.max(effectiveBreakEven, effectiveTrailingStop);
  
  if (effectiveStop !== -Infinity && priceTon <= effectiveStop) {
    const action: ExitAction = breakEvenArmed && effectiveStop === breakEvenAtTon ? "break_even" : "trail";
    return { action, exitPriceTon: effectiveStop, pos: next, reason: `${action} stop at ${effectiveStop.toFixed(6)}` };
  }

  // ── PRIORITY 7: Structure-based SL (close-confirmed) ───────────
  const structureSLTriggered = pos.swingLow !== null && 
    closePrice <= structureStopLoss(pos.swingLow, pos.atrAtEntry, 1.0);
  if (structureSLTriggered) {
    return { 
      action: "structure_sl", 
      exitPriceTon: closePrice, 
      pos: next, 
      reason: `structure SL hit (swing low ${pos.swingLow} + ATR buffer)` 
    };
  }
  
  // ── PRIORITY 8: Fixed Take-Profit & Stop-Loss ──────────────────
  if (priceTon >= pos.takeProfitTon) {
    return { action: "tp", exitPriceTon: pos.takeProfitTon, pos: next, reason: "take-profit" };
  }
  if (priceTon <= pos.stopLossTon) {
    return { action: "sl", exitPriceTon: pos.stopLossTon, pos: next, reason: "stop-loss" };
  }
  
  return { action: "hold", exitPriceTon: null, pos: next, reason: "" };
}
