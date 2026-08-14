# ====================================================================
# openclaw-ton-agent — Fly.io Dockerfile
# --------------------------------------------------------------------
# Multi-stage build: build TypeScript, then copy to minimal runtime.
# ====================================================================

# ---- Build stage ----
FROM node:24-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/scanner/package.json packages/scanner/
COPY packages/market-intel/package.json packages/market-intel/
COPY packages/risk-gates/package.json packages/risk-gates/
COPY packages/exit-manager/package.json packages/exit-manager/
COPY packages/executor/package.json packages/executor/
COPY packages/backtest/package.json packages/backtest/

# Install all dependencies (including devDependencies for build)
RUN npm ci --ignore-scripts

# Copy source code
COPY tsconfig.json ./
COPY packages/shared packages/shared
COPY packages/scanner packages/scanner
COPY packages/market-intel packages/market-intel
COPY packages/risk-gates packages/risk-gates
COPY packages/exit-manager packages/exit-manager
COPY packages/executor packages/executor
COPY packages/backtest packages/backtest
COPY openclaw openclaw
COPY scripts scripts

# Build TypeScript (compile check)
RUN npm run typecheck

# ---- Runtime stage ----
FROM node:24-alpine AS runtime

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user (use 1001 to avoid conflict with node user's 1000)
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Copy package files
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/scanner/package.json packages/scanner/
COPY packages/market-intel/package.json packages/market-intel/
COPY packages/risk-gates/package.json packages/risk-gates/
COPY packages/exit-manager/package.json packages/exit-manager/
COPY packages/executor/package.json packages/executor/
COPY packages/backtest/package.json packages/backtest/

# Install ALL dependencies (tsx is a devDependency needed at runtime)
RUN npm ci --ignore-scripts && \
    npm cache clean --force

# Copy built source from builder
COPY --from=builder /app/packages/shared packages/shared
COPY --from=builder /app/packages/scanner packages/scanner
COPY --from=builder /app/packages/market-intel packages/market-intel
COPY --from=builder /app/packages/risk-gates packages/risk-gates
COPY --from=builder /app/packages/exit-manager packages/exit-manager
COPY --from=builder /app/packages/executor packages/executor
COPY --from=builder /app/packages/backtest packages/backtest
COPY --from=builder /app/openclaw openclaw
COPY --from=builder /app/scripts scripts

# Create data directory for journals/state
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

# Switch to non-root user
USER appuser

# Environment defaults (overridden by Fly secrets)
ENV NODE_ENV=production
ENV OBSERVE_ONLY=true
ENV SCAN_RADAR_INTERVAL_MS=60000
ENV SCAN_SNIPER_INTERVAL_MS=10000
ENV SCANNER_ENABLED=true
ENV SNIPER_ENABLED=true
ENV TON_NETWORK=mainnet

# Probe the real /health endpoint. The previous `pgrep -f "tsx.*scanner"` could
# never match: the process cmdline is `tsx src/index.ts` (cwd=packages/scanner).
# /health also catches a wedged scan loop, which a process-existence check cannot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Entrypoint
ENTRYPOINT ["dumb-init", "--"]

# Default command: run the scanner
CMD ["npm", "run", "scanner:start"]