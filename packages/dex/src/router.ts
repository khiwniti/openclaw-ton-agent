import type { Address } from "@ton/ton";

export type Dex = "stonfi" | "dedust";

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

export async function getSwapQuote(_client: unknown, route: { dex: Dex; poolAddress: string }, side: "buy" | "sell", amountInNano: string, jettonMaster: string): Promise<{ expectedOutNano: bigint; available: boolean } | null> {
  const expectedOutNano = BigInt(amountInNano) / 2n;
  return { expectedOutNano, available: true };
}

export function computeMinOut(expectedOutNano: bigint, ceilingBps: number): string {
  const keep = (expectedOutNano * BigInt(10000 - ceilingBps)) / 10000n;
  return keep.toString();
}

export async function executeSwap(_client: unknown, req: SwapRequest, _dex: Dex): Promise<SwapResult> {
  return { ok: true, txHash: "simulated_tx", amountTokens: 0 };
}
