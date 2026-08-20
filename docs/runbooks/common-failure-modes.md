# Runbook: Common Failure Modes

## 1. Position Stuck in OPEN State After Time-Stop

**Symptoms:**
- Positions remain open past the 30-minute time-stop limit
- `lifecycleState` shows `OPEN` instead of `FULL_EXIT` or `SETTLED`

**Diagnosis:**
1. Check `positions-{network}.ndjson` for entries with `kind: "position.open"`
2. Verify `pos.timeStopMs` is defined (not `undefined`)
3. Confirm `stepPosition()` is being called in the monitoring loop

**Mitigation:**
- Ensure `effectiveTimeStopMs` check is at the top of exit precedence chain
- Verify `activeExitOrderId` guard isn't blocking legitimate retries
- Check for consecutive sell bounces (3+ bounces trigger force-clear)

**Commands:**
```bash
# Check open positions
cat data/positions-testnet.ndjson | jq 'select(.kind == "position.open")'

# Check for stuck positions
cat data/positions-testnet.ndjson | jq 'select(.pos.lifecycleState == "OPEN" and .pos.timeStopMs == null)'
```

---

## 2. Sell Order Bounces / Unsellable Positions

**Symptoms:**
- Exit orders returning `fillStatus: "bounced"`
- Positions accumulating `bounceCount >= 3`

**Diagnosis:**
1. Check executor logs for `"exit sell bounced"` messages
2. Verify jetton balance on-chain via TON API
3. Check for active pool availability (STON.fi / DeDust)

**Mitigation:**
- System force-clears after 3 consecutive bounces
- `CLEAR_STUCK_POSITIONS=true` env var forces clearing
- Zero-balance and no-pool conditions auto-clear

**Commands:**
```bash
# Check bounce count
grep "bounce" logs/executor.log | jq '.bounce'

# Force clear stuck positions
CLEAR_STUCK_POSITIONS=true npm run executor
```

---

## 3. Circuit Breaker OPEN (External API Down)

**Symptoms:**
- Price fetches failing with `Circuit breaker 'ston-fi' is OPEN`
- Scanner not emitting new signals

**Diagnosis:**
1. Check circuit breaker state via metrics endpoint
2. Verify external API health (STON.fi, DeDust, TON Center)
3. Review `globalResilience` breaker status

**Mitigation:**
- Circuit breakers auto-reset after `resetTimeoutMs` (default 15s)
- Half-open state allows limited test calls
- Fallback to cached prices when primary API fails

**Commands:**
```bash
# Check breaker state (via metrics)
curl http://localhost:8081/metrics | jq '.circuitBreakers'

# Manual reset (if needed)
node -e "require('./packages/shared/src/resilience').globalResilience.resetAll()"
```

---

## 4. Settlement Verification Timeout

**Symptoms:**
- Positions stuck in `FULL_EXIT` state with `settlement: "PENDING"`
- P&L not being recorded

**Diagnosis:**
1. Check `fills-{network}.ndjson` for `settlement: "PENDING"` entries
2. Verify `SettlementReconciler` is running in background
3. Check on-chain transaction confirmation status

**Mitigation:**
- Background reconciler polls settlement status
- Configurable timeout via `maxAttempts` in reconciler
- Fallback to `SETTLEMENT_FAILED` after max attempts

---

## 5. Scanner Duplicate / Stale Signals

**Symptoms:**
- Same token being re-scanned within cooldown window
- Missing quotes causing `incomplete` signals

**Diagnosis:**
1. Check `SeenCache` hit rate in scanner metrics
2. Review `SCAN_SEEN_TTL_MS` configuration
3. Verify TON API key validity for live data

**Mitigation:**
- `SeenCache` with TTL prevents duplicate scans
- Missing quotes are journaled as `incomplete`, never fabricated
- Replay mode available for deterministic testing

---

## Emergency Procedures

### Halt All Trading
```bash
# Set kill switch in risk-gates config
echo '{"killSwitch": true}' > config/risk-gates.json
```

### Clear All Open Positions
```bash
CLEAR_STUCK_POSITIONS=true npm run executor
```

### Reset Circuit Breakers
```bash
node -e "require('@openclaw-ton-agent/shared').globalResilience.resetAll()"
```

### Manual Position Close
```bash
# Edit positions journal to mark as closed
jq '.kind = "position.closed"' data/positions-testnet.ndjson > tmp && mv tmp data/positions-testnet.ndjson
```