/**
 * Fee router with multi-size slippage probing.
 * Probes STON.fi / DeDust at multiple trade sizes to build the slippage curve
 * before committing to a trade size. This prevents "looks fine at 0.1 TON,
 * brutal slippage at 50 TON" scenarios.
 */
import { fetch, Headers } from "undici";

export interface STONFiSimulateRequest {
  offerAmount: string;        // in nanoTON (1e9)
  askJettonAddress: string;   // jetton master address
  slippageTolerance?: number; // bps, default 100 (1%)
}

export interface STONFiSimulateResponse {
  success: boolean;
  router: string;
  offerAmount: string;
  askAmount: string;          // expected output in jetton units
  fee: {
    total: string;            // total fee in nanoTON
    lpFee: string;
    protocolFee: string;
  };
  gas: {
    estimated: string;        // estimated gas in nanoTON
    limit: string;
  };
  priceImpact?: number;       // price impact percentage
}

export interface DeDustPoolInfo {
  address: string;
  fee: number;                // fee tier (bps, e.g., 25 = 0.25%)
  reserve0: string;
  reserve1: string;
  token0: string;
  token1: string;
}

export interface DeDustSimulateRequest {
  poolAddress: string;
  amountIn: string;           // in base units (nanoTON)
  tokenIn: string;            // "ton" or jetton address
  slippageTolerance?: number; // bps
}

export interface DeDustSimulateResponse {
  amountOut: string;
  fee: string;
  priceImpact: number;
}

export interface SlippageProbeResult {
  sizeTon: number;
  expectedOutput: number;
  minOutput: number;
  feeBps: number;
  gasTon: number;
  priceImpactPct: number;
  slippageBps: number;
  netOutputAfterFees: number;
  effectivePrice: number;     // TON per token
}

export interface MultiSizeProbeConfig {
  /** Sizes to probe (multipliers of base size). Default: [1, 5, 10]. */
  multipliers?: number[];
  /** Base size in TON. */
  baseSizeTon: number;
  /** Maximum acceptable price impact (percentage). Default: 2%. */
  maxPriceImpactPct?: number;
  /** Maximum acceptable slippage (bps). Default: 200. */
  maxSlippageBps?: number;
}

export interface MultiSizeProbeResult {
  probes: SlippageProbeResult[];
  recommendedSizeTon: number;
  reason: string;
  slippageCurve: { size: number; impact: number }[];
}

/**
 * Probe STON.fi simulate endpoint at multiple sizes.
 * Returns the slippage curve and recommended max size.
 */
