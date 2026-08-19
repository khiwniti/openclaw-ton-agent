/**
 * Executor entry — P3 exit criterion, demonstrated end-to-end.
 *
 * Reads a gated feed (gated-*.ndjson of IngestedEnvelope with meta.gate) →
 * builds validated OrderRequests → runs them through the Executor under the
 * configured EXECUTION_MODE. In notify_only the orders are surfaced and
 * journaled; in paper they are filled deterministically and booked.
 *
 *   node --import tsx src/index.ts --input ../../data/gated-mainnet.ndjson
 */
import { readJournal, validateIngested, type OrderRequest, type ExecutionMode } from "@openclaw-ton-agent/shared";
import { Journal } from "@openclaw-ton-agent/shared";
import { EXEC_CONFIG } from "./config";
import { buildOrderRequest } from "./order-builder";
import { Executor } from "./modes";
import { PaperWallet, TonMcpWallet, ActonWallet } from "./wallet.js";

export { EXEC_CONFIG, buildOrderRequest, Executor, PaperWallet, TonMcpWallet, ActonWallet };
export * from "./acton/router.js";
export * from "./order-queue.js";


function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function walletForMode(mode: ExecutionMode) {
  if (mode !== "auto") return new PaperWallet();
  if (EXEC_CONFIG.acton.enabled) {
    return new ActonWallet({
      mode: "auto",
      gatesG1G3Ack: EXEC_CONFIG.gatesG1G3Ack,
      network: EXEC_CONFIG.network,
      cwd: EXEC_CONFIG.acton.projectPath,
    });
  }
  return new TonMcpWallet({ mode: "auto", gatesG1G3Ack: EXEC_CONFIG.gatesG1G3Ack, network: EXEC_CONFIG.network });
}

export async function runExecutor(opts: { input: string; ordersOut: string; fillsOut: string; mode?: ExecutionMode }) {
  const mode = opts.mode ?? EXEC_CONFIG.mode;
  const rows = readJournal(opts.input);
  const ordersJournal = new Journal(opts.ordersOut);
  const fillsJournal = new Journal(opts.fillsOut);

  let liveTradeCount = 0;
  const surface = async (order: OrderRequest) => {
    console.log(`[EXEC:${mode}] SURFACE ${order.token.ticker} ${order.amountTon} TON tier=${order.tier} confirmRequired=${order.confirmRequired} → trader-ui`);
  };

  const executor = new Executor({ mode, ordersJournal, fillsJournal, surface, wallet: walletForMode(mode) });
  const results: Array<{ id: string; action: string; ticker: string; amountTon: number; fillStatus: string | null }> = [];

  const processAll = async () => {
    for (const row of rows) {
      const parsed = validateIngested(row);
      if (!parsed.ok) continue;
      const env = parsed.value;
      const orderOrErr = buildOrderRequest(env, {
        mode,
        liveTradeCount,
        sizeConfirmThresholdTon: EXEC_CONFIG.sizeConfirmThresholdTon,
        liveConfirmFirstNTrades: EXEC_CONFIG.liveConfirmFirstNTrades,
        slippageBps: EXEC_CONFIG.slippageBps,
        orderTtlMs: EXEC_CONFIG.orderTtlMs,
      });
      if ("error" in orderOrErr) {
        console.log(`[EXEC:${mode}] skip ${env.token?.ticker ?? "?"}: ${orderOrErr.error}`);
        continue;
      }
      const res = await executor.submit(orderOrErr);
      if (res.action === "executed" || res.action === "booked") liveTradeCount++;
      results.push({ id: res.order.id, action: res.action, ticker: res.order.token.ticker, amountTon: res.order.amountTon, fillStatus: res.fill?.status ?? null });
      console.log(`[EXEC:${mode}] ${res.action} ${res.order.token.ticker} ${res.order.amountTon} TON ${res.fill ? `fill=${res.fill.status}` : ""}`);
    }
  };

  await processAll();
  console.log(`[EXEC:${mode}] ${results.length} orders journaled → ${ordersJournal.filePath}`);
  return results;
}

if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  const input = arg("--input") ?? "../../data/gated-mainnet.ndjson";
  void (async () => {
    await runExecutor({ input, ordersOut: "../../data/orders-mainnet.ndjson", fillsOut: "../../data/fills-mainnet.ndjson" });
  })();
}
