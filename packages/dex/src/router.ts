import {
  getSwapQuote as _getSwapQuote,
  executeSwap as _executeSwap,
  type Dex,
  type SwapResult as ActonSwapResult,
} from "@openclaw-ton-agent/executor";


export { Dex };

export interface SwapRequest {
  side: "buy" | "sell";
  jettonMaster: string;
  amountTon: number;
  minOutJettonNano?: string;
}

export interface SwapResult {
  ok: boolean;
  txHash?: string;
  amountTokens?: number;
  error?: string;
}

/**
 * Get a swap quote for the given route and side.
 * Delegates to the acton router which calls Ston.fi / DeDust on-chain.
 * Returns null if the pool is dead-cached or the RPC call fails.
 */
export async function getSwapQuote(
  client: unknown,
  route: { dex: Dex; poolAddress: string },
  side: "buy" | "sell",
  amountInNano: string,
  jettonMaster: string,
  network = "mainnet"
): Promise<{ expectedOutNano: bigint; available: boolean } | null> {
  const quote = await _getSwapQuote(
    client as any,
    route,
    side,
    amountInNano,
    jettonMaster,
    network
  );
  if (!quote) return null;
  return {
    expectedOutNano: BigInt(quote.expectedOutNano),
    available: quote.available,
  };
}

/**
 * Compute the minimum acceptable output given expected output and a slippage ceiling in bps.
 */
export function computeMinOut(expectedOutNano: bigint, ceilingBps: number): string {
  const roundedBps = Math.round(ceilingBps);
  const keep = (expectedOutNano * BigInt(10_000 - roundedBps)) / 10_000n;
  return keep.toString();
}

/**
 * Execute a swap against the given DEX.
 * In notify_only/paper mode this should not be called — use PaperWallet instead.
 * In auto mode, delegates to the acton router.
 */
export async function executeSwap(
  client: unknown,
  req: SwapRequest,
  dex: Dex,
  network = "mainnet",
  tier: "low" | "mid" | "high" = "low",
  wallet?: { address: string; getBalance?: () => Promise<bigint> }
): Promise<SwapResult> {
  const result: ActonSwapResult = await _executeSwap(
    client as any,
    {
      jettonMaster: req.jettonMaster,
      amountTon: req.amountTon,
      side: req.side,
      minOutJettonNano: req.minOutJettonNano,
    },
    tier,
    dex,
    network as any,
    wallet
  );
  return {
    ok: result.ok,
    txHash: result.txHash,
    amountTokens: result.amountTokens ? Number(result.amountTokens) : undefined,
    error: result.error,
  };
}


