/**
 * Manual Swap CLI Tool for TON Trading System
 *
 * Usage:
 *   npx tsx scripts/manual-swap.ts buy --token <jettonAddress> --amount <amountTon>
 *   npx tsx scripts/manual-swap.ts sell --token <jettonAddress> [--amount <tokenQty>]
 *   npx tsx scripts/manual-swap.ts quote --token <jettonAddress> --amount <amountTon>
 */
import "dotenv/config";
import { newId, type OrderRequest } from "@openclaw-ton-agent/shared";
import { ActonWallet } from "../packages/executor/src/acton/acton-wallet.js";
import { Address } from "@ton/ton";

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

// Known common token addresses
const COMMON_TOKENS: Record<string, string> = {
  USDT: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  "USD₮": "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  STON: "EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjRNsfXpHpncUr",
  tsTON: "EQC98_qAmNEptUtPc7W6xdHhbmJbGYrwqc46FGzbgephp2Yx",
  NOT: "EQAvlWFDxQRWejqQKu8O8yJn63no43VCQqVWjhZoWU3mtmcV",
  DOGS: "EQCvxJy4eGOLyHUnbughTIMqFxRfeyCwY2PfQEApXdTianYW",
  MAJOR: "EQCuPm01HldiduQ55xaBF_1kaW_WAUy5DHey8suqzU_MAJOR",
};

async function main() {
  const action = process.argv[2]?.toLowerCase();
  if (!action || !["buy", "sell", "quote", "balance"].includes(action)) {
    console.log(`
Usage:
  npx tsx scripts/manual-swap.ts buy --token <address|symbol> --amount <amountTon> [--slippage <bps>]
  npx tsx scripts/manual-swap.ts sell --token <address|symbol> [--amount <tokenQty>] [--slippage <bps>]
  npx tsx scripts/manual-swap.ts quote --token <address|symbol> --amount <amountTon>
  npx tsx scripts/manual-swap.ts balance

Examples:
  npx tsx scripts/manual-swap.ts buy --token USDT --amount 0.2
  npx tsx scripts/manual-swap.ts sell --token STON
  npx tsx scripts/manual-swap.ts quote --token NOT --amount 0.5
`);
    return;
  }

  const tokenInput = getArg("--token") ?? getArg("-t");
  const amountStr = getArg("--amount") ?? getArg("-a");
  const slippageBps = Number(getArg("--slippage") ?? "250"); // default 2.5%

  const tokenAddress = tokenInput ? (COMMON_TOKENS[tokenInput.toUpperCase()] || tokenInput) : "";

  if (action !== "balance" && !tokenAddress) {
    console.error("Error: --token <address or symbol> is required.");
    process.exit(1);
  }

  const network = (process.env.TON_NETWORK || "mainnet") as "mainnet" | "testnet";
  const wallet = new ActonWallet({
    mode: "auto",
    gatesG1G3Ack: true,
    network,
    minOrderTon: 0.10,
  });

  if (action === "quote") {
    const amountTon = Number(amountStr ?? "0.2");
    console.log(`Fetching quote for ${amountTon} TON -> Token (${tokenAddress})...`);
    try {
      const res = await fetch(`https://api.ston.fi/v1/assets/${tokenAddress}`);
      if (res.ok) {
        const data = (await res.json()) as any;
        console.log("STON.fi Asset Info:", {
          symbol: data.asset?.symbol,
          displayName: data.asset?.display_name,
          dexUsdPrice: data.asset?.dex_usd_price,
          thirdPartyUsdPrice: data.asset?.third_party_usd_price,
        });
      }
    } catch (e: any) {
      console.error("Quote fetch error:", e.message);
    }
    return;
  }

  if (action === "buy") {
    const amountTon = Number(amountStr ?? "0.20");
    if (amountTon <= 0) {
      console.error("Error: --amount <amountTon> must be greater than 0");
      process.exit(1);
    }

    console.log(`\n🚀 Executing Manual BUY:`);
    console.log(`  Token: ${tokenAddress}`);
    console.log(`  Amount: ${amountTon} TON`);
    console.log(`  Slippage: ${slippageBps} bps (${slippageBps / 100}%)`);

    const buyOrder: OrderRequest = {
      id: newId("man-buy"),
      ts: Date.now(),
      gatedEnvelopeId: newId("env"),
      source: "manual-cli",
      side: "buy",
      mode: "auto",
      confirmRequired: false,
      amountTon,
      entryTon: 1.0,
      stopLossTon: 0.9,
      takeProfitTon: 1.5,
      expectedWinTon: amountTon * 0.3,
      tier: "low",
      token: {
        address: tokenAddress,
        ticker: tokenInput ?? "TOKEN",
        decimals: 9,
      },
      slippageBps,
      deadlineMs: Date.now() + 60_000,
      minOutTokenQty: 0,
      expectedTokenQty: 0,
      rRatio: 1.5,
      expectedValueTon: 0.1,
    };

    const res = await wallet.swap(buyOrder);
    console.log("\nSwap Result:");
    console.log(`  Status: ${res.status}`);
    if (res.txHash) console.log(`  TxHash: ${res.txHash}`);
    if (res.reason) console.log(`  Details: ${res.reason}`);
    return;
  }

  if (action === "sell") {
    console.log(`\n🚀 Executing Manual SELL:`);
    console.log(`  Token: ${tokenAddress}`);
    console.log(`  Slippage: ${slippageBps} bps (${slippageBps / 100}%)`);

    const sellOrder: OrderRequest = {
      id: newId("man-sell"),
      ts: Date.now(),
      gatedEnvelopeId: newId("env"),
      source: "manual-cli",
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
        address: tokenAddress,
        ticker: tokenInput ?? "TOKEN",
        decimals: 9,
      },
      slippageBps,
      deadlineMs: Date.now() + 60_000,
      minOutTokenQty: 0,
      expectedTokenQty: amountStr ? Number(amountStr) : 0,
      rRatio: 1.5,
      expectedValueTon: 0.1,
    };

    const res = await wallet.swap(sellOrder);
    console.log("\nSwap Result:");
    console.log(`  Status: ${res.status}`);
    if (res.txHash) console.log(`  TxHash: ${res.txHash}`);
    if (res.reason) console.log(`  Details: ${res.reason}`);
    return;
  }
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
