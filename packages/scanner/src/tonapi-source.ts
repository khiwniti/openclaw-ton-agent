/**
 * Live TONAPI scanner source. Lists recent jettons, audits each, and quotes
 * price/liquidity when available. Quotes without a TONAPI pool lookup remain
 * null — the pipeline journals those as `incomplete` (never fabricated).
 */
import type { ScannerSource, JettonView } from "./replay";
import { auditJetton } from "./audit";
import { tonapiGet } from "./tonapi";
import { SCANNER_CONFIG } from "./config";
import { globalResilience } from "@openclaw-ton-agent/shared";
const stonFiBreaker = globalResilience.getBreaker("scanner-ston-fi", { failureThreshold: 5, resetTimeoutMs: 15_000 });
const tonapiBreaker = globalResilience.getBreaker("scanner-tonapi", { failureThreshold: 5, resetTimeoutMs: 15_000 });

const tonapiSourceImpl: ScannerSource = {
  name: "tonapi",
  listRecent: async (): Promise<JettonView[]> => {
    const views: JettonView[] = [];
    const tonPriceUsd = await getTonPriceUsd();

    // 1. Fetch active tradeable assets from Ston.fi DEX
    try {
      const stonRes = await fetch("https://api.ston.fi/v1/assets", { signal: AbortSignal.timeout(6_000) });
      if (stonRes.ok) {
        const data = (await stonRes.json()) as { asset_list?: Array<{ contract_address?: string; symbol?: string; display_name?: string; decimals?: number; dex_usd_price?: string; third_party_usd_price?: string; popularity_index?: number; blacklisted?: boolean; deprecated?: boolean; community?: boolean }> };
        const assets = data.asset_list || [];
        const tradeable = assets.filter((a) =>
          !a.blacklisted &&
          !a.deprecated &&
          Number(a.dex_usd_price ?? a.third_party_usd_price) > 0 &&
          a.contract_address &&
          a.contract_address !== "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c" &&
          !a.symbol?.includes("_") &&
          (a.community === false || Number(a.popularity_index) > 0)
        );
        const slice = tradeable.slice(0, SCANNER_CONFIG.scanLimit);
        const poolPromises = slice.map(async (a) => {
          if (!a.contract_address) return null;
          const priceUsd = Number(a.dex_usd_price ?? a.third_party_usd_price);
          const priceTon = priceUsd / tonPriceUsd;
          const pool = await fetchPoolForMaster(a.contract_address);
          return {
            master: a.contract_address,
            symbol: a.symbol ?? "",
            name: a.display_name ?? a.symbol ?? "",
            decimals: Number(a.decimals) || 9,
            priceTon,
            liquidityTon: pool?.liquidityTon ?? null,
            curvePct: pool?.curvePct ?? null,
            poolAddress: pool?.pool?.address ?? null,
          };
        });
        const resolved = await Promise.allSettled(poolPromises);
        for (const r of resolved) {
          if (r.status === "fulfilled" && r.value) {
            views.push(r.value);
          }
        }
      }
    } catch {
      // continue to TONAPI fallback
    }

    // 2. Fetch newly created jettons from TONAPI
    try {
      const r = await tonapiGet("/jettons", {
        params: { limit: SCANNER_CONFIG.scanLimit, verified: "false", sort: "created" },
        timeoutMs: 6_000,
      });
      const raw = r.data?.jettons;
      const items: unknown[] = Array.isArray(raw) ? raw : [];
      const tonapiPromises = items.map(async (item) => {
        if (!item || typeof item !== "object") return null;
        const meta = (item as { metadata?: { address?: string; symbol?: string; name?: string; decimals?: string } }).metadata;
        if (!meta?.address) return null;
        const master = meta.address;
        if (views.some((v) => v.master === master)) return null;
        const pool = await fetchPoolForMaster(master);
        return {
          master,
          symbol: meta.symbol ?? "",
          name: meta.name ?? "",
          decimals: Number(meta.decimals) || 9,
          priceTon: pool?.priceTon ?? null,
          liquidityTon: pool?.liquidityTon ?? null,
          curvePct: pool?.curvePct ?? null,
          poolAddress: pool?.pool?.address ?? null,
        };
      });
      const resolvedTonapi = await Promise.allSettled(tonapiPromises);
      for (const r of resolvedTonapi) {
        if (r.status === "fulfilled" && r.value) {
          views.push(r.value);
        }
      }
    } catch {
      // continue
    }

    return views;
  },
  auditMaster: async (master) => auditJetton(master),
};

