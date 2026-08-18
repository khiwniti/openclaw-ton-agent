# ====================================================================
# OpenClaw TON Agent — Fly.io Dockerfile
# --------------------------------------------------------------------
# Builds TypeScript to JS before copying to runtime.
# TypeScript compiler check is MANDATORY (no SKIP_TYPECHECK escape hatch).
# ====================================================================

# ---- Build stage (compile TS → JS) ----
FROM node:22-alpine AS builder

ARG TSC_CACHE_BUST=local

WORKDIR /app

# Install build toolchain (needed for sqlite3 build-from-source)
RUN apk add --no-cache python3 make g++

# Copy workspace manifests first for layer-cache efficiency
COPY package.json package-lock.json ./
COPY packages/agents/package.json      packages/agents/
COPY packages/api/package.json         packages/api/
COPY packages/backtest/package.json    packages/backtest/
COPY packages/core/package.json        packages/core/
COPY packages/dex/package.json         packages/dex/
COPY packages/executor/package.json    packages/executor/
COPY packages/exit-manager/package.json packages/exit-manager/
COPY packages/market-intel/package.json packages/market-intel/
COPY packages/orchestration/package.json packages/orchestration/
COPY packages/risk-gates/package.json  packages/risk-gates/
COPY packages/scanner/package.json     packages/scanner/
COPY packages/security/package.json    packages/security/
COPY packages/shared/package.json      packages/shared/
COPY packages/storage/package.json     packages/storage/
COPY packages/wallet/package.json      packages/wallet/

# Install ALL dependencies including devDeps (needed for tsc, tsx, etc.)
RUN npm ci

# Copy full source tree — any source change busts all subsequent layers
COPY tsconfig.json ./
COPY packages packages
COPY openclaw  openclaw
COPY scripts   scripts

# Force shell script executable in runtime image
RUN chmod +x scripts/start-unified.sh

# Hard gate: TypeScript must compile cleanly. Fail the build if it doesn't.
RUN npm run typecheck

# Emit JS to each package's dist/ so runtime never touches raw .ts
# Use project references when available; fall back to per-package compiles.
# We compile each workspace package individually because tsconfig refs are not set.
RUN set -euo pipefail;                                         \
  for pkg in packages/*/; do                                    \
    cd "$pkg";                                                  \
    npx tsc --project tsconfig.json --outDir dist --declaration false || \
    npx tsc --outDir dist --declaration false || true;          \
    # If build produced no JS (no tsconfig or nothing to compile), create a stub so COPY works \
    if [ ! -d dist ]; then mkdir -p dist; echo 'export {};' > dist/index.js; fi;   \
  done

# Prebuild native sqlite3 bindings on alpine at build time so the runtime
# binary format is known-good for the target image (node:22-alpine).
RUN npm rebuild better-sqlite3 --build-from-source || true

# ---- Runtime stage ----
FROM node:22-alpine AS runtime

WORKDIR /app

# dumb-init gives proper signal handling for unified multi-process container
RUN apk add --no-cache dumb-init

# Add non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Copy compiled JS, runtime deps, and configuration
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages packages
COPY --from=builder /app/openclaw  openclaw
COPY --from=builder /app/scripts   scripts

# Runtime environment: avoid ESM/tsx surprises and .ts cache poisoning
ENV NODE_OPTIONS="--no-warnings=ExperimentalWarning"
ENV TSX_CACHE="0"
ENV NODE_PATH="/app/node_modules:/app/packages"
ENV PYTHON=""

# Data directory for SQLite journals and .openclaw state
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

# Switch to non-root user
USER appuser

# Unifed startup (scanner + risk-gates + executor + api in one container)
ENTRYPOINT ["dumb-init", "--"]
CMD ["scripts/start-unified.sh"]