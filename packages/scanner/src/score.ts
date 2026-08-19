/**
 * Confidence scoring — 100% baseline subtractive model.
 * Faithful port of ton-agent `risk/scoring.ts`. Every deduction is deterministic:
 * unknowns DEDUCT (honest — no fabricated safety).
 *
 * Output maps to SignalEnvelope.score:
 *   soft = final confidence (0-100), risk = total deduction (0-100).
 */
export interface ScoreInput {
  renounced: boolean;
  locked: boolean;
  honeypot: boolean;
  holders: number | null;
  ageHours: number | null;
  liquidityTon: number | null;
  poolAvailable: boolean;
}

export interface ScoreBreakdown {
  soft: number;
  risk: number;
  auditDeduction: number;
  holdersDeduction: number;
  ageDeduction: number;
  liquidityDeduction: number;
  dataGapDeduction: number;
}

export function computeScore(input: ScoreInput): ScoreBreakdown {
  let auditDeduction = 0;
  let holdersDeduction = 0;
  let ageDeduction = 0;
  let liquidityDeduction = 0;
  let dataGapDeduction = 0;

  if (!input.renounced) auditDeduction += 25;
  if (!input.locked) auditDeduction += 30;
  if (!input.honeypot) auditDeduction += 40;

  const holders = input.holders;
  if (holders === null) {
    dataGapDeduction += 20;
  } else if (holders < 10) {
    holdersDeduction += 15;
  } else if (holders < 100) {
    holdersDeduction += 10;
  } else if (holders < 500) {
    holdersDeduction += 5;
  }

  const ageHours = input.ageHours;
  if (ageHours === null) {
    ageDeduction += 15;
  } else if (ageHours < 1) {
    ageDeduction += 15;
  } else if (ageHours < 12) {
    ageDeduction += 10;
  } else if (ageHours < 24) {
    ageDeduction += 5;
  }

  if (!input.poolAvailable || input.liquidityTon === null) {
    liquidityDeduction += 10;
  } else if (input.liquidityTon < 10) {
    liquidityDeduction += 10;
  } else if (input.liquidityTon < 100) {
    liquidityDeduction += 5;
  }


  const risk = Math.min(100, auditDeduction + holdersDeduction + ageDeduction + liquidityDeduction + dataGapDeduction);
  const soft = Math.max(0, Math.min(100, 100 - risk));

  return { soft, risk, auditDeduction, holdersDeduction, ageDeduction, liquidityDeduction, dataGapDeduction };
}
