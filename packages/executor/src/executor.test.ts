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
  const order = buildOrderRequest(gatedEnvelope(), { mode: "notify_only", liveTradeCount: 0 }) as any;
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
  const res = buildOrderRequest(gatedEnvelope({ meta: { gate: { verdict: "reject", sizeTon: 0, tier: null } } }), { mode: "notify_only" });
  assert.ok("error" in res);
});

test("notify_only surfaces and never books a fill", async () => {
  const ordersJ = tmpJournal("orders.ndjson");
  const fillsJ = tmpJournal("fills.ndjson");
  let surfaced = 0;
  const ex = new Executor({ mode: "notify_only", ordersJournal: ordersJ, fillsJournal: fillsJ, surface: () => { surfaced++; } });
  const order = buildOrderRequest(gatedEnvelope(), { mode: "notify_only" }) as any;
  const res = await ex.submit(order);
  assert.equal(res.action, "surface");
  assert.equal(res.fill, null);
  assert.equal(surfaced, 1);
  assert.ok(!readFills(fillsJ.filePath).length);
});

test("paper books a deterministic fill", async () => {
  const ordersJ = tmpJournal("orders.ndjson");
  const fillsJ = tmpJournal("fills.ndjson");
  const ex = new Executor({ mode: "paper", ordersJournal: ordersJ, fillsJournal: fillsJ, surface: () => {} });
  const order = buildOrderRequest(gatedEnvelope(), { mode: "paper" }) as any;
  const res = await ex.submit(order);
  assert.equal(res.action, "booked");
  assert.equal(res.fill?.status, "filled");
  assert.equal(res.fill?.mode, "paper");
  assert.ok(readFills(fillsJ.filePath).length === 1);
});

test("TonMcpWallet refuses without G1–G3 ack and without auto", async () => {
  const noAck = new TonMcpWallet({ mode: "auto", gatesG1G3Ack: false, network: "mainnet" });
  const order = buildOrderRequest(gatedEnvelope(), { mode: "auto", liveTradeCount: 15, sizeConfirmThresholdTon: 100 }) as any;
  await assert.rejects(() => noAck.swap(order), /G1–G3/);
  const wrongMode = new TonMcpWallet({ mode: "auto", gatesG1G3Ack: true, network: "mainnet" });
  const nonAutoOrder = buildOrderRequest(gatedEnvelope(), { mode: "paper" }) as any;
  await assert.rejects(() => wrongMode.swap(nonAutoOrder), /non-auto mode/);
});

test("auto executor refuses when the live adapter guards trip", async () => {
  const ordersJ = tmpJournal("orders.ndjson");
  const fillsJ = tmpJournal("fills.ndjson");
  const wallet = new TonMcpWallet({ mode: "auto", gatesG1G3Ack: false, network: "mainnet" });
  const ex = new Executor({ mode: "auto", ordersJournal: ordersJ, fillsJournal: fillsJ, surface: () => {}, wallet });
  const order = buildOrderRequest(gatedEnvelope(), { mode: "auto", liveTradeCount: 0 }) as any;
  await assert.rejects(() => ex.submit(order)); // no ack
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
