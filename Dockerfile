# ====================================================================
# openclaw-ton-agent — Fly.io Dockerfile
# --------------------------------------------------------------------
# Multi-stage build: build TypeScript, then copy to minimal runtime.
# ====================================================================

# Build arg to skip typecheck (for testnet/production deploys with new code)
ARG SKIP_TYPECHECK=false

# ---- Build stage ----
FROM node:22-alpine AS builder

ARG SKIP_TYPECHECK

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
COPY packages/agents/package.json packages/agents/
COPY packages/api/package.json packages/api/
COPY packages/backtest/package.json packages/backtest/
COPY packages/core/package.json packages/core/
COPY packages/dex/package.json packages/dex/
COPY packages/executor/package.json packages/executor/
COPY packages/exit-manager/package.json packages/exit-manager/
COPY packages/market-intel/package.json packages/market-intel/
COPY packages/orchestration/package.json packages/orchestration/
COPY packages/risk-gates/package.json packages/risk-gates/
COPY packages/scanner/package.json packages/scanner/
COPY packages/security/package.json packages/security/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/wallet/package.json packages/wallet/

# Install all dependencies (including devDependencies for build)
RUN npm ci --ignore-scripts

# Copy source code
COPY tsconfig.json ./
COPY packages/agents packages/agents
COPY packages/api packages/api
COPY packages/backtest packages/backtest
COPY packages/core packages/core
COPY packages/dex packages/dex
COPY packages/executor packages/executor
COPY packages/exit-manager packages/exit-manager
COPY packages/market-intel packages/market-intel
COPY packages/orchestration packages/orchestration
COPY packages/risk-gates packages/risk-gates
COPY packages/scanner packages/scanner
COPY packages/security packages/security
COPY packages/shared packages/shared
COPY packages/storage packages/storage
COPY packages/wallet packages/wallet
COPY openclaw openclaw
COPY scripts scripts

# Set executable bit in builder stage (before copying to runtime)
RUN chmod +x scripts/start-unified.sh

# Build TypeScript (compile check) - skip if SKIP_TYPECHECK=true
RUN if [ "$SKIP_TYPECHECK" = "true" ]; then echo "Skipping typecheck..."; else npm run typecheck; fi

# Prebuild native SQLite bindings where build tools are available
RUN npm rebuild better-sqlite3 --build-from-source

# ---- Runtime stage ----
FROM node:22-alpine AS runtime

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user (use 1001 to avoid conflict with node user's 1000)
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Copy dependencies, compiled packages, and configuration from builder
COPY --from=builder /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages packages
COPY --from=builder /app/openclaw openclaw
COPY --from=builder /app/scripts scripts

# Create data directory for journals/state
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

# Switch to non-root user
USER appuser

# Default to unified startup; override per-process in Fly process groups when desired
CMD ["scripts/start-unified.sh"]
