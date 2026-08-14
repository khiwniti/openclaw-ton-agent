import { test } from "node:test";
import assert from "node:assert/strict";
import { SignalEnvelopeSchema, IngestedEnvelopeSchema, validateEnvelope, validateIngested, newId } from "@openclaw-ton-agent/shared";

const base = {
  id: newId("sig"),
  ts: 1_752_000_000_000,
  source: "radar",
  token: {
    address: "EQA-test",
    name: "Test",
    ticker: "TST",
    decimals: 9,
    priceTon: 0.00001,
    curvePct: 30,
    liquidityTon: 50,
    holders: 100,
  },
  audit: { verified: 70, renounced: true, locked: true, honeypot: false },
  score: { soft: 55, risk: 45 },
};

test("SignalEnvelope accepts a complete valid envelope", () => {
  const r = validateEnvelope(base);
  assert.ok(r.ok);
});

test("SignalEnvelope accepts null quotes (incomplete data, never fabricated)", () => {
  const r = validateEnvelope({
    ...base,
    token: { ...base.token, priceTon: null, liquidityTon: null, curvePct: null },
  });
  assert.ok(r.ok);
});

test("SignalEnvelope rejects a negative price", () => {
  const r = validateEnvelope({ ...base, token: { ...base.token, priceTon: -1 } });
  assert.ok(!r.ok);
});

test("SignalEnvelope rejects a missing token address", () => {
  const r = validateEnvelope({ ...base, token: { ...base.token, address: "" } });
  assert.ok(!r.ok);
});

test("SignalEnvelope rejects a score outside 0-100", () => {
  const r = validateEnvelope({ ...base, score: { soft: 101, risk: 0 } });
  assert.ok(!r.ok);
});

test("IngestedEnvelope requires status and flags", () => {
  const ok = validateIngested({ ...base, status: "validated", flags: [], reasoning: "" });
  assert.ok(ok.ok);
  const bad = validateIngested(base);
  assert.ok(!bad.ok);
});

test("schema types compile through z.infer round trip", () => {
  const parsed = SignalEnvelopeSchema.parse(base);
  assert.equal(parsed.token.ticker, "TST");
  assert.equal(typeof parsed.ts, "number");
  assert.equal(IngestedEnvelopeSchema, IngestedEnvelopeSchema);
});
