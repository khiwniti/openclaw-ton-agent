/**
 * Exit modes — per-mode TP/SL/trailing/break-even/time-stop parameters
 * (ton-exit-modes skill). TON has no native stop orders, so ALL exits are
 * off-chain poll-based (architecture §9); stepPosition is called on a poll
 * loop with the latest price.
 */
;

export interface PartialTake {
  /** Price gain (fraction of entry) that triggers this partial take. */
  triggerPct: number;
  /** Fraction of current position size to exit (0-1). */
  sizePct: number;
}

export interface LadderExitConfig {
  priceTon: number;
  sizePct: number;
  label: string;
}

export interface ExitModeConfig {
  /** price gain (fraction of entry) that arms the break-even stop. */
  beActivatePct: number;
  /** pullback from high-water that triggers a trailing exit. */
  trailingPct: number;
  /** fraction of the way entry→TP where trailing arms. */
  trailingActivateAtPct: number;
  /** hard time-stop; null = none. */
  timeStopMs: number | null;
  /** Partial take-profit levels (executed in order). */
  partialTakes?: PartialTake[];
  /** Laddered exits (scale out in tranches at specific price levels). */
  ladderExits?: LadderExitConfig[];
}

export const EXIT_MODE_CONFIG: Record<ExitMode, ExitModeConfig> = {
  snipe: { 
    beActivatePct: 0.02, 
    trailingPct: 0.5, 
    trailingActivateAtPct: 0.5, 
    timeStopMs: 30 * 60_000,
    partialTakes: [
      { triggerPct: 0.3, sizePct: 0.5 },  // 30% gain -> sell 50%
      { triggerPct: 0.5, sizePct: 0.3 },  // 50% gain -> sell 30%
    ],
    ladderExits: [
      { priceTon: 0, sizePct: 0.33, label: "first_target" },   // Will be set at runtime
      { priceTon: 0, sizePct: 0.33, label: "second_target" },
      { priceTon: 0, sizePct: 0.34, label: "final_target" },
    ],
  },
  swing: { 
    beActivatePct: 0.02, 
    trailingPct: 0.35, 
    trailingActivateAtPct: 0.6, 
    timeStopMs: 6 * 3_600_000,
    partialTakes: [
      { triggerPct: 0.3, sizePct: 0.4 },  // 30% gain -> sell 40%
      { triggerPct: 0.6, sizePct: 0.3 },  // 60% gain -> sell 30%
      { triggerPct: 1.0, sizePct: 0.2 },  // 100% gain -> sell 20%
    ],
    ladderExits: [
      { priceTon: 0, sizePct: 0.33, label: "first_target" },
      { priceTon: 0, sizePct: 0.33, label: "second_target" },
      { priceTon: 0, sizePct: 0.34, label: "final_target" },
    ],
  },
  gamble: { 
    beActivatePct: 0.05, 
    trailingPct: 0.25, 
    trailingActivateAtPct: 0.8, 
    timeStopMs: 24 * 3_600_000,
    partialTakes: [
      { triggerPct: 0.5, sizePct: 0.5 },  // 50% gain -> sell 50%
      { triggerPct: 1.0, sizePct: 0.3 },  // 100% gain -> sell 30%
    ],
    ladderExits: [
      { priceTon: 0, sizePct: 0.5, label: "first_target" },
      { priceTon: 0, sizePct: 0.5, label: "final_target" },
    ],
  },
  diamond: { 
    beActivatePct: 0.1, 
    trailingPct: 0.2, 
    trailingActivateAtPct: 1.0, 
    timeStopMs: null,
    partialTakes: [],  // Diamond mode: manual only
    ladderExits: [],  // Diamond mode: no laddered exits
  },
};

export function modeConfig(mode: ExitMode): ExitModeConfig {
  return EXIT_MODE_CONFIG[mode];
}
