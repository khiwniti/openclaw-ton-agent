import { Address, beginCell } from "@ton/ton"
import { logger } from "@openclaw-ton-agent/core"

// Ston.fi v1 router (mainnet)
const STONFI_ROUTER_MAINNET = "EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt"
// Ston.fi v1 router (testnet)
const STONFI_ROUTER_TESTNET = "kQBsGx9ArADUrREB34W-ghgsCgBShvfUr4Jvlu-0KGc33a1n"
// DeDust v2 factory (mainnet only — no public testnet factory)
const DEDUST_FACTORY_MAINNET = "EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67"
// Null address used as TON asset in pool queries
const TON_NULL_ADDR = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"

export interface ResolvedPool {
  source: "stonfi" | "dedust" | "manual"
  poolAddress: string
  dex: "stonfi" | "dedust"
}

/**
 * Resolve the DEX pool address for a given jetton master.
 * Tries Ston.fi first (get_pool_address), then DeDust (get_pool).
 * Returns null if neither DEX has a pool for this token — never invents an address.
 */
export async function resolvePool(
  client: { runMethod: (addr: Address, method: string, args?: unknown[]) => Promise<any> },
  jettonMaster: Address,
  network: "mainnet" | "testnet" = "mainnet"
): Promise<ResolvedPool | null> {
  const masterStr = jettonMaster.toString()

  // ── Ston.fi ──────────────────────────────────────────────────────
  try {
    const routerAddr = Address.parse(network === "testnet" ? STONFI_ROUTER_TESTNET : STONFI_ROUTER_MAINNET)
    const ptonMinterAddr = Address.parse("EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez")

    let routerPtonWallet: Address
    try {
      const ptonRes = await client.runMethod(ptonMinterAddr, "get_wallet_address", [
        { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }
      ])
      routerPtonWallet = ptonRes.stack.readAddress()
    } catch {
      routerPtonWallet = Address.parse("EQARULUYsmJq1RiZ-YiH-IJLcAZUVkVff-KBPwEmmaQGH6aC")
    }

    let routerJettonWallet: Address
    try {
      const rRes = await client.runMethod(jettonMaster, "get_wallet_address", [
        { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }
      ])
      routerJettonWallet = rRes.stack.readAddress()
    } catch {
      routerJettonWallet = jettonMaster
    }

    const result = await client.runMethod(routerAddr, "get_pool_address", [
      { type: "slice", cell: beginCell().storeAddress(routerPtonWallet).endCell() },
      { type: "slice", cell: beginCell().storeAddress(routerJettonWallet).endCell() },
    ])
    const poolAddress: string | null = result?.stack?.readAddress?.()?.toString?.() ?? null
    if (poolAddress && poolAddress !== TON_NULL_ADDR && poolAddress !== "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c") {
      logger.info("POOL_RESOLVER", JSON.stringify({ jettonMaster: masterStr, dex: "stonfi", poolAddress, network }))
      return { source: "stonfi", poolAddress, dex: "stonfi" }
    }
  } catch (e: unknown) {
    logger.warn("POOL_RESOLVER", `stonfi lookup failed for ${masterStr}: ${(e as Error)?.message ?? e}`)
  }
  // ── DeDust (mainnet only) ─────────────────────────────────────────
  if (network === "mainnet") {
    try {
      const factoryAddr = Address.parse(DEDUST_FACTORY_MAINNET)
      const poolQuery = beginCell()
        .storeUint(0, 32)
        .storeAddress(Address.parse(TON_NULL_ADDR))
        .storeAddress(jettonMaster)
        .endCell()

      const result = await client.runMethod(factoryAddr, "get_pool", [
        { type: "slice", cell: poolQuery },
      ])
      const poolAddress: string | null = result?.stack?.readAddress?.() ?? null
      if (poolAddress && poolAddress !== TON_NULL_ADDR && poolAddress !== "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c") {
        logger.info("POOL_RESOLVER", JSON.stringify({ jettonMaster: masterStr, dex: "dedust", poolAddress, network }))
        return { source: "dedust", poolAddress, dex: "dedust" }
      }
    } catch (e: unknown) {
      logger.warn("POOL_RESOLVER", `dedust lookup failed for ${masterStr}: ${(e as Error)?.message ?? e}`)
    }
  }


  logger.warn("POOL_RESOLVER", `no pool found for ${masterStr} on ${network}`)
  return null
}

