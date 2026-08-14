import { test } from "node:test";
import assert from "node:assert/strict";
import { openPosition, stepPosition, breakEvenActivatePct, EXIT_MODE_CONFIG, type Position } from "./index";

const T0 = 1_752_000_000_000;

function pos(over: Partial<Position> = {}): Position {
  return openPosition({
    orderId: "ord-1",
    tokenAddress: "EQA-pos-1",
    ticker: "P1",
    entryTon: 10,
    amountTon: 20,
    stopLossTon: 9.5,
    takeProfitTon: 11.5,
    entryTs: T0,
    mode: "swing",
    feesTon: 0.204,
    timeStopMs: EXIT_MODE_CONFIG.swing.timeStopMs,
    ...(over as any),
  });
}

test("openPosition derives qty and arms nothing", () => {
  const p = pos();
  assert.equal(p.qty, 2);
  assert.equal(p.highWaterTon, 10);
  assert.equal(p.trailingStopTon, null);
  assert.equal(p.breakEvenAtTon, null);
});

test("stop-loss exits at the stop level", () => {
  const r = stepPosition(pos(), 9.4, T0 + 1000);
  assert.equal(r.action, "sl");
  assert.equal(r.exitPriceTon, 9.5);
});

test("take-profit exits at the target", () => {
  const r = stepPosition(pos(), 11.6, T0 + 1000);
  assert.equal(r.action, "tp");
  assert.equal(r.exitPriceTon, 11.5);
});

test("time-stop exits at current price", () => {
  const p = pos();
  const r = stepPosition(p, 10.05, T0 + (EXIT_MODE_CONFIG.swing.timeStopMs ?? 0) + 1);
  assert.equal(r.action, "time_stop");
  assert.equal(r.exitPriceTon, 10.05);
});

test("diamond mode has no time-stop", () => {
  const r = stepPosition(pos({ mode: "diamond", timeStopMs: null }), 10.05, T0 + 40 * 3_600_000);
  assert.equal(r.action, "hold");
});

test("break-even: arms after +2× fee, exits at entry on pullback", () => {
  const fees = 0.204;
  const amount = 20;
  assert.ok(breakEvenActivatePct(fees, amount) > 0);
  let p = pos();
  // move up past activation (entry 10, beActivate 0.02 → 10.2; 10.25 > 10.2)
  let r = stepPosition(p, 10.25, T0 + 1000);
  assert.equal(r.action, "hold");
  assert.equal(r.pos.breakEvenAtTon, 10);
  p = r.pos;
  // pull back below entry → exit at break-even
  r = stepPosition(p, 9.99, T0 + 2000);
  assert.equal(r.action, "break_even");
  assert.equal(r.exitPriceTon, 10);
});

test("trailing: arms part-way to TP, ratchets, and exits on a partial retrace", () => {
  // High TP so the trade can run well past the trailing activation level
  // (entry 10 → TP 30, activation at 10 + 20×0.5 = 20; trail 50% → once price
  // is above 20 the trailing stop overtakes the break-even stop).
  let p = pos({ mode: "snipe", takeProfitTon: 30 });
  let r = stepPosition(p, 21, T0 + 1000);
  assert.equal(r.action, "hold");
  assert.equal(r.pos.trailingStopTon, 21 * 0.5); // 10.5 — above BE, so trail governs
  assert.equal(r.pos.highWaterTon, 21);
  p = r.pos;
  // push higher; trail ratchets up
  r = stepPosition(p, 25, T0 + 2000);
  assert.equal(r.action, "hold");
  assert.equal(r.pos.trailingStopTon, 25 * (1 - 0.5)); // 12.5
  p = r.pos;
  // partial retrace below the trailing stop but above break-even → trail
  r = stepPosition(p, 12, T0 + 3000);
  assert.equal(r.action, "trail");
  assert.equal(r.exitPriceTon, 12.5);
});

test("trailing stop only ratchets up, never down", () => {
  let p = pos({ mode: "snipe" });
  p = stepPosition(p, 10.9, T0 + 1000).pos;
  const armed = p.trailingStopTon;
  assert.notEqual(armed, null);
  const afterDrop = stepPosition(p, 10.5, T0 + 2000);
  assert.equal(afterDrop.pos.trailingStopTon, armed);
  const afterRise = stepPosition(p, 11.1, T0 + 3000);
  assert.ok((afterRise.pos.trailingStopTon ?? 0) > (armed ?? 0));
});

test("precedence: break-even beats stop-loss when both crossed", () => {
  let p = pos();
  p = stepPosition(p, 10.25, T0 + 1000).pos; // arm BE
  const r = stepPosition(p, 9.4, T0 + 2000); // below entry and below SL
  assert.equal(r.action, "break_even");
});
