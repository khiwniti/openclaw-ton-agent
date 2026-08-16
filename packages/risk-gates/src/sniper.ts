/**
 * Sniper module for low-liquidity TON pairs.
 * Pool-depth-relative sizing, hard pre-trade safety gate,
 * re-quote guard, time-boxed exit (SL/trailing/time-stop).
 * 
 * Based on the sniper_exit_policy.py from the intelligent SL/TP research.
 */
import { TonClient, Address, toNano } from "@ton/ton";
import { PreTradeGate, SafetyConfig, PoolDepth, SafetyCheckResult } from "@openclaw-ton-agent/risk-gates";
import { chandelierStop, supertrendFlip, structureStopLoss, stepPosition } from "@openclaw-ton-agent/exit-manager";
import type { Position, StepResult, ExitAction, ExitMode } from "@openclaw-ton-agent/exit-manager";

export interface DexClient {
  /** Simulate a swap and return expected output. */
  simulateSwap(params: {
    offerAmountNano: bigint;
    jettonAddress: string;
  }): Promise<{
    expectedOutput: bigint;
    minOutput: bigint;
    feeBps: number;
    gasNano: bigint;
    priceImpactPct: number;
  }>;
  
  /** Execute a swap. */
  executeSwap(params: {
    offerAmountNano: bigint;
    jettonAddress: string;
    minOutNano: bigint;
  }): Promise<{
    txHash: string;
    filledAmountNano: bigint;
    filledTokenNano: bigint;
  }>;
  
  /** Get pool depth for a jetton. */
  getPoolDepth(jettonAddress: string): Promise<{ tonReserve: number; jettonReserve: number; priceTon: number } | null>;
}

export interface SniperConfig {
  /** Maximum % of pool reserves to use for entry. Default 2% (0.02). */
  maxPoolSharePct?: number;
  /** Minimum TON size for any snipe. Default 10 TON. */
  absoluteMinTon?: number;
  /** Maximum TON size cap. Default 100 TON. */
  absoluteMaxTon?: number;
  /** Chandelier trailing multiplier. Default 2.5x ATR. */
  chandelierMultiplier?: number;
  /** Hard stop loss % (wide for sniping). Default 25%. */
  hardStopLossPct?: number;
  /** Hard time stop in milliseconds. Default 15 minutes. */
  timeStopMs?: number;
  /** Re-quote guard max drift bps. Default 150 bps (1.5%). */
  requoteMaxDriftBps?: number;
  /** Safety gate config. */
  safetyConfig?: {
    minPoolDepthTon?: number;
    maxHolderConcentrationPct?: number;
    requireLpLock?: boolean;
    requireMintRevoked?: boolean;
    requireOwnershipRenounced?: boolean;
    minHolders?: number;
  };
}

export interface SnipeResult {
  success: boolean;
  txHash?: string;
  entryPriceTon?: number;
  exitPriceTon?: number;
  exitAction?: ExitAction;
  exitReason?: string;
  pnlTon?: number;
  holdTimeMs?: number;
  error?: string;
}

export interface SnipeContext {
  jettonAddress: string;
  jettonTicker: string;
  jettonDecimals: number;
  entryPriceTon: number;
  amountTon: number;
  poolDepth: { tonReserve: number; jettonReserve: number };
  atrAtEntry: number;
  swingLow: number;
  swingHigh: number;
}

/**
 * Sniper engine for low-liquidity TON pairs.
 * Orchestrates: gate -> size -> quote -> requote -> send -> monitor_and_exit
 */
export class SniperEngine {
  private client: TonClient;
  private dex: DexClient;
  private gate: PreTradeGate;
  private config: Required<SniperConfig>;

  constructor(
    client: TonClient,
    dex: DexClient,
    config: SniperConfig = {}
  ) {
    this.client = client;
    this.dex = dex;
    this.config = {
      maxPoolSharePct: config.maxPoolSharePct ?? 0.02,
      absoluteMinTon: config.absoluteMinTon ?? 10,
      absoluteMaxTon: config.absoluteMaxTon ?? 100,
      chandelierMultiplier: config.chandelierMultiplier ?? 2.5,
      hardStopLossPct: config.hardStopLossPct ?? 0.25,
      timeStopMs: config.timeStopMs ?? 15 * 60 * 1000,
      requoteMaxDriftBps: config.requoteMaxDriftBps ?? 150,
      safetyConfig: config.safetyConfig ?? {},
    };
    
    this.gate = new PreTradeGate(
      new TonClient({ endpoint: "https://toncenter.com/api/v2/jsonRPC" }),
      this.config.safetyConfig
    );
  }

