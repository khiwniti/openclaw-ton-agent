/**
 * Real-data bar source (P6 G1 prep). Fetches daily/higher-freq candles for
 * TON-ecosystem jettons from public CEX OHLC and converts to TON-denominated
 * bars via a cross-rate against the TON/USD price.
 *
 * Why cross-rates: the whole backtest prices in TON (fees 0.1 TON/side,
 * position in TON, G1 in TON). TON itself is degenerate (price≡1), so the
 * tradeable universe is jettons quoted in TON: NOT/TON, HMSTR/TON, DOGS/TON.
 *
 * Base leg — TON/USD: as of 2026-08 all Binance TON pairs (TONUSDT, TONUSDC,
 * TONBTC) are in BREAK status and their klines stop at 2026-06-30, so Binance
 * cannot serve the base leg. We use CoinGecko /coins/{id}/market_chart
 * (1h candles, no API key) resampled to daily bars aligned at 00:00 UTC —
 * the exact convention Binance daily klines use — so crossRates aligns.
 * If CoinGecko ever fails, fetchTonUsdBars falls back to Binance TONUSDT.
 *
 * Quote leg — jettons: Binance klines (still trading).
 *
 * Honesty: CEX prices ≠ TON DEX execution prices; label every run as
 * cex-cross-rate data. The engine and gate stack are identical to live.
 *
 * Binance kline: [openTime, open, high, low, close, volume, closeTime, ...]
 * CoinGecko market_chart: { prices: [[ts, price], ...] }
 *   (close is used as the bar price; openTime is the bar timestamp)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Bar } from "./series";

export interface Kline {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTimeMs: number;
}

export const BINANCE_URL = "https://api.binance.com/api/v3/klines";
export const COINGECKO_URL = "https://api.coingecko.com/api/v3/coins/the-open-network/market_chart";
export const DEFAULT_JETTONS = ["not", "hmstr", "dogs"];
const DAY_MS = 86_400_000;

export interface PricePoint {
  tsMs: number;
  price: number;
}

export function parseBinanceKlines(raw: unknown): Kline[] {
  if (!Array.isArray(raw)) throw new Error("binance: expected an array of klines");
  return raw.map((row) => {
    if (!Array.isArray(row) || row.length < 7) throw new Error("binance: malformed kline row");
    const [openTimeMs, open, high, low, close, volume, closeTimeMs] = row as unknown[];
    for (const v of [openTimeMs, open, high, low, close, volume, closeTimeMs]) {
      if (typeof v !== "string" && typeof v !== "number") throw new Error("binance: non-numeric kline field");
    }
    return {
      openTimeMs: Number(openTimeMs),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      closeTimeMs: Number(closeTimeMs),
    };
  });
}

export async function fetchKlines(symbol: string, interval = "1d", limit = 45, timeoutMs = 20_000): Promise<Kline[]> {
  const url = `${BINANCE_URL}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`binance ${symbol}: HTTP ${res.status}`);
    const raw = (await res.json()) as unknown;
    return parseBinanceKlines(raw);
  } finally {
    clearTimeout(timer);
  }
}

/** CoinGecko market_chart → { prices: [[tsMs, price], ...] }. */
export function parseCoinGeckoPrices(raw: unknown): PricePoint[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { prices?: unknown }).prices)) {
    throw new Error("coingecko: expected { prices: [[tsMs, price], ...] }");
  }
  return (raw as { prices: unknown[] }).prices.map((p) => {
    if (!Array.isArray(p) || p.length < 2) throw new Error("coingecko: malformed price point");
    const [tsMs, price] = p;
    if (typeof tsMs !== "number" || (typeof price !== "number" && typeof price !== "string")) {
      throw new Error("coingecko: non-numeric price point");
    }
    const v = Number(price);
    if (!Number.isFinite(v)) throw new Error("coingecko: invalid price value");
    return { tsMs, price: v };
  });
}

/** Binance `limit` is a bar count; for sub-daily intervals days ≠ bars. */
export function barsPerDayFor(interval: string): number {
  const HOUR_MS = 3_600_000;
  const m = /^(\d+)([mhdw])$/.exec(interval);
  if (!m) throw new Error(`unsupported interval: ${interval}`);
  const n = Number(m[1]);
  const unitMs = m[2] === "m" ? 60_000 : m[2] === "h" ? HOUR_MS : m[2] === "d" ? 24 * HOUR_MS : 7 * 24 * HOUR_MS;
  return (24 * HOUR_MS) / (n * unitMs);
}

