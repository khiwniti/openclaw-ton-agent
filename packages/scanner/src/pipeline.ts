/**
 * Scan pipeline (read-only). For each candidate jetton:
 *   audit → score → build SignalEnvelope → validate → journal → signal-out.
 *
 * Deterministic and honest: schema-invalid envelopes are dropped with a
 * reason; missing quotes produce `incomplete` (journaled, not fabricated);
 * the audit must pass before an envelope is emitted.
 */
import { newId, validateEnvelope, validateIngested, type SignalEnvelope, type IngestedEnvelope, type Journal } from "@openclaw-ton-agent/shared";
import { computeScore } from "./score";
import { postSignal } from "./signal-out";
import type { ScannerSource, JettonView } from "./replay";
import { isFixture } from "./replay";

export interface PipelineOpts {
  source: ScannerSource;
  journal: Journal;
  /** Optional emit hook (signal-out). Defaults to postSignal. */
  emit?: (e: SignalEnvelope) => Promise<unknown>;
  /**
   * Dedup store for master addresses. Structural so both a plain `Set` (tests)
   * and the TTL-bounded `SeenCache` (production) satisfy it.
   */
  seen?: { has(key: string): boolean; add(key: string): unknown };
}

export interface ScanTickResult {
  scanned: number;
  emitted: number;
  incomplete: number;
  dropped: number;
  envelopes: IngestedEnvelope[];
}

export async function runScanTick(opts: PipelineOpts): Promise<ScanTickResult> {
  const { source, journal, seen = new Set<string>() } = opts;
  const emit = opts.emit ?? postSignal;
  const result: ScanTickResult = { scanned: 0, emitted: 0, incomplete: 0, dropped: 0, envelopes: [] };

  let recent: JettonView[];
  try {
    recent = await source.listRecent();
  } catch (e: any) {
    const msg = (e as Error)?.message ?? String(e);
    journal.append({ ts: Date.now(), kind: "scan.error", source: source.name, error: msg });
    return result;
  }

  for (const view of recent) {
    if (seen.has(view.master)) continue;
    seen.add(view.master);
    result.scanned++;

    const audit = await source.auditMaster(view.master);
    if (!audit?.ok) {
      journal.append({ ts: Date.now(), kind: "scan.audit_failed", source: source.name, master: view.master });
      result.dropped++;
      continue;
    }

    const hasQuote = view.priceTon !== null && view.liquidityTon !== null;
    const score = computeScore({
      renounced: audit.renounced,
      locked: audit.locked,
      honeypot: audit.honeypot,
      holders: audit.holders,
      ageHours: audit.ageHours,
      liquidityTon: view.liquidityTon,
      poolAvailable: !!view.poolAddress,
    });

    const envelope: SignalEnvelope = {
      id: newId("sig"),
      ts: Date.now(),
      source: isFixture(view.master) ? "audit" : "radar",
      token: {
        address: view.master,
        name: view.name,
        ticker: view.symbol,
        decimals: view.decimals,
        priceTon: view.priceTon,
        curvePct: view.curvePct,
        liquidityTon: view.liquidityTon,
        holders: audit.holders ?? undefined,
        tags: isFixture(view.master) ? [...new Set(["fixture", ...audit.flags])] : audit.flags,
      },
      audit: { verified: audit.verified, renounced: audit.renounced, locked: audit.locked, honeypot: audit.honeypot },
      score: { soft: score.soft, risk: score.risk },
      meta: {
        source: source.name,
        poolAddress: view.poolAddress,
        scoreBreakdown: { audit: score.auditDeduction, holders: score.holdersDeduction, age: score.ageDeduction, liquidity: score.liquidityDeduction, gap: score.dataGapDeduction },
      },
    };

    const parsed = validateEnvelope(envelope);
    if (!parsed.ok) {
      journal.append({ ts: Date.now(), kind: "scan.drop", master: view.master, reason: parsed.reason });
      result.dropped++;
      continue;
    }

    const status = hasQuote ? "validated" : "incomplete";
    if (!hasQuote) result.incomplete++;
    const flags = [...audit.flags];
    if (!hasQuote) flags.push("quote_unavailable");

    const ingested: IngestedEnvelope = {
      ...parsed.value,
      status,
      flags,
      reasoning: `audit.verified=${audit.verified} renounced=${audit.renounced} soft=${score.soft} risk=${score.risk}`,
    };

    const ingestedParsed = validateIngested(ingested);
    if (!ingestedParsed.ok) {
      journal.append({ ts: Date.now(), kind: "scan.drop", master: view.master, reason: `ingest invalid: ${ingestedParsed.reason}` });
      result.dropped++;
      continue;
    }

    journal.append(ingested);
    const emitted = await emit(parsed.value);
    if (emitted && typeof emitted === "object" && "sent" in emitted) {
      (ingested.meta ??= {})["signalOut"] = emitted;
    }
    result.envelopes.push(ingested);
    result.emitted++;
  }

  return result;
}