  /**
   * Execute a snipe trade with full lifecycle management.
   */
  async executeSnipe(ctx: SnipeContext): Promise<SnipeResult> {
    const entryTime = Date.now();
    
    try {
      // 1. Pre-trade safety gate
      const gateResult = await this.gate.checkJetton(ctx.jettonAddress);
      if (!gateResult.passed) {
        return { 
          success: false, 
          error: `Safety gate blocked: ${gateResult.blockReason}`,
          exitAction: "blocked",
        };
      }

      // 2. Position sizing based on pool depth
      const sizeResult = this.calculatePositionSize(ctx);
      if (sizeResult.sizeTon <= 0) {
        return { 
          success: false, 
          error: `Position sizing rejected: ${sizeResult.reason}`,
          exitAction: "blocked",
        };
      }

      // 3. Get fresh quote and run re-quote guard
      const quote = await this.dex.simulateSwap({
        offerAmountNano: BigInt(Math.floor(sizeResult.sizeTon * 1e9)),
        jettonAddress: ctx.jettonAddress,
      });

      // 4. Re-quote guard: re-simulate right before send
      const freshQuote = await this.dex.simulateSwap({
        offerAmountNano: BigInt(Math.floor(sizeResult.sizeTon * 1e9)),
        jettonAddress: ctx.jettonAddress,
      });
      
      const driftBps = Math.floor(
        ((Number(freshQuote.expectedOutput) - Number(quote.expectedOutput)) / Number(quote.expectedOutput)) * 10000
      );
      
      if (driftBps < -this.config.requoteMaxDriftBps!) {
        return {
          success: false,
          error: `Requote guard: price moved against us ${Math.abs(driftBps)}bps`,
          exitAction: "blocked",
        };
      }

      // Use the fresh quote
      const finalQuote = freshQuote;

      // 5. Execute the swap
      const swapResult = await this.dex.executeSwap({
        offerAmountNano: BigInt(Math.floor(sizeResult.sizeTon * 1e9)),
        jettonAddress: ctx.jettonAddress,
        minOutNano: finalQuote.minOutput,
      });

      // 6. Build position for exit monitoring
      const position = this.buildPosition(ctx, sizeResult.sizeTon, finalQuote);

      // 7. Monitor and exit (time-boxed)
      const exitResult = await this.monitorAndExit(position, ctx.jettonAddress, entryTime);

      return {
        success: true,
        txHash: swapResult.txHash,
        entryPriceTon: ctx.entryPriceTon,
        exitPriceTon: exitResult.exitPriceTon,
        exitAction: exitResult.action,
        exitReason: exitResult.reason,
        pnlTon: exitResult.pnlTon,
        holdTimeMs: exitResult.holdTimeMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        exitAction: "error",
      };
    }
  }

  /**
   * Calculate position size based on pool depth.
   * Caps at maxPoolSharePct of pool reserves, clamped to [absoluteMinTon, absoluteMaxTon].
   */
  private calculatePositionSize(ctx: SnipeContext): { sizeTon: number; reason: string } {
    const poolShare = this.config.maxPoolSharePct!;
    const poolDepth = ctx.poolDepth;
    
    // Max size = poolShare * TON reserve
    const maxByDepth = poolDepth.tonReserve * poolShare;
    
    // Clamp to absolute bounds
    const minTon = this.config.absoluteMinTon!;
    const maxTon = this.config.absoluteMaxTon!;
    
    const size = Math.min(maxByDepth, maxTon);
    const clamped = Math.max(minTon, size);
    
    if (clamped < minTon) {
      return { sizeTon: 0, reason: `Pool too thin: ${poolDepth.tonReserve.toFixed(2)} TON reserve, need at least ${minTon / poolShare} TON for ${(poolShare * 100).toFixed(0)}% share` };
    }
    
    if (maxByDepth < minTon) {
      return { sizeTon: 0, reason: `Pool depth insufficient: ${maxByDepth.toFixed(2)} TON at ${(poolShare * 100).toFixed(0)}% share < min ${minTon} TON` };
    }
    
    return { sizeTon: clamped, reason: `Sized at ${clamped.toFixed(2)} TON (${(poolShare * 100).toFixed(1)}% of ${poolDepth.tonReserve.toFixed(2)} TON pool)` };
  }

