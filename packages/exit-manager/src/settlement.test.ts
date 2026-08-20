import test from "node:test";
import assert from "node:assert/strict";
import { SettlementReconciler, SettlementProvider } from "../src/reconciler";
import { PositionJournal } from "../src/journal";
import { FillRecord } from "@openclaw-ton-agent/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

test("SettlementReconciler: reconciles pending fill to confirmed", async () => {
  const tmpFile = path.join(os.tmpdir(), `test-pos-journal-${Date.now()}.ndjson`);
  const journal = new PositionJournal(tmpFile);

  const mockProvider: SettlementProvider = {
    async checkSettlement(orderId: string) {
      return { settled: true, status: "CONFIRMED", pnlTon: 1.5 };
    },
  };

  const reconciler = new SettlementReconciler(journal, mockProvider);

  const pendingFill: FillRecord = {
    id: "fill-1",
    positionId: "pos-1",
    orderId: "ord-1",
    tokenAddress: "EQ-token",
    action: "SELL",
    qty: 100,
    priceTon: 1.2,
    feesTon: 0.02,
    ts: Date.now(),
    settlement: "PENDING",
  };

  const results = await reconciler.reconcilePending([pendingFill]);
  assert.equal(results.length, 1);
  assert.equal(results[0].settlement, "CONFIRMED");
  assert.equal(results[0].pnlTon, 1.5);

  const events = journal.readAll();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "SETTLED");
  assert.equal(events[0].positionId, "pos-1");

  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});
