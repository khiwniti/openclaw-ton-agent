# Coding Conventions

**Analysis Date:** 2026-08-16

## Workspace Architecture & Package Conventions

- **Monorepo Structure:** Managed via npm workspaces across 15 packages in `packages/*`. Each package contains an independent `package.json` with an explicit `src/index.ts` public boundary.
- **Cross-Package Imports:** Cross-package imports MUST ALWAYS use the workspace package name (e.g. `import { validateEnvelope } from "@openclaw-ton-agent/shared"` or `import { logger } from "@openclaw-ton-agent/core"`). Relative imports across package boundaries (e.g. `../../shared/src/...`) are strictly prohibited.
- **TypeScript Configuration:** Root `tsconfig.json` compiles all `packages/**/src/**/*.ts` with strict compiler flags:
  - `strict: true`
  - `noEmit: true`
  - `noUnusedLocals: true`
  - `noUnusedParameters: true`
  - `noFallthroughCasesInSwitch: true`
  - `moduleResolution: "bundler"`
  - `target: "ES2022"`, `lib: ["ES2023"]`
- **Zero-Build Execution:** Plain TypeScript is executed directly via `tsx` across development, test running, and Docker production runtime without intermediate transpilation artifacts.

## Naming Patterns

**Files & Directories:**
- TypeScript source modules: kebab-case or camelCase (e.g. `order-builder.ts`, `circuit-breaker.ts`, `macro-feed.ts`, `pipeline.ts`).
- Test files: colocated `<module>.test.ts` or placed in `src/__tests__/<module>.test.ts`.
- Package folders: kebab-case (e.g. `risk-gates`, `exit-manager`, `market-intel`).
- Smart contracts: PascalCase for Tolk contracts (e.g. `Counter.tolk`, `Counter.test.tolk`).
- Script files: kebab-case with appropriate extension (e.g. `start-unified.sh`, `validate-openclaw-config.mjs`).

**Functions & Methods:**
- camelCase verbs describing the exact action: `evaluateGates`, `validateEnvelope`, `runScanTick`, `computeMinOut`, `openPosition`, `buildGramSupervisorGraph`.
- Factory and builder functions: `makeClient`, `makeSafetyCapsNode`, `newId`, `build`.

**Types & Interfaces:**
- PascalCase for all types, interfaces, and Zod schemas: `IngestedEnvelope`, `GatedEnvelope`, `TradeDecision`, `Position`, `GateContext`, `FillResult`, `SwapRequest`.
- Zod schema constants: camelCase or PascalCase ending with `Schema` (e.g. `envelopeSchema`, `orderRequestSchema`, `OrderSideSchema`).

**Constants & Enum-like Values:**
- Module-level constants: `UPPER_SNAKE_CASE` (e.g. `GATE_CONFIG`, `DB_PATH`, `DEFAULT_DECISION_INTERVAL_MS`).
- Enum-style string literals (lowercase unions, not TypeScript `enum`):
  - Trade sides: `"buy" | "sell"`
  - Gate verdicts: `"pass" | "reject" | "halt"`
  - Execution modes: `"notify_only" | "paper" | "auto"`
  - Exit modes: `"snipe" | "swing" | "gamble" | "diamond"`
  - DEX platforms: `"stonfi" | "dedust"`

## Code Style & Formatting

**Indentation & Syntax:**
- 2-space indentation throughout all TypeScript and JSON files.
- Double quotes or single quotes used consistently per package file.
- Semicolons are optional but consistent within each module.
- Trailing commas enabled for multiline object and array literals.

**Lint & Compile Gate:**
- Run `npm run typecheck` (`tsc --noEmit`) as the primary compilation and type-safety gate. Any unused variable or parameter will immediately fail the check due to strict flags.

## Import Organization

Imports follow a strict 4-tier hierarchy separated by blank lines:

```typescript
// 1. Node.js built-in modules (with node: prefix)
import fs from "node:fs";
import path from "node:path";

// 2. External third-party dependencies
import { Address, beginCell, toNano } from "@ton/ton";
import { z } from "zod";

// 3. Monorepo workspace packages
import { logger } from "@openclaw-ton-agent/core";
import { type IngestedEnvelope, validateEnvelope } from "@openclaw-ton-agent/shared";

// 4. Local package-relative imports
import { GATE_CONFIG } from "./config.js";
import { pointSetup } from "./point-setup.js";
```

- Type-only imports MUST use `import type { ... }` or inline `import { type Foo }` to ensure clean tree-shaking and runtime separation.

## Validation & Type Safety

- **Schema-First Design:** All external data (API request bodies, WebSocket messages, on-chain trace responses, NDJSON journal entries) must be validated with Zod at the application boundary before entering internal logic.
- **Inferred Types:** Derive TypeScript types directly from Zod schemas using `z.infer<typeof schema>` to maintain a single source of truth (`packages/shared/src/schemas.ts`, `packages/shared/src/signal.ts`).
- **No Data Fabrication:** Missing numeric fields are represented as `null` (e.g. `priceTon: number | null`), never fabricated as `0` or estimated unless explicitly derived by an intelligence node.

## Error Handling Patterns

- **Structured Result Objects:** Domain functions return structured result discriminators (`{ ok: boolean, error?: string, ... }` or `{ verdict: "pass" | "reject" | "halt", reasons: string[] }`) rather than throwing unexpected exceptions:
  ```typescript
  export interface SwapResult {
    ok: boolean;
    txHash?: string;
    amountTokens?: number;
    error?: string;
  }
  ```
- **Fail-Closed Risk Gate Philosophy:** When risk calculations encounter network timeouts, missing data feeds, or unexpected errors, the gates MUST default to halting or rejecting the trade:
  ```typescript
  // If macro feed fails, fail closed with safe default
  if (!feedResponse.ok) {
    return { riskOff: true, reason: "macro_feed_unreachable" };
  }
  ```
- **Explicit Timeout Guards:** Asynchronous external network calls must always be bounded with `AbortSignal.timeout(ms)` to prevent hanging promises in event loops.

## Logging & Telemetry

- **Structured Logging:** Use `logger` from `@openclaw-ton-agent/core`:
  ```typescript
  import { logger } from "@openclaw-ton-agent/core";

  logger.info("SCANNER", `Ingested signal: ${envelope.id} for token ${envelope.jettonMaster}`);
  logger.warn("RISK_GATE", `Trade rejected: ${reasons.join(", ")}`);
  logger.error("EXECUTOR", `Swap execution failed`, err);
  ```
- **Immutable NDJSON Audit Trails:** Critical lifecycle events (signals, risk decisions, orders, fills, agent messages) are appended to rotated NDJSON journals via `Journal` (`packages/shared/src/journal.ts`) and SQLite (`packages/storage/src/store.ts`).

## Module & Function Design

- **Named Exports Exclusively:** Default exports are avoided in package source files; all modules use explicit named exports (`export function evaluateGates(...)`, `export class ActonWallet(...)`).
- **Options Objects for Extensibility:** Functions taking more than 2 parameters should accept a typed options object (e.g. `GateContext`, `PipelineOpts`, `ActonWalletOptions`).
- **Pure Helpers vs State Managers:** Pure calculation logic (e.g. `chandelierStop`, `sizedPositionTon`, `computeMinOut`) is isolated in separate pure functions for straightforward unit testing.

---

*Convention analysis: 2026-08-16*