  /**
   * Build position for exit monitoring.
   */
  private buildPosition(ctx: SnipeContext, sizeTon: number, quote: any): Position {
    const entryPrice = ctx.entryPriceTon;
    const expectedTokenQty = Number(quote.expectedOutput) / Math.pow(10, ctx.jettonDecimals);
    const qty = sizeTon / entryPrice;
    
    // Hard stop loss (wide for sniping)
    const stopLoss = entryPrice * (1 - this.config.hardStopLossPct!);
    
    // Take profit = entry + 3x risk (3:1 R:R)
    const riskPerToken = entryPrice - stopLoss;
    const takeProfit = entryPrice + riskPerToken * 3;
    
    // Chandelier trailing will be set up by stepPosition
    // Initial trailing is null until price moves favorably
    
    return {
      id: `snipe-${Date.now()}`,
      orderId: `ord-${Date.now()}`,
      tokenAddress: ctx.jettonAddress,
      ticker: ctx.jettonTicker,
      entryTon: entryPrice,
      qty,
      remainingQty: qty,
      amountTon: sizeTon,
      initialStopLossTon: stopLoss,
      stopLossTon: stopLoss,
      takeProfitTon: takeProfit,
      entryTs: Date.now(),
      mode: "snipe" as ExitMode,
      feesTon: 0.2, // Estimate
      highWaterTon: entryPrice,
      lowWaterTon: entryPrice,
      trailingStopTon: null,
      breakEvenAtTon: null,
      trendFlipPrice: null,
      trendState: "uptrend",
      atrAtEntry: ctx.atrAtEntry,
      swingLow: ctx.swingLow,
      swingHigh: ctx.swingHigh,
      timeStopMs: this.config.timeStopMs!,
      partialTakesHit: [],
      ladderExits: [],
    };
  }

  /**
   * Monitor position and exit on first trigger.
   * Returns when any exit condition fires.
   */
  private async monitorAndExit(
    position: Position,
    jettonAddress: string,
    entryTime: number
  ): Promise<{
    action: ExitAction;
    exitPriceTon: number;
    pnlTon: number;
    holdTimeMs: number;
    reason: string;
  }> {
    const pollIntervalMs = 2000; // 2 second polls
    
    while (true) {
      // Check time stop
      if (position.timeStopMs !== null && Date.now() - position.entryTs >= position.timeStopMs!) {
        const currentPrice = await this.getCurrentPrice(jettonAddress);
        return {
          action: "time_stop",
          exitPriceTon: currentPrice,
          pnlTon: (currentPrice - position.entryTon) * position.remainingQty,
          holdTimeMs: Date.now() - entryTime,
          reason: `Time stop (${position.timeStopMs! / 1000 / 60} min)`,
        };
      }

      // Get current price
      const currentPrice = await this.getCurrentPrice(jettonAddress);
      
      // Check for exit using enhanced stepPosition
      const candleClose = currentPrice; // In production, use candle close
      const result = stepPosition(position, currentPrice, Date.now(), candleClose);
      
      if (result.action !== "hold") {
        return {
          action: result.action,
          exitPriceTon: result.exitPriceTon!,
          pnlTon: (result.exitPriceTon! - position.entryTon) * position.remainingQty,
          holdTimeMs: Date.now() - entryTime,
          reason: result.reason,
        };
      }
      
      // Update position for next iteration
      position = result.pos;
      
      // Wait for next poll
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  private async getCurrentPrice(jettonAddress: string): Promise<number> {
    // In production, use websocket or DEX API for real-time price
    // For now, simulate with DEX simulate
    const depth = await this.dex.getPoolDepth(jettonAddress);
    return depth?.priceTon ?? 0;
  }
}

/**
 * Create a SniperEngine with default configuration.
 */
export function createSniperEngine(
  client: TonClient,
  dex: DexClient,
  overrides?: SniperConfig
): SniperEngine {
  return new SniperEngine(client, dex, overrides);
}