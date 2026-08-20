/**
 * Sell All Held Jettons back into native TON
 */
import "dotenv/config";
import { newId, type OrderRequest } from "@openclaw-ton-agent/shared";
import { ActonWallet } from "../packages/executor/src/acton/acton-wallet.js";

async function sellAll() {
  const wallet = new ActonWallet({
    mode: "auto",
    gatesG1G3Ack: true,
    network: "mainnet",
    minOrderTon: 0.01,
  });

  const walletAddr = "EQAuVAfhIQhSY7SsPNy87wuTzyXcZKpaL7jOgfz9LkEkex6m";
  console.log(`\n🔍 Fetching Jetton balances for ${walletAddr}...`);
  
  const res = await fetch(`https://tonapi.io/v2/accounts/${walletAddr}/jettons`);
  const data = await res.json();
  const balances = (data.balances || []).filter((b: any) => Number(b.balance) > 0);

  console.log(`Found ${balances.length} Jetton(s) with non-zero balance.\n`);

  for (const b of balances) {
    const symbol = b.jetton.symbol;
    const masterAddr = b.jetton.address;
    const decimals = b.jetton.decimals ?? 9;
    const humanQty = (Number(b.balance) / 10 ** decimals).toFixed(4);

    console.log(`=================================================`);
    console.log(`Selling ${symbol} (${humanQty} tokens) -> TON...`);
    console.log(`Master: ${masterAddr}`);

    const sellOrder: OrderRequest = {
      id: newId("sell-all"),
      ts: Date.now(),
      gatedEnvelopeId: newId("env"),
      source: "sell-all-cli",
      side: "sell",
      mode: "auto",
      confirmRequired: false,
      amountTon: 0.20,
      entryTon: 1.0,
      stopLossTon: 0,
      takeProfitTon: 999,
      expectedWinTon: 0.1,
      tier: "low",
      token: {
        address: masterAddr,
        ticker: symbol,
        decimals,
      },
      slippageBps: 500, // 5% slippage to guarantee execution
      deadlineMs: Date.now() + 60_000,
      minOutTokenQty: 0,
      expectedTokenQty: 0,
      rRatio: 1.5,
      expectedValueTon: 0.1,
    };

    try {
      const result = await wallet.swap(sellOrder);
      console.log(`Result: ${result.status} ${result.reason || ""}`);
      if (result.txHash) console.log(`TX: ${result.txHash}`);
    } catch (err: any) {
      console.error(`Failed to sell ${symbol}:`, err.message);
    }

    // Wait 3 seconds before next swap
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("\n✅ Sell-all routine completed.");
}

sellAll().catch(console.error);
