/** Slippage floor computation — fail-closed when floor rounds to zero. */

export interface MinOutConstraint {
  tier: string;
  ceilingBps: number;
  quotedOutNano: string;
  minOutNano: string;
}

export function computeMinOut(quotedOutNano: string, ceilingBps: number): string {
  const quoted = BigInt(quotedOutNano);
  if (quoted <= 0n) {
    throw new Error("quotedOutNano must be positive");
  }
  const minOut = (quoted * BigInt(10000 - ceilingBps)) / 10000n;
  if (minOut <= 0n) {
    throw new Error("minOut rounds to zero");
  }
  return minOut.toString();
}

export function buildMinOutConstraint(quote: { expectedOutNano?: string }, tier: string, ceilingBps: number): MinOutConstraint {
  const quotedOutNano = quote.expectedOutNano;
  if (!quotedOutNano) {
    throw new Error("quote is missing expectedOutNano");
  }
  return {
    tier,
    ceilingBps,
    quotedOutNano,
    minOutNano: computeMinOut(quotedOutNano, ceilingBps),
  };
}
