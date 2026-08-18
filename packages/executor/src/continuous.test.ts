import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { runContinuousExecutor } from "./continuous";
import { Executor } from "./modes";
import { EXEC_CONFIG } from "./config";
import * as os from "os";

test("continuous executor processes gated files and exposes health endpoints", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-test-"));
  const gatedDir = path.join(tmpDir, "gated");
  const ordersOut = path.join(tmpDir, "orders.ndjson");
  const fillsOut = path.join(tmpDir, "fills.ndjson");

  fs.mkdirSync(gatedDir, { recursive: true });
  const gatedFile = path.join(gatedDir, "gated-test.ndjson");
  const testEnvelope = {
    id: "test-1",
    ts: Date.now(),
    source: "radar",
    chain: "TON",
    dex: "stonfi",
    token: { address: "EQD0vdSA_NedR9uvdbOmDrZt5Xw6aFqcmBD5LFebTnRc4ED", name: "Test Token", ticker: "TEST", decimals: 9, priceTon: 0.001, curvePct: 0.5, liquidityTon: 100, holders: 100 },
    priceTon: 0.001,
    quote: { priceTon: 0.001, liquidityUsd: 10000, volume24hUsd: 50000, source: "stonfi", ts: Date.now() },
    audit: { verified: 85, renounced: true, locked: true, honeypot: false },
    score: { soft: 85, risk: 15 },
    status: "validated",
    flags: [],
    reasoning: "test",
    meta: {
      gate: {
        verdict: "pass",
        sizeTon: 0.5,
        tier: "low",
        rRatio: 2.0,
        expectedValueTon: 0.1
      }
    }
  };
  fs.writeFileSync(gatedFile, JSON.stringify(testEnvelope) + "\n");

  const controller = await runContinuousExecutor({
    gatedDir,
    ordersOut,
    fillsOut,
    mode: "paper",
    pollIntervalMs: 200,
    healthPort: 0,
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (fs.existsSync(ordersOut) && fs.existsSync(fillsOut)) {
      const orders = fs.readFileSync(ordersOut, "utf-8").trim().split("\n").filter(Boolean);
      const fills = fs.readFileSync(fillsOut, "utf-8").trim().split("\n").filter(Boolean);
      if (orders.length >= 1 && fills.length >= 1) break;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  controller.stop();

  assert.ok(fs.existsSync(ordersOut), "orders.ndjson was not created");
  assert.ok(fs.existsSync(fillsOut), "fills.ndjson was not created");

  const orders = fs.readFileSync(ordersOut, "utf-8").trim().split("\n").filter(Boolean);
  const fills = fs.readFileSync(fillsOut, "utf-8").trim().split("\n").filter(Boolean);
  assert.ok(orders.length >= 1, "orders.length >= 1");
  assert.ok(fills.length >= 1, "fills.length >= 1");

  const order = JSON.parse(orders[0]);
  const fill = JSON.parse(fills[0]);
  assert.strictEqual(order.token.ticker, "TEST");
  assert.strictEqual(fill.status, "filled");
  assert.strictEqual(fill.mode, "paper");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("force-closes positions after 3 consecutive sell bounces", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stuck-test-"));
  const gatedDir = path.join(tmpDir, "gated");
  const ordersOut = path.join(tmpDir, "orders.ndjson");
  const fillsOut = path.join(tmpDir, "fills.ndjson");

  fs.mkdirSync(gatedDir, { recursive: true });

  const buyOrder = {
    id: "buy-old",
    ts: Date.now() - 2 * 60 * 60_000,
    gatedEnvelopeId: "env-1",
    side: "buy",
    source: "radar",
    mode: "auto",
    confirmRequired: false,
    amountTon: 0.5,
    entryTon: 1.0,
    stopLossTon: 0.95,
    takeProfitTon: 1.5,
    expectedWinTon: 0.15,
    expectedTokenQty: 0.5,
    minOutTokenQty: 0.4,
    slippageBps: 150,
    tier: "low",
    rRatio: 2.0,
    expectedValueTon: 0.1,
    token: { address: "EQD0vdSA_NedR9uvdbOmDrZt5Xw6aFqcmBD5LFebTnRc4ED", ticker: "STUCK", decimals: 9 },
    deadlineMs: Date.now() + 60000,
  };
  fs.writeFileSync(ordersOut, JSON.stringify(buyOrder) + "\n");

  EXEC_CONFIG.gatesG1G3Ack = true;
  let submitCalls = 0;
  const originalSubmit = Executor.prototype.submit;
  Executor.prototype.submit = async function (order) {
    submitCalls++;
    if (order.side === "sell") {
      return {
        order,
        action: "executed",
        fill: {
          status: "bounced",
          txHash: null,
          filledAmountTon: 0,
          filledTokenQty: 0,
          minOutTokenQty: order.minOutTokenQty,
          slippageBps: order.slippageBps,
          mode: "auto",
          reason: "test bounce",
        },
        journaled: true,
      } as any;
    }
    return originalSubmit.call(this, order);
  };

  try {
    const controller = await runContinuousExecutor({
      gatedDir,
      ordersOut,
      fillsOut,
      mode: "auto",
      pollIntervalMs: 200,
      healthPort: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));
    controller.stop();

    const positionsJournal = path.join(gatedDir, "positions-mainnet.ndjson");
    const positions = fs.existsSync(positionsJournal)
      ? fs.readFileSync(positionsJournal, "utf-8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];

    const closed = positions.filter((p) => p.kind === "position.closed");
    assert.ok(closed.length >= 1, "expected position to be closed after bouncing");
    assert.ok(
      closed.some((c) => (c.reason ?? "").includes("force_cleared")),
      `expected force_cleared reason, got: ${closed.map((c) => c.reason).join(", ")}`
    );
    assert.ok(submitCalls >= 3, `expected at least 3 sell attempts, got ${submitCalls}`);
  } finally {
    Executor.prototype.submit = originalSubmit;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

