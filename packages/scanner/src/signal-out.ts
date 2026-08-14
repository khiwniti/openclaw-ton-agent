/**
 * signal-out — posts SignalEnvelope to the OpenClaw signal bus (webhook).
 * Port of ton-agent `webhook.ts`: HMAC-SHA256 signed body, stable id used as
 * the idempotency key. When SIGNAL_OUT_URL is unset, reports `sent:false` and
 * the pipeline continues (journaling is always on).
 */
import { createHmac } from "node:crypto";
import { SCANNER_CONFIG } from "./config";
import type { SignalEnvelope } from "@openclaw-ton-agent/shared";

export interface SignalOutResult {
  sent: boolean;
  id: string;
  reason?: string;
  error?: string;
}

export interface SignalOutOpts {
  url?: string;
  sharedSecret?: string;
}

export async function postSignal(envelope: SignalEnvelope, opts: SignalOutOpts = {}): Promise<SignalOutResult> {
  const url = opts.url ?? SCANNER_CONFIG.signalOut.url;
  if (!url) return { sent: false, id: envelope.id, reason: "SIGNAL_OUT_URL not set" };

  const body = {
    id: envelope.id,
    ts: envelope.ts,
    kind: "signal_envelope",
    payload: envelope,
  };
  const bodyJson = JSON.stringify(body);
  const signature = createHmac("sha256", opts.sharedSecret ?? SCANNER_CONFIG.signalOut.sharedSecret)
    .update(bodyJson)
    .digest("hex");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Agent-Secret": signature },
      body: bodyJson,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { sent: false, id: envelope.id, reason: `HTTP ${res.status}`, error: await res.text().catch(() => "") };
    return { sent: true, id: envelope.id };
  } catch (e: any) {
    return { sent: false, id: envelope.id, reason: "network error", error: (e as Error)?.message };
  }
}
