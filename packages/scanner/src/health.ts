/**
 * Minimal health/metrics HTTP server.
 *
 * Fly's proxy autostops any machine in an `http_service` group that it believes
 * has no traffic. The scanner is a background worker and never listened on
 * `internal_port`, so the proxy stopped both machines ("excess capacity") and
 * the app went to zero. Listening on PORT keeps the machine addressable, makes
 * Fly health checks meaningful, and exposes tick liveness for debugging.
 *
 * Deliberately dependency-free (node:http) — this must never be the reason the
 * scanner fails to boot.
 */
import { createServer, type Server } from "node:http";

export interface ScannerStats {
  startedAt: number;
  ticks: number;
  lastTickAt: number | null;
  lastError: string | null;
  source: string;
  network: string;
  observeOnly: boolean;
  /** Totals across all ticks. */
  totals: { scanned: number; emitted: number; incomplete: number; dropped: number };
}

export function createStats(init: Pick<ScannerStats, "source" | "network" | "observeOnly">): ScannerStats {
  return {
    startedAt: Date.now(),
    ticks: 0,
    lastTickAt: null,
    lastError: null,
    totals: { scanned: 0, emitted: 0, incomplete: 0, dropped: 0 },
    ...init,
  };
}

/**
 * Liveness verdict. The scanner is unhealthy if a tick hasn't completed within
 * a generous multiple of its interval — that distinguishes "process alive but
 * scan loop wedged" from "process alive and working", which a plain pgrep
 * check cannot do.
 */
export function healthOf(stats: ScannerStats, intervalMs: number, now = Date.now()): { ok: boolean; reason: string } {
  const grace = Math.max(intervalMs * 3, 30_000);
  const since = stats.lastTickAt === null ? now - stats.startedAt : now - stats.lastTickAt;
  if (since > grace) {
    return { ok: false, reason: `no completed tick in ${Math.round(since / 1000)}s (grace ${Math.round(grace / 1000)}s)` };
  }
  return { ok: true, reason: "ok" };
}

/** Start the health server. Never throws — a bind failure is logged, not fatal. */
export function startHealthServer(opts: {
  stats: ScannerStats;
  intervalMs: number;
  port?: number;
}): Server | null {
  // `?? 0` is intentional: port 0 (ephemeral, used by tests) must be honoured,
  // so only an undefined/unparseable value falls through to 8080.
  const envPort = Number(process.env.PORT);
  const port = opts.port ?? (Number.isFinite(envPort) && envPort > 0 ? envPort : 8080);
  try {
    const server = createServer((req, res) => {
      const url = req.url ?? "/";
      const health = healthOf(opts.stats, opts.intervalMs);
      const body = {
        ...health,
        uptimeSec: Math.round((Date.now() - opts.stats.startedAt) / 1000),
        ...opts.stats,
      };
      if (url === "/health" || url === "/healthz" || url === "/") {
        res.writeHead(health.ok ? 200 : 503, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
        return;
      }
      if (url === "/metrics") {
        // Plain-text Prometheus exposition; no client library needed.
        const t = opts.stats.totals;
        const lines = [
          `scanner_up ${health.ok ? 1 : 0}`,
          `scanner_ticks_total ${opts.stats.ticks}`,
          `scanner_scanned_total ${t.scanned}`,
          `scanner_emitted_total ${t.emitted}`,
          `scanner_incomplete_total ${t.incomplete}`,
          `scanner_dropped_total ${t.dropped}`,
        ];
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
        res.end(lines.join("\n") + "\n");
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    });
    server.on("error", (e) => console.error(`[HEALTH] server error: ${(e as Error).message}`));
    server.listen(port, "0.0.0.0", () => console.log(`[HEALTH] listening on 0.0.0.0:${port}`));
    return server;
  } catch (e) {
    console.error(`[HEALTH] failed to start: ${(e as Error).message}`);
    return null;
  }
}