export async function probeStonFiMultiSize(
  jettonAddress: string,
  config: MultiSizeProbeConfig
): Promise<MultiSizeProbeResult> {
  const multipliers = config.multipliers ?? [1, 5, 10];
  const baseSize = config.baseSizeTon;
  const maxImpact = config.maxPriceImpactPct ?? 2.0;
  const maxSlippage = config.maxSlippageBps ?? 200;

  const probes: SlippageProbeResult[] = [];
  let lastValidSize = 0;
  const recommendedSize = 0;

  for (const mult of multipliers) {
    const sizeTon = baseSize * mult;
    const offerAmountNano = Math.floor(sizeTon * 1e9);

    try {
      const response = await fetch("https://api.ston.fi/v1/swap/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerAmount: offerAmountNano.toString(),
          askJettonAddress: jettonAddress,
          slippageTolerance: 100, // 1% for simulation
        }),
      });

      if (!response.ok) {
        console.warn(`STON.fi simulate failed for ${sizeTon} TON: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json() as STONFiSimulateResponse;
      
      if (!data.success || !data.askAmount) {
        console.warn(`STON.fi simulate returned error for ${sizeTon} TON`);
        continue;
      }

      const expectedOutput = Number(data.askAmount) / 1e9; // Convert from nano units
      const feeTotalNano = Number(data.fee.total);
      const gasNano = Number(data.gas.estimated);
      const feeTon = (feeTotalNano + gasNano) / 1e9;
      
      // Calculate metrics
      const priceImpact = data.priceImpact ?? 0;
      const slippageBps = priceImpact * 100; // priceImpact is in %
      const effectivePrice = sizeTon / expectedOutput;
      const minOutput = expectedOutput * (1 - 0.01); // 1% slippage tolerance
      const netOutput = expectedOutput - (feeTon / effectivePrice);

      const probe: SlippageProbeResult = {
        sizeTon,
        expectedOutput,
        minOutput,
        feeBps: (feeTon / sizeTon) * 10000,
        gasTon: gasNano / 1e9,
        priceImpactPct: priceImpact,
        slippageBps,
        netOutputAfterFees: netOutput,
        effectivePrice,
      };

      probes.push(probe);

      // Check constraints
      if (priceImpact <= maxImpact && slippageBps <= maxSlippage) {
        lastValidSize = sizeTon;
      } else {
        break; // Stop probing larger sizes once we hit constraints
      }
    } catch (error) {
      console.warn(`STON.fi probe failed for ${sizeTon} TON: ${error}`);
    }
  }

  // Recommend the largest valid size, or the base size if none valid
  recommendedSize = lastValidSize > 0 ? lastValidSize : config.baseSizeTon;
  
  const slippageCurve = probes.map(p => ({ size: p.sizeTon, impact: p.priceImpactPct }));

  let reason = "All probes within limits";
  if (probes.some(p => p.priceImpactPct > (config.maxPriceImpactPct ?? 2.0))) {
    reason = "Price impact exceeds threshold at larger sizes";
  } else if (probes.length < 3) {
    reason = "Insufficient probe data - some sizes failed";
  }

  return {
    probes,
    recommendedSizeTon: recommendedSize,
    reason,
    slippageCurve,
  };
}

/**
 * Probe DeDust pool at multiple sizes.
 * DeDust fee varies per pool (0.1% - 10%), so we must query the specific pool.
 */
export async function probeDeDustMultiSize(
  poolAddress: string,
  config: MultiSizeProbeConfig,
  isTonIn: boolean = true
): Promise<MultiSizeProbeResult> {
  const multipliers = config.multipliers ?? [1, 5, 10];
  const baseSize = config.baseSizeTon;
  const maxImpact = config.maxPriceImpactPct ?? 2.0;
  const maxSlippage = config.maxSlippageBps ?? 200;

  const probes: SlippageProbeResult[] = [];
  let lastValidSize = 0;
  const recommendedSize = 0;

  for (const mult of config.multipliers!) {
    const sizeTon = baseSize * mult;
    const amountInNano = Math.floor(sizeTon * 1e9);

    try {
      // Query DeDust pool info first to get fee tier
      // Note: DeDust v2 SDK would be used in production
      const _poolInfo = await fetchDeDustPoolInfo(poolAddress);
      
      const response = await fetch(`https://api.dedust.io/v2/pools/${poolAddress}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountIn: amountInNano.toString(),
          tokenIn: isTonIn ? "ton" : "jetton",
          slippageTolerance: 100,
        }),
      });

      if (!response.ok) continue;

      const data = await response.json() as DeDustSimulateResponse;
      const expectedOutput = Number(data.amountOut) / 1e9;
      const feeTon = Number(data.fee) / 1e9;
      const priceImpact = data.priceImpact ?? 0;

      const probe: SlippageProbeResult = {
        sizeTon: baseSize * mult,
        expectedOutput,
        minOutput: expectedOutput * 0.99,
        feeBps: (feeTon / sizeTon) * 10000,
        gasTon: 0.05, // Estimate
        priceImpactPct: priceImpact,
        slippageBps: priceImpact * 100,
        netOutputAfterFees: expectedOutput - feeTon / (baseSize * mult / expectedOutput),
        effectivePrice: sizeTon / expectedOutput,
      };

      probes.push(probe);

      if (priceImpact <= (config.maxPriceImpactPct ?? 2.0) && 
          priceImpact * 100 <= (config.maxSlippageBps ?? 200)) {
        lastValidSize = sizeTon;
      } else {
        break;
      }
    } catch (error) {
      console.warn(`DeDust probe failed for ${sizeTon} TON: ${error}`);
    }
  }

  const recommendedSize = lastValidSize > 0 ? lastValidSize : config.baseSizeTon;
  const slippageCurve = probes.map(p => ({ size: p.sizeTon, impact: p.priceImpactPct }));

  return {
    probes,
    recommendedSizeTon: recommendedSize,
    reason: "DeDust multi-size probe complete",
    slippageCurve,
  };
}

async function fetchDeDustPoolInfo(poolAddress: string): Promise<DeDustPoolInfo> {
  // In production, use DeDust SDK
  // For now, return mock
  return {
    address: poolAddress,
    fee: 25, // 0.25% default
    reserve0: "0",
    reserve1: "0",
    token0: "",
    token1: "",
  };
}

/**
 * Compare routes across STON.fi and DeDust at multiple sizes.
 * Picks the route with best net output at the intended size.
 */
export async function pickBestRoute(
  jettonAddress: string,
  deDustPoolAddress: string | null,
  config: MultiSizeProbeConfig
): Promise<{ route: "stonfi" | "dedust"; result: MultiSizeProbeResult } | null> {
  const stonfiResult = await probeStonFiMultiSize(jettonAddress, config);
  
  let bestRoute: "stonfi" | "dedust" = "stonfi";
  let bestResult = stonfiResult;

  if (deDustPoolAddress) {
    const dedustResult = await probeDeDustMultiSize(deDustPoolAddress, config);
    
    // Compare at the recommended size
    const stonfiNet = stonfiResult.probes.find(p => p.sizeTon === stonfiResult.recommendedSizeTon)?.netOutputAfterFees ?? 0;
    const dedustNet = dedustResult.probes.find(p => p.sizeTon === dedustResult.recommendedSizeTon)?.netOutputAfterFees ?? 0;

    if (dedustNet > stonfiNet) {
      bestRoute = "dedust";
      bestResult = dedustResult;
    }
  }

  return { route: bestRoute, result: bestResult };
}