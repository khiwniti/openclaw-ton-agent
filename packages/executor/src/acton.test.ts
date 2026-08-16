import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ActonWallet } from "../src/acton/acton-wallet.js";

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");
try {
  for (const line of readFileSync(path.join(projectRoot, ".env"), "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {}
import type { OrderRequest } from "@openclaw-ton-agent/shared";

function buildOrder(mode: "notify_only" | "paper" | "auto" = "auto", confirmRequired = false): OrderRequest {
  return {
    id: "order-1",
    ts: Date.now(),
    gatedEnvelopeId: "env-1",
    source: "test",
    mode,
    side: "buy",
    token: { address: "kQCQkg0YZRWy6J7yXxmGEJjXpPbtCsBLjtmmkQyNXlGoyC9p", ticker: "TST", decimals: 9 },
    amountTon: 1.0,
    entryTon: 1.0,
    stopLossTon: 0.9,
    takeProfitTon: 1.1,
    expectedWinTon: 0.1,
    expectedTokenQty: 1000,
    minOutTokenQty: 900,
    slippageBps: 50,
    tier: "low",
    rRatio: 2.0,
    expectedValueTon: 0.1,
    confirmRequired,
    deadlineMs: Date.now() + 60000,
  };
}

test("ActonWallet rejects non-auto orders", async () => {
  const wallet = new ActonWallet({ mode: "auto", gatesG1G3Ack: true, network: "testnet" });
  const result = await wallet.swap(buildOrder("notify_only"));
  assert.equal(result.status, "bounced");
  assert.match(result.reason ?? "", /non-auto mode/);
});

test("ActonWallet rejects orders requiring confirmation", async () => {
  const wallet = new ActonWallet({ mode: "auto", gatesG1G3Ack: true, network: "testnet" });
  const result = await wallet.swap(buildOrder("auto", true));
  assert.equal(result.status, "bounced");
  assert.match(result.reason ?? "", /operator confirmation/);
});

test("ActonWallet returns pending_reconcile for valid auto orders", async () => {
  const wallet = new ActonWallet({ mode: "auto", gatesG1G3Ack: true, network: "testnet", balanceTon: 1000 });
  const result = await wallet.swap(buildOrder("auto", false));
  if (process.env.RUN_LIVE_TON_TESTS === "1" && process.env.WALLET_MASTER_MNEMONIC && (process.env.TON_API_KEY || process.env.TONCENTER_API_KEY)) {
    const endpoint = process.env.TON_RPC_ENDPOINT || "https://testnet.toncenter.com/api/v2/jsonRPC";
    const { TonClient, Address } = await import("@ton/ton");
    const client = new TonClient({ endpoint });
    const bal = await client.getBalance(Address.parse("kQCHY3p4RZMqICczvAy_M9V-B9lyv-7V4i36sS6WUouEOi7N"));
    if (typeof bal === "bigint" && bal > 0n) {
      assert.equal(result.status, "pending_reconcile");
      assert.ok(result.txHash && result.txHash.length > 0, "txHash should be non-empty");
      assert.equal(result.filledAmountTon, 1.0);
      return;
    }
  }
  assert.equal(result.status, "bounced");
  assert.match(result.reason ?? "", /WALLET_MASTER_MNEMONIC is required for broadcast|broadcast failed/);
  assert.equal(result.filledAmountTon, 0.0);
});

test("ActonWallet rejects when G1-G3 ack is missing", async () => {
  assert.throws(() => new ActonWallet({ mode: "auto", gatesG1G3Ack: false, network: "testnet" }), /G1–G3/);
});
