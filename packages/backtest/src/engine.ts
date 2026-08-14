/**
 * Backtest engine — cost-aware replay of gated signals against a price
 * series, using the SAME deterministic path as live: risk gates (L3) to
 * approve, pointSetup for stop/target, exit-manager (L4) for the exit.
 * Every trade pays round-trip fees (totalCostTon) and the metric report is
 * what G1 measures (architecture §12.2).
 */
import type { IngestedEnvelope } from "@openclaw-ton-agent/shared";
import { evaluateGates, pointSetup, totalCostTon, GATE_CONFIG } from "@openclaw-ton-agent/risk-gates";
import { openPosition, stepPosition, EXIT_MODE_CONFIG, type ExitMode } from "@openclaw-ton-agent/exit-manager";
import { newId } from "@openclaw-ton-agent/shared";
import { realizedVolPct } from "@openclaw-ton-agent/market-intel";
import type { Bar } from "./series";

export interface BacktestEvent {
  ts: number;
  envelope: IngestedEnvelope;
}

export interface Trade {
  id: string;
  tokenAddress: string;
  ticker: string;
  entryTs: number;
  exitTs: number;
  entryTon: number;
  exitTon: number;
  qty: number;
  amountTon: number;
  exitAction: string;
  feesTon: number;
  grossPnLTon: number;
  netPnLTon: number;
  netPnlPct: number;
}

export interface BacktestResult {
  trades: Trade[];
  eventsEvaluated: number;
  gatedPassed: number;
}

/**
 * A decision record emitted as the engine walks a signal through the gated
 * pipeline — the paper-mode (G2) trace. The engine produces the same fills a
 * live `PaperWallet` would (deterministic, at the quoted entry), so these
 * records ARE the paper journal: same code path, no simulated prices.
 */
export type EngineDecision =
  | { kind: "event"; ts: number; tokenAddress: string; ticker: string }
  | { kind: "gate_reject"; ts: number; tokenAddress: string; ticker: string; reason: string }
  | { kind: "gate_pass"; ts: number; tokenAddress: string; ticker: string; sizeTon: number; tier: string }
  | { kind: "fill"; ts: number; tokenAddress: string; ticker: string; entryTon: number; amountTon: number; stopLossTon: number; takeProfitTon: number }
  | { kind: "exit"; ts: number; tokenAddress: string; ticker: string; exitAction: string; exitTon: number; netPnLTon: number };

export interface RunBacktestOptions {
  events: BacktestEvent[];
  series: Map<string, Bar[]>;
  bankrollTon?: number;
  mode?: ExitMode;
  /** Point-setup overrides for hyperopt (live/demo path keeps GATE_CONFIG defaults). */
  strategy?: { volPct?: number; rrTarget?: number };
  /** Optional paper-mode hook: receives a decision record per gated-pipeline step. */
  onDecision?: (d: EngineDecision) => void;
}

function drawdownPct(equity: number, peak: number): number {
  if (peak <= 0) return 0;
  return ((peak - equity) / peak) * 100;
}

