# Graph Report - openclaw-ton-agent  (2026-08-20)

## Corpus Check
- 299 files · ~121,936 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 526 nodes · 448 edges · 78 communities (75 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d1894a98`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- OpenClaw TON Agent — Session Handoff Package
- OpenClaw TON Trading Agent — Architecture Design Document
- Architecture
- Simulation Wallet Design
- TON MCP Raw CLI Mode
- TON MCP Raw CLI Mode
- xStocks on TON (buy / sell)
- xStocks on TON (buy / sell)
- Testing Patterns
- Codebase Concerns
- TON Wallet Management
- AI Multi-Agent Trading System — Rule of Thumb
- FlyMCP
- TON Wallet Management
- Coding Conventions
- External Integrations
- Codebase Structure
- Workflows
- Workflows
- Technology Stack
- Create TON Agentic Wallet
- TON Documentation
- TON NFT Operations
- Create TON Agentic Wallet
- TON Documentation
- TON NFT Operations
- Send TON & Tokens
- OpenClaw TON Agent - Project Memory
- ton-execute
- Send TON & Tokens
- ton-execute
- deepwiki
- Architecture
- TON Docs-first workflow
- ton-exit-modes
- ton-tpsl-manager
- Incident Report: INC-2026-08-20-001
- ton-exit-modes
- ton-tpsl-manager
- Project Context & Technical Architecture
- Swap TON Tokens
- Global Constraints
- OpenClaw TON Trading Agent — Architecture Design Document
- ton-reporting
- ton-signal-ingest
- Swap TON Tokens
- Harness Artifact Contracts
- openclaw-ton-agent
- ton-reporting
- ton-signal-ingest
- Executor — AGENTS.md
- Market Intel — AGENTS.md
- Risk Analyst — AGENTS.md
- Scanner Ops — AGENTS.md
- Scanner Ops
- Trader UI — AGENTS.md
- ultimate-pi: Agentic Harness
- manual-override
- ton-audit
- ton-risk-gates
- ton-settlement
- manual-override
- ton-audit
- ton-risk-gates
- ton-settlement
- Executor
- Market Intel
- Risk Analyst
- Trader UI
- CLAUDE.md
- .openharness/README.md
- flymcp

## God Nodes (most connected - your core abstractions)
1. `Architecture` - 12 edges
2. `xStocks on TON (buy / sell)` - 11 edges
3. `xStocks on TON (buy / sell)` - 11 edges
4. `Simulation Wallet Design` - 11 edges
5. `Codebase Concerns` - 10 edges
6. `Coding Conventions` - 9 edges
7. `External Integrations` - 9 edges
8. `OpenClaw TON Agent — Session Handoff Package` - 9 edges
9. `AI Multi-Agent Trading System — Rule of Thumb` - 9 edges
10. `TON MCP Raw CLI Mode` - 8 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (78 total, 3 thin omitted)

### Community 0 - "OpenClaw TON Agent — Session Handoff Package"
Cohesion: 0.11
Nodes (18): 1. SESSION GOAL, 2. WHAT WAS ACCOMPLISHED, 3. CURRENT BLOCKER, 4. PRODUCTION LOG REVIEW (PENDING), 5. FILES TO REVIEW NEXT SESSION, 6. RECOMMENDED NEXT STEPS, 7. KEY DECISIONS & CONTEXT, 8. QUICK REFERENCE (+10 more)

### Community 1 - "OpenClaw TON Trading Agent — Architecture Design Document"
Cohesion: 0.11
Nodes (17): 1. System Overview & Core Objectives, 2. High-Level Pipeline Architecture, 3.1. Scanner & Safety Audit Layer (`packages/scanner`, `packages/security`), 3.2. Risk Gates Layer (`packages/risk-gates`), 3.3. Asynchronous Order Queue Manager (`packages/executor/src/order-queue.ts`), 3.4. Multi-DEX & Multi-Hop Execution Engine (`packages/executor/src/acton`), 3.5. 8-Tier Exit Precedence Waterfall (`packages/exit-manager/src/decide.ts`), 3. Subsystem Breakdown (+9 more)

### Community 2 - "Architecture"
Cohesion: 0.11
Nodes (17): 1. Direct LLM-to-Chain Execution, 2. Bypassing Safety Caps with Raw Swaps, 3. Relative Cross-Package Imports, Anti-Patterns to Avoid, Architectural Constraints, Architecture, Component Responsibilities, Cross-Cutting Concerns (+9 more)

### Community 3 - "Simulation Wallet Design"
Cohesion: 0.12
Nodes (16): Architecture, `continuous.ts` change, Deployment stages, Env Flags, Files touched, Fill Journal Entry (on sim reject), Goal, Interface (+8 more)

### Community 4 - "TON MCP Raw CLI Mode"
Cohesion: 0.13
Nodes (14): DNS, Environment Variables, Example Session, Invocation Modes, NFTs, Notes, Output, Raw CLI Usage (+6 more)

### Community 5 - "TON MCP Raw CLI Mode"
Cohesion: 0.13
Nodes (14): DNS, Environment Variables, Example Session, Invocation Modes, NFTs, Notes, Output, Raw CLI Usage (+6 more)

### Community 6 - "xStocks on TON (buy / sell)"
Cohesion: 0.17
Nodes (11): Buy workflow, CLI argument names (exact), Key addresses, MCP tools, Omniston quirks, Post-trade checks, Pre-fund USDT (auto, when needed), Relations (+3 more)

### Community 7 - "xStocks on TON (buy / sell)"
Cohesion: 0.17
Nodes (11): Buy workflow, CLI argument names (exact), Key addresses, MCP tools, Omniston quirks, Post-trade checks, Pre-fund USDT (auto, when needed), Relations (+3 more)

### Community 8 - "Testing Patterns"
Cohesion: 0.17
Nodes (11): 1. Unit Tests (Pure Logic), 2. Integration Tests, 3. Smart Contract Tests, Common Testing Patterns, Fixtures and Factories, Mocking Strategies, Test File Organization, Test Framework (+3 more)

### Community 9 - "Codebase Concerns"
Cohesion: 0.18
Nodes (10): Codebase Concerns, Dependencies at Risk, Fragile Areas, Known Bugs & Operational Risks, Missing Critical Features, Performance Bottlenecks, Scaling Limits, Security Considerations (+2 more)

### Community 10 - "TON Wallet Management"
Cohesion: 0.20
Nodes (9): Agentic Wallet Management, Import Existing Agentic Wallet, MCP Tools, Notes, Rotate Operator Key, Switch Active Wallet, TON Wallet Management, Wallet Registry (+1 more)

### Community 11 - "AI Multi-Agent Trading System — Rule of Thumb"
Cohesion: 0.20
Nodes (9): 1. Mode first, 2. Gating is non-optional, 3. Kill switch wins, 4. Journal everything, 5. Observe before automate, 6. Single responsibility per agent, 7. Fail closed, 8. Human override always available (+1 more)

### Community 12 - "FlyMCP"
Cohesion: 0.20
Nodes (9): Authentication, Claude Desktop Setup, Configuration, Development, FlyMCP, Installation, License, Prerequisites (+1 more)

### Community 13 - "TON Wallet Management"
Cohesion: 0.20
Nodes (9): Agentic Wallet Management, Import Existing Agentic Wallet, MCP Tools, Notes, Rotate Operator Key, Switch Active Wallet, TON Wallet Management, Wallet Registry (+1 more)

### Community 14 - "Coding Conventions"
Cohesion: 0.20
Nodes (9): Code Style & Formatting, Coding Conventions, Error Handling Patterns, Import Organization, Logging & Telemetry, Module & Function Design, Naming Patterns, Validation & Type Safety (+1 more)

### Community 15 - "External Integrations"
Cohesion: 0.20
Nodes (9): APIs & External Services, Authentication & Identity, CI/CD & Deployment, Data Storage, Environment Configuration, External Integrations, Monitoring & Observability, OpenClaw MCP Plugins (+1 more)

### Community 16 - "Codebase Structure"
Cohesion: 0.20
Nodes (9): Codebase Structure, Directory Layout, Directory Purposes, Key File Locations, Naming Conventions, Non-Package Root Directories, Special & Generated Directories, Where to Add New Code (+1 more)

### Community 17 - "Workflows"
Cohesion: 0.22
Nodes (8): Check Balance, Check Specific Token, MCP Tools, Notes, TON Balance & Transaction Queries, Verify a Sent Transaction, View Transaction History, Workflows

### Community 18 - "Workflows"
Cohesion: 0.22
Nodes (8): Check Balance, Check Specific Token, MCP Tools, Notes, TON Balance & Transaction Queries, Verify a Sent Transaction, View Transaction History, Workflows

### Community 19 - "Technology Stack"
Cohesion: 0.22
Nodes (8): Configuration, Frameworks, Key Dependencies, Languages, Platform Requirements, Runtime, Technology Stack, Workspace Packages (15 Monorepo Packages)

### Community 20 - "Create TON Agentic Wallet"
Cohesion: 0.25
Nodes (7): Create TON Agentic Wallet, Environment Variables, How It Works, MCP Tools, Notes, Tool Parameters, Workflow

### Community 21 - "TON Documentation"
Cohesion: 0.25
Nodes (7): Gotchas, MCP Server Setup, MCP Tools, TEPs (TON Enhancement Proposals), TON Documentation, When to Use, Workflow

### Community 22 - "TON NFT Operations"
Cohesion: 0.25
Nodes (7): List My NFTs, MCP Tools, Notes, Send an NFT, TON NFT Operations, View NFT Details, Workflows

### Community 23 - "Create TON Agentic Wallet"
Cohesion: 0.25
Nodes (7): Create TON Agentic Wallet, Environment Variables, How It Works, MCP Tools, Notes, Tool Parameters, Workflow

### Community 24 - "TON Documentation"
Cohesion: 0.25
Nodes (7): Gotchas, MCP Server Setup, MCP Tools, TEPs (TON Enhancement Proposals), TON Documentation, When to Use, Workflow

### Community 25 - "TON NFT Operations"
Cohesion: 0.25
Nodes (7): List My NFTs, MCP Tools, Notes, Send an NFT, TON NFT Operations, View NFT Details, Workflows

### Community 26 - "Send TON & Tokens"
Cohesion: 0.29
Nodes (6): MCP Tools, Notes, Send Jetton (Token), Send TON, Send TON & Tokens, Workflows

### Community 27 - "OpenClaw TON Agent - Project Memory"
Cohesion: 0.29
Nodes (6): Architecture, Configuration, Key Components, OpenClaw TON Agent - Project Memory, Overview, TON Skills Available

### Community 28 - "ton-execute"
Cohesion: 0.29
Nodes (6): Hand-off contract, Hard rules (enforced in code, not just prompts), Output, Tests, ton-execute, Workflow

### Community 29 - "Send TON & Tokens"
Cohesion: 0.29
Nodes (6): MCP Tools, Notes, Send Jetton (Token), Send TON, Send TON & Tokens, Workflows

### Community 30 - "ton-execute"
Cohesion: 0.29
Nodes (6): Hand-off contract, Hard rules (enforced in code, not just prompts), Output, Tests, ton-execute, Workflow

### Community 31 - "deepwiki"
Cohesion: 0.33
Nodes (5): Commands, deepwiki, Examples, Flags, Tips

### Community 32 - "Architecture"
Cohesion: 0.33
Nodes (5): Architecture, Layering, Objective, Principles, Stack

### Community 33 - "TON Docs-first workflow"
Cohesion: 0.33
Nodes (5): 1) Read the orientation page first, 2) Discover available pages, 3) Pull only the pages you need, 4) Execute the task using the docs as ground truth, TON Docs-first workflow

### Community 34 - "ton-exit-modes"
Cohesion: 0.33
Nodes (5): Modes, Output, Rules (`decide.ts`), Tests, ton-exit-modes

### Community 35 - "ton-tpsl-manager"
Cohesion: 0.33
Nodes (5): Exit modes (`modes.ts`, per `ton-exit-modes`), Output, Point setup (derived, not guessed), Tests, ton-tpsl-manager

### Community 36 - "Incident Report: INC-2026-08-20-001"
Cohesion: 0.33
Nodes (5): 1. Trigger & Summary, 2. Root Cause Analysis, 3. Mitigations Applied, 4. Verification & Status, Incident Report: INC-2026-08-20-001

### Community 37 - "ton-exit-modes"
Cohesion: 0.33
Nodes (5): Modes, Output, Rules (`decide.ts`), Tests, ton-exit-modes

### Community 38 - "ton-tpsl-manager"
Cohesion: 0.33
Nodes (5): Exit modes (`modes.ts`, per `ton-exit-modes`), Output, Point setup (derived, not guessed), Tests, ton-tpsl-manager

### Community 39 - "Project Context & Technical Architecture"
Cohesion: 0.33
Nodes (5): Active Considerations & Architecture Signals, Architecture, Conventions (Observed), Project Context & Technical Architecture, Stack

### Community 40 - "Swap TON Tokens"
Cohesion: 0.40
Nodes (4): MCP Tools, Notes, Swap TON Tokens, Workflow

### Community 41 - "Global Constraints"
Cohesion: 0.40
Nodes (4): Global Constraints, Simulation Wallet Implementation Plan, Task 1: Create SimulationWallet Class, Task 2: Wire Simulation into Continuous Executor

### Community 42 - "OpenClaw TON Trading Agent — Architecture Design Document"
Cohesion: 0.40
Nodes (4): 1. System Overview & Core Objectives, 2. High-Level Pipeline Architecture, OpenClaw TON Trading Agent — Architecture Design Document, Primary Design Pillars

### Community 43 - "ton-reporting"
Cohesion: 0.40
Nodes (4): Gate hooks, Output, Reports, ton-reporting

### Community 44 - "ton-signal-ingest"
Cohesion: 0.40
Nodes (4): Output, ton-signal-ingest, When to use, Workflow

### Community 45 - "Swap TON Tokens"
Cohesion: 0.40
Nodes (4): MCP Tools, Notes, Swap TON Tokens, Workflow

### Community 46 - "Harness Artifact Contracts"
Cohesion: 0.40
Nodes (4): Governance Defaults Locked In, Harness Artifact Contracts, Scope, Versioning

### Community 47 - "openclaw-ton-agent"
Cohesion: 0.40
Nodes (4): Agents, openclaw-ton-agent, Run, Tech stack

### Community 48 - "ton-reporting"
Cohesion: 0.40
Nodes (4): Gate hooks, Output, Reports, ton-reporting

### Community 49 - "ton-signal-ingest"
Cohesion: 0.40
Nodes (4): Output, ton-signal-ingest, When to use, Workflow

### Community 50 - "Executor — AGENTS.md"
Cohesion: 0.40
Nodes (4): Commands, Context, Conventions, Executor — AGENTS.md

### Community 51 - "Market Intel — AGENTS.md"
Cohesion: 0.40
Nodes (4): Commands, Context, Conventions, Market Intel — AGENTS.md

### Community 52 - "Risk Analyst — AGENTS.md"
Cohesion: 0.40
Nodes (4): Commands, Context, Conventions, Risk Analyst — AGENTS.md

### Community 53 - "Scanner Ops — AGENTS.md"
Cohesion: 0.40
Nodes (4): Commands, Context, Conventions, Scanner Ops — AGENTS.md

### Community 54 - "Scanner Ops"
Cohesion: 0.40
Nodes (4): Hard rules, Loop, Mission, Scanner Ops

### Community 55 - "Trader UI — AGENTS.md"
Cohesion: 0.40
Nodes (4): Commands, Context, Conventions, Trader UI — AGENTS.md

### Community 56 - "ultimate-pi: Agentic Harness"
Cohesion: 0.50
Nodes (3): Conventions, Structure, ultimate-pi: Agentic Harness

### Community 57 - "manual-override"
Cohesion: 0.50
Nodes (3): Commands, manual-override, Rules

### Community 58 - "ton-audit"
Cohesion: 0.50
Nodes (3): Checks, Output, ton-audit

### Community 59 - "ton-risk-gates"
Cohesion: 0.50
Nodes (3): Gates (all must pass), Output, ton-risk-gates

### Community 60 - "ton-settlement"
Cohesion: 0.50
Nodes (3): Output, ton-settlement, Workflow

### Community 61 - "manual-override"
Cohesion: 0.50
Nodes (3): Commands, manual-override, Rules

### Community 62 - "ton-audit"
Cohesion: 0.50
Nodes (3): Checks, Output, ton-audit

### Community 63 - "ton-risk-gates"
Cohesion: 0.50
Nodes (3): Gates (all must pass), Output, ton-risk-gates

### Community 64 - "ton-settlement"
Cohesion: 0.50
Nodes (3): Output, ton-settlement, Workflow

### Community 65 - "Executor"
Cohesion: 0.50
Nodes (3): Executor, Hard rules, Mission

### Community 66 - "Market Intel"
Cohesion: 0.50
Nodes (3): Hard rules, Market Intel, Mission

### Community 67 - "Risk Analyst"
Cohesion: 0.50
Nodes (3): Hard rules, Mission, Risk Analyst

### Community 68 - "Trader UI"
Cohesion: 0.50
Nodes (3): Hard rules, Mission, Trader UI

## Knowledge Gaps
- **348 isolated node(s):** `flymcp`, `Commands`, `Flags`, `Examples`, `Tips` (+343 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `flymcp`, `Commands`, `Flags` to the rest of the system?**
  _348 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `OpenClaw TON Agent — Session Handoff Package` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `OpenClaw TON Trading Agent — Architecture Design Document` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Should `Architecture` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Should `Simulation Wallet Design` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `TON MCP Raw CLI Mode` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `TON MCP Raw CLI Mode` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._