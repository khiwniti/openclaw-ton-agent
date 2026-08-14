/**
 * Poll-based exit decision (L4). Pure per-tick: given a position and the
 * latest observed price, return an action and the updated position. All
 * exits are off-chain; there is no on-chain stop order (architecture §9).
 *
 * Exit precedence when multiple levels are crossed:
 *   break-even (armed) → trailing (armed) → take-profit → stop-loss → time-stop
 * Break-even and trailing stops are treated as touched/filled at their level.
 */
import type { Position } from "./position";
import { modeConfig } from "./modes";

export type ExitAction = "hold" | "tp" | "sl" | "break_even" | "trail" | "time_stop";

export interface StepResult {
  action: ExitAction;
  exitPriceTon: number | null;
  pos: Position;
  reason: string;
}

export function stepPosition(pos: Position, priceTon: number, now: number): StepResult {
  const cfg = modeConfig(pos.mode);

  // 1. Track high-water and arm the protective stops.
  const highWaterTon = Math.max(pos.highWaterTon, priceTon);
  let trailingStopTon = pos.trailingStopTon;
  let breakEvenAtTon = pos.breakEvenAtTon;

  if (breakEvenAtTon === null && priceTon >= pos.entryTon * (1 + cfg.beActivatePct)) {
    breakEvenAtTon = pos.entryTon;
  }
  const trailingActivatePrice = pos.entryTon + (pos.takeProfitTon - pos.entryTon) * cfg.trailingActivateAtPct;
  if (trailingStopTon === null && highWaterTon >= trailingActivatePrice) {
    trailingStopTon = highWaterTon * (1 - cfg.trailingPct);
  } else if (trailingStopTon !== null && highWaterTon > pos.highWaterTon) {
    trailingStopTon = Math.max(trailingStopTon, highWaterTon * (1 - cfg.trailingPct));
  }

  const next: Position = { ...pos, highWaterTon, trailingStopTon, breakEvenAtTon };

  // 2. Exit checks. The effective protective stop is the TIGHTER armed stop
  //    (break-even vs trailing) — whichever is higher governs, and its action
  //    is reported. This keeps the trailing path reachable instead of dead.
  const breakEvenArmed = breakEvenAtTon !== null;
  const trailArmed = trailingStopTon !== null;
  const effectiveStop = Math.max(breakEvenArmed ? breakEvenAtTon! : -Infinity, trailArmed ? trailingStopTon! : -Infinity);
  if (effectiveStop !== -Infinity && priceTon <= effectiveStop) {
    const action: ExitAction = breakEvenArmed && effectiveStop === breakEvenAtTon ? "break_even" : "trail";
    return { action, exitPriceTon: effectiveStop, pos: next, reason: `${action} stop at ${effectiveStop.toFixed(6)}` };
  }
  if (priceTon >= pos.takeProfitTon) {
    return { action: "tp", exitPriceTon: pos.takeProfitTon, pos: next, reason: "take-profit" };
  }
  if (priceTon <= pos.stopLossTon) {
    return { action: "sl", exitPriceTon: pos.stopLossTon, pos: next, reason: "stop-loss" };
  }
  if (pos.timeStopMs !== null && now - pos.entryTs >= pos.timeStopMs) {
    return { action: "time_stop", exitPriceTon: priceTon, pos: next, reason: "time-stop" };
  }
  return { action: "hold", exitPriceTon: null, pos: next, reason: "" };
}
