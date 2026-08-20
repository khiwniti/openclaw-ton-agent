#!/usr/bin/env bash
# Apply Phase 1 plan packet for OpenClaw TON Trading Agent - FIXED v2
# Run this script from the project root: ./apply-plan.sh

set -euo pipefail

RUN_DIR=".pi/harness/runs/run-openclaw"
PLAN_PACKET="$RUN_DIR/plan-packet.yaml"

echo "Writing plan-packet.yaml to $PLAN_PACKET..."

cat > "$PLAN_PACKET" << 'EOF'
schema_version: "1.0.0"
contract_version: "1.1.0"
plan_id: plan-openclaw-phase1
task_id: phase1-correctness
scope: |
  Implement Phase 1 of the Production Improvement Plan: Fix correctness for the OpenClaw TON Trading Agent.
  This includes lifecycle state, duplicate-exit prevention, remaining quantity calculation, settlement-based close, and durable P&L.
assumptions:
  - "The existing monorepo packages (scanner, executor, exit-manager, storage) are stable enough for incremental refactor."
  - "Position types are centralized in a shared package and can be extended without breaking downstream consumers."
  - "Settlement verification can be performed via existing ton-settlement skill or equivalent on-chain query."
  - "The Position interface in packages/exit-manager/src/position.ts is the authoritative source and will be extended."
  - "Scanner and executor logic changes are isolated to their respective packages."
  - "Journal-first architecture is preserved; PositionStateMachine adds explicit state transitions via append-only journal."
  - "Idempotency keys will use deterministic SHA-256 hash of (tokenAddress, fromVersion, action, exitPrice)."
  - "Async settlement via background reconciler keeps high-priority exit queue unblocked."
risk_level: med
acceptance_checks:
  - id: AC-1
    description: "Position interface has lifecycleState and OPEN-only monitoring is enforced."
  - id: AC-2
    description: "Duplicate exits are prevented by an activeExitOrderId / exitInFlight guard."
  - id: AC-3
    description: "Sell orders use remainingQty."
  - id: AC-4
    description: "Sell/P&L handling waits for settlement verification before marking position CLOSED."
  - id: AC-5
    description: "A canonical Fill record schema is implemented."
rollback_plan:
  revert_commit_ready: true
  rollback_artifacts:
    revert_command: "git reset --hard HEAD~1"
    revert_branch: "main"
    patch_bundle: "rollback.patch"