export function intervalMsFor(interval: string): number {
  const HOUR_MS = 3_600_000;
  const m = /^(\d+)([mhdw])$/.exec(interval);
  if (!m) throw new Error(`unsupported interval: ${interval}`);
  const n = Number(m[1]);
  const unitMs = m[2] === "m" ? 60_000 : m[2] === "h" ? HOUR_MS : m[2] === "d" ? 24 * HOUR_MS : 7 * 24 * HOUR_MS;
  return n * unitMs;
}

/** Resample CoinGecko 1h points into bars bucketed at interval boundaries (00:00 UTC for 1d). */
export function resampleTo(points: PricePoint[], intervalMs: number): Kline[] {
  const buckets = new Map<number, number[]>();
  for (const p of points) {
    const start = p.tsMs - (p.tsMs % intervalMs);
    const bucket = buckets.get(start) ?? [];
    bucket.push(p.price);
    buckets.set(start, bucket);
  }
  const out: Kline[] = [];
  for (const [start, prices] of buckets) {
    out.push({
      openTimeMs: start,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume: 0,
      closeTimeMs: start + intervalMs - 1,
    });
  }
  return out.sort((a, b) => a.openTimeMs - b.openTimeMs);
}

/** Resample 1h CoinGecko points into daily bars bucketed at 00:00 UTC. */
export function resampleDaily(points: PricePoint[]): Kline[] {
  return resampleTo(points, DAY_MS);
}

/** TON/USD base leg. CoinGecko first (Binance TON pairs are BREAK); fall back to Binance TONUSDT. */
export async function fetchTonUsdBars(days = 60, interval = "1d", timeoutMs = 20_000): Promise<Kline[]> {
  try {
    const intervalMs = intervalMsFor(interval);
    // CoinGecko market_chart serves 1h candles up to ~90 days; resample to the
    // requested interval. For sub-daily intervals we still ask for enough 1h
    // points to cover `days`.
    const cgDays = interval === "1d" ? Math.max(days, 2) : Math.min(Math.max(days, 2), 90);
    const url = `${COINGECKO_URL}?vs_currency=usd&days=${cgDays}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`coingecko TON/USD: HTTP ${res.status}`);
      const raw = (await res.json()) as unknown;
      return resampleTo(parseCoinGeckoPrices(raw), intervalMs);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`TON/USD base via CoinGecko failed (${(err as Error).message}); falling back to Binance TONUSDT`);
    return fetchKlines("TONUSDT", interval, days * barsPerDayFor(interval), timeoutMs);
  }
}

/** Cross-rate a jetton against TON at aligned open times (pure, testable). */
export function crossRates(tonKlines: Kline[], jettonKlines: Kline[]): Bar[] {
  const tonByOpen = new Map<number, number>();
  for (const k of tonKlines) tonByOpen.set(k.openTimeMs, k.close);
  const out: Bar[] = [];
  for (const k of jettonKlines) {
    const tonPrice = tonByOpen.get(k.openTimeMs);
    if (tonPrice === undefined || tonPrice <= 0) continue; // align on shared days
    const priceTon = k.close / tonPrice;
    if (!Number.isFinite(priceTon) || priceTon <= 0) continue;
    out.push({ ts: k.openTimeMs, priceTon });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export async function fetchTonJettonsBars(opts: { jettons?: string[]; interval?: string; days?: number }): Promise<Map<string, Bar[]>> {
  const jettons = opts.jettons ?? DEFAULT_JETTONS;
  const interval = opts.interval ?? "1d";
  const days = opts.days ?? 45;
  // Base leg from CoinGecko for any interval (Binance TON pairs are BREAK).
  const ton = await fetchTonUsdBars(days, interval);
  if (ton.length === 0) throw new Error("no TON/USD base bars available for cross-rate");
  const limit = Math.max(1, Math.ceil(days * barsPerDayFor(interval)));
  const out = new Map<string, Bar[]>();
  for (const sym of jettons) {
    const upper = sym.toUpperCase();
    const jk = await fetchKlines(`${upper}USDT`, interval, limit);
    out.set(`EQA-cex:${sym}`, crossRates(ton, jk));
  }
  return out;
}

/** Write bars in the replay NDJSON format ({tokenAddress,ts,priceTon} per line). */
export function writeBarsNdjson(bars: Map<string, Bar[]>, file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines: string[] = [];
  for (const [tokenAddress, series] of bars) {
    for (const b of series) lines.push(JSON.stringify({ tokenAddress, ts: b.ts, priceTon: b.priceTon }));
  }
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}
