import { Address, TonClient, WalletContractV5R1 } from "@ton/ton"
import { mnemonicToPrivateKey } from "@ton/crypto"

export type KeyPair = { pub: Buffer; sec: Buffer }

export async function loadKeyPair(): Promise<KeyPair> {
  const mnemonic = process.env.WALLET_MASTER_MNEMONIC || process.env.WALLET_MNEMONIC || ""
  if (!mnemonic) throw new Error("missing wallet mnemonic — set WALLET_MASTER_MNEMONIC")
  const key = await mnemonicToPrivateKey(mnemonic.split(" "))
  return { pub: key.publicKey, sec: key.secretKey }
}

export async function loadKeyPairForTier(_tier: string): Promise<KeyPair> {
  // Future: load tier-specific HD wallets via WALLET_MNEMONIC_{TIER}
  return loadKeyPair()
}

/**
 * Open a wallet contract on the given client using the supplied key pair.
 * Returns the wallet address (derived from the public key) and a live
 * getBalance() backed by the RPC — never fabricated.
 */
export function openWallet(
  client: TonClient,
  kp: KeyPair,
  network: "mainnet" | "testnet" = "mainnet"
) {
  const walletId = network === "testnet" ? { networkGlobalId: -3 } : undefined
  const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: kp.pub, walletId })
  const contract = client.open(wallet)

  // If WALLET_ADDRESS is explicitly set, validate it matches the derived address
  const envAddr = process.env.WALLET_ADDRESS
  if (envAddr) {
    const parsed = Address.parse(envAddr)
    if (parsed.toString() !== wallet.address.toString()) {
      throw new Error(
        `WALLET_ADDRESS mismatch: env=${parsed.toString()} derived=${wallet.address.toString()}`
      )
    }
  }

  return {
    address: wallet.address,
    getBalance: () => contract.getBalance(),
    getSeqno: () => contract.getSeqno(),
  }
}

/**
 * Create a TonClient for the configured network. Uses TONCENTER_API_KEY /
 * TON_RPC_ENDPOINT to avoid hitting public rate limits in production.
 */
export function makeClient(network: "mainnet" | "testnet" = "mainnet"): TonClient {
  const rpcOverride = (process.env.TON_RPC_ENDPOINT || "").replace(/\/+$/, "")
  const defaultEndpoint =
    network === "testnet"
      ? "https://testnet.toncenter.com/api/v2/jsonRPC"
      : "https://toncenter.com/api/v2/jsonRPC"
  const endpoint = rpcOverride || defaultEndpoint
  const apiKey = process.env.TONCENTER_API_KEY || ""
  return new TonClient({ endpoint, apiKey: apiKey || undefined })
}

