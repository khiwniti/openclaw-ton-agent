import { Address, beginCell, toNano, TonClient, WalletContractV5R1, SendMode } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8').split('\n').reduce<Record<string,string>>((acc, line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return acc;
  const eq = trimmed.indexOf('=');
  if (eq < 0) return acc;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '');
  acc[key] = value;
  return acc;
}, {});

const mnemonic = env.WALLET_MASTER_MNEMONIC;
if (!mnemonic) {
  console.log('ERR missing WALLET_MASTER_MNEMONIC');
  process.exit(1);
}

(async () => {
  const key = await mnemonicToPrivateKey(mnemonic.split(' '));
  const workchain = 0;
  const wallet = WalletContractV5R1.create({ workchain, publicKey: key.publicKey });
  const address = Address.parse('kQCHY3p4RZMqICczvAy_M9V-B9lyv-7V4i36sS6WUouEOi7N');
  console.log('WALLET_ADDRESS', wallet.address.toString());
  console.log('TARGET_ADDRESS', address.toString());
  console.log('MATCH', wallet.address.toString() === address.toString());

  const endpoint = 'https://ton-testnet.core.chainstack.com/5a07eef51feb9d59fab58cf02fc714ff/api/v2/jsonRPC';
  const client = new TonClient({ endpoint });

  const state = await client.getAccountState(address);
  console.log('BEFORE_BALANCE', state.balance?.toString?.() ?? String(state.balance));
  console.log('BEFORE_STATE', JSON.stringify(state));

  if (state.state.type === 'active') {
    console.log('ALREADY_ACTIVE');
    process.exit(0);
  }

  const walletContract = client.open(wallet);
  const seqno = await walletContract.getSeqno().catch(() => 0n);
  const deployMessage = walletContract.createTransfer({
    seqno,
    secretKey: key.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
    messages: [
      {
        to: address,
        value: toNano('0.04'),
        stateInit: wallet.init,
        body: beginCell().endCell(),
      },
    ],
  });

  const result = await client.sendExternalMessage(wallet, deployMessage);
  console.log('DEPLOY_RESULT', JSON.stringify(result, null, 2));

  await new Promise(resolve => setTimeout(resolve, 4000));
  const after = await client.getAccountState(address);
  console.log('AFTER_STATE', JSON.stringify(after));
  console.log('AFTER_BALANCE', after.balance?.toString?.() ?? String(after.balance));
})();
