/**
 * Systemic circuit breaker for TON ecosystem.
 * Monitors TON's own price/volatility regime and halts new entries
 * during broad selloffs that correlate with meme coin crashes.
 * 
 * This protects against correlated crashes that per-pair logic won't catch individually.
 */
import { TonClient, Address } from "@ton/ton";

export interface CircuitBreakerConfig {
  /** TON/USD price drop % over lookback window to trigger halt. Default 15%. */
  tonPriceDropPct?: number;
  /** Lookback window in hours. Default 24h. */
  lookbackHours?: number;
  /** Minimum TON volatility (ATR) spike multiplier to trigger. Default 2x. */
  volatilitySpikeMultiplier?: number;
  /** Cooldown period after halt before re-arming. Default 4 hours. */
  cooldownHours?: number;
  /** Whether to tighten existing trailing stops instead of full halt. Default true. */
  tightenStopsInsteadOfHalt?: boolean;
}

export interface CircuitBreakerState {
  active: boolean;
  triggeredAt: number | null;
  reason: string | null;
  tonPriceAtTrigger: number | null;
  tonVolatilityAtTrigger: number | null;
  cooldownUntil: number | null;
}

export interface TonMarketData {
  priceUsd: number;
  priceChange24hPct: number;
  volume24h: number;
  volatility24h: number; // ATR as % of price
}

/**
 * Systemic circuit breaker for TON ecosystem-wide risk.
 * Monitors TON price action and volatility to detect broad market stress.
 */
export class SystemicCircuitBreaker {
  private client: TonClient;
  private config: Required<CircuitBreakerConfig>;
  private state: CircuitBreakerState;
  private priceHistory: { price: number; timestamp: number }[] = [];

  constructor(
    client: TonClient,
    config: CircuitBreakerConfig = {}
  ) {
    this.client = client;
    this.config = {
      tonPriceDropPct: config.tonPriceDropPct ?? 15,
      lookbackHours: config.lookbackHours ?? 24,
      volatilitySpikeMultiplier: config.volatilitySpikeMultiplier ?? 2.0,
      cooldownHours: config.cooldownHours ?? 4,
      tightenStopsInsteadOfHalt: config.tightenStopsInsteadOfHalt ?? true,
    };
    
    this.state = {
      active: false,
      triggeredAt: null,
      reason: null,
      tonPriceAtTrigger: null,
      tonVolatilityAtTrigger: null,
      cooldownUntil: null,
    };
  }

  /**
   * Update with latest TON market data and check for trigger conditions.
   * Call this periodically (e.g., every 5 minutes) from your main loop.
   */
  async update(tonMarketData: TonMarketData): Promise<{ triggered: boolean; action: "halt" | "tighten_stops" | "none"; reason: string }> {
    const now = Date.now();
    
    // Add to price history
    this.priceHistory.push({ price: tonMarketData.priceUsd, timestamp: now });
    
    // Trim old history
    const cutoff = now - this.config.lookbackHours! * 60 * 60 * 1000;
    this.priceHistory = this.priceHistory.filter(p => p.timestamp > cutoff);
    
    // Check cooldown
    if (this.state.cooldownUntil && now < this.state.cooldownUntil) {
      return { triggered: false, action: "none", reason: "In cooldown period" };
    }
    
    // Reset cooldown if expired
    if (this.state.cooldownUntil && now >= this.state.cooldownUntil) {
      this.state.cooldownUntil = null;
      this.state.active = false;
    }
    
    // Calculate metrics
    const metrics = this.calculateMetrics();
    
    // Check trigger conditions
    if (!this.state.active) {
      const trigger = this.checkTriggers(metrics, tonMarketData);
      if (trigger.triggered) {
        this.activate(trigger.reason, tonMarketData);
        return { 
          triggered: true, 
          action: this.config.tightenStopsInsteadOfHalt ? "tighten_stops" : "halt", 
          reason: trigger.reason 
        };
      }
    }
    
    return { triggered: false, action: "none", reason: "No trigger conditions met" };
  }

