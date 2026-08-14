import { test } from "node:test";
import assert from "node:assert/strict";
import { newId, validateIngested, type IngestedEnvelope } from "@openclaw-ton-agent/shared";
import { GATE_CONFIG, totalCostTon } from "./config";
import { kellyFraction, sizedPositionTon } from "./kelly";
import { pointSetup } from "./point-setup";
import { evaluateGates } from "./gates";

function env(over: Partial<IngestedEnvelope> = {}): IngestedEnvelope {
  const e = {
    id: newId("sig"),
    ts: Date.now(),
    source: "radar",
    token: { address: "EQA-gated-1", name: "G", ticker: "G", decimals: 9, priceTon: 10, curvePct: 50, liquidityTon: 100, holders: 500 },
    audit: { verified: 100, renounced: true, locked: true, honeypot: true },
    score: { soft: 92, risk: 8 },
    status: "validated",
    flags: [],
    reasoning: "test",
    ...over,
  } as IngestedEnvelope;
  assert.ok(validateIngested(e).ok);
  return e;
}

function ctx(over: Partial<Parameters<typeof evaluateGates>[1]> = {}): Parameters<typeof evaluateGates>[1] {
  return {
    now: Date.now(),
    cooldowns: new Map(),
    openPositions: [],
    drawdownPct: 0,
    killSwitchFlipped: false,
    bankrollTon: GATE_CONFIG.bankrollTon,
    ...over,
  };
}

test("kellyFraction is nonnegative and zero when the game is negative", () => {
  assert.ok(kellyFraction(0.5, 2) > 0);
  assert.ok(kellyFraction(0.55, 1) > 0);
  assert.equal(kellyFraction(0.4, 1), 0); // 1*0.4 - 0.6 = -0.2 → 0
});

test("kellyFraction clamps a near-certain win instead of zeroing it", () => {
  const f = kellyFraction(1, 3); // score-100 envelope must not bet 0
  assert.ok(f > 0);
  assert.ok(f <= 1);
  assert.equal(kellyFraction(0, 3), 0);
});

test("sizedPositionTon caps at tier ceiling", () => {
  const s = sizedPositionTon({ winProb: 0.6, payoffRatio: 3, bankrollTon: 100, tierCeilingTon: 5 });
  assert.ok(s.sizeTon > 0 && s.sizeTon <= 5);
});

test("sizedPositionTon rejects positions below the fee floor", () => {
  const s = sizedPositionTon({ winProb: 0.4, payoffRatio: 3, bankrollTon: 1, tierCeilingTon: 0.05 });
  assert.equal(s.sizeTon, 0);
  assert.match(s.reason, /fee floor/);
});

test("sizedPositionTon: measured vol risk-targets size (lot-size intelligence)", () => {
  // winProb 0.9 → kelly ≈ 21.7 TON, above the tier ceiling (20): tier binds.
  const base = { winProb: 0.9, payoffRatio: 3, bankrollTon: 100, tierCeilingTon: 20 };
  const noVol = sizedPositionTon(base);
  assert.equal(noVol.cappedBy, "tier");
  assert.equal(noVol.sizeTon, 20);

  // vol 0.05 → risk cap = 100 × 0.01 / 0.05 = 20 TON → still tier-bounded.
  const vol5 = sizedPositionTon({ ...base, volPct: 0.05 });
  assert.equal(vol5.cappedBy, "tier");
  assert.equal(vol5.sizeTon, 20);

  // vol 0.25 → risk cap = 100 × 0.01 / 0.25 = 4 TON → risk cap binds, halving
  // the tier ceiling. Higher measured vol shrinks the position.
  const vol25 = sizedPositionTon({ ...base, volPct: 0.25 });
  assert.equal(vol25.cappedBy, "risk");
  assert.equal(vol25.sizeTon, 4);
});

test("pointSetup: measured vol widens the stop instead of the fixed constant", () => {
  const fixed = pointSetup({ entryTon: 10, curvePct: 50, rrTarget: 3 });
  assert.equal(fixed.stopLoss, 10 - 10 * GATE_CONFIG.volPct);

  const highVol = pointSetup({ entryTon: 10, curvePct: 50, rrTarget: 3, volPct: 0.2 });
  assert.ok(highVol.stopLoss < fixed.stopLoss, "20% vol gives a wider stop than the 5% constant");
  assert.equal(highVol.volPct, 0.2);

  const pathological = pointSetup({ entryTon: 10, curvePct: 50, rrTarget: 3, volPct: 0.9 });
  assert.equal(pathological.volPct, GATE_CONFIG.volCapPct, "vol above the cap is clamped");
});

