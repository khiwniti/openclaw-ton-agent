/**
 * DEX execution router — Ston.fi & DeDust (Acton port).
 *
 * Ports the fail-closed execution flow from `ton-agent` while delegating
 * actual signing/broadcasting to the Acton CLI/FFI layer.
 *
 * Network-aware routing: on testnet, DeDust falls back to Ston.fi.
 */

import {
  toNano,
  fromNano,
  Address,
  beginCell,
  type Cell,
} from "@ton/ton";
import {
  evaluateBuyGasGuard,
  evaluateSellGasGuard,
} from "./gas-guard.js";
// minout helpers are available if needed
import {
  readUserJettonBalance,
  verifyBuyDelivered,
  verifySellExecuted,
} from "./verify.js";
import { sendTransferLocked } from "./locked-wallet.js";

// ── Network-aware DEX contract addresses ──────────────────────────

export const STONFI_ROUTER_ADDR = "EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt";
const STONFI_ROUTER_ADDR_TESTNET = "kQBsGx9ArADUrREB34W-ghgsCgBShvfUr4Jvlu-0KGc33a1n";
export const STONFI_PTON_ADDR = "EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez";
const STONFI_PTON_ADDR_TESTNET = "EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez";

// Source: @dedust/sdk v0.8.x MAINNET_FACTORY_ADDR
export const DEDUST_FACTORY_ADDR_MAINNET = "EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67";

function isTestnet(network = "mainnet"): boolean {
  return network === "testnet";
}

function stonfiRouterAddr(network = "mainnet"): string {
  return isTestnet(network) ? STONFI_ROUTER_ADDR_TESTNET : STONFI_ROUTER_ADDR;
}

function stonfiPtonAddr(network = "mainnet"): string {
  return isTestnet(network) ? STONFI_PTON_ADDR_TESTNET : STONFI_PTON_ADDR;
}

function dedustFactoryAddr(network = "mainnet"): string | null {
  return isTestnet(network) ? null : DEDUST_FACTORY_ADDR_MAINNET;
}

// ── Types ──────────────────────────────────────────────────────────

export type Dex = "stonfi" | "dedust";

export type SwapExecutionStatus =
  | "confirmed"
  | "signing_failed"
  | "broadcast_failed"
  | "broadcast_unknown"
  | "blocked";

export interface SwapQuote {
  route: { dex: Dex; poolAddress: string };
  side: "buy" | "sell";
  amountInNano: string;
  expectedOutNano: string;
  resolvedAt: number;
  available: boolean;
}

export interface SwapRequest {
  jettonMaster: string;
  amountTon: number;
  side: "buy" | "sell";
  minOutJettonNano?: string;
  jettonAmountNano?: string;
  useBudgetingWallet?: boolean;
  budgetingAddress?: string;
}

export interface SwapResult {
  ok: boolean;
  dex: Dex;
  status?: SwapExecutionStatus;
  error?: string;
  txHash?: string;
  amountTokens?: string;
}

// ── Helpers ────────────────────────────────────────────────────────

