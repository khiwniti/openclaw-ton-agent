# AI Multi-Agent Trading System — Rule of Thumb

## 1. Mode first
Start in `notify_only`, move to `paper`, then `auto` only after G1/G3 evidence.

## 2. Gating is non-optional
All trades must pass risk gates and regime filters before execution.

## 3. Kill switch wins
If `KILL_SWITCH_URL` or drawdown tripped, queue flattens immediately.

## 4. Journal everything
Every signal, order, decision, and error goes to durable journal streams.

## 5. Observe before automate
Monitor latency, fills, slippage, and regime fit before escalating autonomy.

## 6. Single responsibility per agent
One agent owns one layer; cross-layer changes require review.

## 7. Fail closed
Unknown data or missing secrets fail loudly; they do not fall back to fake data in production.

## 8. Human override always available
Auto mode never removes the ability to cancel, pause, or change parameters.
