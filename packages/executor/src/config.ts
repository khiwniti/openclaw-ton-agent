/**
 * Executor config — env-driven, loaded once at startup.
 *
 * SAFETY: the executor NEVER signs until two conditions both hold:
 *   EXECUTION_MODE=auto         (operator opted into live execution)
 *   GATES_G1_G3_ACK=1           (operator acknowledged G1–G3 gate progression)
 * Without `auto`, real wallet adapters refuse outright.
 */
import "dotenv/config";
import type { ExecutionMode } from "@openclaw-ton-agent/shared";

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function str(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export function parseExecutionMode(value: string | undefined): ExecutionMode {
  const m = (value ?? "notify_only").toLowerCase();
  if (m === "notify_only" || m === "paper" || m === "auto") return m;
  throw new Error(`EXECUTION_MODE must be notify_only|paper|auto, got "${value}"`);
}

export const EXEC_CONFIG = {
  network: (process.env.TON_NETWORK ?? "mainnet") as "mainnet" | "testnet",
  mode: parseExecutionMode(process.env.EXECUTION_MODE),

  /** confirm-first guardrails (architecture §10). */
  sizeConfirmThresholdTon: num("SIZE_CONFIRM_THRESHOLD_TON", 1.0),
  liveConfirmFirstNTrades: num("LIVE_CONFIRM_FIRST_N_TRADES", 10),
  minOrderTon: num("MIN_ORDER_TON", 0.20),
  maxOpenPositions: num("MAX_OPEN_POSITIONS_PER_TIER", 10),

  /** live execution requires an explicit G1–G3 gate progression acknowledgement. */
  gatesG1G3Ack: bool("GATES_G1_G3_ACK", false),

  slippageBps: num("EXEC_SLIPPAGE_BPS", 200),
  orderTtlMs: num("EXEC_ORDER_TTL_MS", 60_000),

  wallet: {
    /** @ton/mcp config; real swaps only possible in auto mode + ack. */
    tonConfigPath: str("TON_CONFIG_PATH", "~/.config/ton/config.json"),
    rpcUrl: str("TON_RPC_URL", "https://toncenter.com/api/v2/jsonRPC"),
  },

  /** Acton integration toggles. */
  acton: {
    /** When true, auto mode uses ActonWallet instead of TonMcpWallet. */
    enabled: bool("ACTON_ENABLED", false),
    /** Acton project root for CLI/FFI calls. */
    projectPath: str("ACTON_PROJECT_PATH", "."),
    /** Optional deployed contract/router address overrides. */
    contractAddress: str("ACTON_CONTRACT_ADDRESS", ""),
    routerAddress: str("ACTON_ROUTER_ADDRESS", ""),
  },
};
