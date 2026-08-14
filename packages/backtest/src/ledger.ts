/**
 * Per-mode win/loss ledger (P5) — append-only NDJSON so hyperopt runs and live
 * demos accumulate one durable record per (config, seed, phase). Aggregates
 * answer "which exit mode is actually +EV" instead of trusting the last run.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface LedgerEntry {
  at: string;
  days: number;
  seed: number;
  mode: "snipe" | "swing" | "gamble" | "diamond";
  volPct: number;
  rrTarget: number;
  phase: "tune" | "validate" | "demo";
  trades: number;
  winRate: number;
  expectancyTon: number;
  profitFactor: number;
  sharpe: number;
  maxDrawdownPct: number;
  spanDays: number;
  g1Passed: boolean;
}

export interface ModeAggregate {
  mode: LedgerEntry["mode"];
  runs: number;
  trades: number;
  g1Passes: number;
  g1PassRate: number;
  avgExpectancyTon: number;
  totalExpectancyTon: number;
  bestProfitFactor: number;
  avgWinRate: number;
}

export function recordLedger(entry: LedgerEntry, file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
}

export function readLedger(file: string): LedgerEntry[] {
  if (!fs.existsSync(file)) return [];
  const out: LedgerEntry[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as LedgerEntry);
    } catch {
      // skip corrupt/partial lines; appends are atomic-ish so this is rare
    }
  }
  return out;
}

export function aggregateByMode(entries: LedgerEntry[], phase?: "tune" | "validate" | "demo"): ModeAggregate[] {
  const groups = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    if (phase && e.phase !== phase) continue;
    const list = groups.get(e.mode) ?? [];
    list.push(e);
    groups.set(e.mode, list);
  }
  const out: ModeAggregate[] = [];
  for (const [mode, list] of groups) {
    const exp = list.map((e) => e.expectancyTon);
    out.push({
      mode: mode as LedgerEntry["mode"],
      runs: list.length,
      trades: list.reduce((s, e) => s + e.trades, 0),
      g1Passes: list.filter((e) => e.g1Passed).length,
      g1PassRate: list.length > 0 ? list.filter((e) => e.g1Passed).length / list.length : 0,
      avgExpectancyTon: exp.length > 0 ? exp.reduce((s, x) => s + x, 0) / exp.length : 0,
      totalExpectancyTon: exp.reduce((s, x) => s + x, 0),
      bestProfitFactor: list.length > 0 ? Math.max(...list.map((e) => e.profitFactor)) : 0,
      avgWinRate: list.length > 0 ? list.reduce((s, e) => s + e.winRate, 0) / list.length : 0,
    });
  }
  return out.sort((a, b) => b.totalExpectancyTon - a.totalExpectancyTon);
}
