# Coding Conventions

**Analysis Date:** [2026-08-14]

## Repo Layout & Workspace Conventions

- npm workspaces monorepo. All runtime code lives under `packages/<pkg>/src/`; each package has its own `package.json`, and the root `package.json` wires the workspace scripts (`test`, `typecheck`, `scanner:dev`, `backtest`, etc.).
- Cross-package imports go through the workspace package name, never relative paths: `import { validateEnvelope } from "@openclaw-ton-agent/shared"` (see `packages/scanner/src/pipeline.ts`).
- Root `tsconfig.json` compiles every package's `packages/**/src/**/*.ts` plus root scripts with `strict`, `noEmit`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `moduleResolution: bundler`, `target: ES2022`, `lib: ES2023`. Add new source only under a package `src/` tree so it is type-checked by `npm run typecheck` (`tsc --noEmit`).
- No bundler or framework: plain TypeScript executed by `tsx` (devDependency at the root, `tsx ^4.19.2`). Node `>=26.0.0` (root `engines`).

## Naming Patterns

**Files:**
- Source modules: camelCase, `packages/scanner/src/pipeline.ts`, `packages/shared/src/signal.ts`.
- Test files: `<module>.test.ts` colocated next to the module, `packages/shared/src/signal.test.ts`.
- Packages and top-level dirs: kebab-case, `@openclaw-ton-agent/risk-gates`, `packages/shared`.
- Root scripts: kebab-case with explicit `.mjs`, `scripts/validate-openclaw-config.mjs`.

**Functions:**
- camelCase verbs: `validateEnvelope`, `postSignal`, `runScanTick`, `newOrderId`.
- Domain nouns describe the object being built: `newId(prefix)` in `packages/shared/src/newid.ts`, `tempJournal()` in `packages/scanner/src/pipeline.test.ts`.

**Types & Interfaces:**
- PascalCase, often zod-inferred rather than hand-written: `export type IngestedEnvelope = z.infer<typeof envelopeSchema>` in `packages/shared/src/signal.ts`.
- Result shapes use a `{ ok, ... }` or `{ sent, id, reason?, error? }` discriminator: `AuditResult`, `SignalOutResult`, `ScanTickResult`.

**Constants:**
- UPPER_SNAKE_CASE for module-level literals: `OrderSideSchema = z.literal("buy")`, `BURN_PREFIXES` in `packages/scanner/src/audit.ts`, `ExecutionModeSchema = z.enum(["notify_only", "paper", "auto"])` in `packages/shared/src/order.ts`.

**Enum-style values:**
- lowercase strings, not TS enums: `"notify_only" | "paper" | "auto"`, `"stonfi" | "dedust"`, `"radar" | "x1000" | "audit" | "pool" | "manual"` (deduced from fixtures and schemas). Keep new values lowercase so they serialize cleanly into NDJSON.

## Code Style

**Formatting:** No Prettier config present — format by hand to match the surrounding file (2-space indent, single quotes, trailing commas on multiline calls). Run `npm run typecheck` after edits as the lint-equivalent gate; there is no ESLint config in the repo.

**Imports:**
- `import type` for type-only imports; runtime imports stay separate.
- Order: external/workspace packages first (`@openclaw-ton-agent/shared`, `node:test`, `node:http`), then local modules, each group sorted alphabetically.
- Import only what is used — `noUnusedLocals`/`noUnusedParameters` fail the build otherwise.

**JSDoc:**
- Every module starts with a one-line JSDoc header describing its responsibility (`packages/scanner/src/pipeline.ts`, `packages/shared/src/journal.ts`).
- Interfaces and exported function options get per-field JSDoc (see `PipelineOpts` in `packages/scanner/src/pipeline.ts`).

## Validation & Type Safety

- Zod is the validation primitive everywhere. Schema first, then `z.infer` for the type:
  ```typescript
  // packages/shared/src/signal.ts
  export const envelopeSchema = z.object({ /* ... */ });
  export type IngestedEnvelope = z.infer<typeof envelopeSchema>;
  export function validateEnvelope(value: unknown): IngestedEnvelope { ... }
  ```
- Unknown input is parsed at the boundary (HTTP bodies, JSONL rows) and rejected with explicit messages, e.g. `"journal: value is not JSON-serializable"` in `packages/shared/src/journal.ts`.
- Optional numeric fields are nullable (`priceTon: number | null`) rather than optional-and-missing; the shared policy is "never fabricate" missing data — see `packages/shared/src/signal.ts` and the `audit`/`score` tests.

## Error Handling

- Functions return structured results instead of throwing for expected failures: `postSignal` returns `{ sent: false, reason: "SIGNAL_OUT_URL not set" | "HTTP ${status}" | "network error" }` (`packages/scanner/src/signal-out.ts`).
- External polling fails closed: `packages/risk-gates/src/macro-feed.ts` falls back to `{ riskOff: false, reason: "", timestamp: 0 }` on error/abort so a broken feed never silently disables risk gates.
- Hard failure modes are explicit and auditable: the audit path reports `ok: false` with a `flags` entry like `"audit_source_unavailable"` when `TONAPI_KEY` is absent (`packages/scanner/src/audit.ts`).
- Timeouts via `AbortSignal.timeout(5_000)` and abort forwarding, not raw `setTimeout` races (`packages/scanner/src/signal-out.ts`).

## Logging & Persistence

- No logging framework — structured NDJSON append-only journal files. See `packages/shared/src/journal.ts`: `journalPath()` derives `signals-<network>.ndjson`, `maxBytes` defaults to 16MB, and rotation renames to `<file>.1` on overflow.
- Out-of-band events are journaled as tagged records, e.g. `{ kind: "scan.error", source: source.name, error: msg }` on list failure in `packages/scanner/src/pipeline.ts`.
- Env vars are read at module scope and referenced by name (e.g. `SCANNER_CONFIG` with `tonapi.key`, `SIGNAL_OUT_URL`, `TONAPI_KEY`); do not commit values, only names.

## Module Design

- Named exports only — no default exports anywhere in the packages.
- Small focused modules per concern: `signal.ts`, `order.ts`, `journal.ts`, `newid.ts` in `packages/shared/src/`; `gates.ts`, `macro-feed.ts`, `kelly.ts`, `point-setup.ts` in `packages/risk-gates/src/`.
- Pure helpers are exported for testing (`validateIngested`, `newId`, `runScanTick`) so tests exercise the real code path with seeded inputs.

---

*Convention analysis: 2026-08-14*