execution_plan:
  dag_mode: strict
  phases:
    - phase_id: phase-types
      name: "Define Lifecycle and Fill Types"
      exit_criteria:
        - "Position interface has lifecycleState enum (OPEN, PARTIAL_EXIT, FULL_EXIT, SETTLED)"
        - "Position interface has activeExitOrderId field for duplicate-exit guard"
        - "Fill record type defined with required fields including settlement status"
        - "PositionEvent types (OPEN, PARTIAL_EXIT, FULL_EXIT, SETTLED) defined"
      work_item_ids: [wi-types-1, wi-types-2, wi-types-3]
    - phase_id: phase-monitoring
      name: "Enforce OPEN-only monitoring"
      exit_criteria:
        - "Scanner filters positions by lifecycleState == OPEN"
        - "Executor skips non-OPEN positions in monitoring loop"
        - "Unit tests pass for OPEN-only enforcement"
        - "reconstructPosition() folds journal to derive current state"
      work_item_ids: [wi-monitor-1, wi-monitor-2, wi-monitor-3]
    - phase_id: phase-exit-guard
      name: "Implement exit guard and remainingQty"
      exit_criteria:
        - "exitInFlight/activeExitOrderId guard prevents duplicate exits via idempotency keys"
        - "Sell order construction uses remainingQty from reconstructed position"
        - "Unit tests pass for duplicate-exit prevention and remainingQty calculation"
        - "PositionJournal appends events with idempotencyKey deduplication"
      work_item_ids: [wi-exit-1, wi-exit-2, wi-exit-3]
    - phase_id: phase-settlement
      name: "Settlement verification and P&L"
      exit_criteria:
        - "Position close flow sets FULL_EXIT state with settlement='PENDING', then SETTLED on confirmation"
        - "Fill records created on confirmed settlement with durable P&L entries"
        - "Integration tests pass for settlement-based close and Fill record creation"
        - "Background reconciler polls ton-settlement skill for pending fills"
      work_item_ids: [wi-settle-1, wi-settle-2, wi-settle-3]
  work_items:
    - work_item_id: wi-types-1
      phase_id: phase-types
      depends_on: []
      files: [packages/exit-manager/src/position.ts, packages/shared/src/schemas.ts]
      acceptance_check_ids: [AC-1, AC-5]
      non_code: false
    - work_item_id: wi-types-2
      phase_id: phase-types
      depends_on: [wi-types-1]
      files: [packages/exit-manager/src/position.ts, packages/exit-manager/src/state-machine.ts]
      acceptance_check_ids: [AC-1, AC-2]
      non_code: false
    - work_item_id: wi-types-3
      phase_id: phase-types
      depends_on: [wi-types-1]
      files: [packages/shared/src/schemas.ts, packages/exit-manager/src/journal.ts]
      acceptance_check_ids: [AC-5]
      non_code: false
    - work_item_id: wi-monitor-1
      phase_id: phase-monitoring
      depends_on: [wi-types-1]
      files: [packages/scanner/src/pipeline.ts, packages/scanner/src/index.ts]
      acceptance_check_ids: [AC-1]
      non_code: false
    - work_item_id: wi-monitor-2
      phase_id: phase-monitoring
      depends_on: [wi-types-1]
      files: [packages/executor/src/continuous.ts, packages/executor/src/index.ts, packages/executor/src/order-queue.ts]
      acceptance_check_ids: [AC-1]
      non_code: false
    - work_item_id: wi-monitor-3
      phase_id: phase-monitoring
      depends_on: [wi-monitor-1, wi-monitor-2]
      files: [packages/scanner/src/__tests__/pipeline.test.ts, packages/executor/src/__tests__/continuous.test.ts, packages/exit-manager/src/__tests__/state-machine.test.ts]
      acceptance_check_ids: [AC-1]
      non_code: false
    - work_item_id: wi-exit-1
      phase_id: phase-exit-guard
      depends_on: [wi-types-2, wi-monitor-2]
      files: [packages/exit-manager/src/decide.ts, packages/exit-manager/src/index.ts, packages/exit-manager/src/journal.ts]
      acceptance_check_ids: [AC-2]
      non_code: false
    - work_item_id: wi-exit-2
      phase_id: phase-exit-guard
      depends_on: [wi-types-2]
      files: [packages/executor/src/order-builder.ts, packages/executor/src/wallet.ts]
      acceptance_check_ids: [AC-3]
      non_code: false
    - work_item_id: wi-exit-3
      phase_id: phase-exit-guard
      depends_on: [wi-exit-1, wi-exit-2]
      files: [packages/exit-manager/src/__tests__/decide.test.ts, packages/executor/src/__tests__/order-builder.test.ts, packages/exit-manager/src/__tests__/journal.test.ts]
      acceptance_check_ids: [AC-2, AC-3]
      non_code: false
    - work_item_id: wi-settle-1
      phase_id: phase-settlement
      depends_on: [wi-exit-1]
      files: [packages/exit-manager/src/decide.ts, packages/exit-manager/src/position.ts, packages/exit-manager/src/journal.ts, packages/exit-manager/src/reconciler.ts]
      acceptance_check_ids: [AC-4]
      non_code: false
    - work_item_id: wi-settle-2
      phase_id: phase-settlement
      depends_on: [wi-settle-1]
      files: [packages/shared/src/schemas.ts, packages/storage/src/store.ts, packages/exit-manager/src/journal.ts]
      acceptance_check_ids: [AC-4, AC-5]
      non_code: false
    - work_item_id: wi-settle-3
      phase_id: phase-settlement
      depends_on: [wi-settle-1, wi-settle-2]
      files: [packages/exit-manager/src/__tests__/settlement.test.ts, packages/exit-manager/src/__tests__/reconciler.test.ts]
      acceptance_check_ids: [AC-4, AC-5]
      non_code: false
  risk_register:
    - id: R-1
      description: "Position type changes may break downstream consumers in scanner, executor, storage"
      likelihood: "med"
      impact: "high"
      mitigation: "Add lifecycleState as optional with default OPEN; phased migration with OPEN-only monitoring first"
    - id: R-2
      description: "Settlement verification may introduce latency in position close flow"
      likelihood: "med"
      impact: "med"
      mitigation: "Async polling with timeout; configurable retry; fallback to SETTLEMENT_FAILED after max attempts"
    - id: R-3
      description: "exitInFlight guard may prevent legitimate retry after network failure"
      likelihood: "low"
      impact: "high"
      mitigation: "Include timeout/expiry on activeExitOrderId; allow manual override via manual-override skill"
    - id: R-4
      description: "remainingQty calculation may drift from on-chain reality due to partial fills"
      likelihood: "med"
      impact: "med"
      mitigation: "Reconcile remainingQty with on-chain state on each position poll; log discrepancies to positionsJournal"
    - id: R-5
      description: "Journal folding latency may exceed 2ms p99 target for 5s polling loop"
      likelihood: "low"
      impact: "med"
      mitigation: "In-memory journal cache with periodic snapshots; benchmark with fast-check property tests"
  schedule_metadata:
    critical_path_work_item_ids: [wi-types-1, wi-types-2, wi-exit-1, wi-settle-1, wi-settle-2, wi-settle-3]
executor_strategy: single_pass
EOF

echo "Plan packet written. Running DAG validation..."

node /root/.pi/agent/npm/node_modules/ultimate-pi/.pi/scripts/validate-plan-dag.mjs --packet "$PLAN_PACKET" --write

echo ""
echo "✅ DAG validation complete!"
echo ""
echo "Next steps (run in your AI session with harness tools):"
echo "  approve_plan({ human_summary: \"Phase 1 correctness fixes via journal-backed PositionStateMachine with idempotency keys and async settlement-gated P&L\" })"
echo "  create_plan()"
echo ""
echo "Then run:"
echo "  /harness-run"