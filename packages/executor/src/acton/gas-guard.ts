/** Worst-case exit-reserve guard for BUY and SELL swaps. */

export const EXIT_RESERVE_TON = Number(process.env.DEX_EXIT_RESERVE_TON ?? "0.4");
export const SELL_GAS_FLOOR_TON = Number(process.env.DEX_SELL_GAS_FLOOR_TON ?? "0.35");
export const BANKROLL_FLOOR_TON = Number(process.env.DEX_BANKROLL_FLOOR_TON ?? "1.0");

export function effectiveBuyReserveTon(): number {
  return Math.max(EXIT_RESERVE_TON, BANKROLL_FLOOR_TON);
}

export interface GasGuardResult {
  ok: boolean;
  error: string;
  haveTon: number;
  needTon: number;
}

export function evaluateSellGasGuard(balanceTon: number): GasGuardResult {
  const haveTon = Number.isFinite(balanceTon) ? Math.max(0, balanceTon) : 0;
  if (haveTon < SELL_GAS_FLOOR_TON) {
    return {
      ok: false,
      error: `[sell] insufficient balance: have=${haveTon.toFixed(3)} TON, need>${SELL_GAS_FLOOR_TON.toFixed(3)} TON`,
      haveTon,
      needTon: SELL_GAS_FLOOR_TON,
    };
  }
  return { ok: true, error: "", haveTon, needTon: SELL_GAS_FLOOR_TON };
}

export function evaluateBuyGasGuard(balanceTon: number, requestedTon: number): GasGuardResult {
  const forwardCushion = Number(process.env.DEX_FORWARD_CUSHION_TON ?? "0.25");
  const reserveFloor = effectiveBuyReserveTon();
  const haveTon = Number.isFinite(balanceTon) ? Math.max(0, balanceTon) : 0;
  const safeRequested = Number.isFinite(requestedTon) ? Math.max(0, requestedTon) : 0;
  const needTon = safeRequested + forwardCushion + reserveFloor;

  if (!Number.isFinite(needTon) || haveTon < needTon) {
    return {
      ok: false,
      error: `[buy] insufficient balance: have=${haveTon.toFixed(3)} TON, need>${needTon.toFixed(3)} TON`,
      haveTon,
      needTon: Number.isFinite(needTon) ? needTon : 0,
    };
  }

  return { ok: true, error: "", haveTon, needTon };
}
