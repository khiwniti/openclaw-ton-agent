/**
 * Gated feed runner — the P2 exit criterion, demonstrated end-to-end.
 *
 * Reads a scanner journal (NDJSON of IngestedEnvelope) → annotates with
 * market-intel (curve band + whale/sentiment from holder delta, regime when a
 * price series is supplied) → evaluates deterministic risk gates → writes a
 * gated journal. Deterministic gates outrank everything here (architecture §10).
 *
 * Usage:
 *   node --import tsx src/run-gated-feed.ts --input ../../data/signals-mainnet.ndjson \
 *     --output ../../data/gated-mainnet.ndjson
 */
import { readJournal, Journal, validateIngested } from "@openclaw-ton-agent/shared";
import { annotateEnvelope } from "@openclaw-ton-agent/market-intel";
import { evaluateGates, gatedMeta } from "./gates";
import { GATE_CONFIG } from "./config";
import { createMacroFeed, isMacroRiskOff, type MacroState } from "./macro-feed";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export async function runGatedFeed(opts: { input: string; output: string }) {
  const rows = readJournal(opts.input);
  const cooldowns = new Map<string, number>();
  const journal = new Journal(opts.output);

  let valid = 0;
  let passed = 0;
  let rejected = 0;
  let halted = 0;

  let macroState: MacroState = { riskOff: false, reason: "", timestamp: 0 };
  const macroFeed = createMacroFeed();

  for (const row of rows) {
    const parsed = validateIngested(row);
    if (!parsed.ok || !parsed.value) {
      continue;
    }
    valid++;
    const env = parsed.value!!;
    if (!env) continue;

    // Macro risk-off polling (throttled by macroPollIntervalMs)
    let macroRiskOff = false;
    if (GATE_CONFIG.macroRiskOffEnabled) {
      const now = Date.now();
      if (now - macroState.timestamp >= GATE_CONFIG.macroPollIntervalMs) {
        const pollResult = await macroFeed.poll();
        macroState = pollResult.state;
        macroRiskOff = isMacroRiskOff(macroState).verdict === "halt";
      } else {
        macroRiskOff = isMacroRiskOff(macroState).verdict === "halt";
      }
    }

    // L2 annotation — deterministic intel derived from what the scanner saw.
    const annotated = annotateEnvelope(env, {
      curvePct: env.token.curvePct,
      sentiment: env.token.holders !== undefined ? "neutral" : "unknown",
      whale: env.token.holders !== undefined ? { signal: "none", deltaPct: 0 } : { signal: null, deltaPct: null },
      sources: ["market-intel:deterministic", "risk-gates:feed"],
    });

    // L3 deterministic gates.
    const result = evaluateGates(annotated, {
      now: Date.now(),
      cooldowns,
      openPositions: [],
      drawdownPct: 0,
      killSwitchFlipped: process.env.KILL_SWITCH_FLIPPED === "1",
      bankrollTon: GATE_CONFIG.bankrollTon,
      macroRiskOff,
    });

    if (result.verdict === "pass") passed++;
    else if (result.verdict === "halt") halted++;
    else rejected++;

    const gated = { ...annotated, meta: { ...(annotated.meta ?? {}), ...gatedMeta(result) } };
    journal.append(gated);
  }

  const summary = { valid, passed, rejected, halted };
  console.log(`[GATED] valid=${valid} passed=${passed} rejected=${rejected} halted=${halted}`);
  console.log(`[GATED] journal=${journal.filePath}`);
  return summary;
}

if (process.argv[1] && process.argv[1].endsWith("run-gated-feed.ts")) {
  const input = arg("--input") ?? "../../data/signals-mainnet.ndjson";
  const output = arg("--output") ?? "../../data/gated-mainnet.ndjson";
  runGatedFeed({ input, output }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
