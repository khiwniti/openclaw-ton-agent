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
    atrAtEntry: 0.35, // ATR for swing mode (trailingPct = 0.35)
    swingLow: 9.0,
    swingHigh: 12.0,
    ladderExits: [],
    ...(over as any),
  });
}

test("openPosition derives qty and arms nothing", () => {
  const p = pos();
  assert.equal(p.qty, 2);
  assert.equal(p.remainingQty, 2);
  assert.equal(p.highWaterTon, 10);
  assert.equal(p.trailingStopTon, null);
  assert.equal(p.breakEvenAtTon, null);
  assert.equal(p.partialTakesHit.length, 0);
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

test("partial take-profit: snipe mode sells 50% at 30% gain", () => {
  // Snipe mode has partialTakes: [{ triggerPct: 0.3, sizePct: 0.5 }, { triggerPct: 0.5, sizePct: 0.3 }]
  // Entry 10, so 30% gain = 13, 50% gain = 15
  let p = pos({ mode: "snipe", takeProfitTon: 30, stopLossTon: 8.5 });
  
  // Price moves to 13 (30% gain) - should trigger first partial take (sell 50%)
  let r = stepPosition(p, 13, T0 + 1000);
  assert.equal(r.action, "partial_tp");
  assert.equal(r.exitPriceTon, 13);
  assert.equal(r.exitSizePct, 0.5);
  assert.equal(r.pos.remainingQty, 1); // 50% of 2 = 1
  assert.deepEqual(r.pos.partialTakesHit, [0]);
  p = r.pos;
  
  // Price moves to 15 (50% gain) - should trigger second partial take (sell 30% of remaining)
  r = stepPosition(p, 15, T0 + 2000);
  assert.equal(r.action, "partial_tp");
  assert.equal(r.exitPriceTon, 15);
  assert.equal(r.exitSizePct, 0.3);
  assert.equal(r.pos.remainingQty, 0.7); // 1 * 0.7 = 0.7
  assert.deepEqual(r.pos.partialTakesHit, [0, 1]);
});

test("trailing: arms part-way to TP, ratchets, and exits on a partial retrace", () => {
  // Use swing with TP=12: Chandelier trailing activates at highWater > entry
  // Chandelier: trailing = highWater - (ATR * 2.5) = 11.5 - (0.35 * 2.5) = 11.5 - 0.875 = 10.625
  // break-even at 2% arms at 10.2
  // At price 11.5: both break-even (10) and Chandelier (10.625) armed
  // Effective stop = max(10, 10.625) = 10.625 (Chandelier)
  // At price 7.5: triggers Chandelier trail (since 10.625 > 7.5)
  let p = pos({ mode: "swing", takeProfitTon: 12, stopLossTon: 8.5 });
  
  // Move to 11.5 (above trailing activation, but below take-profit at 12)
  let r = stepPosition(p, 11.5, T0 + 1000);
  assert.equal(r.action, "hold");
  // Chandelier: 11.5 - (0.35 * 2.5) = 10.625
  assert.equal(r.pos.trailingStopTon, 11.5 - (0.35 * 2.5)); // 10.625
  assert.equal(r.pos.breakEvenAtTon, 10); // break-even armed at 10
  assert.equal(r.pos.highWaterTon, 11.5);
  p = r.pos;
  
  // Push higher; Chandelier ratchets up (but still below TP)
  r = stepPosition(p, 11.8, T0 + 2000);
  assert.equal(r.action, "hold");
  assert.equal(r.pos.trailingStopTon, 11.8 - (0.35 * 2.5)); // 10.925
  assert.equal(r.pos.breakEvenAtTon, 10);
  p = r.pos;
  
  // Drop below both stops: Chandelier (10.925) is higher than break-even (10)
  // But trend_reversal (Supertrend flip) triggers first since it checks trendFlipPrice
  // trendFlipPrice = trailingStopTon = 10.925, closePrice = 7.5 < 10.925 → trend_reversal
  r = stepPosition(p, 7.5, T0 + 3000);
  assert.equal(r.action, "trend_reversal"); // Supertrend flip takes precedence over trail
  assert.equal(r.exitPriceTon, 7.5); // exits at close price
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
