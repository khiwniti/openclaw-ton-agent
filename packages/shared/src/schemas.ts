import { z } from "zod";

export type Token = {
  address: string;
  name: string;
  ticker: string;
  decimals: number;
  priceTon?: number | null | undefined;
  curvePct?: number | null | undefined;
  liquidityTon?: number | null | undefined;
  holders?: number | undefined;
};

export type LifecycleState = "OPEN" | "PARTIAL_EXIT" | "FULL_EXIT" | "SETTLED";

export type SettlementStatus = "PENDING" | "CONFIRMED" | "FAILED";

export type FillRecord = {
  id: string;
  positionId: string;
  orderId: string;
  tokenAddress: string;
  action: "BUY" | "SELL";
  qty: number;
  priceTon: number;
  feesTon: number;
  ts: number;
  settlement: SettlementStatus;
  pnlTon?: number; // Realized P&L for SELL actions
};

export type PositionEvent = {
  type: LifecycleState;
  positionId: string;
  ts: number;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
};

export type Audit = {
  verified: number;
  renounced: boolean;
  locked: boolean;
  honeypot: boolean;
};

export type Score = {
  soft: number;
  risk: number;
};

export type SignalEnvelope = {
  id: string;
  ts: number;
  source: string;
  token: Token;
  audit: Audit;
  score: Score;
  meta?: Record<string, unknown> | undefined;
};

export type IngestedEnvelope = {
  id: string;
  ts: number;
  source: string;
  token: Token;
  audit: Audit;
  score: Score;
  status: string;
  flags: string[];
  reasoning: string;
  meta?: Record<string, unknown> | undefined;
};

export const TokenSchema = z.object({
  address: z.string().min(1),
  name: z.string(),
  ticker: z.string(),
  decimals: z.number().int().nonnegative(),
  priceTon: z.number().nonnegative().nullable().optional(),
  curvePct: z.number().nonnegative().nullable().optional(),
  liquidityTon: z.number().nonnegative().nullable().optional(),
  holders: z.number().int().nonnegative().optional(),
});

export const LifecycleStateSchema = z.enum(["OPEN", "PARTIAL_EXIT", "FULL_EXIT", "SETTLED"]);

export const SettlementStatusSchema = z.enum(["PENDING", "CONFIRMED", "FAILED"]);

export const FillRecordSchema = z.object({
  id: z.string(),
  positionId: z.string(),
  orderId: z.string(),
  tokenAddress: z.string(),
  action: z.enum(["BUY", "SELL"]),
  qty: z.number().positive(),
  priceTon: z.number().positive(),
  feesTon: z.number().nonnegative(),
  ts: z.number().positive(),
  settlement: SettlementStatusSchema,
  pnlTon: z.number().optional(),
});

export const PositionEventSchema = z.object({
  type: LifecycleStateSchema,
  positionId: z.string(),
  ts: z.number().positive(),
  payload: z.record(z.unknown()),
  idempotencyKey: z.string().optional(),
});

export const AuditSchema = z.object({
  verified: z.number().min(0).max(100),
  renounced: z.boolean(),
  locked: z.boolean(),
  honeypot: z.boolean(),
});

export const ScoreSchema = z.object({
  soft: z.number().min(0).max(100),
  risk: z.number().min(0).max(100),
});

export const SignalEnvelopeSchema = z.object({
  id: z.string(),
  ts: z.number().nonnegative(),
  source: z.string(),
  token: TokenSchema,
  audit: AuditSchema,
  score: ScoreSchema,
  meta: z.record(z.unknown()).optional(),
});

export const IngestedEnvelopeSchema = z.object({
  id: z.string(),
  ts: z.number().nonnegative(),
  source: z.string(),
  token: TokenSchema,
  audit: AuditSchema,
  score: ScoreSchema,
  status: z.string(),
  flags: z.array(z.string()),
  reasoning: z.string(),
  meta: z.record(z.unknown()).optional(),
});

export function validateEnvelope(input: unknown): { ok: true; value: SignalEnvelope } | { ok: false; reason: string } {
  const result = SignalEnvelopeSchema.safeParse(input);
  if (!result.success) return { ok: false, reason: result.error.message };
  return { ok: true, value: result.data };
}

export function validateIngested(input: unknown): { ok: true; value: IngestedEnvelope } | { ok: false; reason: string } {
  const result = IngestedEnvelopeSchema.safeParse(input);
  if (!result.success) return { ok: false, reason: result.error.message };
  return { ok: true, value: result.data };
}

export function newId(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newOrderId(): string {
  return `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type AgentMessage = {
  id: string;
  from: string;
  to: string;
  kind: string;
  payload: Record<string, unknown>;
  ts: number;
};