  private calculateMetrics(): {
    priceChangePct: number;
    volatility: number;
    maxPrice: number;
    minPrice: number;
  } {
    if (this.priceHistory.length < 2) {
      return { priceChangePct: 0, volatility: 0, maxPrice: 0, minPrice: 0 };
    }
    
    const prices = this.priceHistory.map(p => p.price);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const currentPrice = prices[prices.length - 1];
    const startPrice = prices[0];
    
    const priceChangePct = ((currentPrice - startPrice) / startPrice) * 100;
    
    // Calculate volatility as average true range % (simplified)
    let trueRangeSum = 0;
    for (let i = 1; i < prices.length; i++) {
      const tr = Math.abs(prices[i] - prices[i - 1]);
      trueRangeSum += tr;
    }
    const avgTrueRange = trueRangeSum / (prices.length - 1);
    const volatility = (avgTrueRange / currentPrice) * 100;
    
    return { priceChangePct, volatility, maxPrice, minPrice };
  }

  private checkTriggers(
    metrics: ReturnType<SystemicCircuitBreaker["calculateMetrics"]>,
    currentData: TonMarketData
  ): { triggered: boolean; reason: string } {
    // Trigger 1: TON price drop exceeds threshold
    if (metrics.priceChangePct <= -this.config.tonPriceDropPct!) {
      return { 
        triggered: true, 
        reason: `TON price dropped ${Math.abs(metrics.priceChangePct).toFixed(1)}% over ${this.config.lookbackHours}h (threshold: ${this.config.tonPriceDropPct}%)` 
      };
    }
    
    // Trigger 2: Volatility spike (current ATR > multiplier * baseline)
    // We use 24h volatility as proxy for ATR
    const baselineVolatility = this.calculateBaselineVolatility();
    if (currentData.volatility24h > baselineVolatility * this.config.volatilitySpikeMultiplier!) {
      return { 
        triggered: true, 
        reason: `TON volatility spike: ${currentData.volatility24h.toFixed(2)}% > ${this.config.volatilitySpikeMultiplier}x baseline (${baselineVolatility.toFixed(2)}%)` 
      };
    }
    
    // Trigger 3: Combined price drop + volume spike (panic selling)
    // This would require volume data - simplified for now
    
    return { triggered: false, reason: "" };
  }

  private calculateBaselineVolatility(): number {
    // Use longer-term volatility as baseline (last 7 days if available)
    if (this.priceHistory.length < 50) return 2.0; // Default 2% baseline
    
    // Use oldest 80% of data as baseline
    const baselineCount = Math.floor(this.priceHistory.length * 0.8);
    const baselinePrices = this.priceHistory.slice(0, baselineCount).map(p => p.price);
    
    let trSum = 0;
    for (let i = 1; i < baselinePrices.length; i++) {
      trSum += Math.abs(baselinePrices[i] - baselinePrices[i - 1]);
    }
    const avgPrice = baselinePrices.reduce((a, b) => a + b, 0) / baselinePrices.length;
    return ((trSum / (baselinePrices.length - 1)) / avgPrice) * 100;
  }

  private activate(reason: string, currentData: TonMarketData): void {
    const now = Date.now();
    this.state = {
      active: true,
      triggeredAt: now,
      reason,
      tonPriceAtTrigger: currentData.priceUsd,
      tonVolatilityAtTrigger: currentData.volatility24h,
      cooldownUntil: now + this.config.cooldownHours! * 60 * 60 * 1000,
    };
  }

  /**
   * Get current circuit breaker state.
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Check if circuit breaker is currently active.
   */
  isActive(): boolean {
    return this.state.active;
  }

  /**
   * Get recommended trailing stop multiplier adjustment.
   * Returns multiplier to apply to existing trailing stops (1.0 = normal, >1.0 = tighter).
   */
  getTrailingStopMultiplier(): number {
    if (!this.state.active) return 1.0;
    
    // Tighten stops by 50% during systemic stress
    return 1.5;
  }

  /**
   * Check if new entries should be allowed.
   */
  shouldAllowNewEntries(): boolean {
    return !this.state.active || this.config.tightenStopsInsteadOfHalt;
  }

  /**
   * Manual reset (for testing or operator override).
   */
  reset(): void {
    this.state = {
      active: false,
      triggeredAt: null,
      reason: null,
      tonPriceAtTrigger: null,
      tonVolatilityAtTrigger: null,
      cooldownUntil: null,
    };
  }
}

/**
 * Create a systemic circuit breaker with default config.
 */
export function createSystemicCircuitBreaker(
  client: TonClient,
  config?: CircuitBreakerConfig
): SystemicCircuitBreaker {
  return new SystemicCircuitBreaker(client, config);
}