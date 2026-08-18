/**
 * Order hand-off contract — the executor's input (L4).
 *
 * Built deterministically from a gated envelope (meta.gate) by the executor's
 * order-builder; validated here so a malformed request can never reach a
 * wallet. The `mode` field records what the executor is allowed to do with it.
 */
import { z } from "zod";
import { newId } from "./newid";

export const ExecutionModeSchema = z.enum(["notify_only", "paper", "auto"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const OrderSideSchema = z.enum(["buy", "sell"]);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const OrderRequestSchema = z.object({
  id: z.string().min(1),
  ts: z.number().nonnegative().int(),
  /** source envelope that produced this order (a gated IngestedEnvelope). */
  gatedEnvelopeId: z.string().min(1),
  source: z.string(),
  mode: ExecutionModeSchema,
  side: OrderSideSchema,
  token: z.object({
    address: z.string().min(1),
    ticker: z.string(),
    decimals: z.number().int().nonnegative().default(9),
  }),
  /** TON capital committed (Kelly-sized, tier-capped). */
  amountTon: z.number().positive(),
  /** live quote used for sizing (TON per token). */
  entryTon: z.number().positive(),
  stopLossTon: z.number().positive(),
  takeProfitTon: z.number().positive(),
  expectedWinTon: z.number().positive(),
  /** expected output token qty = amountTon / entryTon. */
  expectedTokenQty: z.number().positive(),
  /** min output token qty for the swap = expectedTokenQty × (1 − slippageBps/10000). */
  minOutTokenQty: z.number().nonnegative(),
  slippageBps: z.number().nonnegative(),
  tier: z.enum(["low", "mid", "high"]),
  rRatio: z.number().nonnegative(),
  expectedValueTon: z.number(),
  confirmRequired: z.boolean(),
  /** epoch ms; an unexecuted order expires. */
  deadlineMs: z.number().nonnegative(),
});

export type OrderRequest = z.infer<typeof OrderRequestSchema>;

export function validateOrderRequest(value: unknown): { ok: true; value: OrderRequest } | { ok: false; reason: string } {
  const parsed = OrderRequestSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, reason: errorMessage(parsed.error) };
}

export function newOrderId(): string {
  return newId("ord");
}

function errorMessage(err: z.ZodError): string {
  const first = err.issues[0];
  if (!first) return "unknown validation error";
  return `order request invalid: ${first.path.join(".")} ${first.message}`;
}
