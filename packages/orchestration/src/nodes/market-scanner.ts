import type { MarketScannerInput, MarketScannerOutput, JettonCandidate, SniperMeta } from "../state.js"
import { logger, CONFIG } from "@openclaw-ton-agent/core"
import { tonapiSource, type JettonView } from "@openclaw-ton-agent/scanner"
import { TonClient } from "@ton/ton"
import { PreTradeGate, sniperPositionSize } from "@openclaw-ton-agent/risk-gates"
import { createSniperDexClient, buildSnipeContext } from "@openclaw-ton-agent/scanner"

/**
 * Market scanner node — calls the live scanner source to fetch recent jetton
 * candidates and returns the highest-quality one that passes minimum criteria.
 *
 * Priority:
 *   1. seed_jetton_master (if supplied by caller — explicit override)
 *   2. Top candidate from tonapiSource sorted by pool_tvl_ton desc
 *
 * If no candidates pass the minimum TVL / liquidity gates the node returns
 * an empty candidates list — the supervisor will discard the cycle cleanly.
 */
export async function marketScannerNode(input: MarketScannerInput): Promise<MarketScannerOutput> {
  const { cycle_id, seed_jetton_master } = input

  const minPoolTvl = CONFIG.orchestration.scannerMinPoolTvlTon
  const minLiquidity = CONFIG.orchestration.scannerMinPoolLiquidityTon
  const scanLimit = CONFIG.orchestration.scannerScanLimit
  const topN = CONFIG.orchestration.scannerTopN

  // ── Explicit seed override ────────────────────────────────────────
  if (seed_jetton_master) {
    const candidate: JettonCandidate = {
      jetton_master: seed_jetton_master,
      symbol: undefined,
      pool_tvl_ton: undefined,
      volume_24h_ton: undefined,
      liquidity_ton: undefined,
      holders: undefined,
      age_hours: undefined,
      bonding_curve_pct: undefined,
      source: "manual",
      enriched_at: Date.now(),
    }
    logger.info("MARKET_SCANNER", JSON.stringify({ cycle_id, mode: "seed", jetton_master: seed_jetton_master }))
    return { cycle_id, candidates: [candidate], winner: candidate }
  }


  // ── Live scan via TonAPI ──────────────────────────────────────────
  try {
    const views = await tonapiSource.listRecent()

    const candidates: JettonCandidate[] = views
      .filter((v: JettonView) => {
        if (!v.master) return false
        const tvl = v.liquidityTon ?? 0
        const liq = v.liquidityTon ?? 0
        return tvl >= minPoolTvl && liq >= minLiquidity
      })
      .slice(0, scanLimit)
      .map((v: JettonView) => ({
        jetton_master: v.master,
        symbol: v.symbol,
        pool_tvl_ton: v.liquidityTon ?? undefined,
        volume_24h_ton: undefined,
        liquidity_ton: v.liquidityTon ?? undefined,
        holders: undefined,
        age_hours: undefined,
        bonding_curve_pct: v.curvePct ?? undefined,
        pool_address: v.poolAddress ?? undefined,
        source: "tonapi" as const,
        enriched_at: Date.now(),
        sniper: null as SniperMeta | null,
      }))
      // Sort descending by pool TVL
      .sort((a: JettonCandidate, b: JettonCandidate) => (b.pool_tvl_ton ?? 0) - (a.pool_tvl_ton ?? 0))
      .slice(0, topN)

    // ── Sniper screen for low-liquidity candidates ─────────────────────
    // Only run when SNIPER_ENABLED=true and on mainnet where TonClient is available.
    const sniperEnabled = String(process.env.SNIPER_ENABLED ?? "false").toLowerCase() === "true"
    if (sniperEnabled && CONFIG.network === "mainnet") {
      try {
        const rpcEndpoint = process.env.TON_RPC_ENDPOINT ?? "https://toncenter.com/api/v2/jsonRPC"
        const client = new TonClient({ endpoint: rpcEndpoint })
        const viewsByMaster = new Map(views.map((v) => [v.master, v]))
        const gate = new PreTradeGate(client)
        const sniperCfg = {
          maxPoolSharePct: 0.02,
          absoluteMinTon: 0.5,
          absoluteMaxTon: 5,
        } as const

        for (const c of candidates) {
          const liq = c.liquidity_ton ?? 0
          if (liq >= 100) { c.sniper = null; continue }
          try {
            const gateResult = await gate.checkJetton(c.jetton_master)
            if (!gateResult.passed) {
              c.sniper = { viable: false, sizeTon: 0, reason: gateResult.blockReason ?? "gate_failed", gatePassed: false, blockReason: gateResult.blockReason }
              continue
            }
            const view = viewsByMaster.get(c.jetton_master)
            if (!view || !view.priceTon || view.priceTon <= 0) {
              c.sniper = { viable: false, sizeTon: 0, reason: "no_price", gatePassed: true }
              continue
            }
            const ctx = buildSnipeContext(c.jetton_master, view)
            if (!ctx) {
              c.sniper = { viable: false, sizeTon: 0, reason: "invalid_context", gatePassed: true }
              continue
            }
            const sizeResult = sniperPositionSize(ctx, sniperCfg)
            c.sniper = {
              viable: sizeResult.sizeTon > 0,
              sizeTon: sizeResult.sizeTon,
              reason: sizeResult.reason,
              gatePassed: true,
            }
          } catch (e: any) {
            c.sniper = { viable: false, sizeTon: 0, reason: e?.message ?? "sniper_error", gatePassed: false }
          }
        }
      } catch (e: any) {
        logger.warn("MARKET_SCANNER", `sniper screen failed: ${e?.message ?? e}`)
        for (const c of candidates) c.sniper = null
      }
    } else {
      for (const c of candidates) c.sniper = null
    }

    const winner = candidates[0] ?? null
    logger.info(
      "MARKET_SCANNER",
      JSON.stringify({ cycle_id, total_scanned: views.length, candidates_after_filter: candidates.length, winner: winner?.jetton_master, sniper_enabled: sniperEnabled })
    )
    return { cycle_id, candidates, winner: winner ?? undefined }
  } catch (err: unknown) {
    logger.err("MARKET_SCANNER", `scan failed: ${(err as Error)?.message ?? err}`)
    return { cycle_id, candidates: [], winner: undefined }
  }
}


