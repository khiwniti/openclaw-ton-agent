import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScore } from "./score";

test("fully clean token scores 100/0", () => {
  const s = computeScore({
    renounced: true,
    locked: true,
    honeypot: true,
    holders: 1200,
    ageHours: 48,
    liquidityTon: 400,
    poolAvailable: true,
  });
  assert.equal(s.soft, 100);
  assert.equal(s.risk, 0);
});

test("unchecked security posture deducts heavily (honest unknowns)", () => {
  const s = computeScore({
    renounced: false,
    locked: false,
    honeypot: false,
    holders: 1200,
    ageHours: 48,
    liquidityTon: 400,
    poolAvailable: true,
  });
  assert.ok(s.risk >= 95, `risk=${s.risk} — audit unknowns must dominate`);
});

test("concentrated holders and new token deduct", () => {
  const s = computeScore({
    renounced: true,
    locked: true,
    honeypot: true,
    holders: 3,
    ageHours: 0.1,
    liquidityTon: 5,
    poolAvailable: true,
  });
  assert.ok(s.risk >= 40, `risk=${s.risk}`);
});

test("missing data gaps deduct per data point", () => {
  const s = computeScore({
    renounced: true,
    locked: true,
    honeypot: true,
    holders: null,
    ageHours: null,
    liquidityTon: null,
    poolAvailable: false,
  });
  assert.ok(s.risk >= 30, `risk=${s.risk}`);
});
