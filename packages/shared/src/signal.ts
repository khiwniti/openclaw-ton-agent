/**
 * SignalEnvelope — the single data contract flowing scanner → agents.
 *
 * Faithful to docs/architecture.md §7. Every downstream persona APPENDS fields
 * (annotated / gated / position) and never mutates prior fields. The core
 * envelope is validated here; ingestion adds lifecycle fields via
 * `IngestedEnvelope` (status/flags/reasoning).
 */
import { z } from "zod";

export const ChainSchema = z.enum(["mainnet", "testnet"]);
export type Chain = z.infer<typeof ChainSchema>;

export const DexSchema = z.enum(["stonfi", "dedust"]);
export type Dex = z.infer<typeof DexSchema>;

export const EnvelopeSourceSchema = z.enum(["radar", "x1000", "audit", "pool", "manual"]);
export type EnvelopeSource = z.infer<typeof EnvelopeSourceSchema>;

export const SignalEnvelopeSchema = z.object({
  id: z.string().min(1),
  ts: z.number().nonnegative().int(),
  source: EnvelopeSourceSchema,
  token: z.object({
    address: z.string().min(1),
    name: z.string(),
    ticker: z.string(),
    decimals: z.number().int().nonnegative().default(9),
    priceTon: z.number().nonnegative().nullable(),
    curvePct: z.number().min(0).max(100).nullable(),
    liquidityTon: z.number().nonnegative().nullable(),
    holders: z.number().int().nonnegative().optional(),
    tags: z.array(z.string()).optional(),
  }),
  audit: z
    .object({
      verified: z.number().min(0).max(100),
      renounced: z.boolean(),
      locked: z.boolean(),
      honeypot: z.boolean(),
    })
    .optional(),
  score: z
    .object({
      soft: z.number().min(0).max(100),
      risk: z.number().min(0).max(100),
    })
    .optional(),
  meta: z.record(z.unknown()).optional(),
});
export type SignalEnvelope = z.infer<typeof SignalEnvelopeSchema>;

export const IngestedEnvelopeSchema = SignalEnvelopeSchema.extend({
  status: z.enum(["validated", "incomplete", "drop"]),
  flags: z.array(z.string()),
  reasoning: z.string(),
});
export type IngestedEnvelope = z.infer<typeof IngestedEnvelopeSchema>;

function errorMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ");
}

export function validateEnvelope(value: unknown): {
  ok: true;
  value: SignalEnvelope;
} | { ok: false; reason: string } {
  const r = SignalEnvelopeSchema.safeParse(value);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, reason: errorMessage(r.error) };
}

export function validateIngested(value: unknown): {
  ok: true;
  value: IngestedEnvelope;
} | { ok: false; reason: string } {
  const r = IngestedEnvelopeSchema.safeParse(value);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, reason: errorMessage(r.error) };
}