export function parsePositiveNano(value: string | undefined, field: string): bigint {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${field} must be a positive integer in nano units`);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new Error(`${field} must be greater than zero`);
  }
  return parsed;
}

export async function readWithRetries<T>(read: () => Promise<T>, attempts = 3): Promise<T> {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("attempts must be a positive integer");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export function requireExecutableQuote(
  minOutJettonNano: string | undefined,
  quoteRequest: string
): bigint {
  if (!minOutJettonNano) {
    throw new Error(`No executable quote available for ${quoteRequest} — swap blocked`);
  }
  return parsePositiveNano(minOutJettonNano, "minOutJettonNano");
}

export function classifyTransferResult(result: {
  success: boolean;
  error?: string;
}): SwapExecutionStatus {
  if (result.success) return "confirmed";
  if (result.error?.includes("sign")) return "signing_failed";
  if (result.error?.includes("broadcast")) return "broadcast_failed";
  return "broadcast_unknown";
}

export { computeMinOut } from "./minout.js";

// ── Dead-pool cache ────────────────────────────────────────────────

const deadPoolCache = new Map<string, number>();
const DEAD_POOL_TTL_MS = 300000; // 5 minutes

function isPoolDead(poolAddress: string): boolean {
  const expiresAt = deadPoolCache.get(poolAddress);
  if (expiresAt === undefined) return false;
  if (Date.now() > expiresAt) {
    deadPoolCache.delete(poolAddress);
    return false;
  }
  return true;
}

function markPoolDead(poolAddress: string, ttl: number): void {
  deadPoolCache.set(poolAddress, Date.now() + ttl);
}

// ── DeDust payload builders ────────────────────────────────────────

/**
 * DeDust JETTON-vault swap-payload builder — opcode `0xe3a0d482`.
 */
export function dedustSwapPayload(args: {
  poolAddress: Address;
  limit: bigint;
  swapParams?: { recipientAddress?: Address };
}): Cell {
  return beginCell()
    .storeUint(0xe3a0d482n, 32)
    .storeAddress(args.poolAddress)
    .storeCoins(args.limit)
    .storeMaybeRef(
      args.swapParams?.recipientAddress
        ? beginCell().storeAddress(args.swapParams.recipientAddress).endCell()
        : null
    )
    .endCell();
}

/**
 * DeDust NATIVE-vault swap-payload builder (BUY: TON → Jetton).
 * Native vault dispatches on opcode `0xea06185d`.
 */
export function dedustNativeSwapPayload(args: {
  poolAddress: Address;
  amount: bigint;
  queryId?: bigint | number;
  limit?: bigint;
  swapParams?: { recipientAddress?: Address };
}): Cell {
  return beginCell()
    .storeUint(0xea06185dn, 32)
    .storeUint(BigInt(args.queryId ?? 0), 64)
    .storeCoins(args.amount)
    .storeAddress(args.poolAddress)
    .storeUint(0, 1)
    .storeCoins(args.limit ?? 0n)
    .storeMaybeRef(null)
    .storeRef(
      beginCell()
        .storeUint(0, 32)
        .storeAddress(args.swapParams?.recipientAddress ?? null)
        .storeAddress(null)
        .storeMaybeRef(null)
        .storeMaybeRef(null)
        .endCell()
    )
    .endCell();
}

// ── Low-level RPC helpers ─────────────────────────────────────────

async function runMethodSafe(
  client: any,
  address: string,
  method: string,
  args: unknown[] = []
): Promise<{ stack: { readAddress: () => unknown; readBigNumber: () => bigint } } | null> {
  try {
    return (await client.runMethod(address, method, args)) as {
      stack: { readAddress: () => unknown; readBigNumber: () => bigint };
    };
  } catch {
    return null;
  }
}

async function readUserJettonBalanceLocal(
  client: any,
  master: string,
  userWallet: string
): Promise<bigint | null> {
  return readUserJettonBalance(client, master, userWallet);
}

// ── Pool minimum check ─────────────────────────────────────────────

async function checkPoolMinimum(
  client: any,
  p: SwapRequest,
  dex: Dex,
  network = "mainnet"
): Promise<{ ok: boolean; reason?: string }> {
  if (p.side !== "buy") return { ok: true };

  const totalTon = p.amountTon + 0.25;
  const poolMinimumTon = 1.0;

  if (totalTon < poolMinimumTon) {
    return {
      ok: false,
      reason: `below-pool-minimum: ${totalTon.toFixed(4)} TON < ${poolMinimumTon} TON`,
    };
  }

  if (dex === "dedust" && !isTestnet(network)) {
    try {
      const factoryAddr = dedustFactoryAddr(network);
      if (!factoryAddr) return { ok: true };

      const factoryResult = await runMethodSafe(
        client,
        factoryAddr,
        "get_pool",
        [
          {
            type: "slice",
            cell: beginCell()
              .storeUint(0, 32)
              .storeAddress(Address.parse("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"))
              .storeAddress(Address.parse(p.jettonMaster))
              .endCell()
              .toBoc()
              .toString("base64"),
          },
        ]
      );

      if (factoryResult) {
        const poolAddr = factoryResult.stack.readAddress() as string;
        const poolResult = await runMethodSafe(client, poolAddr, "get_reserves");
        if (poolResult) {
          const reserveIn = Number(poolResult.stack.readBigNumber()) / 1e9;
          const effectiveMinimum = Math.min(poolMinimumTon, reserveIn * 0.01);
          if (totalTon < effectiveMinimum) {
            return {
              ok: false,
              reason: `below-pool-minimum: ${totalTon.toFixed(4)} TON < effective ${effectiveMinimum.toFixed(4)} TON (reserve=${reserveIn.toFixed(2)} TON)`,
            };
          }
        }
      }
    } catch {
      /* best-effort */
    }
  }

  return { ok: true };
}

// ── Ston.fi helpers ────────────────────────────────────────────────

async function stonfiBuy(
  client: any,
  w: any,
  kp: { sec: Buffer },
  p: SwapRequest,
  tier: "low" | "mid" | "high",
  network = "mainnet"
): Promise<SwapResult> {
  const bal = await w.getBalance();
  const guard = evaluateBuyGasGuard(Number(fromNano(bal)), p.amountTon);
  if (!guard.ok) {
    throw new Error(guard.error);
  }

  const routerAddr = stonfiRouterAddr(network);
  const jettonMasterAddr = Address.parse(p.jettonMaster);

  let amountTokens: string | undefined;
  try {
    const routerResult = await runMethodSafe(
      client,
      routerAddr,
      "get_pool_address",
      [
        {
          type: "slice",
          cell: beginCell()
            .storeAddress(Address.parse("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"))
            .storeAddress(jettonMasterAddr)
            .endCell()
            .toBoc()
            .toString("base64"),
        },
      ]
    );

    if (routerResult) {
      const poolAddress = routerResult.stack.readAddress() as string;
      const poolDataResult = await runMethodSafe(client, poolAddress, "get_pool_data");
      if (poolDataResult) {
        const jettonWallet = poolDataResult.stack.readAddress() as string;
        const expectedResult = await runMethodSafe(client, poolAddress, "get_expected_outputs", [
          {
            type: "slice",
            cell: beginCell()
              .storeCoins(toNano(p.amountTon.toString()))
              .storeAddress(Address.parse(jettonWallet))
              .endCell()

              .toBoc()
              .toString("base64"),
          },
        ]);
        if (expectedResult) {
          amountTokens = expectedResult.stack.readBigNumber().toString();
        }
      }
    }
  } catch {
    // estimation failure non-fatal
  }

  const buyBalanceBefore = await readUserJettonBalanceLocal(
    client,
    p.jettonMaster,
    w.address
  );

  const pTonMinterAddr = Address.parse(stonfiPtonAddr(network));
  let routerPtonWallet: Address;
  try {
    const ptonRes = await client.runMethod(pTonMinterAddr, "get_wallet_address", [
      { type: "slice", cell: beginCell().storeAddress(Address.parse(routerAddr)).endCell() }
    ]);
    routerPtonWallet = ptonRes.stack.readAddress();
  } catch {
    routerPtonWallet = Address.parse("EQARULUYsmJq1RiZ-YiH-IJLcAZUVkVff-KBPwEmmaQGH6aC");
  }

  let routerJettonWallet: Address;
  try {
    const rRes = await client.runMethod(jettonMasterAddr, "get_wallet_address", [
      { type: "slice", cell: beginCell().storeAddress(Address.parse(routerAddr)).endCell() }
    ]);
    routerJettonWallet = rRes.stack.readAddress();
  } catch {
    routerJettonWallet = jettonMasterAddr;
  }

  const forwardPayload = beginCell()
    .storeUint(0x25938561, 32)
    .storeAddress(routerJettonWallet)
    .storeCoins(BigInt(p.minOutJettonNano ?? "1"))
    .storeAddress(Address.parse(w.address))
    .storeUint(0, 1)
    .endCell();

  const transferBody = beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(Date.now(), 64)
    .storeCoins(toNano(p.amountTon.toString()))
    .storeAddress(Address.parse(routerAddr))
    .storeAddress(Address.parse(w.address))
    .storeBit(0)
    .storeCoins(toNano("0.185"))
    .storeBit(1)
    .storeRef(forwardPayload)
    .endCell();

  const r = await sendTransferLocked(
    tier,
    {
      wallet: w,
      secretKey: kp.sec,
      messages: [
        {
          to: routerPtonWallet.toString(),
          value: toNano((p.amountTon + 0.24).toString()),
          body: transferBody.toBoc().toString("base64"),
        } as any,
      ],
      client,
    },
    client
  );

  if (r.ok) {
    const delivered = await verifyBuyDelivered({
      client,
      master: p.jettonMaster,
      walletAddress: w.address,
      expectedNano: amountTokens ? BigInt(amountTokens) : 0n,
      balanceBefore: buyBalanceBefore,
    });
    if (!delivered.ok) {
      return { ok: false, dex: "stonfi", error: delivered.error };
    }
    amountTokens = delivered.actualBalance?.toString();
  }

  return {
    ok: r.ok,
    dex: "stonfi",
    error: r.error,
    amountTokens: r.ok ? amountTokens : undefined,
  };
}

async function stonfiSell(
  client: any,
  w: any,
  kp: { sec: Buffer },
  p: SwapRequest,
  tier: "low" | "mid" | "high",
  network = "mainnet"
): Promise<SwapResult> {
  if (!p.jettonAmountNano) {
    throw new Error("jettonAmountNano is required for sell swap");
  }

  const bal = await w.getBalance();
  const sellGuard = evaluateSellGasGuard(Number(fromNano(bal)));
  if (!sellGuard.ok) {
    return { ok: false, dex: "stonfi", error: sellGuard.error };
  }

  const jettonMasterAddr = Address.parse(p.jettonMaster);


  const result = await readWithRetries(() =>
    client.runMethod(jettonMasterAddr.toString(), "get_wallet_address", [
      {
        type: "slice",
        cell: beginCell().storeAddress(w.address).endCell().toBoc().toString("base64"),
      },
    ])
  );
  const userJettonWalletStack = (result as { stack: { readAddress: () => unknown } }).stack;
  const userJettonWallet = userJettonWalletStack.readAddress() as string;

  const sellBalanceBefore = await readUserJettonBalanceLocal(
    client,
    p.jettonMaster,
    w.address
  );

  const pTonMinterAddr = Address.parse(stonfiPtonAddr(network));
  let routerPtonWallet: Address;
  try {
    const pRes = await client.runMethod(pTonMinterAddr, "get_wallet_address", [
      { type: "slice", cell: beginCell().storeAddress(Address.parse(stonfiRouterAddr(network))).endCell() }
    ]);
    routerPtonWallet = pRes.stack.readAddress();
  } catch {
    routerPtonWallet = pTonMinterAddr;
  }

  const forwardBody = beginCell()
    .storeUint(0x25938561, 32)
    .storeAddress(routerPtonWallet)
    .storeCoins(BigInt(p.minOutJettonNano ?? "1"))
    .storeAddress(Address.parse(w.address))
    .storeUint(0, 1)
    .endCell();

  const sellBody = beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(Date.now(), 64)
    .storeCoins(BigInt(p.jettonAmountNano))
    .storeAddress(Address.parse(stonfiRouterAddr(network)))
    .storeAddress(Address.parse(w.address))
    .storeBit(0)
    .storeCoins(toNano("0.185"))
    .storeBit(1)
    .storeRef(forwardBody)
    .endCell();

  const r = await sendTransferLocked(
    tier,
    {
      wallet: w,
      secretKey: kp.sec,
      messages: [
        {
          to: userJettonWallet,
          value: toNano("0.25"),
          body: sellBody.toBoc().toString("base64"),
        } as any,
      ],
      client,
    },
    client
  );

  if (r.ok) {
    const verified = await verifySellExecuted({
      client,
      master: p.jettonMaster,
      walletAddress: w.address,
      soldNano: BigInt(p.jettonAmountNano),
      balanceBefore: sellBalanceBefore,
    });
    if (!verified.ok) {
      return { ok: false, dex: "stonfi", error: verified.error };
    }
  }

  return {
    ok: r.ok,
    dex: "stonfi",
    error: r.error,
    amountTokens: r.ok ? p.jettonAmountNano : undefined,
  };
}

// ── DeDust helpers ─────────────────────────────────────────────────

async function dedustBuy(
  client: any,
  w: any,
  kp: { sec: Buffer },
  p: SwapRequest,
  tier: "low" | "mid" | "high",
  network = "mainnet"
): Promise<SwapResult> {
  if (isTestnet(network)) {
    return {
      ok: false,
      dex: "dedust",
      error: "DeDust not available on testnet (no public factory) — use stonfi",
    };
  }

  const bal = await w.getBalance();
  const guard = evaluateBuyGasGuard(Number(fromNano(bal)), p.amountTon);
  if (!guard.ok) {
    throw new Error(guard.error);
  }

  const factoryAddr = dedustFactoryAddr(network);
  if (!factoryAddr) {
    return { ok: false, dex: "dedust", error: "DeDust factory not configured for this network" };
  }

  const tonAsset = Address.parse("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c");
  const jetAsset = Address.parse(p.jettonMaster);

  const factoryResult = await runMethodSafe(
    client,
    factoryAddr,
    "get_pool",
    [
      {
        type: "slice",
        cell: beginCell()
          .storeUint(0, 32)
          .storeAddress(tonAsset)
          .storeAddress(jetAsset)
          .endCell()
          .toBoc()
          .toString("base64"),
      },
    ]
  );

  if (!factoryResult) {
    return { ok: false, dex: "dedust", error: "failed to resolve DeDust pool" };
  }

  const poolAddress = factoryResult.stack.readAddress() as string;

  let amountTokens: string | undefined;
  try {
    const poolResult = await runMethodSafe(client, poolAddress, "get_reserves");
    if (poolResult) {
      const reserveIn = BigInt(poolResult.stack.readBigNumber());
      const reserveOut = BigInt(poolResult.stack.readBigNumber());
      if (reserveIn > 0n && reserveOut > 0n) {
        const amountIn = toNano(p.amountTon.toString());
        const numerator = reserveOut * amountIn * 997n;
        const denominator = reserveIn * 1000n + amountIn * 997n;
        if (denominator > 0n) {
          amountTokens = (numerator / denominator).toString();
        }
      }
    }
  } catch {
    // estimation failure non-fatal
  }

  const buyBalanceBefore = await readUserJettonBalanceLocal(
    client,
    p.jettonMaster,
    w.address
  );

  const swapBody = dedustNativeSwapPayload({
    poolAddress: Address.parse(poolAddress),
    amount: toNano(p.amountTon.toString()),
    limit: 0n,
    swapParams: { recipientAddress: w.address },
  });

  const r = await sendTransferLocked(
    tier,
    {
      wallet: w,
      secretKey: kp.sec,
      messages: [
        {
          to: poolAddress,
          value: toNano((p.amountTon + 0.25).toString()),
          body: swapBody.toBoc().toString("base64"),
        } as any,
      ],
      client,
    },
    client
  );

  if (r.ok) {
    const delivered = await verifyBuyDelivered({
      client,
      master: p.jettonMaster,
      walletAddress: w.address,
      expectedNano: amountTokens ? BigInt(amountTokens) : 0n,
      balanceBefore: buyBalanceBefore,
    });
    if (!delivered.ok) {
      return { ok: false, dex: "dedust", error: delivered.error };
    }
    amountTokens = delivered.actualBalance?.toString();
  }

  return {
    ok: r.ok,
    dex: "dedust",
    error: r.error,
    amountTokens: r.ok ? amountTokens : undefined,
  };
}

async function dedustSell(
  client: any,
  w: any,
  kp: { sec: Buffer },
  p: SwapRequest,
  tier: "low" | "mid" | "high",
  network = "mainnet"
): Promise<SwapResult> {
  if (isTestnet(network)) {
    return {
      ok: false,
      dex: "dedust",
      error: "DeDust not available on testnet (no public factory) — use stonfi",
    };
  }

  if (!p.jettonAmountNano) {
    throw new Error("jettonAmountNano is required for sell swap");
  }

  const sellBal = await w.getBalance();
  const sellGuard = evaluateSellGasGuard(Number(fromNano(sellBal)));
  if (!sellGuard.ok) {
    return { ok: false, dex: "dedust", error: sellGuard.error };
  }

  const factoryAddr = dedustFactoryAddr(network);
  if (!factoryAddr) {
    return { ok: false, dex: "dedust", error: "DeDust factory not configured for this network" };
  }

  const jettonMasterAddr = Address.parse(p.jettonMaster);

  const result = await readWithRetries(() =>
    client.runMethod(jettonMasterAddr.toString(), "get_wallet_address", [
      {
        type: "slice",
        cell: beginCell().storeAddress(w.address).endCell().toBoc().toString("base64"),
      },
    ])
  );
  const userJettonWalletStack = (result as { stack: { readAddress: () => unknown } }).stack;
  const userJettonWallet = userJettonWalletStack.readAddress() as string;

  const sellBalanceBefore = await readUserJettonBalanceLocal(
    client,
    p.jettonMaster,
    w.address
  );

  const factoryResult = await runMethodSafe(
    client,
    factoryAddr,
    "get_pool",
    [
      {
        type: "slice",
        cell: beginCell()
          .storeUint(0, 32)
          .storeAddress(Address.parse("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"))
          .storeAddress(jettonMasterAddr)
          .endCell()
          .toBoc()
          .toString("base64"),
      },
    ]
  );

  const poolAddress = factoryResult?.stack.readAddress() as string | undefined;

  const forwardPayload = dedustSwapPayload({
    poolAddress: poolAddress ? Address.parse(poolAddress) : jettonMasterAddr,
    limit: 0n,
    swapParams: { recipientAddress: w.address },
  });

  const body = beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(Date.now(), 64)
    .storeCoins(BigInt(p.jettonAmountNano))
    .storeAddress(Address.parse(userJettonWallet))
    .storeAddress(w.address)

    .storeBit(0)
    .storeCoins(toNano("0.25"))
    .storeBit(1)
    .storeRef(forwardPayload)
    .endCell();

  const r = await sendTransferLocked(
    tier,
    {
      wallet: w,
      secretKey: kp.sec,
      messages: [
        {
          to: userJettonWallet,
          value: toNano("0.35"),
          body: body.toBoc().toString("base64"),
        } as any,
      ],
      client,
    },
    client
  );

  if (r.ok) {
    const verified = await verifySellExecuted({
      client,
      master: p.jettonMaster,
      walletAddress: w.address,
      soldNano: BigInt(p.jettonAmountNano),
      balanceBefore: sellBalanceBefore,
    });
    if (!verified.ok) {
      return { ok: false, dex: "dedust", error: verified.error };
    }
  }

  return {
    ok: r.ok,
    dex: "dedust",
    error: r.error,
    amountTokens: r.ok ? p.jettonAmountNano : undefined,
  };
}

// ── getSwapQuote ───────────────────────────────────────────────────

export async function getSwapQuote(
  client: {
    runMethod: (...args: unknown[]) => Promise<unknown>;
    open: (contract: unknown) => unknown;
  },
  route: { dex: Dex; poolAddress?: string },
  side: "buy" | "sell",
  amountInNano: string,
  jettonMaster: string,
  network = "mainnet"
): Promise<SwapQuote | null> {
  const now = Date.now();

  if ((route.dex === "stonfi" || route.dex === "dedust") && route.poolAddress && isPoolDead(route.poolAddress)) {
    return {
      route: { dex: route.dex, poolAddress: route.poolAddress },
      side,
      amountInNano,
      expectedOutNano: "0",
      resolvedAt: now,
      available: false,
    };
  }

  try {
    if (route.dex === "stonfi") {
      const routerAddr = stonfiRouterAddr(network);
      const jettonMasterAddr = Address.parse(jettonMaster);

      let poolAddress: string | null = null;
      let jettonWallet: string | null = null;

      try {
        const routerResult = await runMethodSafe(
          client,
          routerAddr,
          "get_pool_address",
          [
            {
              type: "slice",
              cell: beginCell()
                .storeAddress(Address.parse("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"))
                .storeAddress(jettonMasterAddr)
                .endCell()
                .toBoc()
                .toString("base64"),
            },
          ]
        );
        if (routerResult) {
          poolAddress = routerResult.stack.readAddress() as string;
        }
      } catch (e: any) {
        if (route.poolAddress) markPoolDead(route.poolAddress, DEAD_POOL_TTL_MS);
        return {
          route: { dex: "stonfi", poolAddress: route.poolAddress ?? "" },
          side,
          amountInNano,
          expectedOutNano: "0",
          resolvedAt: now,
          available: false,
        };
      }

      if (!poolAddress) {
        return {
          route: { dex: "stonfi", poolAddress: route.poolAddress ?? "" },
          side,
          amountInNano,
          expectedOutNano: "0",
          resolvedAt: now,
          available: false,
        };
      }

      try {
        const poolDataResult = await runMethodSafe(client, poolAddress, "get_pool_data");
        if (poolDataResult) {
          jettonWallet = poolDataResult.stack.readAddress() as string;
        }
      } catch (e: any) {
        if (route.poolAddress) markPoolDead(route.poolAddress, DEAD_POOL_TTL_MS);
        return {
          route: { dex: "stonfi", poolAddress: route.poolAddress ?? "" },
          side,
          amountInNano,
          expectedOutNano: "0",
          resolvedAt: now,
          available: false,
        };
      }

      if (!jettonWallet) {
        return {
          route: { dex: "stonfi", poolAddress: route.poolAddress ?? poolAddress },
          side,
          amountInNano,
          expectedOutNano: "0",
          resolvedAt: now,
          available: false,
        };
      }

      let expectedOutNano = "0";
      try {
        const expectedResult = await runMethodSafe(client, poolAddress, "get_expected_outputs", [
          {
            type: "slice",
            cell: beginCell()
              .storeCoins(BigInt(amountInNano))
              .storeAddress(Address.parse(jettonWallet))
              .endCell()

              .toBoc()
              .toString("base64"),
          },
        ]);
        if (expectedResult) {
          expectedOutNano = expectedResult.stack.readBigNumber().toString();
        }
      } catch (e: any) {
        if (route.poolAddress) markPoolDead(route.poolAddress, DEAD_POOL_TTL_MS);
        return {
          route: { dex: "stonfi", poolAddress: route.poolAddress ?? poolAddress },
          side,
          amountInNano,
          expectedOutNano: "0",
          resolvedAt: now,
          available: false,
        };
      }

      const avail = BigInt(expectedOutNano) > 0n;
      return {
        route: { dex: "stonfi", poolAddress },
        side,
        amountInNano,
        expectedOutNano,
        resolvedAt: now,
        available: avail,
      };
    }

    if (route.dex === "dedust") {
      if (isTestnet(network)) {
        return {
          route: { dex: "dedust", poolAddress: route.poolAddress ?? "" },
          side,
          amountInNano,
          expectedOutNano: "0",
          resolvedAt: now,
          available: false,
        };
      }

      const factoryAddr = dedustFactoryAddr(network);
      if (!factoryAddr) {
        return {
          route: { dex: "dedust", poolAddress: route.poolAddress ?? "" },
          side,
          amountInNano,
          expectedOutNano: "0",
          resolvedAt: now,
          available: false,
        };
      }

      const tonAsset = Address.parse("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c");
      const jetAsset = Address.parse(jettonMaster);

      const factoryResult = await runMethodSafe(
        client,
        factoryAddr,
        "get_pool",
        [
          {
            type: "slice",
            cell: beginCell()
              .storeUint(0, 32)
              .storeAddress(tonAsset)
              .storeAddress(jetAsset)
              .endCell()
              .toBoc()
              .toString("base64"),
          },
        ]
      );

      if (!factoryResult) {
        return {
          route: { dex: "dedust", poolAddress: route.poolAddress ?? "" },
          side,
          amountInNano,
          expectedOutNano: "0",
          resolvedAt: now,
          available: false,
        };
      }

      const poolAddress = factoryResult.stack.readAddress() as string;
      const poolResult = await runMethodSafe(client, poolAddress, "get_reserves");

      if (!poolResult) {
        if (route.poolAddress) markPoolDead(route.poolAddress, DEAD_POOL_TTL_MS);
        return {
          route: { dex: "dedust", poolAddress: route.poolAddress ?? poolAddress },
          side,
          amountInNano,
          expectedOutNano: "0",
          resolvedAt: now,
          available: false,
        };
      }

      const reserveIn = BigInt(poolResult.stack.readBigNumber());
      const reserveOut = BigInt(poolResult.stack.readBigNumber());

      if (reserveIn <= 0n || reserveOut <= 0n) {
        if (route.poolAddress) markPoolDead(route.poolAddress, DEAD_POOL_TTL_MS);
        return {
          route: { dex: "dedust", poolAddress: route.poolAddress ?? poolAddress },
          side,
          amountInNano,
          expectedOutNano: "0",
          resolvedAt: now,
          available: false,
        };
      }

      const amountIn = BigInt(amountInNano);
      let expectedOutNano: string;
      if (side === "buy") {
        const numerator = reserveOut * amountIn * 997n;
        const denominator = reserveIn * 1000n + amountIn * 997n;
        expectedOutNano = denominator > 0n ? (numerator / denominator).toString() : "0";
      } else {
        const numerator = reserveIn * amountIn * 997n;
        const denominator = reserveOut * 1000n + amountIn * 997n;
        expectedOutNano = denominator > 0n ? (numerator / denominator).toString() : "0";
      }

      const avail = BigInt(expectedOutNano) > 0n;
      return {
        route: { dex: "dedust", poolAddress },
        side,
        amountInNano,
        expectedOutNano,
        resolvedAt: now,
        available: avail,
      };
    }

    return null;
  } catch (e: any) {
    if (route.dex === "stonfi" && route.poolAddress) {
      markPoolDead(route.poolAddress, DEAD_POOL_TTL_MS);
    }
    return null;
  }
}

// ── executeSwap ────────────────────────────────────────────────────

export async function executeSwap(
  client: any,
  p: SwapRequest,
  tier: "low" | "mid" | "high",
  dex: Dex = "stonfi",
  network = "mainnet",
  wallet?: { address: string; getBalance?: () => Promise<bigint> }
): Promise<SwapResult> {
  try {
    const effectiveDex: Dex = isTestnet(network) && dex === "dedust" ? "stonfi" : dex;

    const poolMinimumCheck = await checkPoolMinimum(client, p, effectiveDex, network);
    if (!poolMinimumCheck.ok) {
      return { ok: false, dex: effectiveDex, error: poolMinimumCheck.reason };
    }

    if (!wallet) {
      return { ok: false, dex: effectiveDex, error: "executeSwap requires a wallet with address and optional getBalance" };
    }

    if (p.side === "buy") {
      const r = effectiveDex === "dedust"
        ? await dedustBuy(client, wallet, { sec: Buffer.alloc(32) }, p, tier, network)
        : await stonfiBuy(client, wallet, { sec: Buffer.alloc(32) }, p, tier, network);
      return r;
    } else {
      const r = effectiveDex === "dedust"
        ? await dedustSell(client, wallet, { sec: Buffer.alloc(32) }, p, tier, network)
        : await stonfiSell(client, wallet, { sec: Buffer.alloc(32) }, p, tier, network);
      return r;
    }
  } catch (e: any) {
    return { ok: false, dex, error: e.message };
  }
}