test("pointSetup: R:R target honored, win covers round-trip fee", () => {
  const p = pointSetup({ entryTon: 10, curvePct: 50, rrTarget: 3 });
  assert.equal(p.rr, 3);
  assert.ok(p.expectedWinTon > totalCostTon());
  assert.equal(p.stopLoss, 10 - 10 * GATE_CONFIG.volPct);
});

test("gates: pass a clean, quoted, well-scored envelope", () => {
  const r = evaluateGates(env(), ctx());
  assert.equal(r.verdict, "pass");
  assert.ok(r.sizeTon > 0);
  assert.equal(r.tier, "high");
  assert.ok(r.expectedValueTon > 0);
  assert.ok((r.cooldownUntil ?? 0) > 0);
});

test("gates: kill switch halts everything", () => {
  const r = evaluateGates(env(), ctx({ killSwitchFlipped: true }));
  assert.equal(r.verdict, "halt");
  assert.match(r.reasons[0], /KILL SWITCH/);
});

test("gates: drawdown breaker halts", () => {
  const r = evaluateGates(env(), ctx({ drawdownPct: GATE_CONFIG.maxDrawdownPct + 1 }));
  assert.equal(r.verdict, "halt");
  assert.match(r.reasons[0], /drawdown/);
});

test("gates: cooldown rejects a repeated token", () => {
  const c = ctx();
  const first = evaluateGates(env(), c);
  assert.equal(first.verdict, "pass");
  const again = evaluateGates(env(), c); // same address, cooldown now set
  assert.equal(again.verdict, "reject");
  assert.match(again.reasons[0], /cooldown/);
});

test("gates: low score rejects below trade floor", () => {
  const r = evaluateGates(env({ score: { soft: 40, risk: 60 } }), ctx());
  assert.equal(r.verdict, "reject");
  assert.match(r.reasons[0], /trade floor/);
});

test("gates: missing quote rejects (no fabrication)", () => {
  const r = evaluateGates(env({ token: { ...env().token, priceTon: null } }), ctx());
  assert.equal(r.verdict, "reject");
  assert.match(r.reasons[0], /no quote/);
});

test("gates: fee-coverage is position-level, not price-magnitude", () => {
  // A token priced at 1e-7 TON is fine: a 20 TON high-tier position wins
  // size×vol×rr = 3 TON at target, which covers the fee floor. Rejecting it
  // because the per-token move is tiny would be dimensionally wrong.
  const r = evaluateGates(env({ token: { ...env().token, priceTon: 0.0000001 } }), ctx());
  assert.equal(r.verdict, "pass");
  assert.ok(r.expectedValueTon > 0);
});

test("gates: a position too small to cover the fee floor rejects", () => {
  // tier ceiling 0.01 TON → capped size < cost×feeCoverageMult (2.04 TON) →
  // kelly's fee floor rejects: fees would dominate the winner.
  const r = evaluateGates(env(), ctx({ tierCeilingTon: 0.01 }));
  assert.equal(r.verdict, "reject");
  assert.match(r.reasons[0], /fee floor/);
});

test("gates: correlation rejects when an open position shares the group", () => {
  const r = evaluateGates(env(), ctx({
    openPositions: [{ address: "EQA-other", group: "g1", pnlPct: 5 }],
    correlationGroup: (addr) => (addr === "EQA-gated-1" ? "g1" : null),
  }));
  assert.equal(r.verdict, "reject");
  assert.match(r.reasons[0], /correlated/);
});

test("gates: expected-value is position-level and positive when the game is +EV", () => {
  // score 92, rr 3, high tier → size 20 TON; EV = 0.92·(20·0.05·3) − 0.08·(20·0.05)
  const r = evaluateGates(env(), ctx());
  assert.equal(r.verdict, "pass");
  const expected = 0.92 * (r.sizeTon * 0.05 * 3) - 0.08 * (r.sizeTon * 0.05);
  assert.ok(Math.abs(r.expectedValueTon - expected) < 1e-9);
});

test("gates: risk-off halts the feed and leaves open positions untouched", () => {
  const positions = [{ address: "EQA-open-1", group: "g1", pnlPct: 5 }];
  const r = evaluateGates(env(), ctx({ macroRiskOff: true, openPositions: positions }));
  assert.equal(r.verdict, "halt");
  assert.match(r.reasons[0], /risk-off/);
  assert.equal(positions.length, 1); // input not mutated
});
