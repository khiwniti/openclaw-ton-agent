import type { OrderRequest } from "@openclaw-ton-agent/shared";
import { createLogger } from "@openclaw-ton-agent/shared";
import type { WalletAdapter } from "../wallet.js";
import type { ActonCommandOptions } from "./index.js";
import { Address, beginCell, toNano, TonClient, WalletContractV4, WalletContractV5R1, SendMode, internal } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";

export interface ActonWalletOptions extends ActonCommandOptions {
  mode: "auto";
  gatesG1G3Ack: boolean;
  network: "mainnet" | "testnet";
  balanceTon?: number;
  mnemonic?: string;
  /** Minimum order size in TON; aligns with executor default */
  minOrderTon?: number;
  /** Acton project root (maps to ActonCommandOptions.cwd). */
  projectPath?: string;
  /** Optional deployed contract address override. */
  contractAddress?: string;
  /** Optional router address override. */
  routerAddress?: string;
}

export type FillStatus = "filled" | "bounced" | "pending_reconcile";

export interface FillResult {
  status: FillStatus;
  txHash: string | null;
  filledAmountTon: number;
  filledTokenQty: number;
  minOutTokenQty: number;
  slippageBps: number;
  mode: "paper" | "auto";
  reason?: string;
}

export interface SwapPayload {
  side: "buy" | "sell";
  jettonMaster: string;
  amountTon: number;
  jettonAmountNano?: string;
  minOutTokenQty: string;
  slippageBps: number;
  dex: "stonfi" | "dedust";
  decimals: number;
}
const STONFI_ROUTER_MAINNET = "EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt";
const STONFI_ROUTER_TESTNET = "kQBsGx9ArADUrREB34W-ghgsCgBShvfUr4Jvlu-0KGc33a1n";
const STONFI_PTON_MAINNET = "EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez";
const STONFI_PTON_TESTNET = "EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez"; // pTON V1 — same address on both networks per ston-fi/sdk

class WalletMutex {
  private promise: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void;
    const nextPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentPromise = this.promise;
    this.promise = nextPromise;
    await currentPromise;
    return release!;
  }
}

const walletLock = new WalletMutex();

export class ActonWallet implements WalletAdapter {
  readonly name = "acton";

  constructor(private readonly opts: ActonWalletOptions) {
    if (opts.mode !== "auto") {
      throw new Error("ActonWallet: live execution requires EXECUTION_MODE=auto");
    }
    if (!opts.gatesG1G3Ack) {
      throw new Error("ActonWallet: G1–G3 gate progression not acknowledged (GATES_G1_G3_ACK=1 required before live money)");
    }
  }

