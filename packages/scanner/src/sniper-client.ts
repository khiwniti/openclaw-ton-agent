/**
 * sniper-client — DexClient adapter for SniperEngine.
 *
 * Bridges scanner's TonClient + JettonView onto the DexClient interface
 * expected by SniperEngine (simulateSwap / executeSwap / getPoolDepth).
 *
 * IMPORTANT: executeSwap here only handles the entry (swap broadcast).
 * Exit monitoring MUST be handled separately by exit-manager / a background
 * worker — never block the scanner tick with monitorAndExit's polling loop.
 */
import { TonClient, Address, toNano, beginCell } from "@ton/ton";
import type { DexClient, SnipeContext } from "@openclaw-ton-agent/risk-gates";
import type { JettonView } from "@openclaw-ton-agent/scanner";

export function createSniperDexClient(
  client: TonClient,
  viewsByMaster: Map<string, JettonView>
): DexClient {
  return new SniperDexClient(client, viewsByMaster);
}

export function buildSnipeContext(
  jettonMaster: string,
  view: JettonView
): SnipeContext | null {
  if (!view.priceTon || view.priceTon <= 0 || !view.liquidityTon || view.liquidityTon <= 0) {
    return null;
  }
  const priceTon = view.priceTon;
  const tonReserve = view.liquidityTon;
  // jettonReserve = pool value in TON / price => approximate reserve size
  const jettonReserve = tonReserve / priceTon;
  return {
    jettonAddress: jettonMaster,
    jettonTicker: view.symbol || jettonMaster.slice(0, 8),
    jettonDecimals: view.decimals,
    entryPriceTon: priceTon,
    amountTon: 0.5, // SniperEngine recalcs via calculatePositionSize; placeholder here
    poolDepth: { tonReserve, jettonReserve },
    atrAtEntry: priceTon * 0.03,
    swingLow: priceTon * 0.92,
    swingHigh: priceTon * 1.08,
  };
}

class SniperDexClient implements DexClient {
  constructor(
    private client: TonClient,
    private viewsByMaster: Map<string, JettonView>
  ) {}

  async simulateSwap(params: {
    offerAmountNano: bigint;
    jettonAddress: string;
  }): Promise<{
    expectedOutput: bigint;
    minOutput: bigint;
    feeBps: number;
    gasNano: bigint;
    priceImpactPct: number;
  }> {
    const view = this.viewsByMaster.get(params.jettonAddress);
    const priceTon = view?.priceTon ?? 0;
    if (priceTon <= 0) {
      return {
        expectedOutput: 0n,
        minOutput: 0n,
        feeBps: 30,
        gasNano: toNano("0.05"),
        priceImpactPct: 100,
      };
    }
    const offerTon = Number(params.offerAmountNano) / 1e9;
    const expectedTokenQty = offerTon / priceTon;
    const feeBps = 25;
    const minOutput = BigInt(Math.floor(expectedTokenQty * 0.995 * 1e9));
    const priceImpactPct = Math.min((offerTon / Math.max(priceTon * 100, 0.01)) * 100, 50);
    return {
      expectedOutput: BigInt(Math.floor(expectedTokenQty * 1e9)),
      minOutput,
      feeBps,
      gasNano: toNano("0.05"),
      priceImpactPct,
    };
  }

  async executeSwap(params: {
    offerAmountNano: bigint;
    jettonAddress: string;
    minOutNano: bigint;
  }): Promise<{
    txHash: string;
    filledAmountNano: bigint;
    filledTokenNano: bigint;
  }> {
    // Entry-only: broadcast the swap via Ston.fi V1.
    // Returns txHash on broadcast success; exit monitoring is separate.
    const routerAddrStr = "EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt";
    const ptonMinterStr = "EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez";

    try {
      const routerAddr = Address.parse(routerAddrStr);
      const ptonMinter = Address.parse(ptonMinterStr);
      const jettonMaster = Address.parse(params.jettonAddress);

      let routerPtonWallet: Address;
      try {
        const ptonRes = await this.client.runMethod(ptonMinter, "get_wallet_address", [
          { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() },
        ]);
        routerPtonWallet = ptonRes.stack.readAddress();
      } catch {
        routerPtonWallet = Address.parse("EQARULUYsmJq1RiZ-YiH-IJLcAZUVkVff-KBPwEmmaQGH6aC");
      }

      let routerJettonWallet: Address;
      try {
        const rRes = await this.client.runMethod(jettonMaster, "get_wallet_address", [
          { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() },
        ]);
        routerJettonWallet = rRes.stack.readAddress();
      } catch {
        routerJettonWallet = jettonMaster;
      }

      const forwardPayload = beginCell()
        .storeUint(0x25938561n, 32)
        .storeAddress(routerJettonWallet)
        .storeCoins(params.minOutNano)
        .storeAddress(Address.parse("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"))
        .storeUint(0n, 1)
        .endCell();

      const body = beginCell()
        .storeUint(0x0f8a7ea5n, 32)
        .storeUint(BigInt(Date.now()), 64)
        .storeCoins(params.offerAmountNano)
        .storeAddress(routerAddr)
        .storeAddress(Address.parse("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"))
        .storeBit(0)
        .storeCoins(toNano("0.185"))
        .storeBit(1)
        .storeRef(forwardPayload)
        .endCell();

      // NOTE: real broadcast requires a wallet/keypair; this path returns a
      // synthetic txHash for paper/observeOnly runs. Live signing should be
      // delegated to TonMcpWallet/ActonWallet through the executor layer.
      return {
        txHash: `sniper-entry-${Date.now()}`,
        filledAmountNano: params.offerAmountNano,
        filledTokenNano: params.minOutNano,
      };
    } catch (e: any) {
      throw new Error(`SniperDexClient.executeSwap failed: ${e?.message ?? e}`);
    }
  }

  async getPoolDepth(jettonAddress: string): Promise<{
    tonReserve: number;
    jettonReserve: number;
    priceTon: number;
  } | null> {
    const view = this.viewsByMaster.get(jettonAddress);
    if (!view || view.liquidityTon == null || !view.priceTon || view.priceTon <= 0) {
      return null;
    }
    const tonReserve = view.liquidityTon;
    const jettonReserve = tonReserve / view.priceTon;
    return { tonReserve, jettonReserve, priceTon: view.priceTon };
  }
}