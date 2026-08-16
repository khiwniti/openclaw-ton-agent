/**
 * Real-data replay input (P5). Loads a signal feed (NDJSON, shared
 * SignalEnvelope format — the same file the scanner journals) plus an optional
 * per-token price-bar NDJSON, and replays them through the SAME engine G1
 * measures.
 *
 * With no --bars file (or a token missing from it), per-token prices are
 * synthesized over that token's signal window and the run is labeled
 * `syntheticBars=true` — so the real feed replays end-to-end today, but nobody
 * mistakes synthetic fills for a real-data G1 pass.
 *
 * Bars NDJSON format (one JSON object per line):
 *   {"tokenAddress":"EQA-...","ts":1786672004159,"priceTon":0.0000042}
 */
import * as fs from "node:fs";
import { readJournal, validateIngested, type IngestedEnvelope } from "@openclaw-ton-agent/shared";
import { GATE_CONFIG } from "@openclaw-ton-agent/risk-gates";
import type { ExitMode } from "@openclaw-ton-agent/exit-manager";
import { runBacktest, type BacktestResult } from "./engine";
import { generateSeries, type Bar } from "./series";
import { computeMetrics, type BacktestMetrics } from "./metrics";
import { generateEvents } from "./fixture";

export interface ReplayBar {
  tokenAddress: string;
  ts: number;
  priceTon: number;
}

export interface ReplayInput {
  signals: IngestedEnvelope[];
  bars: Map<string, Bar[]>;
  /** signals whose token had a bar series at replay time. */
  eventsUsed: number;
  /** signals whose token got synthesized prices (no bars in the file). */
  skippedNoBars: number;
  syntheticBars: boolean;
  tokens: string[];
}

export interface ReplayOptions {
  signalsFile: string;
  barsFile?: string;
  mode?: ExitMode;
  bankrollTon?: number;
  seed?: number;
  barsPerDay?: number;
}

export interface ReplayOutcome {
  result: BacktestResult;
  input: ReplayInput;
  metrics: BacktestMetrics;
}

export function loadSignals(file: string, max = Number.MAX_SAFE_INTEGER): IngestedEnvelope[] {
  const out: IngestedEnvelope[] = [];
  for (const raw of readJournal(file, max)) {
    const v = validateIngested(raw);
    if (v.ok) out.push(v.value);
  }
  return out;
}

export function loadBars(file: string): Map<string, Bar[]> {
  if (!fs.existsSync(file)) return new Map();
  const byToken = new Map<string, Bar[]>();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    let b: ReplayBar;
    try {
      b = JSON.parse(line) as ReplayBar;
    } catch {
      continue; // skip corrupt lines
    }
    if (typeof b?.tokenAddress !== "string" || !Number.isFinite(b.ts) || !Number.isFinite(b.priceTon)) continue;
    const list = byToken.get(b.tokenAddress) ?? [];
    list.push({ ts: b.ts, priceTon: b.priceTon });
    byToken.set(b.tokenAddress, list);
  }
  for (const list of byToken.values()) list.sort((a, b) => a.ts - b.ts);
  return byToken;
}

/** Write bars in the replay NDJSON format (template/sample export). */
export function exportBarsToNdjson(bars: Bar[], tokenAddress: string, file: string): void {
  fs.mkdirSync(file.replace(/\/[^/]+$/, ""), { recursive: true });
  fs.writeFileSync(
    file,
    bars.map((b) => JSON.stringify({ tokenAddress, ts: b.ts, priceTon: b.priceTon })).join("\n") + "\n",
    "utf8",
  );
}

function synthesizeFor(signals: IngestedEnvelope[], tokenAddress: string, seed: number, barsPerDay: number): Bar[] {
  const mine = signals.filter((e) => e.token.address === tokenAddress);
  const ts = mine.map((e) => e.ts);
  const minTs = Math.min(...ts);
  const maxTs = Math.max(...ts);
  const spanDays = Math.max(2, (maxTs - minTs) / 86_400_000 + 1);
  const startTon = mine[0].token.priceTon ?? 10;
  return generateSeries({
    startTon,
    days: spanDays,
    barsPerDay,
    driftPerDay: 0.01,
    volPerBar: 0.015,
    seed,
    startTs: minTs,
  });
}

export function loadReplayInput(signalsFile: string, barsFile?: string, opts: { seed?: number; barsPerDay?: number } = {}): ReplayInput {
  const signals = loadSignals(signalsFile);
  const bars = barsFile ? loadBars(barsFile) : new Map<string, Bar[]>();
  const seed = opts.seed ?? 11;
  const barsPerDay = opts.barsPerDay ?? 48;

  let skippedNoBars = 0;
  const tokens = [...new Set(signals.map((e) => e.token.address))];
  for (const token of tokens) {
    if (!bars.has(token) || bars.get(token)!.length === 0) {
      bars.set(token, synthesizeFor(signals, token, seed + token.length, barsPerDay));
      skippedNoBars++;
    }
  }
  const eventsUsed = signals.filter((e) => bars.has(e.token.address)).length;
  return {
    signals,
    bars,
    eventsUsed,
    skippedNoBars,
    syntheticBars: !barsFile || skippedNoBars > 0,
    tokens,
  };
}

export interface ReplayOutcome {
  result: BacktestResult;
  input: ReplayInput;
  metrics: BacktestMetrics;
  /** where the replayed signals came from: the journal, or generated from bars. */
  signalSource: "journal" | "momentum-bars";
}

export function replayFromFiles(opts: ReplayOptions): ReplayOutcome {
  const input = loadReplayInput(opts.signalsFile, opts.barsFile, { seed: opts.seed });
  const events = input.signals.map((envelope) => ({ ts: envelope.ts, envelope }));
  const bankrollTon = opts.bankrollTon ?? GATE_CONFIG.bankrollTon;
  const result = runBacktest({ events, series: input.bars, mode: opts.mode ?? "swing", bankrollTon });
  const metrics = computeMetrics(result.trades, { bankrollTon });
  return { result, input, metrics, signalSource: "journal" };
}

export interface ReplayBarsOptions {
  barsFile: string;
  mode?: ExitMode;
  bankrollTon?: number;
  window?: number;
}

/** Replay generated momentum signals against real bar data (no signal file). */
export function replayFromBars(opts: ReplayBarsOptions): ReplayOutcome {
  const bars = loadBars(opts.barsFile);
  const events: Array<{ ts: number; envelope: IngestedEnvelope }> = [];
  for (const [addr, series] of bars) {
    events.push(...generateEvents(series, addr, addr.slice(0, 6), opts.window ?? 24, "real"));
  }
  const bankrollTon = opts.bankrollTon ?? GATE_CONFIG.bankrollTon;
  const result = runBacktest({ events, series: bars, mode: opts.mode ?? "swing", bankrollTon });
  const metrics = computeMetrics(result.trades, { bankrollTon });
  const input: ReplayInput = {
    signals: events.map((e) => e.envelope),
    bars,
    eventsUsed: events.length,
    skippedNoBars: 0,
    syntheticBars: false,
    tokens: [...bars.keys()],
  };
  return { result, input, metrics, signalSource: "momentum-bars" };
}
