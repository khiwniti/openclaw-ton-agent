import { Address } from "@ton/ton"
import { toNano } from "@ton/ton"

export type KeyPair = { pub: Buffer; sec: Buffer }

export async function loadKeyPair(): Promise<KeyPair> {
  const mnemonic = process.env.WALLET_MASTER_MNEMONIC || process.env.WALLET_MNEMONIC || ""
  if (!mnemonic) throw new Error("missing wallet mnemonic")
  const { mnemonicToPrivateKey } = await import("@ton/crypto")
  const key = await mnemonicToPrivateKey(mnemonic.split(" "))
  return { pub: key.publicKey, sec: key.secretKey }
}

export async function loadKeyPairForTier(_tier: string): Promise<KeyPair> {
  return loadKeyPair()
}

export function openWallet(_client: { runMethod: (addr: Address, method: string) => Promise<any> }, _kp: KeyPair) {
  return {
    address: Address.parse(process.env.WALLET_ADDRESS || "EQ-placeholder-wallet"),
    getBalance: async () => "0n",
  }
}

export function makeClient() {
  return {
    runMethod: async (_addr: Address, _method: string) => ({
      stack: {
        readBigNumber: () => 0n,
        readBoolean: () => false,
        readAddressOpt: () => null,
        readCellOpt: () => null,
      },
    }),
  }
}
