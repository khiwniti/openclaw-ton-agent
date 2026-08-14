import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySeries, curveBand } from "./regime";
import { realizedVolPct } from "./vol";
import { whaleSignal, sentimentFromHolders } from "./whales";
import { annotateEnvelope } from "./annotate";
import { newId, validateIngested, type IngestedEnvelope } from "@openclaw-ton-agent/shared";

function series(prices: number[], startTs = 1_752_000_000_000, stepMs = 60_000): { ts: number; priceTon: number }[] {
  return prices.map((priceTon, i) => ({ ts: startTs + i * stepMs, priceTon }));
}

function baseEnvelope(): IngestedEnvelope {
  const env = {
    id: newId("sig"),
    ts: Date.now(),
    source: "radar",
    token: { address: "EQA-gated-1", name: "G", ticker: "G", decimals: 9, priceTon: 0.5, curvePct: 50, liquidityTon: 100, holders: 500 },
    audit: { verified: 100, renounced: true, locked: true, honeypot: true },
    score: { soft: 92, risk: 8 },
    status: "validated",
    flags: [],
    reasoning: "test",
  } as IngestedEnvelope;
  assert.ok(validateIngested(env).ok);
  return env;
}

test("classifySeries: trending up", () => {
  const prices = Array.from({ length: 30 }, (_, i) => 0.1 * Math.pow(1.03, i));
  const r = classifySeries(series(prices));
  assert.equal(r.regime, "trending_up");
  assert.ok(r.confidence > 0.5);
});

test("classifySeries: trending down", () => {
  const prices = Array.from({ length: 30 }, (_, i) => 1.0 * Math.pow(0.97, i));
  const r = classifySeries(series(prices));
  assert.equal(r.regime, "trending_down");
});

test("classifySeries: sideways", () => {
  const prices = Array.from({ length: 30 }, (_, i) => 0.5 + Math.sin(i) * 0.01);
  const r = classifySeries(series(prices));
  assert.equal(r.regime, "sideways");
});

test("classifySeries: breakout up", () => {
  const prices = Array.from({ length: 30 }, (_, i) => (i < 28 ? 0.5 : 0.5 + (i - 27) * 0.15));
  const r = classifySeries(series(prices));
  assert.equal(r.regime, "breakout_up");
});

test("classifySeries: insufficient data → unknown, never fabricated", () => {
  const r = classifySeries(series([0.1, 0.2, 0.3, 0.4, 0.5]));
  assert.equal(r.regime, "unknown");
  assert.equal(r.confidence, 0);
});

test("curveBand buckets", () => {
  assert.equal(curveBand(10), "early_curve");
  assert.equal(curveBand(50), "sweet");
  assert.equal(curveBand(95), "late_curve");
  assert.equal(curveBand(null), "unknown");
});

test("whaleSignal: accumulating / dumping / none / unknown", () => {
  assert.equal(whaleSignal(120, 100).signal, "accumulating");
  assert.equal(whaleSignal(80, 100).signal, "dumping");
  assert.equal(whaleSignal(105, 100).signal, "none");
  assert.equal(whaleSignal(null, 100).signal, null);
  assert.equal(whaleSignal(120, null).signal, null);
});

test("sentimentFromHolders mirrors whale signals", () => {
  assert.equal(sentimentFromHolders(120, 100), "bullish");
  assert.equal(sentimentFromHolders(80, 100), "bearish");
  assert.equal(sentimentFromHolders(100, 100), "neutral");
  assert.equal(sentimentFromHolders(null, 100), "unknown");
});

test("annotateEnvelope appends meta.annotation and preserves core fields", () => {
  const env = baseEnvelope();
  const annotated = annotateEnvelope(env, {
    regime: { regime: "trending_up", confidence: 0.8, slopePerDayPct: 5, r2: 0.9 },
    curvePct: 50,
    whale: { signal: "accumulating", deltaPct: 20 },
    sentiment: "bullish",
    sources: ["market-intel", "tonapi"],
  });
  const a = annotated.meta?.annotation as any;
  assert.equal(a.regime, "trending_up");
  assert.equal(a.curveBand, "sweet");
  assert.equal(a.whale, "accumulating");
  assert.equal(a.sentiment, "bullish");
  assert.ok(a.sources.includes("market-intel"));
  assert.equal(annotated.token.address, env.token.address);
  assert.equal(annotated.id, env.id);
  assert.equal(annotated.score?.soft, env.score?.soft);
});

test("realizedVolPct: null with no bars; clamped low vol; higher vol measured higher", () => {
  assert.equal(realizedVolPct(null), null);
  assert.equal(realizedVolPct([]), null);
  assert.equal(realizedVolPct(series([0.1, 0.11]), { atrPeriod: 5 }), null, "too few bars");

  const flat = realizedVolPct(series(Array.from({ length: 60 }, (_, i) => 0.1 * Math.pow(1.001, i))), { minVolPct: 0.02 });
  assert.equal(flat, 0.02, "flat series floors at minVolPct");

  const jumpy = realizedVolPct(series(Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 0.1 : 0.115))), { minVolPct: 0.02 });
  assert.ok(jumpy !== null && jumpy > 0.05, `alternating ±15% bars measure above the floor: ${jumpy}`);
});
