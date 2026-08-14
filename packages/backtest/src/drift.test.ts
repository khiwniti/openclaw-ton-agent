import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runDriftMonitor, realizedSlippageBps } from "./drift";
import { newOrderId, type OrderRequest } from "@openclaw-ton-agent/shared";

function baseOrder(over: Partial<OrderRequest> = {}): OrderRequest {
  return {
    id: newOrderId(),
    ts: 1_700_000_000_000,
    gatedEnvelopeId: "env-1",
    source: "scanner",
    mode: "paper",
    side: "buy",
    token: { address: "EQA-1:abc", ticker: "test", decimals: 9 },
    amountTon: 10,
    entryTon: 1,
    stopLossTon: 0.9,
    takeProfitTon: 1.5,
    expectedWinTon: 5,
    expectedTokenQty: 10,
    minOutTokenQty: 9.95,
    slippageBps: 50,
    tier: "low",
    rRatio: 5,
    expectedValueTon: 1,
    confirmRequired: false,
    deadlineMs: 1_700_060_000,
    ...over,
  };
}

function tmpJournal(rows: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drift-"));
  const file = path.join(dir, "j.ndjson");
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return file;
}

test("realizedSlippageBps: fill at quoted entry = 0; fill at worse price = positive", () => {
  const order = baseOrder();
  const atEntry = { filledAmountTon: 10, filledTokenQty: 10 } as any; // 1.0 TON/token
  assert.equal(realizedSlippageBps(order, atEntry), 0);
  const worse = { filledAmountTon: 10, filledTokenQty: 9.9 } as any; // 1.0101… TON/token
  assert.ok(realizedSlippageBps(order, worse) > 100, "~101 bps worse than the 1.00 quote");
});

test("drift monitor: clean paper fills pass; a fill beyond expected+tolerance fails", () => {
  const o1 = baseOrder();
  const o2 = baseOrder({ id: newOrderId(), amountTon: 20, expectedTokenQty: 20, minOutTokenQty: 19.9 });
  const ordersFile = tmpJournal([o1, o2]);
  // both fills realize AT the quoted entry → realized = expected, drift 0.
  const fillsFile = tmpJournal([
    { orderId: o1.id, status: "filled", txHash: "paper-1", filledAmountTon: 10, filledTokenQty: 10, minOutTokenQty: 9.95, slippageBps: 50, mode: "paper" },
    { orderId: o2.id, status: "filled", txHash: "paper-2", filledAmountTon: 20, filledTokenQty: 19.9, minOutTokenQty: 19.9, slippageBps: 50, mode: "paper" },
  ]);
  const clean = runDriftMonitor({ ordersFile, fillsFile });
  assert.equal(clean.verdict, "pass");
  assert.equal(clean.fills.length, 2);
  assert.equal(clean.violations.length, 0);
  assert.ok(clean.maxDriftBps < 50, "worst fill sits within the 50 bps expected allowance");

  // now a live fill that paid 200 bps over the quote while the order allowed 50.
  const driftFills = tmpJournal([
    { orderId: o1.id, status: "filled", txHash: "live-1", filledAmountTon: 10, filledTokenQty: 9.8, minOutTokenQty: 9.95, slippageBps: 50, mode: "auto" },
  ]);
  const drifted = runDriftMonitor({ ordersFile, fillsFile: driftFills });
  assert.equal(drifted.verdict, "fail");
  assert.equal(drifted.violations.length, 1);
  assert.equal(drifted.violations[0].orderId, o1.id);
  assert.ok(drifted.violations[0].driftBps > 50, "drift beyond the 50 bps expected allowance");
});
