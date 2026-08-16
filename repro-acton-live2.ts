import { readFileSync } from "node:fs";
const dotenv = readFileSync(".env", "utf8");
for (const line of dotenv.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 0) continue;
  const k = trimmed.slice(0, eq).trim();
  const v = trimmed.slice(eq + 1).trim();
  if (!(k in process.env)) process.env[k] = v;
}

import { ActonWallet } from "./packages/executor/src/acton/acton-wallet.ts";

function buildOrder(mode = "auto", confirmRequired = false) {
  return {
    id: "order-1", ts: Date.now(), gatedEnvelopeId: "env-1", source: "test", mode,
    side: "buy", token: { address: "kQCQkg0YZRWy6J7yXxmGEJjXpPbtCsBLjtmmkQyNXlGoyC9p", ticker: "TST", decimals: 9 },
    amountTon: 1, entryTon: 1, stopLossTon: 0.9, takeProfitTon: 1.1,
    expectedWinTon: 0.1, expectedTokenQty: 1000, minOutTokenQty: 900,
    slippageBps: 100, tier: "low", rRatio: 1, expectedValueTon: 0.1,
    confirmRequired, deadlineMs: Date.now() + 60_000,
  } as any;
}

(async () => {
  const wallet = new ActonWallet({ mode: "auto", gatesG1G3Ack: true, network: "testnet", balanceTon: 1000 });
  const order = buildOrder("auto", false);
  console.log("env loaded:", {
    ton_api: !!process.env.TON_API_KEY,
    tonapi_key: !!process.env.TONAPI_KEY,
    tonapi_base: !!process.env.TONAPI_BASE,
    ton_rpc: !!process.env.TON_RPC_ENDPOINT,
    mnemonic: !!process.env.WALLET_MASTER_MNEMONIC,
  });
  const res = await wallet.swap(order);
  console.log(JSON.stringify(res, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
