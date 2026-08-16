/**
 * Continuous executor — file-watcher consumer for gated signals.
 *
 * Watches the gated journal directory for new gated-*.ndjson files,
 * processes them in order, and writes orders/fills journals.
 */
import { Journal, readJournal, validateIngested, createLogger, type OrderRequest, type ExecutionMode } from "@openclaw-ton-agent/shared";
import { EXEC_CONFIG } from "./config";
import { buildOrderRequest } from "./order-builder";
import { Executor } from "./modes";
import { PaperWallet, TonMcpWallet, ActonWallet } from "./wallet.js";
import * as fs from "fs";
import * as path from "path";

const log = createLogger("executor");

function walletForMode(mode: ExecutionMode) {
  if (mode !== "auto") return new PaperWallet();
  return new ActonWallet({
    mode: "auto",
    gatesG1G3Ack: EXEC_CONFIG.gatesG1G3Ack,
    network: EXEC_CONFIG.network,
    projectPath: EXEC_CONFIG.acton.projectPath,
    contractAddress: EXEC_CONFIG.acton.contractAddress,
    routerAddress: EXEC_CONFIG.acton.routerAddress,
  });
}

interface ContinuousExecutorOpts {
  gatedDir: string;
  ordersOut: string;
  fillsOut: string;
  mode?: ExecutionMode;
  pollIntervalMs?: number;
  healthPort?: number;
}

interface HealthStats {
  processedFiles: number;
  totalOrders: number;
  lastProcessedAt: number | null;
  lastError: string | null;
  uptimeSec: number;
}

export async function runContinuousExecutor(opts: ContinuousExecutorOpts) {
  const mode = opts.mode ?? EXEC_CONFIG.mode;
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  const startTime = Date.now();

  const ordersJournal = new Journal(opts.ordersOut);
  const fillsJournal = new Journal(opts.fillsOut);

  let liveTradeCount = 0;
  const stats: HealthStats = {
    processedFiles: 0,
    totalOrders: 0,
    lastProcessedAt: null,
    lastError: null,
    uptimeSec: 0,
  };

  const surface = async (order: OrderRequest) => {
    log.info("order surfaced to trader-ui", {
      ticker: order.token.ticker,
      amountTon: order.amountTon,
      tier: order.tier,
      confirmRequired: order.confirmRequired,
      orderId: order.id,
    });
  };

  const executor = new Executor({ mode, ordersJournal, fillsJournal, surface, wallet: walletForMode(mode) });

  // Track processed files to avoid reprocessing
  const processedFiles = new Set<string>();

  // Health server
  let healthServer: ReturnType<typeof createHealthServer> | null = null;
  if (opts.healthPort) {
    healthServer = createHealthServer(opts.healthPort, () => ({
      ...stats,
      uptimeSec: Math.floor((Date.now() - startTime) / 1000),
    }));
  }

  const processFile = async (filePath: string) => {
    const fileName = path.basename(filePath);
    if (processedFiles.has(fileName)) return;

    log.info("processing gated file", { fileName });
    const rows = readJournal(filePath);
    let fileOrders = 0;

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
        log.warn("skipping envelope", { ticker: env.token?.ticker ?? "?", error: orderOrErr.error });
        continue;
      }
      const res = await executor.submit(orderOrErr);
      if (res.action === "executed" || res.action === "booked") liveTradeCount++;
      fileOrders++;
      ordersJournal.append(orderOrErr);
      if (res.fill) fillsJournal.append({ orderId: orderOrErr.id, ...res.fill });
      log.info("order processed", {
        action: res.action,
        ticker: res.order.token.ticker,
        amountTon: res.order.amountTon,
        fillStatus: res.fill?.status ?? "none",
        orderId: res.order.id,
        reason: res.fill?.reason,
      });
    }

    processedFiles.add(fileName);
    stats.processedFiles++;
    stats.totalOrders += fileOrders;
    stats.lastProcessedAt = Date.now();
    log.info("completed gated file", { fileName, orders: fileOrders });
  };

  const scanAndProcess = async () => {
    try {
      stats.uptimeSec = Math.floor((Date.now() - startTime) / 1000);
      stats.lastError = null;

      const files = fs.readdirSync(opts.gatedDir)
        .filter(f => f.startsWith("gated-") && f.endsWith(".ndjson"))
        .sort(); // Process in chronological order

      for (const file of files) {
        await processFile(path.join(opts.gatedDir, file));
      }
    } catch (e) {
      stats.lastError = (e as Error)?.message ?? String(e);
      log.error("scan failed", e as Error);
    }
  };

  // Initial scan
  await scanAndProcess();

  // Poll loop
  let handle: NodeJS.Timeout;
  const scheduleNext = () => {
    handle = setTimeout(async () => {
      await scanAndProcess();
      scheduleNext();
    }, pollIntervalMs);
  };
  scheduleNext();

  // Handle signals only when running as the main runtime entrypoint
  const isMainRuntime = process.argv[1] && process.argv[1].endsWith("continuous.ts");
  const shutdown = () => {
    clearTimeout(handle);
    healthServer?.close();
  };
  if (isMainRuntime) {
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.on(sig, () => {
        log.info("shutdown signal received", { signal: sig });
        shutdown();
        process.exit(0);
      });
    }
  }

  return { stop: shutdown, stats };
}

function createHealthServer(port: number, getStats: () => HealthStats) {
  const http = require("http");
  const server = http.createServer((req: any, res: any) => {
    if (req.url === "/health" || req.url === "/health/executor") {
      const stats = getStats();
      const ok = stats.lastError === null;
      res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok, ...stats }));
    } else if (req.url === "/metrics" || req.url === "/metrics/executor") {
      const stats = getStats();
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end([
        `executor_up 1`,
        `executor_processed_files_total ${stats.processedFiles}`,
        `executor_total_orders_total ${stats.totalOrders}`,
        `executor_uptime_seconds ${stats.uptimeSec}`,
        `executor_last_processed_timestamp ${stats.lastProcessedAt ?? 0}`,
        `executor_last_error ${stats.lastError ? 1 : 0}`,
      ].join("\n") + "\n");
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  server.listen(port, "0.0.0.0");
  log.info("health server listening", { port });
  return server;
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith("continuous.ts")) {
  const gatedDir = process.env.GATED_DIR ?? "/app/data";
  const ordersOut = process.env.ORDERS_OUT ?? "/app/data/orders-mainnet.ndjson";
  const fillsOut = process.env.FILLS_OUT ?? "/app/data/fills-mainnet.ndjson";
  const healthPort = Number(process.env.EXEC_HEALTH_PORT ?? "8081");

  void runContinuousExecutor({
    gatedDir,
    ordersOut,
    fillsOut,
    healthPort,
  });
}