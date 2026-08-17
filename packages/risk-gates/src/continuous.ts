/**
 * Continuous risk gate runner — bridges signals-*.ndjson to gated-*.ndjson.
 * Evaluates risk gates for new scanner signals in real-time.
 */
import { readJournal, Journal, validateIngested, createLogger } from "@openclaw-ton-agent/shared";
import { annotateEnvelope } from "@openclaw-ton-agent/market-intel";
import { evaluateGates, gatedMeta } from "./gates.js";
import { GATE_CONFIG } from "./config.js";
import * as fs from "fs";
import * as path from "path";

const log = createLogger("risk-gates");

export async function runContinuousRiskGates(opts: {
  signalsPath: string;
  gatedPath: string;
  pollIntervalMs?: number;
}) {
  const pollIntervalMs = opts.pollIntervalMs ?? 3000;
  const cooldowns = new Map<string, number>();
  let lastProcessedLine = 0;

  const existingGated = fs.existsSync(opts.gatedPath) ? readJournal(opts.gatedPath) : [];
  const processedSignalIds = new Set<string>();
  for (const g of existingGated) {
    if (g && typeof g === "object" && "id" in g && typeof (g as { id: string }).id === "string") {
      processedSignalIds.add((g as { id: string }).id);
    }
  }

  const gatedJournal = new Journal(opts.gatedPath);
  log.info("continuous risk-gates started", {
    signals: opts.signalsPath,
    gated: opts.gatedPath,
    existingGatedCount: existingGated.length,
  });

  const processNewSignals = async () => {
    try {
      if (!fs.existsSync(opts.signalsPath)) return;
      const rows = readJournal(opts.signalsPath);
      if (rows.length <= lastProcessedLine) return;

      const newRows = rows.slice(lastProcessedLine);
      for (const row of newRows) {
        lastProcessedLine++;
        const parsed = validateIngested(row);
        if (!parsed.ok || !parsed.value) continue;
        const env = parsed.value;
        if (env.id && processedSignalIds.has(env.id)) {
          continue;
        }
        if (env.id) processedSignalIds.add(env.id);
        const annotated = annotateEnvelope(env, {
          curvePct: env.token.curvePct,
          sentiment: env.token.holders !== undefined ? "neutral" : "unknown",
          whale: env.token.holders !== undefined ? { signal: "none", deltaPct: 0 } : { signal: null, deltaPct: null },
          sources: ["market-intel:continuous", "risk-gates:continuous"],
        });

        const result = evaluateGates(annotated, {
          now: Date.now(),
          cooldowns,
          openPositions: [],
          drawdownPct: 0,
          killSwitchFlipped: process.env.KILL_SWITCH_FLIPPED === "1",
          bankrollTon: GATE_CONFIG.bankrollTon,
          macroRiskOff: false,
        });

        log.info("evaluated signal", {
          ticker: env.token.ticker,
          verdict: result.verdict,
          score: env.score?.soft ?? 0,
          sizeTon: result.sizeTon,
        });

        const gated = { ...annotated, meta: { ...(annotated.meta ?? {}), ...gatedMeta(result) } };
        gatedJournal.append(gated);
      }
    } catch (err) {
      log.error("error processing signals", err as Error);
    }
  };

  await processNewSignals();
  const handle = setInterval(processNewSignals, pollIntervalMs);
  return { stop: () => clearInterval(handle) };
}

if (process.argv[1] && process.argv[1].endsWith("continuous.ts")) {
  const dataDir = process.env.DATA_DIR || "/app/data";
  const network = process.env.TON_NETWORK || "testnet";
  const signalsPath = path.join(dataDir, `signals-${network}.ndjson`);
  const gatedPath = path.join(dataDir, `gated-${network}.ndjson`);
  runContinuousRiskGates({ signalsPath, gatedPath });
}
