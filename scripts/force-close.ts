import { readJournal, newId, type OrderRequest } from "@openclaw-ton-agent/shared";
import { openPosition, type Position } from "@openclaw-ton-agent/exit-manager";
import { ActonWallet } from "../packages/executor/src/acton/acton-wallet";
import * as fs from "fs";

async function forceCloseAll() {
  const ordersOut = process.env.ORDERS_OUT ?? "./data/orders-mainnet.ndjson";
  if (!fs.existsSync(ordersOut)) {
    console.log("No orders journal found at", ordersOut);
    return;
  }

  const orders = readJournal(ordersOut);
  const soldTokens = new Set<string>();
  const openPositionsMap = new Map<string, Position>();

  for (const o of orders) {
    if (o && typeof o === "object" && (o as any).side === "sell" && (o as any).token?.address) {
      soldTokens.add((o as any).token.address);
    }
  }

  for (const o of orders) {
    if (!o || typeof o !== "object") continue;
    const ord = o as OrderRequest;
    if (ord.side === "buy" && ord.token?.address && !soldTokens.has(ord.token.address) && !openPositionsMap.has(ord.token.address)) {
      const pos = openPosition({
        orderId: ord.id,
        tokenAddress: ord.token.address,
        ticker: ord.token.ticker,
        entryTon: ord.entryTon || 1.0,
        amountTon: ord.amountTon,
        stopLossTon: 0,
        takeProfitTon: 999,
        entryTs: ord.ts || Date.now(),
        mode: "snipe",
        feesTon: 0.02,
        timeStopMs: 30 * 60_000,
        atrAtEntry: 0.05,
        swingLow: null,
        swingHigh: null,
        ladderExits: [],
      });
      openPositionsMap.set(ord.token.address, pos);
    }
  }

  console.log(`Found ${openPositionsMap.size} open positions to force close.`);

  if (openPositionsMap.size === 0) return;

  const wallet = new ActonWallet({
    mode: "auto",
    gatesG1G3Ack: true,
    network: "mainnet",
  });

  for (const [address, pos] of openPositionsMap.entries()) {
    console.log(`\nClosing position for ${pos.ticker} (${address})...`);
    const sellOrder: OrderRequest = {
      id: newId("force"),
      ts: Date.now(),
      gatedEnvelopeId: pos.orderId,
      source: "cli-force-close",
      side: "sell",
      mode: "auto",
      confirmRequired: false,
      amountTon: pos.amountTon,
      entryTon: pos.entryTon,
      stopLossTon: pos.stopLossTon,
      takeProfitTon: pos.takeProfitTon,
      expectedWinTon: pos.amountTon * 0.3,
      tier: "low",
      token: {
        address: pos.tokenAddress,
        ticker: pos.ticker,
        decimals: 9,
      },
      slippageBps: 500, // 5% slippage to force execution
      deadlineMs: Date.now() + 60_000,
      minOutTokenQty: 0,
      expectedTokenQty: pos.qty,
      rRatio: 1.5,
      expectedValueTon: 0.1,
    };

    try {
      const res = await wallet.swap(sellOrder);
      console.log(`Result for ${pos.ticker}:`, res.status, res.reason || "");
      if (res.txHash) console.log(`TX Hash: ${res.txHash}`);
    } catch (e) {
      console.error(`Error closing ${pos.ticker}:`, e);
    }
  }
}

forceCloseAll().catch(console.error);
