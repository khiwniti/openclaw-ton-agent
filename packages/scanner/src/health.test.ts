/**
 * Health server + liveness.
 *
 * Regression guard for E2: the scanner had no HTTP listener while fly.toml
 * declared `internal_port = 8080`, so Fly's proxy autostopped both machines
 * ("excess capacity") and the app fell to zero running instances.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStats, healthOf, startHealthServer } from "./health";

function stats(over: Partial<ReturnType<typeof createStats>> = {}) {
  return { ...createStats({ source: "replay", network: "testnet", observeOnly: true }), ...over };
}

test("healthy immediately after start, before any tick completes", () => {
  const s = stats({ startedAt: 1_000, lastTickAt: null });
  assert.equal(healthOf(s, 60_000, 1_500).ok, true);
});

test("healthy while ticks keep arriving", () => {
  const s = stats({ lastTickAt: 100_000 });
  assert.equal(healthOf(s, 60_000, 220_000).ok, true, "inside the 3x grace window");
});

test("unhealthy when the scan loop wedges", () => {
  const s = stats({ lastTickAt: 100_000 });
  const h = healthOf(s, 60_000, 400_000); // 300s > 180s grace
  assert.equal(h.ok, false);
  assert.match(h.reason, /no completed tick/);
});

test("grace never drops below 30s for fast intervals", () => {
  const s = stats({ startedAt: 0, lastTickAt: 0 });
  assert.equal(healthOf(s, 1_000, 20_000).ok, true, "20s must stay healthy despite a 1s interval");
});

test("serves /health and /metrics on a real socket", async () => {
  const s = stats({ ticks: 3, lastTickAt: Date.now(), totals: { scanned: 9, emitted: 4, incomplete: 1, dropped: 2 } });
  const server = startHealthServer({ stats: s, intervalMs: 60_000, port: 0 });
  assert.ok(server, "server should start");
  await new Promise((r) => server!.once("listening", r as () => void));
  const addr = server!.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const body = (await health.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.ticks, 3);
    assert.equal(body.totals.emitted, 4);

    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(metrics.status, 200);
    const text = await metrics.text();
    assert.match(text, /scanner_up 1/);
    assert.match(text, /scanner_emitted_total 4/);

    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(missing.status, 404);
  } finally {
    server!.close();
  }
});

test("/health returns 503 when the loop is wedged", async () => {
  const s = stats({ startedAt: 0, lastTickAt: 0 });
  const server = startHealthServer({ stats: s, intervalMs: 1_000, port: 0 });
  await new Promise((r) => server!.once("listening", r as () => void));
  const addr = server!.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 503, "a wedged scanner must fail its health check");
  } finally {
    server!.close();
  }
});
