/**
 * TTL + size bounded dedup cache for scanned masters.
 *
 * The scanner must not re-emit the same candidate on every tick, but it also
 * must not suppress it forever: a token's audit, liquidity or holder count can
 * change, and an unbounded `Set` both blinds the scanner (every tick reports
 * `scanned=0`) and leaks memory for the life of the machine.
 *
 * Insertion order in a JS `Map` is preserved, so the oldest key is always the
 * first — that gives O(1) eviction without a separate LRU structure.
 */
export interface SeenCacheOpts {
  /** How long a master stays suppressed before it may be re-scanned. */
  ttlMs: number;
  /** Hard cap on retained entries; oldest are evicted first. */
  maxEntries: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export class SeenCache {
  private readonly entries = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: SeenCacheOpts) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = Math.max(1, opts.maxEntries);
    this.now = opts.now ?? Date.now;
  }

  /** True when `key` was seen within the TTL window. Expired keys read false. */
  has(key: string): boolean {
    const seenAt = this.entries.get(key);
    if (seenAt === undefined) return false;
    if (this.now() - seenAt >= this.ttlMs) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /** Record (or refresh) `key`, evicting the oldest entries past the cap. */
  add(key: string): void {
    // Delete first so a refresh moves the key to the end of the insertion order.
    this.entries.delete(key);
    this.entries.set(key, this.now());
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Drop every expired entry. Cheap to call once per tick. */
  prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, seenAt] of this.entries) {
      if (seenAt <= cutoff) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
