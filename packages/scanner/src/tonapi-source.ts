/**
 * Live TONAPI scanner source. Lists recent jettons, audits each, and quotes
 * price/liquidity when available. Quotes without a TONAPI pool lookup remain
 * null — the pipeline journals those as `incomplete` (never fabricated).
 */
import type { ScannerSource, JettonView } from "./replay";
import { auditJetton } from "./audit";
import { tonapiGet } from "./tonapi";
import { SCANNER_CONFIG } from "./config";

const tonapiSourceImpl: ScannerSource = {
  name: "tonapi",
  listRecent: async (): Promise<JettonView[]> => {
    const r = await tonapiGet("/jettons", {
      params: { limit: SCANNER_CONFIG.scanLimit, verified: "false", sort: "created" },
      timeoutMs: 8_000,
    });
    const raw = r.data?.jettons;
    const items: any[] = Array.isArray(raw) ? raw : [];
    const masters = items
      .filter((x) => x?.metadata?.address)
      .map((x) => x.metadata.address);

    const pools = await Promise.all(
      masters.map((master) => fetchPoolForMaster(master))
    );

    type PoolInfo = { master: string; pool: any; priceTon: number | null; liquidityTon: number | null; curvePct: number | null };
    const poolByMaster = new Map<string, PoolInfo>();
    for (const p of pools) {
      if (p) poolByMaster.set(p.master, p);
    }

    return masters
      .map((master, idx) => {
        const item = items[idx];
        const pool = poolByMaster.get(master);
        const poolAddress = pool?.pool?.address ?? null;
        const priceTon = pool?.priceTon ?? null;
        const liquidityTon = pool?.liquidityTon ?? null;
        const curvePct = pool?.curvePct ?? null;
        return {
          master,
          symbol: item.metadata.symbol ?? "",
          name: item.metadata.name ?? "",
          decimals: Number(item.metadata.decimals) || 9,
          priceTon,
          liquidityTon,
          curvePct,
          poolAddress,
        };
      })
      .filter((x) => x.master);
  },
  auditMaster: async (master) => auditJetton(master),
};

async function fetchPoolForMaster(master: string): Promise<{ master: string; pool: any; priceTon: number | null; liquidityTon: number | null; curvePct: number | null } | null> {
  try {
    const r = await tonapiGet(`/jettons/${master}/pools`, { timeoutMs: 8_000 });
    const pools = Array.isArray(r.data?.pools) ? r.data.pools : [];
    const pool = pools.find((p: any) => p && p.address) ?? pools[0];
    if (!pool) return null;

    let priceTon: number | null = null;
    let liquidityTon: number | null = null;
    let curvePct: number | null = null;

    if (pool?.price) {
      priceTon = Number(pool.price);
    }
    if (Number.isFinite(pool?.liquidity)) {
      liquidityTon = Number(pool.liquidity);
    }
    if (Number.isFinite(pool?.curvePct)) {
      curvePct = Number(pool.curvePct);
    }

    return { master, pool, priceTon, liquidityTon, curvePct };
  } catch {
    return null;
  }
}

export const tonapiSource: ScannerSource = tonapiSourceImpl;