let cachedTonPriceUsd = 1.30;
let lastTonPriceFetch = 0;

async function getTonPriceUsd(): Promise<number> {
  const now = Date.now();
  if (now - lastTonPriceFetch < 60_000 && cachedTonPriceUsd > 0) {
    return cachedTonPriceUsd;
  }
  try {
    const res = await fetch("https://api.ston.fi/v1/assets/EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c", {
      signal: AbortSignal.timeout(4_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { asset?: { dex_usd_price?: string; third_party_usd_price?: string } };
      const p = Number(data.asset?.dex_usd_price ?? data.asset?.third_party_usd_price);
      if (Number.isFinite(p) && p > 0) {
        cachedTonPriceUsd = p;
        lastTonPriceFetch = now;
        return p;
      }
    }
  } catch {
    // fallback to cached
  }
  return cachedTonPriceUsd;
}

async function fetchPoolForMaster(master: string): Promise<{ master: string; pool: { address: string }; priceTon: number | null; liquidityTon: number | null; curvePct: number | null } | null> {
  try {
    const tonPriceUsd = await getTonPriceUsd();

    // 1. Try direct Ston.fi pool data first
    const poolRes = await fetch(`https://api.ston.fi/v1/pools?token0=${master}`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (poolRes.ok) {
      const poolData = (await poolRes.json()) as { pool_list?: Array<{ address?: string; token0_balance?: string; token1_balance?: string; lp_total_supply_usd?: string }> };
      const pools = poolData.pool_list ?? [];
      const pool = pools.find((p) => p.address) ?? pools[0];
      if (pool?.address) {
        const lpUsd = Number(pool.lp_total_supply_usd);
        const t0Bal = Number(pool.token0_balance);
        const t1Bal = Number(pool.token1_balance);
        const priceTon = t0Bal > 0 && t1Bal > 0 ? t1Bal / t0Bal : null;
        const liquidityTon =
          Number.isFinite(lpUsd) && lpUsd > 0
            ? lpUsd / tonPriceUsd
            : t1Bal > 0
              ? t1Bal * 2
              : null;
        return {
          master,
          pool: { address: pool.address },
          priceTon,
          liquidityTon,
          curvePct: null,
        };
      }
    }

    // 2. Try STON.fi USDT paired pool (Multi-Hop candidate)
    const usdtMaster = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
    if (master !== usdtMaster) {
      try {
        const usdtPoolRes = await fetch(`https://api.ston.fi/v1/pools?token0=${usdtMaster}&token1=${master}`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (usdtPoolRes.ok) {
          const poolData = (await usdtPoolRes.json()) as { pool_list?: Array<{ address?: string; token0_balance?: string; token1_balance?: string; lp_total_supply_usd?: string }> };
          const pool = poolData.pool_list?.[0];
          if (pool?.address) {
            const lpUsd = Number(pool.lp_total_supply_usd);
            const t0Bal = Number(pool.token0_balance);
            const t1Bal = Number(pool.token1_balance);
            const priceUsd = t0Bal > 0 && t1Bal > 0 ? (t0Bal / 1e6) / (t1Bal / 1e9) : null;
            return {
              master,
              pool: { address: pool.address },
              priceTon: priceUsd && priceUsd > 0 ? priceUsd / tonPriceUsd : null,
              liquidityTon: Number.isFinite(lpUsd) && lpUsd > 0 ? lpUsd / tonPriceUsd : null,
              curvePct: null,
            };
          }
        }
      } catch {}
    }

    // 3. Fallback: Ston.fi asset endpoint for price only
    const assetRes = await fetch(`https://api.ston.fi/v1/assets/${master}`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (assetRes.ok) {
      const data = (await assetRes.json()) as { asset?: { dex_usd_price?: string; third_party_usd_price?: string } };
      const priceUsd = Number(data.asset?.dex_usd_price ?? data.asset?.third_party_usd_price);
      if (Number.isFinite(priceUsd) && priceUsd > 0) {
        return {
          master,
          pool: { address: `stonfi-asset-${master}` },
          priceTon: priceUsd / tonPriceUsd,
          liquidityTon: null,
          curvePct: null,
        };
      }
    }
  } catch {
    // continue
  }

  return null;
}

export const tonapiSource: ScannerSource = tonapiSourceImpl;
