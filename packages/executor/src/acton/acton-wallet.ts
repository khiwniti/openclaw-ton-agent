import type { OrderRequest } from "@openclaw-ton-agent/shared";
import type { WalletAdapter } from "../wallet.js";
import type { ActonCommandOptions } from "./index.js";
import { Address, beginCell, toNano, TonClient, WalletContractV5R1, SendMode, internal } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";

export interface ActonWalletOptions extends ActonCommandOptions {
  mode: "auto";
  gatesG1G3Ack: boolean;
  network: "mainnet" | "testnet";
  balanceTon?: number;
  mnemonic?: string;
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
const STONFI_PTON_TESTNET = "EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez";

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

    const payload = this.toSwapPayload(order);

    try {
      let balanceTon = this.opts.balanceTon;
      if (balanceTon === undefined) {
        const mnemonic = this.opts.mnemonic ?? process.env.WALLET_MASTER_MNEMONIC;
        if (mnemonic) {
          try {
            const key = await mnemonicToPrivateKey(mnemonic.split(" "));
            const walletId = this.opts.network === "testnet" ? { networkGlobalId: -3 } : undefined;
            const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: key.publicKey, walletId });
            
            // Try TonAPI first
            const tonapiKey = process.env.TONAPI_KEY;
            const tonapiBase = (process.env.TONAPI_BASE || (this.opts.network === "testnet" ? "https://testnet.tonapi.io/v2" : "https://tonapi.io/v2")).replace(/\/+$/, "");
            try {
              const res = (await fetch(`${tonapiBase}/accounts/${wallet.address.toRawString()}`, {
                headers: tonapiKey ? { Authorization: `Bearer ${tonapiKey}` } : {},
                signal: AbortSignal.timeout(4000),
              }).then((r) => r.json())) as { balance?: string | number };
              if (res?.balance !== undefined) {
                balanceTon = Number(res.balance) / 1e9;
              }
            } catch {
              // fallback to TonClient
            }

            // If TonAPI was unavailable or 0, query on-chain via TonClient
            if (!balanceTon || balanceTon <= 0) {
              const endpoint = this.opts.network === "mainnet"
                ? "https://toncenter.com/api/v2/jsonRPC"
                : "https://testnet.toncenter.com/api/v2/jsonRPC";
              const toncenterApiKey = process.env.TONCENTER_API_KEY || process.env.TON_API_KEY;
              const client = new TonClient({ endpoint, apiKey: toncenterApiKey });
              const contract = client.open(wallet);
              const bal = await contract.getBalance().catch(() => 0n);
              balanceTon = Number(bal) / 1e9;
            }
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
      const workchain = 0;
      const walletId = this.opts.network === "testnet" ? { networkGlobalId: -3 } : undefined;
      const wallet = WalletContractV5R1.create({ workchain, publicKey: key.publicKey, walletId });
      const contract = client.open(wallet);
      const startSeqno = await contract.getSeqno().catch(() => 0);
      const stateInit = startSeqno === 0 ? wallet.init : undefined;

      const routerAddrStr = this.opts.routerAddress || (this.opts.network === "testnet" ? STONFI_ROUTER_TESTNET : STONFI_ROUTER_MAINNET);
      const pTonMinterStr = this.opts.network === "testnet" ? STONFI_PTON_TESTNET : STONFI_PTON_MAINNET;
      const routerAddr = Address.parse(this.safeAddress(routerAddrStr));
      const pTonMinterAddr = Address.parse(this.safeAddress(pTonMinterStr));
      const jettonMasterAddr = Address.parse(this.safeAddress(payload.jettonMaster));
      const swapAmountNano = BigInt(Math.floor(payload.amountTon * 1e9));
      const minOutNano = BigInt(payload.minOutTokenQty);

      let targetAddr: Address;
      let msgValue: bigint;
      let body;

      if (payload.side === "buy") {
        // Resolve router pTON wallet (the destination for native TON swaps on Ston.fi)
        let routerPtonWallet: Address;
        try {
          const ptonRes = await client.runMethod(pTonMinterAddr, "get_wallet_address", [
            { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }
          ]);
          routerPtonWallet = ptonRes.stack.readAddress();
        } catch {
          routerPtonWallet = Address.parse("EQARULUYsmJq1RiZ-YiH-IJLcAZUVkVff-KBPwEmmaQGH6aC");
        }

        // Resolve router Jetton wallet for target token
        let routerJettonWallet: Address;
        try {
          const rRes = await client.runMethod(jettonMasterAddr, "get_wallet_address", [
            { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }
          ]);
          routerJettonWallet = rRes.stack.readAddress();
        } catch {
          routerJettonWallet = jettonMasterAddr;
        }

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
          .storeCoins(toNano("0.185")) // forward_ton_amount for router execution gas
          .storeBit(1)
          .storeRef(forwardPayload)
          .endCell();
        // Verify STON.fi pool exists and is active on-chain before broadcasting
        let isPoolActive = false;
        try {
          const poolRes = await client.runMethod(routerAddr, "get_pool_address", [
            { type: "slice", cell: beginCell().storeAddress(routerPtonWallet).endCell() },
            { type: "slice", cell: beginCell().storeAddress(routerJettonWallet).endCell() }
          ]);
          const poolAddr = poolRes.stack.readAddress();
          if (poolAddr && poolAddr.toString() !== "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c") {
            const poolState = await client.getContractState(poolAddr);
            isPoolActive = poolState.state === "active";
          }
        } catch {
          isPoolActive = false;
        }

        if (!isPoolActive && this.opts.network === "mainnet") {
          return { ok: false, error: `No active STON.fi pool found for token ${payload.jettonMaster}` };
        }

        targetAddr = routerPtonWallet;
        msgValue = swapAmountNano + toNano("0.24");
      } else {
        // Resolve user jetton wallet
        let userJettonWallet: Address;
        try {
          const jRes = await client.runMethod(jettonMasterAddr, "get_wallet_address", [
            { type: "slice", cell: beginCell().storeAddress(wallet.address).endCell() }
          ]);
          userJettonWallet = jRes.stack.readAddress();
        } catch {
          userJettonWallet = jettonMasterAddr;
        }

        // Resolve router pTON wallet
        let routerPtonWallet: Address;
        try {
          const pRes = await client.runMethod(pTonMinterAddr, "get_wallet_address", [
            { type: "slice", cell: beginCell().storeAddress(routerAddr).endCell() }
          ]);
          routerPtonWallet = pRes.stack.readAddress();
        } catch {
          routerPtonWallet = pTonMinterAddr;
        }

        const forwardPayload = beginCell()
          .storeUint(0x25938561, 32) // Ston.fi V1 SWAP opcode
          .storeAddress(routerPtonWallet)
          .storeCoins(minOutNano)
          .storeAddress(wallet.address)
          .storeUint(0, 1)
          .endCell();

        body = beginCell()
          .storeUint(0x0f8a7ea5, 32)
          .storeUint(Date.now(), 64)
          .storeCoins(BigInt(payload.jettonAmountNano ?? "0"))
          .storeAddress(routerAddr)
          .storeAddress(wallet.address)
          .storeBit(0)
          .storeCoins(toNano("0.185"))
          .storeBit(1)
          .storeRef(forwardPayload)
          .endCell();

        targetAddr = userJettonWallet;
        msgValue = toNano("0.25");
      }

      const swapMsg = internal({
        to: targetAddr,
        value: msgValue,
        body,
      });

      const transfer = contract.createTransfer({
        seqno: startSeqno,
        secretKey: key.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
        messages: [swapMsg],
        ...(stateInit ? { stateInit } : {}),
      });
      let sent = false;
      let lastErr: unknown;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 1000 * attempt));
          }
          await client.sendExternalMessage(wallet, transfer);
          sent = true;
          break;
        } catch (e: unknown) {
          lastErr = e;
        }
      }

      if (!sent) {
        throw lastErr ?? new Error("broadcast failed after retries");
      }

      // Sequential lock wait: poll until on-chain seqno increments
      const pollStart = Date.now();
      const timeoutMs = 45_000;
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
