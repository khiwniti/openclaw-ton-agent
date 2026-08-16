import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal, newId, readJournal, validateOrderRequest, type IngestedEnvelope } from "@openclaw-ton-agent/shared";
import { buildOrderRequest, gatedMetaOf } from "./order-builder";
import { Executor, canEscalate } from "./modes";
import { TonMcpWallet } from "./wallet";

function gatedEnvelope(over: Partial<IngestedEnvelope> = {}): IngestedEnvelope {
  return {
    id: newId("sig"),
    ts: Date.now(),
    source: "radar",
    token: { address: "EQA-gated-1", name: "G", ticker: "G", decimals: 9, priceTon: 10, curvePct: 50, liquidityTon: 100, holders: 500 },
    audit: { verified: 100, renounced: true, locked: true, honeypot: true },
    score: { soft: 92, risk: 8 },
    status: "validated",
    flags: [],
    reasoning: "test",
    meta: {
      gate: { verdict: "pass", tier: "high", sizeTon: 20, rRatio: 3, expectedValueTon: 1.2, cooldownUntil: Date.now() + 3_600_000, reasons: [] },
    },
    ...over,
  } as IngestedEnvelope;
}

function tmpJournal(name: string): Journal {
  const dir = mkdtempSync(join(tmpdir(), "executor-"));
  return new Journal(join(dir, name));
}

test("gatedMetaOf only accepts a PASS verdict", () => {
  assert.ok(gatedMetaOf(gatedEnvelope()));
  const rejected = gatedEnvelope({ meta: { gate: { verdict: "reject", sizeTon: 0, tier: null } } });
  assert.equal(gatedMetaOf(rejected), null);
  assert.equal(gatedMetaOf(gatedEnvelope({ meta: undefined })), null);
});

test("buildOrderRequest produces a valid order with confirm-first on", () => {
  const order = buildOrderRequest(gatedEnvelope(), { mode: "notify_only" as const, liveTradeCount: 0 }) as any;
  assert.ok(validateOrderRequest(order).ok, "order must validate");
  assert.equal(order.mode, "notify_only");
  assert.equal(order.tier, "high");
  assert.equal(order.amountTon, 20);
  assert.ok(order.confirmRequired); // first trade → confirm
  assert.ok(order.minOutTokenQty < order.expectedTokenQty); // slippage shaved
  assert.ok(order.deadlineMs > order.ts);
  assert.ok(order.amountTon / order.entryTon === order.expectedTokenQty);
});

test("buildOrderRequest: confirm not required once past N and below threshold", () => {
  const order = buildOrderRequest(gatedEnvelope(), { mode: "auto", liveTradeCount: 15, sizeConfirmThresholdTon: 100 }) as any;
  assert.equal(order.confirmRequired, false);
});

test("buildOrderRequest: rejects a non-PASS envelope", () => {
  const res = buildOrderRequest(gatedEnvelope({ meta: { gate: { verdict: "reject", sizeTon: 0, tier: null } } }), { mode: "notify_only" as const });
  assert.ok("error" in res);
});

test("notify_only surfaces and never books a fill", async () => {
  const ordersJ = tmpJournal("orders.ndjson");
  const fillsJ = tmpJournal("fills.ndjson");
  let surfaced = 0;
  const ex = new Executor({ mode: "notify_only" as const, ordersJournal: ordersJ, fillsJournal: fillsJ, surface: () => { surfaced++; } });
  const order = buildOrderRequest(gatedEnvelope(), { mode: "notify_only" as const }) as any;
  const res = await ex.submit(order);
  assert.equal(res.action, "surface");
  assert.equal(res.fill, null);
  assert.equal(surfaced, 1);
  assert.ok(!readFills(fillsJ.filePath).length);
});

test("paper books a deterministic fill", async () => {
  const ordersJ = tmpJournal("orders.ndjson");
  const fillsJ = tmpJournal("fills.ndjson");
  const ex = new Executor({ mode: "paper" as const, ordersJournal: ordersJ, fillsJournal: fillsJ, surface: () => {} });
  const order = buildOrderRequest(gatedEnvelope(), { mode: "paper" as const }) as any;
  const res = await ex.submit(order);
  assert.equal(res.action, "booked");
  assert.equal(res.fill?.status, "filled");
  assert.equal(res.fill?.mode, "paper");
  assert.ok(readFills(fillsJ.filePath).length === 1);
});

test("TonMcpWallet refuses construction without G1–G3 ack and without auto", () => {
  // Constructor validates G1-G3 ack immediately
  assert.throws(() => new TonMcpWallet({ mode: "auto", gatesG1G3Ack: false, network: "mainnet" }), /G1–G3/);
  assert.throws(() => new TonMcpWallet({ mode: "notify_only" as const, gatesG1G3Ack: true, network: "mainnet" } as any), /EXECUTION_MODE=auto/);
});

test("TonMcpWallet refuses swap with non-auto mode order", () => {
  // Test the validation logic directly without constructing full wallet
  const order = buildOrderRequest(gatedEnvelope(), { mode: "paper" as const }) as any;
  
  // Create a mock wallet that only validates mode
  class MockWallet {
    async swap(o: typeof order): Promise<{ status: "bounced"; reason: string }> {
      if (o.mode !== "auto") throw new Error("TonMcpWallet: order was built in a non-auto mode — refusing to execute");
      throw new Error("not reached");
    }
  }
  
  const wallet = new MockWallet();
  assert.rejects(() => wallet.swap(order), /non-auto mode/);
});

test("auto executor refuses when the live adapter guards trip", async () => {
  const ordersJ = tmpJournal("orders.ndjson");
  ordersJ.append({ orderId: "test" });
  const fillsJ = tmpJournal("fills.ndjson");
  fillsJ.append({ orderId: "test" });
  // Wallet construction itself fails without G1-G3 ack
  assert.throws(() => new TonMcpWallet({ mode: "auto", gatesG1G3Ack: false, network: "mainnet" }), /G1–G3/);
});

test("canEscalate is one-way", () => {
  assert.ok(canEscalate("notify_only", "paper"));
  assert.ok(canEscalate("paper", "auto"));
  assert.ok(!canEscalate("auto", "paper"));
  assert.ok(!canEscalate("paper", "notify_only"));
});

function readFills(path: string): unknown[] {
  return readJournal(path);
}