export function runBacktest(opts: RunBacktestOptions): BacktestResult {
  const bankrollTon = opts.bankrollTon ?? GATE_CONFIG.bankrollTon;
  const mode: ExitMode = opts.mode ?? "swing";
  const timeStopMs = EXIT_MODE_CONFIG[mode].timeStopMs;

  const sorted = [...opts.events].sort((a, b) => a.ts - b.ts);
  const cooldowns = new Map<string, number>();
  const open = new Map<string, { pos: ReturnType<typeof openPosition>; bars: Bar[]; entryIdx: number }>();

  const trades: Trade[] = [];
  let eventsEvaluated = 0;
  let gatedPassed = 0;
  let cumulative = 0;
  let peak = 0;
  for (const event of sorted) {
    eventsEvaluated++;
    const env = event.envelope;
    const addr = env.token.address;
    const ticker = env.token.ticker;
    opts.onDecision?.({ kind: "event", ts: event.ts, tokenAddress: addr, ticker });
    if (open.has(addr)) continue; // one position per token at a time
    const bars = opts.series.get(addr);
    if (!bars || bars.length === 0) continue;

    const entryIdx = bars.findIndex((b) => b.ts >= event.ts);
    if (entryIdx < 0 || entryIdx + 1 >= bars.length) continue;
    const entryBar = bars[entryIdx];

    // Lot-size intelligence (P3): measure realized vol from the bars BEFORE
    // entry (never lookahead). The strategy volPct is the floor; measured ATR
    // widens the stop and shrinks the position when a token is genuinely
    // volatile. Both gates and point-setup receive the same effective vol so
    // R:R, fee economics and sizing are all consistent with the same stop.
    const measuredVol = realizedVolPct(bars.slice(0, entryIdx), { atrPeriod: GATE_CONFIG.atrPeriod, minVolPct: GATE_CONFIG.volFloorPct, maxVolPct: GATE_CONFIG.volCapPct });
    const volPct = Math.max(opts.strategy?.volPct ?? GATE_CONFIG.volPct, measuredVol ?? 0);

    const gate = evaluateGates(env, {
      now: event.ts,
      cooldowns,
      openPositions: [...open.values()].map((o) => ({ address: o.pos.tokenAddress, pnlPct: null })),
      // Equity-based drawdown — same measure computeMetrics uses (bankroll is
      // the starting equity). The gate's 20% circuit breaker must fire here or
      // the backtest trades the account into the ground while reporting 0%.
      drawdownPct: drawdownPct(bankrollTon + cumulative, bankrollTon + peak),
      killSwitchFlipped: false,
      bankrollTon,
      volPct,
    });
    if (gate.verdict !== "pass") {
      opts.onDecision?.({ kind: "gate_reject", ts: event.ts, tokenAddress: addr, ticker, reason: gate.reasons.join("; ") });
      continue;
    }
    gatedPassed++;
    opts.onDecision?.({ kind: "gate_pass", ts: event.ts, tokenAddress: addr, ticker, sizeTon: gate.sizeTon, tier: gate.tier ?? "none" });

    const setup = pointSetup({
      entryTon: entryBar.priceTon,
      curvePct: env.token.curvePct,
      rrTarget: opts.strategy?.rrTarget,
      volPct,
    });
    const fees = totalCostTon();
    opts.onDecision?.({ kind: "fill", ts: entryBar.ts, tokenAddress: addr, ticker, entryTon: entryBar.priceTon, amountTon: gate.sizeTon, stopLossTon: setup.stopLoss, takeProfitTon: setup.takeProfit });
    let pos = openPosition({
      orderId: `bt-${env.id}`,
      tokenAddress: addr,
      ticker: env.token.ticker,
      entryTon: entryBar.priceTon,
      amountTon: gate.sizeTon,
      stopLossTon: setup.stopLoss,
      takeProfitTon: setup.takeProfit,
      entryTs: entryBar.ts,
      mode,
      feesTon: fees,
      timeStopMs,
    });

    let exitTon = entryBar.priceTon;
    let exitTs = entryBar.ts;
    let exitAction = "end_of_data";
    let stepped = false;
    for (let j = entryIdx + 1; j < bars.length; j++) {
      stepped = true;
      const step = stepPosition(pos, bars[j].priceTon, bars[j].ts);
      if (step.action !== "hold") {
        exitTon = step.exitPriceTon ?? bars[j].priceTon;
        exitTs = bars[j].ts;
        exitAction = step.action;
        pos = step.pos;
        break;
      }
      pos = step.pos;
      if (j === bars.length - 1) {
        exitTon = bars[j].priceTon;
        exitTs = bars[j].ts;
        exitAction = "end_of_data";
      }
    }
    if (!stepped) {
      exitTon = entryBar.priceTon;
      exitTs = entryBar.ts;
      exitAction = "end_of_data";
    }

    const gross = (exitTon - pos.entryTon) * pos.qty;
    const net = gross - pos.feesTon;
    const trade: Trade = {
      id: newId("bt"),
      tokenAddress: addr,
      ticker: pos.ticker,
      entryTs: pos.entryTs,
      exitTs,
      entryTon: pos.entryTon,
      exitTon,
      qty: pos.qty,
      amountTon: pos.amountTon,
      exitAction,
      feesTon: pos.feesTon,
      grossPnLTon: gross,
      netPnLTon: net,
      netPnlPct: (net / pos.amountTon) * 100,
    };
    trades.push(trade);
    open.delete(addr);
    cumulative += net;
    peak = Math.max(peak, cumulative);
    opts.onDecision?.({ kind: "exit", ts: exitTs, tokenAddress: addr, ticker, exitAction, exitTon, netPnLTon: net });
  }

  return { trades, eventsEvaluated, gatedPassed };
}
