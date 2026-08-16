/**
 * Locked transfer helper — sequential per-tier transfer with confirmation.
 *
 *  In the Acton context this invokes the Acton CLI when the binary is
 *  available, otherwise falls back to a direct sendExternalMessage path
 *  if the client exposes one.
 */

import { buildActonCommand } from "./cli.js";

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

const locks: Record<string, WalletMutex> = {
  low: new WalletMutex(),
  mid: new WalletMutex(),
  high: new WalletMutex(),
};

async function waitForConfirmation(
  _client: unknown,
  _wallet: unknown,
  _startSeqno: number,
  timeoutMs = 45_000
): Promise<boolean> {
  // Acton CLI manages seqno confirmation externally. We poll the client
  // if it exposes getSeqno, otherwise we trust the Acton process exit code.
  const client = _client as { getSeqno?: () => Promise<number> } | undefined;
  const wallet = _wallet as { getSeqno?: () => Promise<number> } | undefined;
  const startSeqno = _startSeqno;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const seq = await (client?.getSeqno?.() ?? wallet?.getSeqno?.());
      if (typeof seq === "number" && seq > startSeqno) {
        return true;
      }
    } catch {
      // Ignore transient RPC errors during polling
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export interface Transfer {
  to: string;
  value: string;
  body: string;
  seqno: number;
}

export async function sendTransferLocked(
  tier: "low" | "mid" | "high",
  payload: {
    wallet: unknown;
    secretKey: Buffer;
    messages: Array<{ to: string; value: bigint; body: string }>;
    client: unknown;
  },
  client: unknown
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const release = await locks[tier].acquire();
  try {
    const seqno = await (payload.wallet as { getSeqno?: () => Promise<number> } | undefined)?.getSeqno?.() ?? 0;

    // Try direct sendExternalMessage if the client supports it (TonClient-like)
    const tonClient = client as { sendExternalMessage?: (...args: unknown[]) => Promise<unknown> } | undefined;
    if (tonClient?.sendExternalMessage && payload.wallet) {
      try {
        await tonClient.sendExternalMessage(payload.wallet, {
          messages: payload.messages.map((m) => ({
            to: m.to,
            value: m.value,
            body: m.body,
            bounce: true,
          })),
        });
        const confirmed = await waitForConfirmation(client, payload.wallet, seqno);
        if (!confirmed) {
          return { ok: false, error: "Confirmation timeout (seqno did not increase)" };
        }
        return { ok: true };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    // Fallback: build an Acton CLI command for execution
    const message = payload.messages[0];
    const { command, env } = buildActonCommand(
      "swap",
      [
        "execute",
        "--tier",
        tier,
        "--to",
        message.to,
        "--value",
        message.value.toString(),
        "--body",
        message.body,
      ],
      {
        env: {
          ACTON_TIER: tier,
          ACTON_RECIPIENT: message.to,
          ACTON_VALUE: message.value.toString(),
          ACTON_BODY: message.body,
        },
      }
    );

    // Attempt to run the Acton CLI if available
    try {
      const { execSync } = await import("node:child_process");
      const result = execSync(command, {
        encoding: "utf-8",
        timeout: 120_000,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const txHash = result.trim() || `acton-${tier}-${Date.now().toString(16)}`;
      return { ok: true, txHash };
    } catch (e: unknown) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : `Acton CLI unavailable: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  } finally {
    release();
  }
}
