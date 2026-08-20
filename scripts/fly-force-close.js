const { readJournal, newId } = require("../packages/shared/dist");
const { openPosition } = require("../packages/exit-manager/dist");
const { ActonWallet } = require("../packages/executor/dist/acton/acton-wallet");
const fs = require("fs");

async function forceCloseAll() {
  const ordersOut = process.env.ORDERS_OUT ?? "/app/data/orders-mainnet.ndjson";
  if (!fs.existsSync(ordersOut)) {
    console.log("No orders journal found at", ordersOut);
    return;
  }

  const orders = readJournal(ordersOut);
  const soldTokens = new Set();
  const openPositionsMap = new Map();

  for (const o of orders) {
    if (o && typeof o === "object" && o.side === "sell" && o.token?.address) {
      soldTokens.add(o.token.address);
    }
  }

  for (const o of orders) {
    if (!o || typeof o !== "object") continue;
    const ord = o;
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
        timeStopMs: null,
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
    const sellOrder = {
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
      slippageBps: 500,
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
