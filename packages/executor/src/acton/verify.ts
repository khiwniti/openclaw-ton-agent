/** Post-broadcast verification helpers — fail-closed balance-delta proofs. */

import { beginCell } from "@ton/ton";

export function computeDeliveredIncrement(args: {
  balanceBefore: bigint | null;
  balanceAfter: bigint | null;
}): bigint | null {
  if (args.balanceAfter === null) return null;
  if (args.balanceBefore === null) return args.balanceAfter;
  return args.balanceAfter - args.balanceBefore;
}

export async function readUserJettonBalance(
  client: { runMethod: (...args: unknown[]) => Promise<unknown> },
  master: string,
  userWallet: string
): Promise<bigint | null> {
  try {
    const { stack } = (await client.runMethod(
      master,
      "get_wallet_address",
      [
        {
          type: "slice",
          cell: beginCell().storeAddress(userWallet as any).endCell().toBoc().toString("base64"),
        },
      ]
    )) as { stack: { readAddress: () => unknown } };

    const jettonWallet = stack.readAddress() as string;

    const data = (await client.runMethod(jettonWallet, "get_wallet_data")) as {
      stack: { readBigNumber: () => bigint };
    };
    return data.stack.readBigNumber();
  } catch (e: unknown) {
    return null;
  }
}

export function verifySellDelta(args: {
  balanceBefore: bigint;
  balanceAfter: bigint;
  soldNano: bigint;
}): { ok: boolean; error: string } {
  const { balanceBefore, balanceAfter, soldNano } = args;
  if (balanceBefore <= 0n) {
    return { ok: true, error: "" };
  }
  const spent = balanceBefore - balanceAfter;
  if (spent <= 0n) {
    return {
      ok: false,
      error: "sell BOUNCED: jetton balance did not decrease after broadcast",
    };
  }
  const movedEnough = spent >= (soldNano * 99n) / 100n;
  if (!movedEnough) {
    return {
      ok: false,
      error: `sell PARTIAL/BOUNCED: only ${spent} of ${soldNano} jetton left the wallet`,
    };
  }
  return { ok: true, error: "" };
}

/**
 * Post-broadcast BUY verification: poll the jetton balance and use the
 * delivered INCREMENT (after − before) as the truth. Never trust the pool
 * estimate — on thin memepad curves the estimate can be orders of magnitude
 * higher than what actually lands (prod example: estimate 437T, actual ~19.9M).
 */
export async function verifyBuyDelivered(args: {
  client: { runMethod: (...args: unknown[]) => Promise<unknown> };
  master: string;
  walletAddress: string;
  expectedNano: bigint;
  balanceBefore: bigint | null;
  attempts?: number;
  delayMs?: number;
}): Promise<{ ok: boolean; error: string; actualBalance: bigint | null }> {
  const masterAddr = args.master;
  const ATTEMPTS = args.attempts ?? 5;
  const DELAY_MS = args.delayMs ?? 1500;

  let actual: bigint | null = null;
  for (let i = 0; i < ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    actual = await readUserJettonBalance(args.client, masterAddr, args.walletAddress);
    const gained = computeDeliveredIncrement({
      balanceBefore: args.balanceBefore,
      balanceAfter: actual,
    });
    if (gained !== null && gained > 0n) break;
  }

  if (actual === null) {
    return {
      ok: false,
      error: "buy unverifiable: could not read post-buy jetton balance — refusing to trust the estimate",
      actualBalance: null,
    };
  }

  const gained = computeDeliveredIncrement({
    balanceBefore: args.balanceBefore,
    balanceAfter: actual,
  });

  if (gained === null || gained <= 0n) {
    return {
      ok: false,
      error: `buy BOUNCED: no new jettons delivered (before=${args.balanceBefore ?? "unread"} after=${actual}, expected ~${args.expectedNano}) — swap child tx did not deliver`,
      actualBalance: gained,
    };
  }

  return { ok: true, error: "", actualBalance: gained };
}

/**
 * Post-broadcast SELL verification: ensures the jettons actually left the
 * wallet by measuring the pre/post balance delta.
 */
export async function verifySellExecuted(args: {
  client: { runMethod: (...args: unknown[]) => Promise<unknown> };
  master: string;
  walletAddress: string;
  soldNano: bigint;
  balanceBefore: bigint | null;
  attempts?: number;
  delayMs?: number;
}): Promise<{
  ok: boolean;
  error: string;
  balanceBefore: bigint | null;
  balanceAfter: bigint | null;
}> {
  if (args.balanceBefore === null) {
    return {
      ok: false,
      error: "sell unverifiable: could not read pre-transfer jetton balance — not booking as executed",
      balanceBefore: null,
      balanceAfter: null,
    };
  }

  const ATTEMPTS = args.attempts ?? 5;
  const DELAY_MS = args.delayMs ?? 1500;
  let after: bigint | null = null;
  for (let i = 0; i < ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    after = await readUserJettonBalance(args.client, args.master, args.walletAddress);
    if (after !== null) break;
  }

  if (after === null) {
    return {
      ok: false,
      error: "sell unverifiable: post-transfer jetton balance read failed — not booking as executed",
      balanceBefore: args.balanceBefore,
      balanceAfter: null,
    };
  }

  const verdict = verifySellDelta({
    balanceBefore: args.balanceBefore,
    balanceAfter: after,
    soldNano: args.soldNano,
  });

  return {
    ok: verdict.ok,
    error: verdict.error,
    balanceBefore: args.balanceBefore,
    balanceAfter: after,
  };
}
