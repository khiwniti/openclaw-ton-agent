import type { GramTradeState, TodoItem, SupervisorOutput } from "../state.js"
import { marketScannerNode } from "./market-scanner.js"
import { riskAnalystNode } from "./risk-analyst.js"
import { strategyNode } from "./strategy.js"

function buildInitialPlan(cycle_id: string): TodoItem[] {
  return [
    { id: `${cycle_id}-1`, content: "Scan market for candidates", status: "pending" },
    { id: `${cycle_id}-2`, content: "Risk analysis", status: "pending" },
    { id: `${cycle_id}-3`, content: "Risk gate", status: "pending" },
    { id: `${cycle_id}-4`, content: "Strategy & sizing", status: "pending" },
    { id: `${cycle_id}-5`, content: "SafetyCaps authorization", status: "pending" },
    { id: `${cycle_id}-6`, content: "Execute swap", status: "pending" },
    { id: `${cycle_id}-7`, content: "Postmortem journal", status: "pending" },
  ]
}

function ensurePlan(plan: TodoItem[] | undefined, cycle_id: string): TodoItem[] {
  if (plan && plan.length > 0) return plan
  return buildInitialPlan(cycle_id)
}

function updatePlan(plan: TodoItem[], id: string, status: TodoItem["status"]): TodoItem[] {
  return plan.map((item) => (item.id === id ? { ...item, status } : item))
}

export async function supervisorNode(
  state: GramTradeState,
  getTierState: (tier: string) => Promise<{ balance_ton: number; open_positions: number }>
): Promise<SupervisorOutput> {
  const { cycle_id, tier, discarded, candidate, risk_assessment, proposed_ticket, todo_plan } = state
  if (discarded) return { state: {}, next: "end", plan_step: "Cycle discarded" }

  const plan = ensurePlan(todo_plan, cycle_id)

  if (!candidate && plan[0] && plan[0].status !== "done") {
    const out = await marketScannerNode({ cycle_id, seed_jetton_master: state.seed_jetton_master })
    if (out.candidates.length === 0) {
      return { state: { discarded: true, discard_reason: "no candidates found", todo_plan: updatePlan(plan, `${cycle_id}-1`, "done") }, next: "end", plan_step: "No candidates" }
    }
    return { state: { candidate: out.candidates[0], todo_plan: updatePlan(plan, `${cycle_id}-1`, "done") }, next: "risk_analyst", plan_step: "Candidate selected" }
  }

  if (!risk_assessment && plan[1] && plan[1].status !== "done") {
    const out = await riskAnalystNode({ cycle_id, jetton_master: candidate!.jetton_master, candidate: candidate! })
    if (out.assessment.verdict === "reject") {
      return { state: { discarded: true, discard_reason: "risk_rejected", todo_plan: updatePlan(plan, `${cycle_id}-2`, "done") }, next: "end", plan_step: "Risk rejected" }
    }
    return { state: { risk_assessment: out.assessment, todo_plan: updatePlan(plan, `${cycle_id}-2`, "done") }, next: "strategy", plan_step: "Risk passed" }
  }

  if (!proposed_ticket && plan[3] && plan[3].status !== "done") {
    const tierState = await getTierState(tier)
    const out = await strategyNode({
      cycle_id,
      tier,
      candidate: candidate!,
      risk_assessment: risk_assessment!,
      tier_state: { balance_ton: tierState.balance_ton, open_positions: tierState.open_positions, max_position_ton: 5, max_open: 3 },
    })
    if (!out.ticket) {
      return { state: { discarded: true, discard_reason: "no_ticket", todo_plan: updatePlan(plan, `${cycle_id}-4`, "done") }, next: "end", plan_step: "No ticket" }
    }
    return { state: { proposed_ticket: out.ticket, todo_plan: updatePlan(plan, `${cycle_id}-4`, "done") }, next: "safety_caps", plan_step: "Ticket proposed" }
  }

  return { state: {}, next: "safety_caps", plan_step: "Advancing to safety caps" }
}
