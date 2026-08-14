/**
 * Exit modes — per-mode TP/SL/trailing/break-even/time-stop parameters
 * (ton-exit-modes skill). TON has no native stop orders, so ALL exits are
 * off-chain poll-based (architecture §9); stepPosition is called on a poll
 * loop with the latest price.
 */
import type { ExitMode } from "./position";

export interface ExitModeConfig {
  /** price gain (fraction of entry) that arms the break-even stop. */
  beActivatePct: number;
  /** pullback from high-water that triggers a trailing exit. */
  trailingPct: number;
  /** fraction of the way entry→TP where trailing arms. */
  trailingActivateAtPct: number;
  /** hard time-stop; null = none. */
  timeStopMs: number | null;
}

export const EXIT_MODE_CONFIG: Record<ExitMode, ExitModeConfig> = {
  snipe: { beActivatePct: 0.02, trailingPct: 0.5, trailingActivateAtPct: 0.5, timeStopMs: 30 * 60_000 },
  swing: { beActivatePct: 0.02, trailingPct: 0.35, trailingActivateAtPct: 0.6, timeStopMs: 6 * 3_600_000 },
  gamble: { beActivatePct: 0.05, trailingPct: 0.25, trailingActivateAtPct: 0.8, timeStopMs: 24 * 3_600_000 },
  diamond: { beActivatePct: 0.1, trailingPct: 0.2, trailingActivateAtPct: 1.0, timeStopMs: null },
};

export function modeConfig(mode: ExitMode): ExitModeConfig {
  return EXIT_MODE_CONFIG[mode];
}
