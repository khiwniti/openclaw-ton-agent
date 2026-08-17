import { TonClient, WalletContractV5R1, SendMode, internal, toNano, fromNano, Address } from "@ton/ton";
import { external, storeMessage, beginCell } from "@ton/core";
import { mnemonicToPrivateKey } from "@ton/crypto";

async function main() {
  const mnemonicStr = process.env.WALLET_MASTER_MNEMONIC || process.argv[2] || "";
  const mnemonic = mnemonicStr.trim().split(/\s+/);

  if (mnemonic.length !== 24) {
    console.error("Error: 24-word mnemonic required.");
    process.exit(1);
  }

  const endpoint = process.env.TON_RPC_ENDPOINT || "https://testnet.toncenter.com/api/v2/jsonRPC";
  const client = new TonClient({ endpoint });
  const key = await mnemonicToPrivateKey(mnemonic);

  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: key.publicKey,
    walletId: { networkGlobalId: -3 },
  });

  const contract = client.open(wallet);
  const userFriendly = wallet.address.toString({ testOnly: true, bounceable: false });
  const rawAddress = wallet.address.toRawString();

  console.log("=========================================");
  console.log("TON Testnet Wallet Initialization (V5R1)");
  console.log("=========================================");
  console.log("Testnet Address :", userFriendly);
  console.log("Raw Address     :", rawAddress);

  // Fetch balance and state from TonAPI
  try {
    const res = await fetch(`https://testnet.tonapi.io/v2/accounts/${rawAddress}`).then((r) => r.json());
    const balanceTon = Number(res.balance || 0) / 1e9;
    console.log("Account Status  :", res.status || "uninit");
    console.log("Balance         :", balanceTon.toFixed(4), "TON");

    if (balanceTon <= 0) {
      console.log("\n⚠️  Balance is 0 TON. Please fund this address before initializing.");
      console.log("   Send testnet TON to:", userFriendly);
      return;
    }

    const seqno = await contract.getSeqno().catch(() => 0);
    console.log("Current Seqno   :", seqno);

    if (seqno > 0) {
      console.log("✅ Wallet contract is ALREADY deployed and initialized! (Seqno:", seqno, ")");
      return;
    }

    console.log("\n🚀 Initializing & deploying WalletContractV5R1 on testnet...");

    const transfer = contract.createTransfer({
      seqno: 0,
      secretKey: key.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
      messages: [
        internal({
          to: wallet.address,
          value: toNano("0.01"),
          body: "init wallet",
          bounce: false,
        }),
      ],
    });

    const extMsg = external({
      to: wallet.address,
      init: wallet.init,
      body: transfer,
    });

    const extCell = beginCell().store(storeMessage(extMsg)).endCell();
    const bocBase64 = extCell.toBoc().toString("base64");
    console.log("Broadcasting initialization message with stateInit via TonAPI testnet...");
    const broadcastRes = await fetch("https://testnet.tonapi.io/v2/blockchain/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boc: bocBase64 }),
    });

    if (broadcastRes.ok) {
      console.log("✅ Broadcasted via TonAPI successfully!");
    } else {
      const errText = await broadcastRes.text();
      console.log("TonAPI broadcast result:", errText);
    }

    console.log("Waiting for block confirmation...");

    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const acc = await fetch(`https://testnet.tonapi.io/v2/accounts/${rawAddress}`).then((r) => r.json());
      if (acc.status === "active") {
        console.log(`\n🎉 Wallet is ACTIVE on-chain!`);
        return;
      }
      process.stdout.write(".");
    }
    console.log("\n⏳ Broadcast sent. Transaction is finalizing in the mempool.");
  } catch (err) {
    console.error("Initialization check failed:", err);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
