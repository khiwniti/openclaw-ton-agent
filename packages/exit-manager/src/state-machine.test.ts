import test from "node:test";
import assert from "node:assert/strict";
import { PositionStateMachine } from "../src/state-machine";
import { openPosition, Position } from "../src/position";
import type { PositionEvent } from "@openclaw-ton-agent/shared";

test("PositionStateMachine: initial state is OPEN", () => {
  const pos = openPosition({
    orderId: "ord-1",
    tokenAddress: "EQ-token",
    ticker: "TEST",
    entryTon: 1.0,
    amountTon: 10.0,
    stopLossTon: 0.9,
    takeProfitTon: 1.5,
    entryTs: 1000,
    mode: "snipe",
    feesTon: 0.02,
    timeStopMs: 30000,
    atrAtEntry: 0.05,
    swingLow: null,
    swingHigh: null,
    ladderExits: [],
  });

  assert.equal(pos.lifecycleState, "OPEN");
  assert.equal(pos.activeExitOrderId, null);
  assert.equal(pos.remainingQty, 10.0);
});

test("PositionStateMachine: handles PARTIAL_EXIT and folds correctly", () => {
  const pos = openPosition({
    orderId: "ord-1",
    tokenAddress: "EQ-token",
    ticker: "TEST",
    entryTon: 1.0,
    amountTon: 10.0,
    stopLossTon: 0.9,
    takeProfitTon: 1.5,
    entryTs: 1000,
    mode: "snipe",
    feesTon: 0.02,
    timeStopMs: 30000,
    atrAtEntry: 0.05,
    swingLow: null,
    swingHigh: null,
    ladderExits: [],
  });

  const events: PositionEvent[] = [
    {
      type: "PARTIAL_EXIT",
      positionId: pos.id,
      ts: 2000,
      payload: { remainingQty: 5.0, activeExitOrderId: "ord-exit-1" },
    },
  ];

  const folded = PositionStateMachine.reconstruct(pos, events);
  assert.equal(folded.lifecycleState, "PARTIAL_EXIT");
  assert.equal(folded.remainingQty, 5.0);
  assert.equal(folded.activeExitOrderId, "ord-exit-1");
});

test("PositionStateMachine: handles FULL_EXIT and SETTLED", () => {
  const pos = openPosition({
    orderId: "ord-1",
    tokenAddress: "EQ-token",
    ticker: "TEST",
    entryTon: 1.0,
    amountTon: 10.0,
    stopLossTon: 0.9,
    takeProfitTon: 1.5,
    entryTs: 1000,
    mode: "snipe",
    feesTon: 0.02,
    timeStopMs: 30000,
    atrAtEntry: 0.05,
    swingLow: null,
    swingHigh: null,
    ladderExits: [],
  });

  const events: PositionEvent[] = [
    {
      type: "FULL_EXIT",
      positionId: pos.id,
      ts: 2000,
      payload: { activeExitOrderId: "ord-exit-full" },
    },
    {
      type: "SETTLED",
      positionId: pos.id,
      ts: 3000,
      payload: {},
    },
  ];

  const folded = PositionStateMachine.reconstruct(pos, events);
  assert.equal(folded.lifecycleState, "SETTLED");
  assert.equal(folded.remainingQty, 0);
  assert.equal(folded.activeExitOrderId, null);
});
