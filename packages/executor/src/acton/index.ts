/** Acton-backed executor adapter for the OpenClaw TON trading system.

 *  This module ports the real DEX execution path from `ton-agent` into
 *  `openclaw-ton-agent` so the executor can run live swaps through
 *  Acton/CLI or Acton FFI instead of the current placeholder Omniston
 *  message builder.
 *
 *  Design goals:
 *   - fail closed: every quote, broadcast, and settlement step must be
 *     verifiable or the order is bounced, never silently booked
 *   - safety-first: gas/reserve guards, confirm-first, kill-switch,
 *     and mode gating are enforced before any live action
 *   - parity with `ton-agent`: post-broadcast balance delta checks,
 *     dead-pool caching, and HD tier wallets are preserved
 */

export { ActonWallet } from "./acton-wallet.js";

export { buildActonCommand, type ActonCommandOptions } from "./cli.js";

export {
  STONFI_ROUTER_ADDR,
  DEDUST_FACTORY_ADDR_MAINNET,
  type Dex,
  type SwapQuote,
  getSwapQuote,
  executeSwap,
  type SwapExecutionStatus,
  type SwapResult,
} from "./router.js";

export {
  computeMinOut,
  buildMinOutConstraint,
  type MinOutConstraint,
} from "./minout.js";

export {
  EXIT_RESERVE_TON,
  SELL_GAS_FLOOR_TON,
  BANKROLL_FLOOR_TON,
  effectiveBuyReserveTon,
  evaluateSellGasGuard,
  evaluateBuyGasGuard,
  type GasGuardResult,
} from "./gas-guard.js";

export {
  computeDeliveredIncrement,
  verifyBuyDelivered,
  verifySellDelta,
  verifySellExecuted,
  readUserJettonBalance,
} from "./verify.js";

export { sendTransferLocked } from "./locked-wallet.js";
