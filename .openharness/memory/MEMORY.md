# OpenClaw TON Agent - Project Memory

## Overview
Professional autonomous AI multi-agent TON trading system using OpenClaw orchestrator + ton-agent scanner + @ton/mcp custody.

## Architecture
- **5 Agent Personas** (defined in openclaw/openclaw.json):
  1. `scanner-ops` - L1 ingestion + scanner health (read-only)
  2. `market-intel` - L2 market intelligence (regime, sentiment, whales)
  3. `risk-analyst` - L3 decision & risk (proposes verdicts)
  4. `executor` - L4 custody & execution (ONLY agent with write/exec)
  5. `trader-ui` - L6 operator surface (Telegram/Dashboard)

## Key Components
- **Scanner** (packages/scanner): Signal ingestion, audit, scoring pipeline
- **Exit Manager** (packages/exit-manager): TP/SL modes, position management
- **MCP Servers**: ton, ton-docs, dune, sim
- **Skills**: 9 ton-* skills + 3 sperax:* skills from ClawHub

## TON Skills Available
- ton-audit: Read-only jetton/pool audit
- ton-execute: Trade execution
- ton-exit-modes: TP/SL management
- ton-reporting: Position reporting
- ton-risk-gates: Risk gating
- ton-settlement: Settlement tracking
- ton-signal-ingest: Signal ingestion
- ton-tpsl-manager: Take-profit/stop-loss
- manual-override: Emergency controls

## Configuration
- Model: anthropic/claude-sonnet-4-6 (via NVIDIA NIM)
- API: nvidia_nemotron via integrate.api.nvidia.com/v1
- Workspace: /Users/admin/openclaw-ton-agent