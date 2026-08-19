/**
 * Continuous executor — file-watcher consumer for gated signals.
 *
 * Watches the gated journal directory for new gated-*.ndjson files,
 * processes them in order, and writes orders/fills journals.
 */
import { Journal, readJournal, validateIngested, createLogger, newId, type OrderRequest, type ExecutionMode } from "@openclaw-ton-agent/shared";
import { openPosition, stepPosition, type Position } from "@openclaw-ton-agent/exit-manager";
import { EXEC_CONFIG } from "./config";
import { buildOrderRequest } from "./order-builder";
import { Executor } from "./modes";
import { PaperWallet, ActonWallet } from "./wallet.js";
import { SimulationWallet } from "./simulation-wallet.js";
import { TonClient } from "@ton/ton";

import * as fs from "fs";
import * as path from "path";

const log = createLogger("executor");

function walletForMode(mode: ExecutionMode, client?: TonClient) {
  if (mode !== "auto") return new PaperWallet();
  const base = new ActonWallet({
    mode: "auto",
    gatesG1G3Ack: EXEC_CONFIG.gatesG1G3Ack,
    network: EXEC_CONFIG.network,
    projectPath: EXEC_CONFIG.acton.projectPath,
    contractAddress: EXEC_CONFIG.acton.contractAddress,
    routerAddress: EXEC_CONFIG.acton.routerAddress,
  });

  if (mode === "auto" && String(process.env.SIMULATE_BEFORE_EXEC) === "true" && client) {
    return new SimulationWallet(base, client, {
      failOpen: process.env.SIMULATE_FAIL_OPEN !== "false",
      logOnly: process.env.SIMULATE_LOG_ONLY === "true",
      network: EXEC_CONFIG.network,
    });
  }
  return base;
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
  const positionsPath = path.join(opts.gatedDir, `positions-${EXEC_CONFIG.network}.ndjson`);
  const positionsJournal = new Journal(positionsPath);
  const openPositionsMap = new Map<string, Position>();

  // 1. Restore positions from positions journal
  if (fs.existsSync(positionsPath)) {
    const pRows = readJournal(positionsPath);
    for (const r of pRows) {
      if (!r || typeof r !== "object") continue;
      const row = r as { kind?: string; pos?: Position };
      if (row.kind === "position.open" && row.pos?.tokenAddress) {
        openPositionsMap.set(row.pos.tokenAddress, row.pos);
      } else if (row.kind === "position.closed" && row.pos?.tokenAddress) {
        openPositionsMap.delete(row.pos.tokenAddress);
      }
    }
  }

  // 2. Reconstruct from orders journal for any filled buys without sells
  if (fs.existsSync(opts.ordersOut)) {
    const orders = readJournal(opts.ordersOut);
    const soldTokens = new Set<string>();
    for (const o of orders) {
      if (o && typeof o === "object" && (o as { side?: string }).side === "sell" && (o as { token?: { address?: string } }).token?.address) {
        soldTokens.add((o as { token: { address: string } }).token.address);
        openPositionsMap.delete((o as { token: { address: string } }).token.address);
      }
    }

    for (const o of orders) {
      if (!o || typeof o !== "object") continue;
      const ord = o as OrderRequest;
      if (ord.side === "buy" && ord.token?.address && !soldTokens.has(ord.token.address) && !openPositionsMap.has(ord.token.address)) {
        const entryPrice = ord.entryTon && ord.entryTon > 0 ? ord.entryTon : 1.0;
        const stopLossTon = ord.stopLossTon && ord.stopLossTon > 0 ? ord.stopLossTon : entryPrice * 0.95;
        const takeProfitTon = ord.takeProfitTon && ord.takeProfitTon > 0 ? ord.takeProfitTon : entryPrice * 1.5;
        const pos = openPosition({
          orderId: ord.id,
          tokenAddress: ord.token.address,
          ticker: ord.token.ticker,
          entryTon: entryPrice,
          amountTon: ord.amountTon,
          stopLossTon,
          takeProfitTon,
          entryTs: ord.ts || Date.now(),
          mode: "snipe",
          feesTon: 0.02,
          timeStopMs: 30 * 60_000,
          atrAtEntry: entryPrice * 0.05,
          swingLow: null,
          swingHigh: null,
          ladderExits: [],
        });
        openPositionsMap.set(ord.token.address, pos);
      }
    }
  }
  log.info("initialized open positions tracker", { activeCount: openPositionsMap.size });

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

  const endpoint = EXEC_CONFIG.network === "mainnet"
    ? "https://toncenter.com/api/v2/jsonRPC"
    : "https://testnet.toncenter.com/api/v2/jsonRPC";
  const toncenterApiKey = process.env.TONCENTER_API_KEY || process.env.TON_API_KEY;
  const client = new TonClient({ endpoint, apiKey: toncenterApiKey });

  const executor = new Executor({ mode, ordersJournal, fillsJournal, surface, wallet: walletForMode(mode, client) });
  const existingOrders = fs.existsSync(opts.ordersOut) ? readJournal(opts.ordersOut) : [];
  const processedEnvIds = new Set<string>();
  for (const o of existingOrders) {
    if (o && typeof o === "object" && "gatedEnvelopeId" in o && typeof (o as { gatedEnvelopeId: string }).gatedEnvelopeId === "string") {
      processedEnvIds.add((o as { gatedEnvelopeId: string }).gatedEnvelopeId);
    }
  }

  // Track processed lines per file to handle continuously appending journals
  const processedFiles = new Set<string>();
  const processedLines = new Map<string, number>();

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
    const startLine = processedLines.get(fileName) ?? 0;
    const rows = readJournal(filePath);
    if (rows.length <= startLine) return;

    log.info("processing gated file", { fileName, fromLine: startLine, totalLines: rows.length });
    let fileOrders = 0;

    for (let i = startLine; i < rows.length; i++) {
      const row = rows[i];
      const parsed = validateIngested(row);
      if (!parsed.ok) continue;
      const env = parsed.value;
      if (env.id && processedEnvIds.has(env.id)) {
        continue;
      }
      if (env.id) processedEnvIds.add(env.id);
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
      if (orderOrErr.side === "buy" && openPositionsMap.size >= EXEC_CONFIG.maxOpenPositions) {
        log.info("max concurrent positions reached, skipping new entry", { activePositions: openPositionsMap.size, maxOpenPositions: EXEC_CONFIG.maxOpenPositions });
        continue;
      }
      const res = await executor.submit(orderOrErr);
      if ((res.action === "executed" || res.action === "booked") && res.fill?.status !== "bounced") {
        liveTradeCount++;
        if (orderOrErr.side === "buy") {
          const entryPrice = orderOrErr.entryTon && orderOrErr.entryTon > 0 ? orderOrErr.entryTon : 1.0;
          const stopLossTon = orderOrErr.stopLossTon && orderOrErr.stopLossTon > 0 ? orderOrErr.stopLossTon : entryPrice * 0.95;
          const takeProfitTon = orderOrErr.takeProfitTon && orderOrErr.takeProfitTon > 0 ? orderOrErr.takeProfitTon : entryPrice * 1.5;
          const pos = openPosition({
            orderId: orderOrErr.id,
            tokenAddress: orderOrErr.token.address,
            ticker: orderOrErr.token.ticker,
            entryTon: entryPrice,
            amountTon: orderOrErr.amountTon,
            stopLossTon,
            takeProfitTon,
            entryTs: orderOrErr.ts || Date.now(),
            mode: "snipe",
            feesTon: 0.02,
            timeStopMs: 30 * 60_000,
            atrAtEntry: entryPrice * 0.05,
            swingLow: null,
            swingHigh: null,
            ladderExits: [],
          });
          openPositionsMap.set(orderOrErr.token.address, pos);
          positionsJournal.append({ kind: "position.open", pos, ts: Date.now() });
          log.info("position opened", { ticker: pos.ticker, amountTon: pos.amountTon, entryTon: pos.entryTon, sl: pos.stopLossTon, tp: pos.takeProfitTon });
        }
      }
      fileOrders++;
      log.info("order processed", {
        action: res.action,
        ticker: res.order.token.ticker,
        amountTon: res.order.amountTon,
        fillStatus: res.fill?.status ?? "none",
        orderId: res.order.id,
        reason: res.fill?.reason,
      });
    }
    processedLines.set(fileName, rows.length);
    if (!processedFiles.has(fileName)) {
      processedFiles.add(fileName);
      stats.processedFiles++;
    }
    stats.totalOrders += fileOrders;
    stats.lastProcessedAt = Date.now();
    log.info("completed gated file", { fileName, newOrders: fileOrders, totalOrders: stats.totalOrders });
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

    // Monitor and step open positions for automated TP/SL/Time-stop exits
    if (openPositionsMap.size > 0) {
      const now = Date.now();
      for (const [address, pos] of openPositionsMap.entries()) {
        try {
          const currentPriceTon = await fetchCurrentPriceTon(address, pos.entryTon);
          const step = stepPosition(pos, currentPriceTon, now);
          openPositionsMap.set(address, step.pos);

          if (step.action !== "hold") {
            const holdDurationMin = ((now - pos.entryTs) / 60_000).toFixed(1);
            log.info("position exit triggered", {
              ticker: pos.ticker,
              action: step.action,
              reason: step.reason,
              entryTon: pos.entryTon,
              exitPriceTon: step.exitPriceTon,
              holdDurationMin,
            });
            // If position is dust below min order size, evict immediately
            if (pos.amountTon < EXEC_CONFIG.minOrderTon) {
              log.warn("evicting dust position", {
                ticker: pos.ticker,
                amountTon: pos.amountTon,
                minOrderTon: EXEC_CONFIG.minOrderTon,
                reason: step.reason,
              });
              openPositionsMap.delete(pos.tokenAddress);
              positionsJournal.append({
                kind: "position.closed",
                pos: step.pos,
                action: step.action,
                reason: "dust",
                exitPriceTon: step.exitPriceTon,
                ts: now,
              });
              continue;
            }

            const sellOrder: OrderRequest = {
              id: newId("ord"),
              ts: now,
              gatedEnvelopeId: pos.orderId,
              source: "exit-manager",
              side: "sell",
              mode,
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
              slippageBps: EXEC_CONFIG.slippageBps,
              deadlineMs: now + 60_000,
              minOutTokenQty: 0,
              expectedTokenQty: pos.qty,
              rRatio: 1.5,
              expectedValueTon: 0.1,
            };
            const sellRes = await executor.submit(sellOrder);
            log.info("sell order processed", {
              action: sellRes.action,
              ticker: pos.ticker,
              fillStatus: sellRes.fill?.status,
              orderId: sellOrder.id,
              reason: sellRes.fill?.reason,
            });

            // Check if bounce is due to zero balance, missing pool, or manual override
            const isZeroBalance = sellRes.fill?.reason?.includes("zero jetton balance") || sellRes.fill?.reason?.includes("No on-chain jetton balance");
            const isNoPool = sellRes.fill?.reason?.includes("No active STON.fi") || sellRes.fill?.reason?.includes("No active STON.fi or DeDust pool");
            const isClearOverride = process.env.CLEAR_STUCK_POSITIONS === "true";

            // Remove from tracking and record as closed if successful or if unsellable / empty
            if (sellRes.fill?.status !== "bounced" || isZeroBalance || isNoPool || isClearOverride) {
              if (sellRes.fill?.status === "bounced") {
                log.info("clearing bounced/unsellable position", { ticker: pos.ticker, reason: sellRes.fill?.reason });
              }
              positionsJournal.append({
                kind: "position.closed",
                pos: step.pos,
                action: step.action,
                reason: sellRes.fill?.status === "bounced" ? (isNoPool ? "unsellable_no_pool" : "zero_balance") : step.reason,
                exitPriceTon: step.exitPriceTon,
                ts: now,
              });
              openPositionsMap.delete(address);
            } else {
              const bounceCount = (step.pos.bounceCount ?? 0) + 1;
              const updatedPos = { ...step.pos, bounceCount };
              openPositionsMap.set(address, updatedPos);

              if (bounceCount >= 3) {
                log.warn("force-clearing stuck position after consecutive bounces", { ticker: pos.ticker, bounces: bounceCount, reason: sellRes.fill?.reason });
                positionsJournal.append({
                  kind: "position.closed",
                  pos: updatedPos,
                  action: step.action,
                  reason: `force_cleared: ${bounceCount} consecutive bounces (${sellRes.fill?.reason ?? "unknown"})`,
                  exitPriceTon: step.exitPriceTon,
                  ts: now,
                });
                openPositionsMap.delete(address);
              } else {
                log.warn("exit sell bounced, will retry", { ticker: pos.ticker, reason: sellRes.fill?.reason, bounce: bounceCount });
              }
            }
          }
        } catch (err) {
          log.error("error monitoring position", err as Error);
        }
      }
    }
  };
  // Initial scan
  await scanAndProcess();

  // Poll loop
  let handle: NodeJS.Timeout | null = null;
  let isRunning = true;
  const scheduleNext = () => {
    if (!isRunning) return;
    handle = setTimeout(async () => {
      if (!isRunning) return;
      await scanAndProcess();
      if (isRunning) {
        scheduleNext();
      }
    }, pollIntervalMs);
  };
  scheduleNext();

  // Handle signals only when running as the main runtime entrypoint
  const isMainRuntime = process.argv[1] && process.argv[1].endsWith("continuous.ts");
  const shutdown = () => {
    isRunning = false;
    if (handle) {
      clearTimeout(handle);
      handle = null;
    }
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

let _cachedTonPriceUsd = 1.0;
let _lastTonPriceFetch = 0;
async function getTonPriceUsd(): Promise<number> {
  const now = Date.now();
  if (now - _lastTonPriceFetch < 60_000 && _cachedTonPriceUsd > 0) return _cachedTonPriceUsd;
  try {
    const res = await fetch("https://api.ston.fi/v1/assets/EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c", {
      signal: AbortSignal.timeout(4_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { asset?: { dex_usd_price?: string; third_party_usd_price?: string } };
      const p = Number(data.asset?.dex_usd_price ?? data.asset?.third_party_usd_price);
      if (Number.isFinite(p) && p > 0) {
        _cachedTonPriceUsd = p;
        _lastTonPriceFetch = now;
        return p;
      }
    }
  } catch {
    // use cached
  }
  return _cachedTonPriceUsd;
}
async function fetchCurrentPriceTon(address: string, fallbackPriceTon: number): Promise<number> {
  if (process.env.NODE_ENV === "test" || !address || address.startsWith("EQD0vdSA")) {
    return fallbackPriceTon;
  }
  // 1. Try STON.fi API
  try {
    const res = await fetch(`https://api.ston.fi/v1/assets/${address}`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { asset?: { dex_usd_price?: string; third_party_usd_price?: string } };
      const priceUsd = Number(data.asset?.dex_usd_price ?? data.asset?.third_party_usd_price);
      if (Number.isFinite(priceUsd) && priceUsd > 0) {
        const tonPrice = await getTonPriceUsd();
        return priceUsd / Math.max(tonPrice, 0.001);
      }
    }
  } catch {}

  // 2. Try DeDust API
  try {
    const res = await fetch("https://api.dedust.io/v2/pools", {
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const pools = (await res.json()) as Array<{ assets: Array<{ type: string; address?: string }>; lastPrice?: string }>;
      if (Array.isArray(pools)) {
        const pool = pools.find((p) => p.assets.some((a) => a.address === address));
        if (pool && pool.lastPrice) {
          const p = Number(pool.lastPrice);
          if (Number.isFinite(p) && p > 0) return p;
        }
      }
    }
  } catch {}

  // 3. Fallback to entry price
  return fallbackPriceTon;
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

  // ONE-TIME FORCE CLOSE OVERRIDE
  if (process.env.FORCE_CLOSE_ALL === "true" && fs.existsSync(ordersOut)) {
    log.info("FORCE_CLOSE_ALL is true, scanning for open positions to liquidate...");
    const orders = readJournal(ordersOut);
    const soldTokens = new Set<string>();
    const openMap = new Map<string, any>();

    for (const o of orders) {
      if (o && typeof o === "object" && (o as any).side === "sell" && (o as any).token?.address) {
        soldTokens.add((o as any).token.address);
      }
    }

    for (const o of orders) {
      if (!o || typeof o !== "object") continue;
      const ord = o as OrderRequest;
      if (ord.side === "buy" && ord.token?.address && !soldTokens.has(ord.token.address) && !openMap.has(ord.token.address)) {
        openMap.set(ord.token.address, ord);
      }
    }

    log.info(`Found ${openMap.size} un-sold positions. Attempting force close...`);
    const acton = new ActonWallet({
      mode: "auto",
      gatesG1G3Ack: EXEC_CONFIG.gatesG1G3Ack,
      network: EXEC_CONFIG.network,
      projectPath: EXEC_CONFIG.acton.projectPath,
      contractAddress: EXEC_CONFIG.acton.contractAddress,
      routerAddress: EXEC_CONFIG.acton.routerAddress,
    });

    (async () => {
      for (const [addr, ord] of openMap.entries()) {
        log.info(`force closing ${ord.token.ticker}`);
        try {
          const sellOrder: OrderRequest = {
            id: newId("force"),
            ts: Date.now(),
            gatedEnvelopeId: ord.id,
            source: "cli-force-close",
            side: "sell",
            mode: "auto",
            confirmRequired: false,
            amountTon: ord.amountTon,
            entryTon: ord.entryTon || 1.0,
            stopLossTon: 0,
            takeProfitTon: 999,
            expectedWinTon: 0,
            tier: "low",
            token: { address: addr, ticker: ord.token.ticker, decimals: 9 },
            slippageBps: 500, // 5%
            deadlineMs: Date.now() + 60_000,
            minOutTokenQty: 0,
            expectedTokenQty: ord.amountTon / (ord.entryTon || 1.0),
            rRatio: 1.5,
            expectedValueTon: 0.1,
          };
          const res = await acton.swap(sellOrder);
          log.info(`force close result for ${ord.token.ticker}`, { status: res.status, reason: res.reason, tx: res.txHash });
        } catch (e) {
          log.error(`force close error for ${ord.token.ticker}`, e as Error);
        }
      }
      log.info("force close sequence complete. Continuing with normal boot.");
      void runContinuousExecutor({ gatedDir, ordersOut, fillsOut, healthPort });
    })().catch(e => log.error("fatal force close error", e));
  } else {
    void runContinuousExecutor({
      gatedDir,
      ordersOut,
      fillsOut,
      healthPort,
    });
  }
}