#!/bin/sh
# Unified startup script for scanner + executor in single container
# Uses dumb-init for proper signal handling and runs both processes

set -e

echo "[STARTUP] Starting unified scanner + executor container"

# Ensure data directory exists
mkdir -p /app/data
chown -R appuser:appgroup /app/data 2>/dev/null || true

# Export environment for both processes
export NODE_ENV=${NODE_ENV:-production}
export OBSERVE_ONLY=${OBSERVE_ONLY:-true}
export TON_NETWORK=${TON_NETWORK:-mainnet}
export SCAN_RADAR_INTERVAL_MS=${SCAN_RADAR_INTERVAL_MS:-60000}
export SCAN_SNIPER_INTERVAL_MS=${SCAN_SNIPER_INTERVAL_MS:-10000}
export SCANNER_ENABLED=${SCANNER_ENABLED:-true}
export SNIPER_ENABLED=${SNIPER_ENABLED:-true}
export EXECUTION_MODE=${EXECUTION_MODE:-notify_only}
export GATES_G1_G3_ACK=${GATES_G1_G3_ACK:-0}
export GATED_DIR=${GATED_DIR:-/app/data}
export ORDERS_OUT=${ORDERS_OUT:-/app/data/orders-mainnet.ndjson}
export FILLS_OUT=${FILLS_OUT:-/app/data/fills-mainnet.ndjson}
export EXEC_HEALTH_PORT=${EXEC_HEALTH_PORT:-8081}

# Health check ports
export PORT=${PORT:-8080}  # Scanner health port

echo "[STARTUP] Configuration:"
echo "  Scanner health port: $PORT"
echo "  Executor health port: $EXEC_HEALTH_PORT"
echo "  Gated directory: $GATED_DIR"
echo "  Execution mode: $EXECUTION_MODE"

# Function to handle shutdown
shutdown() {
  echo "[STARTUP] Received shutdown signal, stopping processes..."
  kill -TERM "$api_pid" "$scanner_pid" "$gates_pid" "$executor_pid" 2>/dev/null || true
  wait "$api_pid" "$scanner_pid" "$gates_pid" "$executor_pid" 2>/dev/null || true
  echo "[STARTUP] All processes stopped"
  exit 0
}

trap shutdown SIGINT SIGTERM

# Start API first for HTTP health checks
echo "[STARTUP] Starting API on port $API_PORT..."
cd /app/packages/api
npm run start &
api_pid=$!
echo "[STARTUP] API started (PID: $api_pid)"

# Start scanner in background
echo "[STARTUP] Starting scanner on port $PORT..."
cd /app/packages/scanner
npm run start &
scanner_pid=$!
echo "[STARTUP] Scanner started (PID: $scanner_pid)"

# Start continuous risk gates in background
echo "[STARTUP] Starting continuous risk gates..."
cd /app/packages/risk-gates
npm run continuous &
gates_pid=$!
echo "[STARTUP] Risk gates started (PID: $gates_pid)"

# Give services a moment to bind ports
sleep 8

# Start executor in background
echo "[STARTUP] Starting executor on port $EXEC_HEALTH_PORT..."
cd /app/packages/executor
npm run continuous &
executor_pid=$!
echo "[STARTUP] Executor started (PID: $executor_pid)"

# Wait for all processes
wait $api_pid $scanner_pid $gates_pid $executor_pid