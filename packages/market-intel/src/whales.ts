/**
 * On-chain whale + sentiment signals derived from holder-count deltas.
 * Deterministic and honest: when the delta is unknown, no signal is emitted
 * (null), never a fabricated trend.
 */

export type WhaleSignal = "accumulating" | "dumping" | "none";
export type Sentiment = "bullish" | "bearish" | "neutral" | "unknown";

export interface WhaleOpts {
  /** % holder delta that qualifies as whale accumulation/dump. Default 10. */
  thresholdPct?: number;
}

export interface WhaleResult {
  signal: WhaleSignal | null;
  deltaPct: number | null;
}

/** holdersNow/holdersPrev as null → unknown → null signal. */
export function whaleSignal(holdersNow: number | null, holdersPrev: number | null, opts: WhaleOpts = {}): WhaleResult {
  if (holdersNow === null || holdersPrev === null || holdersPrev <= 0) {
    return { signal: null, deltaPct: null };
  }
  const deltaPct = ((holdersNow - holdersPrev) / holdersPrev) * 100;
  const { thresholdPct = 10 } = opts;
  if (deltaPct >= thresholdPct) return { signal: "accumulating", deltaPct };
  if (deltaPct <= -thresholdPct) return { signal: "dumping", deltaPct };
  return { signal: "none", deltaPct };
}

/** Sentiment from holder delta (bullish when growing, bearish when shrinking). */
export function sentimentFromHolders(holdersNow: number | null, holdersPrev: number | null, opts: WhaleOpts = {}): Sentiment {
  const { signal } = whaleSignal(holdersNow, holdersPrev, opts);
  if (signal === null) return "unknown";
  if (signal === "accumulating") return "bullish";
  if (signal === "dumping") return "bearish";
  return "neutral";
}
