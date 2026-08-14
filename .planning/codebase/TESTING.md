# Testing Patterns

**Analysis Date:** [2026-08-14]

## Test Framework

**Runner:**
- Node.js built-in test runner (`node:test`) executed through `tsx` — no vitest, no jest
- Config: none (no `jest.config.*` / `vitest.config.*` anywhere in the repo; tests run via CLI glob)

**Assertion Library:**
- `node:assert/strict` (imported alongside `node:test`)

**Run Commands:**
```bash
npm test --workspaces --if-present   # Run all 7 package suites (root)
tsx --test src/*.test.ts             # Run one package's suite (run inside that package dir)
tsc --noEmit                         # Typecheck gate (root) — run before/with tests
```

## Test File Organization

**Location:**
- Colocated with source: every suite lives next to its module as `src/*.test.ts` (e.g. `packages/shared/src/signal.test.ts` beside `packages/shared/src/signal.ts`)

**Naming:**
- `*.test.ts` suffix — 17 test files across the 7 packages; no `*.spec.ts`

**Structure:**
```
packages/<name>/src/<module>.test.ts   # tests for packages/<name>/src/<module>.ts
```

## Test Structure

**Suite Organization:**
- Flat `test()` calls from `node:test` — one `test()` per scenario; no describe/it nesting detected

**Patterns:**
- Per-file factory helpers at top of suite: `env()` / `ctx()` in `packages/risk-gates/src/gates.test.ts` build typed option objects per case
- Shared helper per suite: `tempJournal()` in `packages/scanner/src/pipeline.test.ts` creates a temp-directory journal and returns the journal plus its path
- Deterministic fixed inputs, never random data

## Mocking

**Framework:** None — no sinon/vitest/jest mocks; doubles are hand-rolled with Node stdlib

**Patterns:**
```typescript
// packages/scanner/src/signal-out.test.ts — in-process HTTP mock server
import { createServer } from "node:http";
// server binds an ephemeral port; test records (method, path, headers, body)
// and asserts on them; requests are bounded with AbortSignal.timeout(5_000)
```

**What to Mock:**
- External HTTP endpoints (a local `node:http` server stands in for the SIGNAL_OUT_URL webhook; HMAC `X-Agent-Secret` header is asserted)
- Filesystem via temp dirs: `fs.mkdtempSync` for journal fixtures (`packages/shared/src/journal.test.ts`)

**What NOT to Mock:**
- Domain logic — scoring, gating, validation, journaling all run for real against fixtures
- `fetch` is not mocked; `TONAPI_KEY` absence is handled by env control — `packages/scanner/src/audit.test.ts` expects `ok: false` plus flag `"audit_source_unavailable"` ("the audit must fail soft — never fabricate")

## Fixtures and Factories

**Test Data:**
```typescript
// packages/scanner/src/pipeline.test.ts — replay envelopes keyed by master address
// "EQA-replay-alpha", "EQB-replay-beta", "EQC-replay-gamma", "EQD-replay-delta"
// fed through runScanTick({ source, journal, emit, seen }); dedupe proven by seeding
// the `seen` Set with an already-emitted master address
```

**Location:**
- Inline in the test file — no separate `__fixtures__` directory detected

## Coverage

**Requirements:** None enforced — no coverage threshold or coverage script in root or package manifests

**View Coverage:** Not configured

## Test Types

**Unit Tests:**
- Default and dominant: pure-logic suites for scoring (`packages/scanner/src/score.test.ts`), validation (`packages/shared/src/signal.test.ts`), gating (`packages/risk-gates/src/gates.test.ts`), journaling (`packages/shared/src/journal.test.ts`)

**Integration Tests:**
- Mock-server suites: `packages/scanner/src/signal-out.test.ts` (HTTP + HMAC header), `packages/scanner/src/pipeline.test.ts` (multi-envelope replay through a scan tick, journal rows revalidated with `status: "validated"`), `packages/risk-gates/src/macro-feed.test.ts` (POST + `accept: application/json`, abort forwarding, fail-closed default)

**E2E Tests:**
- Not used

## Common Patterns

**Async Testing:**
```typescript
// async test() with real awaits; network calls bounded by AbortSignal.timeout(5_000)
test("...", async () => { /* await real async work */ });
```

**Error Testing:**
- Assert outcomes rather than thrown exceptions: soft-fail contracts such as `{ sent: false, reason: "HTTP 500" }` (`signal-out.test.ts`), `ok: false` + `audit_source_unavailable` (`audit.test.ts`), fail-closed risk defaults (`macro-feed.test.ts`)
- Validation rejects via `assert.throws` on `validateEnvelope` / `validateIngested` inputs — negative price, empty address, score > 100 (`packages/shared/src/signal.test.ts`)
- Scoring asserted as ranges, not exact numbers: `risk >= 95` (all-false inputs), `risk >= 40` (partial data), `risk >= 30` (all-null, no pool) in `packages/scanner/src/score.test.ts`

---

*Testing analysis: 2026-08-14*