  async swap(order: OrderRequest): Promise<FillResult> {
    if (order.mode !== "auto") {
      return this.bounced(order, "ActonWallet: order was built in a non-auto mode — refusing to execute");
    }
    if (order.confirmRequired) {
      return this.bounced(order, "ActonWallet: order requires operator confirmation (confirm-first) — surface to trader-ui");
    }
    const minOrderTon = this.opts.minOrderTon ?? 0.20;
    if (order.amountTon < minOrderTon) {
      return this.bounced(order, `ActonWallet: order amount ${order.amountTon.toFixed(4)} TON below minimum ${minOrderTon} TON`);
    }

    const payload = this.toSwapPayload(order);

    try {
      let balanceTon = this.opts.balanceTon;
      if (balanceTon === undefined) {
        const mnemonic = this.opts.mnemonic ?? process.env.WALLET_MASTER_MNEMONIC;
        if (mnemonic) {
          try {
            const key = await mnemonicToPrivateKey(mnemonic.split(" "));
            const toncenterApiKey = process.env.TONCENTER_API_KEY || process.env.TON_API_KEY;
            const endpoint = this.opts.network === "mainnet"
              ? "https://toncenter.com/api/v2/jsonRPC"
              : "https://testnet.toncenter.com/api/v2/jsonRPC";
            const client = new TonClient({ endpoint, apiKey: toncenterApiKey });
            const wallet = await this.resolveWallet(client, key.publicKey);
            const contract = client.open(wallet);
            const bal = await contract.getBalance().catch(() => 0n);
            balanceTon = Number(bal) / 1e9;
          } catch {
            balanceTon = 0;
          }
        } else {
          balanceTon = 0;
        }
      }

      if (!Number.isFinite(balanceTon) || balanceTon <= 0) {
        return this.bounced(order, `[buy] balance unavailable or empty: have=${(Number.isFinite(balanceTon) ? balanceTon : 0).toFixed(3)} TON`);
      }

      if (payload.side === "buy" && (order.expectedTokenQty ?? 0) < (order.minOutTokenQty ?? 0)) {
        return this.bounced(order, "ActonWallet: quoted output below minOut after slippage");
      }

      const directRes = await this.sendSwapDirect(payload);
      if (!directRes.ok) {
        return this.bounced(order, `broadcast failed: ${directRes.error ?? "unknown"}`);
      }

      return {
        status: "pending_reconcile",
        txHash: directRes.txHash ?? null,
        filledAmountTon: payload.amountTon,
        filledTokenQty: order.expectedTokenQty ?? 0,
        minOutTokenQty: order.minOutTokenQty,
        slippageBps: payload.slippageBps,
        mode: "auto",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.bounced(order, `ActonWallet runtime exception: ${msg}`);
    }
  }

  private toSwapPayload(order: OrderRequest): SwapPayload {
    const decimals = order.token.decimals ?? 9;
    const toNanoAmount = (human: number) => BigInt(Math.floor(human * 10 ** decimals));

    return {
      side: order.side,
      jettonMaster: order.token.address,
      amountTon: order.amountTon,
      jettonAmountNano: toNanoAmount(order.expectedTokenQty).toString(),
      minOutTokenQty: toNanoAmount(order.minOutTokenQty).toString(),
      slippageBps: order.slippageBps,
      dex: "stonfi",
      decimals,
    };
  }

  private safeAddress(addr: string): string {
    try {
      return Address.parse(addr).toString();
    } catch {
      return "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
    }
  }
  private async resolveWallet(client: TonClient, publicKey: Buffer) {
    const preferredVersion = (process.env.WALLET_VERSION || "").toLowerCase();
    const walletId = this.opts.network === "testnet" ? { networkGlobalId: -3 } : undefined;
    const w5 = WalletContractV5R1.create({ workchain: 0, publicKey, walletId });
    const w4 = WalletContractV4.create({ workchain: 0, publicKey });

    if (preferredVersion === "v4" || preferredVersion === "v4r2") {
      return w4;
    }
    if (preferredVersion === "v5" || preferredVersion === "v5r1") {
      return w5;
    }

    try {
      const c4 = client.open(w4);
      const b4 = await c4.getBalance().catch(() => 0n);
      if (b4 > 0n) return w4;
    } catch {}

    try {
      const c5 = client.open(w5);
      const b5 = await c5.getBalance().catch(() => 0n);
      if (b5 > 0n) return w5;
    } catch {}

    return w4;
  }


  private async sendSwapDirect(payload: SwapPayload): Promise<{ ok: boolean; txHash?: string; error?: string }> {
    const mnemonic = this.opts.mnemonic ?? process.env.WALLET_MASTER_MNEMONIC;
    if (!mnemonic) {
      return { ok: false, error: "WALLET_MASTER_MNEMONIC is required for broadcast" };
    }

    const release = await walletLock.acquire();
    try {
      const endpoint = this.opts.network === "mainnet"
        ? "https://toncenter.com/api/v2/jsonRPC"
        : "https://testnet.toncenter.com/api/v2/jsonRPC";

      const toncenterApiKey = process.env.TONCENTER_API_KEY || process.env.TON_API_KEY;
      const client = new TonClient({ endpoint, apiKey: toncenterApiKey });
      const key = await mnemonicToPrivateKey(mnemonic.split(" "));
      const wallet = await this.resolveWallet(client, key.publicKey);
      const contract = client.open(wallet);
      const startSeqno = await contract.getSeqno().catch(() => 0);
      const log = createLogger("acton-wallet");
      log.info("wallet resolved", { address: wallet.address.toString(), seqno: startSeqno });
      const stateInit = startSeqno === 0 ? wallet.init : undefined;

      const routerAddrStr = this.opts.routerAddress || (this.opts.network === "testnet" ? STONFI_ROUTER_TESTNET : STONFI_ROUTER_MAINNET);
      const pTonMinterStr = this.opts.network === "testnet" ? STONFI_PTON_TESTNET : STONFI_PTON_MAINNET;
      const routerAddr = Address.parse(this.safeAddress(routerAddrStr));
      const pTonMinterAddr = Address.parse(this.safeAddress(pTonMinterStr));
      const jettonMasterAddr = Address.parse(this.safeAddress(payload.jettonMaster));
      const swapAmountNano = BigInt(Math.floor(payload.amountTon * 1e9));
      const minOutNano = BigInt(payload.minOutTokenQty);

      if (payload.side === "buy") {
        const currentBalNano = await contract.getBalance().catch(() => 0n);
        const requiredNano = swapAmountNano + toNano("0.20");
        if (currentBalNano < requiredNano) {
          return {
            ok: false,
            error: `insufficient on-chain balance: have ${(Number(currentBalNano) / 1e9).toFixed(3)} TON, need ${(Number(requiredNano) / 1e9).toFixed(3)} TON`,
          };
        }
      }

      // Determine active DEX: STON.fi vs DeDust
      let routerPtonWallet: Address;
      try {
        const ptonRes = await client.runMethod(pTonMinterAddr, "get_wallet_address", [
          { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }
        ]);
        routerPtonWallet = ptonRes.stack.readAddress();
      } catch {
        routerPtonWallet = Address.parse("EQARULUYsmJq1RiZ-YiH-IJLcAZUVkVff-KBPwEmmaQGH6aC");
      }

      let routerJettonWallet: Address;
      try {
        const rRes = await client.runMethod(jettonMasterAddr, "get_wallet_address", [
          { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }
        ]);
        routerJettonWallet = rRes.stack.readAddress();
      } catch {
        routerJettonWallet = jettonMasterAddr;
      }

      let isStonfiActive = false;
      try {
        const poolRes = await client.runMethod(routerAddr, "get_pool_address", [
          { type: "slice", cell: beginCell().storeAddress(routerPtonWallet).endCell() },
          { type: "slice", cell: beginCell().storeAddress(routerJettonWallet).endCell() }
        ]);
        const poolAddr = poolRes.stack.readAddress();
        if (poolAddr && poolAddr.toString() !== "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c") {
          const poolState = await client.getContractState(poolAddr);
          isStonfiActive = poolState.state === "active";
        }
      } catch {
        isStonfiActive = false;
      }

      // Check DeDust pool if STON.fi is not active
      let isDedustActive = false;
      let dedustPoolAddrStr: string | null = null;
      if (!isStonfiActive && this.opts.network === "mainnet") {
        try {
          const dedustFactory = Address.parse("EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67");
          const tonAsset = Address.parse("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c");
          const poolRes = await client.runMethod(dedustFactory, "get_pool", [
            {
              type: "slice",
              cell: beginCell().storeUint(0, 32).storeAddress(tonAsset).storeAddress(jettonMasterAddr).endCell()
            }
          ]);
          const dPoolAddr = poolRes.stack.readAddress();
          if (dPoolAddr && dPoolAddr.toString() !== "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c") {
            const dPoolState = await client.getContractState(dPoolAddr);
            if (dPoolState.state === "active") {
              isDedustActive = true;
              dedustPoolAddrStr = dPoolAddr.toString();
            }
          }
        } catch {
          isDedustActive = false;
        }
      }

      if (!isStonfiActive && !isDedustActive && this.opts.network === "mainnet") {
        return { ok: false, error: `No active STON.fi or DeDust pool found for token ${payload.jettonMaster}` };
      }

      let targetAddr: Address;
      let msgValue: bigint;
      let body;

      if (isDedustActive && dedustPoolAddrStr) {
        // DeDust execution path
        const dedustPool = Address.parse(dedustPoolAddrStr);
        if (payload.side === "buy") {
          targetAddr = dedustPool;
          msgValue = swapAmountNano + toNano("0.25");
          body = beginCell()
            .storeUint(0xea06185d, 32) // DeDust native swap opcode
            .storeUint(BigInt(Date.now()), 64)
            .storeCoins(swapAmountNano)
            .storeAddress(dedustPool)
            .storeUint(0, 1)
            .storeCoins(minOutNano)
            .storeMaybeRef(null)
            .storeRef(
              beginCell()
                .storeUint(0, 32)
                .storeAddress(wallet.address)
                .storeAddress(null)
                .storeMaybeRef(null)
                .storeMaybeRef(null)
                .endCell()
            )
            .endCell();
        } else {
          // DeDust sell path
          let userJettonWallet: Address;
          try {
            const jRes = await client.runMethod(jettonMasterAddr, "get_wallet_address", [
              { type: "slice", cell: beginCell().storeAddress(wallet.address).endCell() }
            ]);
            userJettonWallet = jRes.stack.readAddress();
          } catch {
            userJettonWallet = jettonMasterAddr;
          }

          let actualJettonBalanceNano = 0n;
          try {
            const balRes = await client.runMethod(userJettonWallet, "get_wallet_data");
            actualJettonBalanceNano = balRes.stack.readBigNumber();
          } catch {}

          if (actualJettonBalanceNano <= 0n) {
            return { ok: false, error: "No on-chain jetton balance available to sell" };
          }

          const requestedNano = BigInt(payload.jettonAmountNano ?? "0");
          const sellAmountNano = requestedNano > 0n && requestedNano < actualJettonBalanceNano
            ? requestedNano
            : actualJettonBalanceNano;

          const forwardPayload = beginCell()
            .storeUint(0xe3a0d482, 32) // DeDust jetton swap opcode
            .storeAddress(dedustPool)
            .storeCoins(minOutNano)
            .storeMaybeRef(beginCell().storeAddress(wallet.address).endCell())
            .endCell();

          body = beginCell()
            .storeUint(0x0f8a7ea5, 32) // standard jetton transfer opcode
            .storeUint(Date.now(), 64)
            .storeCoins(sellAmountNano)
            .storeAddress(dedustPool)
            .storeAddress(wallet.address)
            .storeBit(0)
            .storeCoins(toNano("0.25"))
            .storeBit(1)
            .storeRef(forwardPayload)
            .endCell();

          targetAddr = userJettonWallet;
          msgValue = toNano("0.35");
        }
      } else {
        // STON.fi execution path
        if (payload.side === "buy") {
          const forwardPayload = beginCell()
            .storeUint(0x25938561, 32) // Ston.fi V1 SWAP opcode
            .storeAddress(routerJettonWallet)
            .storeCoins(minOutNano)
            .storeAddress(wallet.address)
            .storeUint(0, 1) // no referral
            .endCell();

          body = beginCell()
            .storeUint(0x0f8a7ea5, 32) // jetton transfer opcode
            .storeUint(Date.now(), 64)
            .storeCoins(swapAmountNano)
            .storeAddress(routerAddr)
            .storeAddress(wallet.address)
            .storeBit(0)
            .storeCoins(toNano("0.12")) // forward_ton_amount for router execution gas
            .storeBit(1)
            .storeRef(forwardPayload)
            .endCell();

          targetAddr = routerPtonWallet;
          msgValue = swapAmountNano + toNano("0.16");
        } else {
          // STON.fi sell path
          let userJettonWallet: Address;
          try {
            const jRes = await client.runMethod(jettonMasterAddr, "get_wallet_address", [
              { type: "slice", cell: beginCell().storeAddress(wallet.address).endCell() }
            ]);
            userJettonWallet = jRes.stack.readAddress();
          } catch {
            userJettonWallet = jettonMasterAddr;
          }

          let actualJettonBalanceNano = 0n;
          try {
            const balRes = await client.runMethod(userJettonWallet, "get_wallet_data");
            actualJettonBalanceNano = balRes.stack.readBigNumber();
          } catch {}

          if (actualJettonBalanceNano <= 0n) {
            return { ok: false, error: "No on-chain jetton balance available to sell" };
          }

          const requestedNano = BigInt(payload.jettonAmountNano ?? "0");
          const sellAmountNano = requestedNano > 0n && requestedNano < actualJettonBalanceNano
            ? requestedNano
            : actualJettonBalanceNano;

          let ptonWalletForSell: Address;
          try {
            const pRes = await client.runMethod(pTonMinterAddr, "get_wallet_address", [
              { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }
            ]);
            ptonWalletForSell = pRes.stack.readAddress();
          } catch {
            ptonWalletForSell = pTonMinterAddr;
          }

          const forwardPayload = beginCell()
            .storeUint(0x25938561, 32) // Ston.fi V1 SWAP opcode
            .storeAddress(ptonWalletForSell)
            .storeCoins(minOutNano)
            .storeAddress(wallet.address)
            .storeUint(0, 1)
            .endCell();

          body = beginCell()
            .storeUint(0x0f8a7ea5, 32)
            .storeUint(Date.now(), 64)
            .storeCoins(sellAmountNano)
            .storeAddress(routerAddr)
            .storeAddress(wallet.address)
            .storeBit(0)
            .storeCoins(toNano("0.14"))
            .storeBit(1)
            .storeRef(forwardPayload)
            .endCell();

          targetAddr = userJettonWallet;
          msgValue = toNano("0.20");
        }
      }

      const swapMsg = internal({
        to: targetAddr,
        value: msgValue,
        body,
      });

      let sent = false;
      let lastErr: unknown;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 1000 * attempt));
          }
          await contract.sendTransfer({
            seqno: startSeqno,
            secretKey: key.secretKey,
            sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
            messages: [swapMsg],
            ...(stateInit ? { stateInit } : {}),
          });
          sent = true;
          break;
        } catch (e: unknown) {
          lastErr = e;
        }
      }
      if (!sent) {
        throw lastErr ?? new Error("broadcast failed after retries");
      }

      // Sequential lock wait: poll until on-chain seqno increments (max 20s for fast unblocking)
      const pollStart = Date.now();
      const timeoutMs = 20_000;
      while (Date.now() - pollStart < timeoutMs) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        try {
          const currentSeq = await contract.getSeqno().catch(() => null);
          if (typeof currentSeq === "number" && currentSeq > startSeqno) {
            break;
          }
        } catch {
          // ignore transient RPC errors during seqno polling
        }
      }

      return { ok: true, txHash: `seqno-${startSeqno}-${Date.now()}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[ActonWallet] sendSwapDirect failed:`, { error: msg, side: payload.side, jetton: payload.jettonMaster });
      return { ok: false, error: msg };
    } finally {
      release();
    }
  }

  private bounced(order: OrderRequest, reason: string): FillResult {
    return {
      status: "bounced",
      txHash: null,
      filledAmountTon: 0,
      filledTokenQty: 0,
      minOutTokenQty: order.minOutTokenQty,
      slippageBps: order.slippageBps,
      mode: "auto",
      reason,
    };
  }
}
