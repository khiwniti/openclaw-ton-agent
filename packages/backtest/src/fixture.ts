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
  regimeSlow = 0,
  /** Force the fixture generator into a high-score tradeable mode for replay tests. */
  tradable = false,
): FixtureEvent[] {
  const w = Math.min(window, Math.floor(bars.length / 3));
  if (w < 2) return [];
  const events: FixtureEvent[] = [];
  for (let i = w * 2; i < bars.length; i += 1) {
    if (regimeSlow > 0 && smaAt(bars, i, w) <= smaAt(bars, i, regimeSlow)) continue;
    const price = bars[i].priceTon;
    const sma = smaAt(bars, i, w);
    const prevSma = smaAt(bars, i - w, w);
    const trending = price > sma && sma > prevSma;
    const score = trending || tradable ? 92 : 55;
    events.push({ ts: bars[i].ts, envelope: makeFixtureEnvelope(tokenAddress, ticker, price, bars[i].ts, score, kind) });
  }
  return events;
}
