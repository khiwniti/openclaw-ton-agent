/**
 * Deterministic price series for replay backtests (P5 §15.4: minimal replay
 * first). Seeded PRNG → reproducible fixtures. No market data dependency.
 */

/** mulberry32 — small deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Bar {
  ts: number;
  priceTon: number;
}

export interface SeriesOptions {
  startTon: number;
  days: number;
  barsPerDay: number;
  /** drift per day, e.g. 0.01 = +1%/day trend. */
  driftPerDay: number;
  /** per-bar relative volatility. */
  volPerBar: number;
  seed?: number;
  startTs?: number;
}

export function generateSeries(opts: SeriesOptions): Bar[] {
  const rand = mulberry32(opts.seed ?? 42);
  const bars = Math.max(1, Math.floor(opts.days * opts.barsPerDay));
  const startTs = opts.startTs ?? 1_752_000_000_000;
  const stepMs = Math.floor((24 * 3_600_000) / opts.barsPerDay);
  const perBarDrift = Math.log(1 + opts.driftPerDay) / opts.barsPerDay;

  const out: Bar[] = [];
  let price = opts.startTon;
  for (let i = 0; i < bars; i++) {
    const shock = (rand() - 0.5) * 2 * opts.volPerBar;
    price = Math.max(1e-9, price * Math.exp(perBarDrift + shock));
    out.push({ ts: startTs + i * stepMs, priceTon: price });
  }
  return out;
}

/** Simple moving average at a bar index. */
export function smaAt(bars: Bar[], idx: number, window: number): number {
  const from = Math.max(0, idx - window + 1);
  let sum = 0;
  for (let i = from; i <= idx; i++) sum += bars[i].priceTon;
  return sum / (idx - from + 1);
}
