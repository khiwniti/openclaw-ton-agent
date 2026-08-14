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
    return items
      .filter((x) => x?.metadata?.address)
      .map((x) => ({
        master: x.metadata.address,
        symbol: x.metadata.symbol ?? "",
        name: x.metadata.name ?? "",
        decimals: Number(x.metadata.decimals) || 9,
        priceTon: null,
        liquidityTon: null,
        curvePct: null,
        poolAddress: null,
      }));
  },
  auditMaster: async (master) => auditJetton(master),
};

export const tonapiSource: ScannerSource = tonapiSourceImpl;
