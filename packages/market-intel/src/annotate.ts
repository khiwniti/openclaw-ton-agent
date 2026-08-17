/**
 * annotate — the L2 enrichment step. Appends `meta.annotation` to an envelope
 * and NEVER mutates core fields (architecture §7: stages append only).
 * Every annotation carries its source so the intelligence chain is auditable.
 */
import type { IngestedEnvelope } from "@openclaw-ton-agent/shared";
import type { Regime, RegimeResult } from "./regime";
import { curveBand } from "./regime";
import type { WhaleSignal, Sentiment } from "./whales";

export interface AnnotationInput {
  regime?: RegimeResult;
  curvePct?: number | null;
  whale?: { signal: WhaleSignal | null; deltaPct: number | null };
  sentiment?: Sentiment;
  /** Sources cited for the annotation (persona skill names, data feeds). */
  sources: string[];
}

export interface Annotation {
  regime: Regime;
  regimeConfidence: number | null;
  curveBand: "sweet" | "early_curve" | "late_curve" | "unknown";
  whale: WhaleSignal | null;
  whaleDeltaPct: number | null;
  sentiment: Sentiment;
  sources: string[];
  ts: number;
}

export function annotateEnvelope(envelope: IngestedEnvelope, input: AnnotationInput, now = Date.now()): IngestedEnvelope {
  const annotation: Annotation = {
    regime: input.regime?.regime ?? "unknown",
    regimeConfidence: input.regime?.confidence ?? null,
    curveBand: curveBand(input.curvePct ?? envelope.token.curvePct ?? null),
    whale: input.whale?.signal ?? null,
    whaleDeltaPct: input.whale?.deltaPct ?? null,
    sentiment: input.sentiment ?? "unknown",
    sources: input.sources,
    ts: now,
  };
  return {
    ...envelope,
    meta: {
      ...(envelope.meta ?? {}),
      annotation,
    },
  };
}
