/**
 * Dedup cache.
 *
 * Regression guard for E6: `seen` was a plain `Set<string>` that lived for the
 * whole process and was never pruned. Two consequences in production:
 *
 *   1. Liveness — every candidate is permanently suppressed after its first
 *      sighting, so the scanner logged `scanned=0 emitted=0` on every tick
 *      forever. A token whose audit or liquidity later changes is never
 *      re-evaluated.
 *   2. Memory — on a live source the set grows without bound for the lifetime
 *      of the machine.
 *
 * A dedup cache should suppress *repeats within a window*, not forever.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SeenCache } from "./seen";

test("suppresses a repeat within the TTL window", () => {
  const now = { t: 1_000 };
  const seen = new SeenCache({ ttlMs: 60_000, maxEntries: 100, now: () => now.t });
  assert.equal(seen.has("EQA"), false);
  seen.add("EQA");
  assert.equal(seen.has("EQA"), true);
  now.t += 59_000;
  assert.equal(seen.has("EQA"), true, "still inside the window");
});

test("allows re-scan once the TTL expires", () => {
  const now = { t: 1_000 };
  const seen = new SeenCache({ ttlMs: 60_000, maxEntries: 100, now: () => now.t });
  seen.add("EQA");
  now.t += 60_001;
  assert.equal(seen.has("EQA"), false, "expired entries must be re-scannable");
});

test("evicts oldest entries past maxEntries so memory stays bounded", () => {
  const seen = new SeenCache({ ttlMs: 10_000, maxEntries: 3, now: () => 1_000 });
  for (const k of ["a", "b", "c", "d", "e"]) seen.add(k);
  assert.ok(seen.size <= 3, `expected <=3 entries, got ${seen.size}`);
  assert.equal(seen.has("e"), true, "newest retained");
  assert.equal(seen.has("a"), false, "oldest evicted");
});

test("prune drops only expired entries", () => {
  const now = { t: 0 };
  const seen = new SeenCache({ ttlMs: 1_000, maxEntries: 100, now: () => now.t });
  seen.add("old");
  now.t = 900;
  seen.add("new");
  now.t = 1_500; // "old" expired at 1000, "new" expires at 1900
  seen.prune();
  assert.equal(seen.has("old"), false);
  assert.equal(seen.has("new"), true);
  assert.equal(seen.size, 1);
});

test("re-adding refreshes the entry's window", () => {
  const now = { t: 0 };
  const seen = new SeenCache({ ttlMs: 1_000, maxEntries: 100, now: () => now.t });
  seen.add("EQA");
  now.t = 800;
  seen.add("EQA");
  now.t = 1_500;
  assert.equal(seen.has("EQA"), true, "refreshed at 800, expires at 1800");
});
