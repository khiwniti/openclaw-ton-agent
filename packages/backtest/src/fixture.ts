/**
 * Fixture data generator — deterministic synthetic signals for the backtest
 * harness and demo. Not real market data; honest label via `meta.backtest`.
 */
import { newId, type IngestedEnvelope } from "@openclaw-ton-agent/shared";
import { smaAt, type Bar } from "./series";

/** Deterministic momentum signal generator over a price series (fixture data). */
export function makeFixtureEnvelope(tokenAddress: string, ticker: string, priceTon: number, ts: number, score: number, kind: "fixture" | "real" = "fixture"): IngestedEnvelope {
  return {
    id: newId("sig"),
    ts,
    source: "manual",
    token: {
      address: tokenAddress,
      name: ticker,
      ticker,
      decimals: 9,
      priceTon,
      curvePct: 50,
      liquidityTon: 25_000,
      holders: 1500,
      tags: [kind === "real" ? "replay" : "fixture"],
    },
    audit: { verified: 100, renounced: true, locked: true, honeypot: true },
    score: { soft: score, risk: 100 - score },
    status: "validated",
    flags: kind === "real" ? ["replay", "real-bars"] : ["fixture"],
    reasoning: kind === "real" ? "real-bars momentum signal" : "backtest-fixture momentum signal",
    meta: { backtest: { strategy: "momentum", data: kind } },
  };
}

export interface FixtureEvent {
  ts: number;
  envelope: IngestedEnvelope;
}

export function generateEvents(
  bars: Bar[],
  tokenAddress: string,
  ticker: string,
  window = 24,
  kind: "fixture" | "real" = "fixture",
  /** Regime gate (bars): when > 0, only emit events when sma(window) > sma(regimeSlow)
   *  — a confirmed uptrend. Tokens in a sustained decline generate ZERO events, so
   *  they cannot drag down a portfolio backtest. This is the principled replacement
   *  for hand-curating the universe. */
  regimeSlow = 0,
): FixtureEvent[] {
  // adapt the window to short series (e.g. 45 daily bars) so signals exist
  const w = Math.min(window, Math.floor(bars.length / 3));
  if (w < 2) return [];
  const events: FixtureEvent[] = [];
  for (let i = w * 2; i < bars.length; i += 1) {
    if (regimeSlow > 0 && smaAt(bars, i, w) <= smaAt(bars, i, regimeSlow)) continue;
    const price = bars[i].priceTon;
    const sma = smaAt(bars, i, w);
    const prevSma = smaAt(bars, i - w, w);
    // momentum cross: price above its mean AND the mean itself rising — fires
    // on genuine up-moves anywhere in the series, not just the first spike.
    const trending = price > sma && sma > prevSma;
    const score = trending ? 92 : 55; // 55 < trade floor 70 → gates reject the lag
    events.push({ ts: bars[i].ts, envelope: makeFixtureEnvelope(tokenAddress, ticker, price, bars[i].ts, score, kind) });
  }
  return events;
}
