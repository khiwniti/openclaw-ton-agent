/**
 * Read-only security audit for the scanner (L1).
 *
 * Port of ton-agent `security/audit.ts` reduced to TONAPI-only signals so the
 * scanner stays dependency-light and read-only. On-chain LP-lock (runMethod)
 * and honeypot sandbox checks are executor-side concerns (P2+) — when they
 * can't run here they are marked UNKNOWN via `flags`, never fabricated.
 */
import { tonapiGet } from "./tonapi";
import { SCANNER_CONFIG } from "./config";

const BURN_PREFIXES = [
  "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
  "0:0000000000000000000000000000000000000000000000000000000000000000",
];

export interface JettonDetail {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  verification: "whitelisted" | "trusted" | "none";
  holders: number | null;
  adminAddress: string | null;
  mintable: boolean;
}

export interface AuditResult {
  ok: boolean;
  verified: number;   // 0..100 from TONAPI verification status
  renounced: boolean;
  locked: boolean;    // LP lock — UNKNOWN=false flagged unless on-chain data present
  honeypot: boolean;  // honeypot check — UNKNOWN=false flagged unless checked
  holders: number | null;
  ageHours: number | null;
  flags: string[];
}

export async function fetchJettonDetail(master: string): Promise<JettonDetail | null> {
  if (!SCANNER_CONFIG.tonapi.key) return null;
  try {
    const r = await tonapiGet(`/jettons/${master}`, { timeoutMs: 8_000 });
    const d = r.data;
    if (!d?.metadata?.address) return null;
    return {
      address: d.metadata.address,
      name: d.metadata.name ?? "",
      symbol: d.metadata.symbol ?? "",
      decimals: Number(d.metadata.decimals) || 9,
      verification: d.verification === "whitelisted" ? "whitelisted" : d.verification === "trusted" ? "trusted" : "none",
      holders: Number.isFinite(d.holders_count) ? d.holders_count : null,
      adminAddress: d.admin?.address ?? null,
      mintable: !!d.mintable,
    };
  } catch {
    return null;
  }
}

function isBurnAddress(addr: string | null): boolean {
  if (!addr) return false;
  const lower = addr.toLowerCase();
  return BURN_PREFIXES.some((p) => lower === p.toLowerCase() || lower.startsWith(p.toLowerCase()));
}

/** Audit a jetton master from TONAPI. `ok=false` only when the source is unusable. */
export async function auditJetton(master: string): Promise<AuditResult> {
  const detail = await fetchJettonDetail(master);
  if (!detail) {
    return { ok: false, verified: 0, renounced: false, locked: false, honeypot: false, holders: null, ageHours: null, flags: ["audit_source_unavailable"] };
  }

  const verified = detail.verification === "whitelisted" ? 100 : detail.verification === "trusted" ? 70 : 0;
  const renounced = !detail.mintable || isBurnAddress(detail.adminAddress);
  const flags: string[] = [];

  if (detail.verification === "none") flags.push("not_verified");
  if (!renounced && detail.adminAddress) flags.push("admin_set");
  if (renounced) flags.push("renounced");

  // LP lock + honeypot are on-chain checks owned by the executor (P2+).
  // Until then they are UNKNOWN — flagged, not asserted safe.
  flags.push("lp_lock_unchecked");
  flags.push("honeypot_unchecked");

  return {
    ok: true,
    verified,
    renounced,
    locked: false,
    honeypot: false,
    holders: detail.holders,
    ageHours: null, // not available from /jettons detail; known after pool discovery
    flags,
  };
}
