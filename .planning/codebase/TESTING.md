# Testing Patterns

**Analysis Date:** 2026-08-16

## Test Framework

**TypeScript / Node.js Runner:**
- Runner: Node.js built-in test runner (`node:test`) executed directly via `tsx --test`.
- Assertion Library: `node:assert/strict` (standard Node.js assertion library with deep equality).
- No external heavy testing frameworks (no Jest, Vitest, or Mocha required).

**Smart Contract Test Runner:**
- Runner: Acton CLI (`acton test`).
- Target: Native Tolk test files located in `tests/*.test.tolk` testing contracts in `contracts/*.tolk`.

**Run Commands:**

```bash
# Run all workspace package test suites
npm test --workspaces --if-present

# Run a specific package's test suite
npm --workspace packages/risk-gates run test
# OR inside a package directory:
tsx --test 'src/**/*.test.ts'

# Run with watch mode (supported in packages/api and packages/orchestration)
npm --workspace packages/api run test:watch

# Compile & Typecheck validation gate (all packages)
npm run typecheck
```

```bash
# Smart contract test execution (Acton)
acton test
```

## Test File Organization

**Location:**
- Colocated with source code: `packages/<name>/src/<module>.test.ts` (e.g. `packages/risk-gates/src/gates.test.ts`).
- Dedicated `__tests__` directories: `packages/<name>/src/__tests__/<module>.test.ts` used in `packages/api` and `packages/orchestration` (e.g. `packages/api/src/__tests__/decisions.test.ts`, `packages/orchestration/src/__tests__/gate.test.ts`).
- Smart Contract tests: `tests/<ContractName>.test.tolk`.

**Naming:**
- Unit & integration tests: `*.test.ts`.
- Contract tests: `*.test.tolk`.

## Test Structure & Patterns

**Basic Test Structure:**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGates } from "../src/gates.js";
import type { IngestedEnvelope, GateContext } from "@openclaw-ton-agent/shared";

test("evaluateGates returns pass for valid low-risk envelope", () => {
  const envelope: IngestedEnvelope = {
    id: "sig_test_1",
    timestamp: Date.now(),
    jettonMaster: "EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt",
    score: { hard: 100, soft: 85 },
    priceTon: 1.5,
    liquidityTon: 5000,
    volume24hTon: 12000,
    poolAddress: "EQD...",
    dex: "dedust",
  };

  const ctx: GateContext = {
    now: Date.now(),
    cooldowns: new Map(),
    openPositions: [],
    drawdownPct: 5,
    killSwitchFlipped: false,
    bankrollTon: 100,
  };

  const result = evaluateGates(envelope, ctx);
  assert.equal(result.verdict, "pass");
  assert.ok(result.sizeTon > 0);
});
```

## Mocking Strategies

**1. In-Process HTTP Mock Servers (`node:http`):**
Used for testing outgoing webhooks and external API endpoints without hitting live services:

```typescript
// Example from packages/scanner/src/signal-out.test.ts
import { createServer } from "node:http";

test("signal-out posts webhook with HMAC header", async () => {
  const server = createServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.ok(req.headers["x-agent-secret"]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  // Exercise signal-out against http://127.0.0.1:${port}
  server.close();
});
```

**2. Temporary Filesystem Journals (`fs.mkdtempSync`):**
Used for testing append-only NDJSON journaling and rotation without mutating production `data/` files:

```typescript
// Example from packages/shared/src/journal.test.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function createTempJournalDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-test-"));
}
```

**3. In-Memory SQLite Databases:**
Tests for `packages/storage` instantiate fresh SQLite databases using `:memory:` or temporary disk files to guarantee isolation between tests.

## Fixtures and Factories

**Test Fixtures:**
- Deterministic synthetic market data and klines in `packages/backtest/src/fixture.ts`.
- Recorded mainnet signal stream sample in `packages/scanner/data/signals-mainnet.ndjson`.

**Factory Functions:**
- Suites define local factory functions (e.g. `makeEnvelope()`, `makeGateContext()`, `makeOrderRequest()`) to populate valid default objects while allowing tests to override specific fields.

## Test Types

### 1. Unit Tests (Pure Logic)
- **Scope:** Risk gate math (`packages/risk-gates`), Kelly position sizing (`kelly.ts`), Chandelier stop-loss math (`packages/exit-manager/src/position.ts`), slippage & min-out calculations (`packages/dex/src/router.ts`), ID generators (`packages/shared/src/newid.ts`).
- **Characteristics:** Fast, synchronous, 100% deterministic, zero network dependencies.

### 2. Integration Tests
- **Scope:** Fastify route endpoints (`packages/api/src/__tests__/*`), scanner pipeline ticks (`packages/scanner/src/pipeline.test.ts`), Redis agent bus dispatch (`packages/agents/src/bus.ts`), continuous runner tick loops.
- **Characteristics:** Spawns ephemeral in-memory servers or local SQLite databases, exercises async pipelines end-to-end.

### 3. Smart Contract Tests
- **Scope:** Native Tolk smart contract behavior, internal message dispatch, state cell serialization.
- **Characteristics:** Executed in the Acton TVM simulator via `acton test`.

## Common Testing Patterns

**Async Testing & Timeouts:**
```typescript
test("async pipeline completes within timeout", async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await runScanTick({ signal: controller.signal });
    assert.ok(res.ok);
  } finally {
    clearTimeout(timeout);
  }
});
```

**Boundary & Error Testing:**
```typescript
test("validates envelope rejects invalid address", () => {
  assert.throws(
    () => validateEnvelope({ id: "123", jettonMaster: "invalid-address" }),
    /Invalid/
  );
});
```

---

*Testing analysis: 2026-08-16*
