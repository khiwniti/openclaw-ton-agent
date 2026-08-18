export type Tier = "low" | "mid" | "high"

export const ALL_TIERS: Tier[] = ["low", "mid", "high"]

export interface TierHandle {
  tier: Tier
  balanceTon: number
  openPositions: number
  maxPositionTon: number
  maxOpen: number
  address?: string
}

export interface TradeTicket {
  cycle_id: string
  tier: Tier
  side: "buy" | "sell"
  jetton_master: string
  amount_ton: number
  slippage_pct: number
  pool_tvl_ton?: number
  ai_score?: number
}

export interface RiskAssessment {
  score: number
  verdict: "pass" | "caution" | "reject"
  reasons: string[]
}

export interface AuthorizedExecution {
  ticket: TradeTicket
  cap: CapCheckResult
}

export interface CapCheckResult {
  ok: boolean
  reason?: string
  ticket_hash?: string
  cycle_id?: string
  issued_at?: number
}

export type GramTradeState = {
  cycle_id: string
  tier: Tier
  seed_jetton_master?: string
  candidate?: JettonCandidate | null
  risk_assessment?: RiskAssessment | null
  proposed_ticket?: TradeTicket | null
  cap_check_result?: CapCheckResult | null
  execution_result?: ExecutionResult | null
  open_positions: number
  discarded: boolean
  discard_reason?: string
  todo_plan: TodoItem[]
  journal_ref?: string
}

export interface SniperMeta {
  viable: boolean;
  sizeTon: number;
  reason: string;
  gatePassed: boolean;
  blockReason?: string;
}

export interface JettonCandidate {
  jetton_master: string
  symbol?: string
  pool_address?: string
  pool_tvl_ton?: number
  volume_24h_ton?: number
  price_ton?: number
  price_change_24h_pct?: number
  liquidity_ton?: number
  holders?: number
  age_hours?: number
  bonding_curve_pct?: number
  source: "stonfi" | "dedust" | "tonapi" | "manual"
  enriched_at: number
  sniper?: SniperMeta | null;
}

export interface ExecutionResult {
  ok: boolean
  txHash?: string
  amountTokens?: number
  dex?: string
  error?: string
}

export interface TodoItem {
  id: string
  content: string
  status: "pending" | "done" | "failed"
}

export interface MarketScannerInput {
  cycle_id: string
  seed_jetton_master?: string
}

export interface MarketScannerOutput {
  cycle_id: string
  candidates: JettonCandidate[]
  winner?: JettonCandidate
}

export interface RiskAnalystInput {
  cycle_id: string
  jetton_master: string
  candidate?: JettonCandidate
}

export interface StrategyInput {
  cycle_id: string
  tier: Tier
  candidate: JettonCandidate
  risk_assessment: RiskAssessment
  tier_state: { balance_ton: number; open_positions: number; max_position_ton: number; max_open: number }
}

export interface StrategyOutput {
  cycle_id: string
  ticket: TradeTicket | null
  rationale: string
}

export interface ExecutionInput {
  cycle_id: string
  ticket: TradeTicket
  cap: CapCheckResult
  dex_override?: "stonfi" | "dedust"
}

export interface ExecutionOutput {
  cycle_id: string
  ok: boolean
  result: ExecutionResult | null
  error?: string
}

export interface SupervisorOutput {
  state: Partial<GramTradeState>
  next: "end" | "risk_analyst" | "strategy" | "safety_caps" | "execution" | "postmortem"
  plan_step: string
}
