/**
 * Replay data source — deterministic fixture jettons so the pipeline runs and
 * is testable WITHOUT a TONAPI key. Used when SCANNER_SOURCE=replay or no
 * TONAPI_KEY is configured. Clearly fixture data: never routed to execution.
 */
import type { AuditResult } from "./audit";

export interface JettonView {
  master: string;
  symbol: string;
  name: string;
  decimals: number;
  /** null when no quote available — pipeline journals as `incomplete`. */
  priceTon: number | null;
  liquidityTon: number | null;
  curvePct: number | null;
  poolAddress: string | null;
}

export interface ScannerSource {
  name: string;
  listRecent(): Promise<JettonView[]>;
  auditMaster(master: string): Promise<AuditResult | null>;
}

const FIXTURES: JettonView[] = [
  {
    master: "EQA-replay-alpha",
    symbol: "RPLY-A",
    name: "Replay Alpha",
    decimals: 9,
    priceTon: 0.000_004_2,
    liquidityTon: 125,
    curvePct: 42,
    poolAddress: "EQD-replay-alpha-pool",
  },
  {
    master: "EQB-replay-beta",
    symbol: "RPLY-B",
    name: "Replay Beta",
    decimals: 9,
    priceTon: 0.000_000_9,
    liquidityTon: 8,
    curvePct: 88,
    poolAddress: "EQD-replay-beta-pool",
  },
  {
    master: "EQC-replay-gamma",
    symbol: "RPLY-G",
    name: "Replay Gamma",
    decimals: 9,
    priceTon: 0.000_021,
    liquidityTon: 420,
    curvePct: 21,
    poolAddress: "EQD-replay-gamma-pool",
  },
  {
    // Viable-size token: a 5% move on a 10 TON entry covers the round-trip
    // fee, so the deterministic gate can demonstrate a PASS path end-to-end.
    master: "EQD-replay-delta",
    symbol: "RPLY-D",
    name: "Replay Delta",
    decimals: 9,
    priceTon: 10,
    liquidityTon: 25_000,
    curvePct: 50,
    poolAddress: "EQD-replay-delta-pool",
  },
];

const FIXTURE_AUDIT: Record<string, AuditResult> = {
  "EQA-replay-alpha": {
    ok: true,
    verified: 70,
    renounced: true,
    locked: true,
    honeypot: false,
    holders: 340,
    ageHours: 6,
    flags: ["fixture", "renounced"],
  },
  "EQB-replay-beta": {
    ok: true,
    verified: 0,
    renounced: false,
    locked: false,
    honeypot: false,
    holders: 22,
    ageHours: 0.4,
    flags: ["fixture", "admin_set", "lp_lock_unchecked", "honeypot_unchecked"],
  },
  "EQC-replay-gamma": {
    ok: true,
    verified: 100,
    renounced: true,
    locked: true,
    honeypot: true,
    holders: 1200,
    ageHours: 48,
    flags: ["fixture", "renounced"],
  },
  "EQD-replay-delta": {
    ok: true,
    verified: 100,
    renounced: true,
    locked: true,
    honeypot: true,
    holders: 1500,
    ageHours: 72,
    flags: ["fixture", "renounced"],
  },
};

export const replaySource: ScannerSource = {
  name: "replay",
  listRecent: async () => FIXTURES,
  auditMaster: async (master) => FIXTURE_AUDIT[master] ?? null,
};

export function isFixture(master: string): boolean {
  return master.includes("-replay-");
}
