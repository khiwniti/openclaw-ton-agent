/**
 * G2 paper-mode runner (architecture §12.2 gate 2).
 *
 * Replays real bar data forward through the SAME gated pipeline the live
 * executor uses (risk gates → point setup → deterministic paper fill → exit
 * manager), emitting a decision journal the shared `Journal` stores. This is
 * the "paper demo" code path: same gates, same sizing, same exits, fills are
 * the deterministic paper fills — no live capital, no simulated prices.
 *
 * Inputs mirror the live path: a signals journal of IngestedEnvelope lines
 * (what the scanner would emit) or, when absent, regime-gated events derived
 * from the real bars (the eval/backtest path). Journal output is written to
 * the shared decision journal (`data/decision-journal.ndjson`).
 */
import { Journal, newOrderId, newId, readJournal, type IngestedEnvelope, type OrderRequest } from "@openclaw-ton-agent/shared";
import { generateEvents } from "./fixture";
import { runBacktest, type EngineDecision } from "./engine";
import { loadBars } from "./replay";
import type { Bar } from "./series";
import { GATE_CONFIG } from "@openclaw-ton-agent/risk-gates";
export interface PaperOptions {
  /** Real per-token bars to replay against. */
  barsFile: string;
  /** Signals journal (NDJSON IngestedEnvelope lines). When empty, events are
   *  derived from the bars via the same regime-gated generator the eval path uses. */
  signalsFile?: string;
  /** Signal lookback window for bar-derived events. */
  window?: number;
  /** Regime gate (bars): only emit events when sma(window) > sma(regimeSlow). */
  regimeSlow?: number;
  mode?: "snipe" | "swing" | "gamble" | "diamond";
  volPct?: number;
  rrTarget?: number;
  bankrollTon?: number;
  /** Decision journal output path. */
  journalFile: string;
  /** Executor-format journals (G2 drift monitor consumes these). Optional:
   *  when provided, every paper fill is also booked as an OrderRequest +
   *  FillResult line, so the drift monitor runs against the paper trace. */
  ordersFile?: string;
  fillsFile?: string;
  slippageBps?: number;
  /** Skip the first N bars of each series (e.g. a 60% tune segment) so the
   *  paper run is forward-only on the held-out tail. */
  skipBars?: number;
}

export interface PaperResult {
  journalFile: string;
  decisions: EngineDecision[];
  events: number;
  gatedPassed: number;
  fills: number;
  exits: number;
  trades: { ticker: string; entryTs: number; exitTs: number; entryTon: number; exitTon: number; exitAction: string; netPnLTon: number }[];
  netPnLTon: number;
  journalLines: number;
  paperOrderCount: number;
}

export function runPaper(opts: PaperOptions): PaperResult {
  const bars = loadBars(opts.barsFile);
  if (bars.size === 0) throw new Error(`paper: no bars loaded from ${opts.barsFile}`);

  // Forward-only replay window: optionally cut the tune segment off the front.
  const series = new Map<string, Bar[]>();
  for (const [addr, list] of bars) {
    series.set(addr, opts.skipBars ? list.slice(opts.skipBars) : list);
  }

  // Events: from a real signals journal when provided, else bar-derived.
  let events: { ts: number; envelope: IngestedEnvelope }[];
  if (opts.signalsFile) {
    const lines = readJournal(opts.signalsFile);
    events = lines
      .filter((l): l is IngestedEnvelope => typeof l === "object" && l !== null && typeof (l as { token?: unknown }).token === "object")
      .filter((l) => series.has(l.token.address))
      .map((l) => ({ ts: l.ts, envelope: l }));
  } else {
    events = [];
    for (const [addr, list] of series) {
      events.push(...generateEvents(list, addr, addr.replace(/^EQA-[^:]*:/, ""), opts.window ?? 20, "real", opts.regimeSlow ?? 0));
    }
  }

  const journal = new Journal(opts.journalFile);
  const ordersJournal = opts.ordersFile ? new Journal(opts.ordersFile) : null;
  const fillsJournal = opts.fillsFile ? new Journal(opts.fillsFile) : null;
  const slippageBps = opts.slippageBps ?? GATE_CONFIG.spreadBpsAllowance;
  const decisions: EngineDecision[] = [];
  let paperOrderCount = 0;
  const result = runBacktest({
    events,
    series,
    bankrollTon: opts.bankrollTon ?? GATE_CONFIG.bankrollTon,
    mode: opts.mode ?? "swing",
    strategy: { volPct: opts.volPct, rrTarget: opts.rrTarget },
    onDecision: (d) => {
      decisions.push(d);
      journal.append({ at: Date.now(), kind: "paper", decision: d });
      if (d.kind === "fill" && ordersJournal && fillsJournal) {
        const order: OrderRequest = {
          id: newOrderId(),
          ts: d.ts,
          gatedEnvelopeId: newId("env"),
          source: "paper-sim",
          mode: "paper",
          side: "buy",
          token: { address: d.tokenAddress, ticker: d.ticker, decimals: 9 },
          amountTon: d.amountTon,
          entryTon: d.entryTon,
          stopLossTon: d.stopLossTon,
          takeProfitTon: d.takeProfitTon,
          expectedWinTon: (d.takeProfitTon - d.entryTon) * (d.amountTon / d.entryTon),
          expectedTokenQty: d.amountTon / d.entryTon,
          minOutTokenQty: (d.amountTon / d.entryTon) * (1 - slippageBps / 10_000),
          slippageBps,
          tier: "low",
          rRatio: (d.takeProfitTon - d.entryTon) / (d.entryTon - d.stopLossTon),
          expectedValueTon: 0,
          confirmRequired: false,
          deadlineMs: d.ts + 60_000,
        };
        ordersJournal.append(order);
        fillsJournal.append({
          orderId: order.id,
          ts: d.ts,
          status: "filled",
          txHash: `paper-${order.id}`,
          filledAmountTon: order.amountTon,
          filledTokenQty: order.expectedTokenQty,
          minOutTokenQty: order.minOutTokenQty,
          slippageBps,
          mode: "paper",
        });
        paperOrderCount++;
      }
    },
  });

  const fills = decisions.filter((d) => d.kind === "fill").length;
  const exits = decisions.filter((d) => d.kind === "exit").length;
  return {
    journalFile: opts.journalFile,
    decisions,
    events: result.eventsEvaluated,
    gatedPassed: result.gatedPassed,
    fills,
    exits,
    trades: result.trades.map((t) => ({ ticker: t.ticker, entryTs: t.entryTs, exitTs: t.exitTs, entryTon: t.entryTon, exitTon: t.exitTon, exitAction: t.exitAction, netPnLTon: t.netPnLTon })),
    netPnLTon: result.trades.reduce((s, t) => s + t.netPnLTon, 0),
    journalLines: journal.lineCountValue,
    paperOrderCount,
  };
}
