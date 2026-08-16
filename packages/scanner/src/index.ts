/**
 * Scanner entrypoint (L1, READ-ONLY).
 *
 *   OBSERVE_ONLY=true is enforced in config.ts — the scanner can never sign.
 *   Envelopes flow: source → audit → score → journal → signal-out (if set).
 *
 * Source selection:
 *   - SCANNER_SOURCE=replay   → fixture data (no keys, deterministic)
 *   - no TONAPI_KEY           → replay fallback
 *   - otherwise               → live TONAPI source
 */
import { Journal, journalPath, createLogger } from "@openclaw-ton-agent/shared";
import { SCANNER_CONFIG, assertLiveDataSource } from "./config";
import { replaySource } from "./replay";
import { tonapiSource } from "./tonapi-source";
import { runScanTick } from "./pipeline";
import { SeenCache } from "./seen";
import { createStats, startHealthServer } from "./health";

const log = createLogger("scanner");

function pickSource() {
  const requested = process.env.SCANNER_SOURCE;
  if (requested === "replay") return replaySource;
  if (requested === "tonapi" && SCANNER_CONFIG.tonapi.key) return tonapiSource;
  if (!SCANNER_CONFIG.tonapi.key) return replaySource;
  return tonapiSource;
}

export function startScanner(
  opts: {
    source?: ReturnType<typeof pickSource>;
    journal?: Journal;
    intervalMs?: number;
    /** Start the health/metrics listener. Off by default so tests don't bind. */
    health?: boolean;
  } = {}
) {
  const source = opts.source ?? pickSource();
  const journal = opts.journal ?? new Journal(journalPath(SCANNER_CONFIG.journalDir, SCANNER_CONFIG.network));
  const intervalMs = opts.intervalMs ?? SCANNER_CONFIG.scanRadarIntervalMs;

  // TTL-bounded: a candidate is suppressed for a window, not forever, so
  // changed audits/liquidity are re-evaluated and memory stays bounded.
  const seen = new SeenCache({
    ttlMs: Math.max(intervalMs * 10, 10 * 60_000),
    maxEntries: 10_000,
  });

  const stats = createStats({
    source: source.name,
    network: SCANNER_CONFIG.network,
    observeOnly: SCANNER_CONFIG.observeOnly,
  });

  const tick = async () => {
    try {
      seen.prune();
      const result = await runScanTick({ source, journal, seen });
      stats.ticks++;
      stats.lastTickAt = Date.now();
      stats.lastError = null;
      stats.totals.scanned += result.scanned;
      stats.totals.emitted += result.emitted;
      stats.totals.incomplete += result.incomplete;
      stats.totals.dropped += result.dropped;
      log.info("scan tick complete", {
        scanned: result.scanned,
        emitted: result.emitted,
        incomplete: result.incomplete,
        dropped: result.dropped,
        tracked: seen.size,
      });
      return result;
    } catch (e) {
      // An unhandled rejection here would kill the process under Node 15+.
      // Record it, let /health report it, and keep the loop alive.
      stats.lastError = (e as Error)?.message ?? String(e);
      log.error("scan tick failed", e as Error);
      return undefined;
    }
  };

  log.info("scanner started", {
    network: SCANNER_CONFIG.network,
    source: source.name,
    observeOnly: SCANNER_CONFIG.observeOnly,
    journal: journal.filePath,
  });
  if (source.name === "replay") {
    log.warn("fixture data mode — signals are NOT real market data");
  }

  const server = opts.health ? startHealthServer({ stats, intervalMs }) : null;
  const t = tick();
  const handle = setInterval(tick, intervalMs);
  return {
    tickPromise: t,
    stats,
    stop: () => {
      clearInterval(handle);
      server?.close();
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  // Fail fast rather than journal fixture data as mainnet reality.
  assertLiveDataSource({
    network: SCANNER_CONFIG.network,
    tonapiKey: SCANNER_CONFIG.tonapi.key,
    source: process.env.SCANNER_SOURCE,
  });

  const scanner = startScanner({ health: true });

  // Fly sends SIGINT/SIGTERM on autostop and deploys; exit 0 so a normal
  // shutdown stops being reported as `npm error code 130`.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      log.info("shutdown signal received", { signal: sig });
      scanner.stop();
      process.exit(0);
    });
  }
}
