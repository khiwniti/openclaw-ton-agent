import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseBinanceKlines, crossRates, writeBarsNdjson, parseCoinGeckoPrices, resampleDaily, resampleTo, barsPerDayFor, intervalMsFor } from "./fetch";
import { loadBars } from "./replay";

test("parseBinanceKlines maps the kline array shape", () => {
  const raw = [
    ["1782604800000", "1.56900000", "1.61700000", "1.53500000", "1.58900000", "3096840.51", "1782691199999", "4855355.55", 62762, "1521578.28", "2387918.03", "0"],
  ];
  const k = parseBinanceKlines(raw)[0];
  assert.equal(k.openTimeMs, 1_782_604_800_000);
  assert.equal(k.open, 1.569);
  assert.equal(k.close, 1.589);
  assert.equal(k.closeTimeMs, 1_782_691_199_999);
  assert.throws(() => parseBinanceKlines("nope"));
});

test("crossRates aligns on shared open times and skips misaligned days", () => {
  const ton = [
    { openTimeMs: 1, close: 2 } as any,
    { openTimeMs: 2, close: 2 } as any,
    { openTimeMs: 3, close: 2 } as any,
  ];
  const jetton = [
    { openTimeMs: 1, close: 1 } as any, // aligned → 0.5
    { openTimeMs: 3, close: 4 } as any, // aligned → 2.0 (skips openTime 2)
  ];
  const bars = crossRates(ton, jetton);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].priceTon, 0.5);
  assert.equal(bars[1].priceTon, 2);
  assert.equal(bars[0].ts, 1);
  assert.ok(bars[0].ts <= bars[1].ts);
});

test("crossRates guards against non-positive or missing TON price", () => {
  const ton = [{ openTimeMs: 1, close: 0 } as any, { openTimeMs: 2, close: 2 } as any];
  const jetton = [{ openTimeMs: 1, close: 1 } as any, { openTimeMs: 2, close: 2 } as any];
  const bars = crossRates(ton, jetton);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].priceTon, 1);
});

test("parseCoinGeckoPrices maps market_chart price points", () => {
  const raw = { prices: [[1_752_000_000_000, 1.37], [1_752_000_360_000, "1.38"]] };
  const pts = parseCoinGeckoPrices(raw);
  assert.equal(pts.length, 2);
  assert.equal(pts[0].tsMs, 1_752_000_000_000);
  assert.equal(pts[0].price, 1.37);
  assert.equal(pts[1].price, 1.38);
  assert.throws(() => parseCoinGeckoPrices({ prices: [[1, "abc"]] }));
  assert.throws(() => parseCoinGeckoPrices({ prices: [[1]] }));
  assert.throws(() => parseCoinGeckoPrices({ nope: true }));
});

test("resampleDaily buckets 1h points into 00:00-UTC daily bars", () => {
  const day0 = Date.UTC(2026, 7, 10); // 2026-08-10T00:00:00Z
  const points = [
    { tsMs: day0 + 3 * 3_600_000, price: 1.3 },
    { tsMs: day0 + 5 * 3_600_000, price: 1.6 },
    { tsMs: day0 + 7 * 3_600_000, price: 1.4 },
    { tsMs: day0 + 86_400_000 + 3 * 3_600_000, price: 1.5 },
  ];
  const bars = resampleDaily(points);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].openTimeMs, day0);
  assert.equal(bars[0].open, 1.3);
  assert.equal(bars[0].high, 1.6);
  assert.equal(bars[0].low, 1.3);
  assert.equal(bars[0].close, 1.4);
  assert.equal(bars[1].openTimeMs, day0 + 86_400_000);
  assert.equal(bars[1].close, 1.5);
  assert.ok(bars[0].openTimeMs <= bars[1].openTimeMs);
});

test("barsPerDayFor / intervalMsFor handle m/h/d/w intervals", () => {
  assert.equal(barsPerDayFor("1d"), 1);
  assert.equal(barsPerDayFor("4h"), 6);
  assert.equal(barsPerDayFor("1h"), 24);
  assert.equal(barsPerDayFor("30m"), 48);
  assert.equal(barsPerDayFor("1w"), 1 / 7);
  assert.equal(intervalMsFor("4h"), 14_400_000);
  assert.equal(intervalMsFor("1d"), 86_400_000);
  assert.throws(() => barsPerDayFor("wat"));
});

test("resampleTo buckets 1h points into Binance-aligned 4h bars", () => {
  const t0 = Date.UTC(2026, 7, 13, 8); // 08:00 UTC, a Binance 4h boundary
  const points = [
    { tsMs: t0, price: 1.0 },
    { tsMs: t0 + 3_600_000, price: 1.1 },
    { tsMs: t0 + 2 * 3_600_000, price: 1.05 },
    { tsMs: t0 + 3 * 3_600_000, price: 1.2 },
    { tsMs: t0 + 4 * 3_600_000, price: 0.9 }, // next 4h bucket
    { tsMs: t0 + 7 * 3_600_000, price: 1.3 },
  ];
  const bars = resampleTo(points, 14_400_000);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].openTimeMs, t0);
  assert.equal(bars[0].high, 1.2);
  assert.equal(bars[0].low, 1.0);
  assert.equal(bars[0].close, 1.2);
  assert.equal(bars[1].openTimeMs, t0 + 4 * 3_600_000);
  assert.equal(bars[1].close, 1.3);
});

test("crossRates aligns Binance 4h jetton bars with resampled CoinGecko TON base", () => {
  const t0 = Date.UTC(2026, 7, 13, 8);
  const ton = resampleTo(
    [
      { tsMs: t0, price: 2.0 },
      { tsMs: t0 + 2 * 3_600_000, price: 2.0 },
      { tsMs: t0 + 4 * 3_600_000, price: 4.0 },
      { tsMs: t0 + 6 * 3_600_000, price: 4.0 },
    ],
    14_400_000,
  );
  const jetton = [
    { openTimeMs: t0, close: 1.0 } as any,
    { openTimeMs: t0 + 4 * 3_600_000, close: 8.0 } as any,
  ];
  const bars = crossRates(ton, jetton);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].priceTon, 0.5);
  assert.equal(bars[1].priceTon, 2);
});

test("crossRates aligns CoinGecko-resampled TON daily with Binance jetton daily", () => {
  const day0 = Date.UTC(2026, 7, 10);
  const ton = resampleDaily([
    { tsMs: day0 + 3 * 3_600_000, price: 2.0 },
    { tsMs: day0 + 5 * 3_600_000, price: 2.0 },
    { tsMs: day0 + 86_400_000 + 3 * 3_600_000, price: 4.0 },
    { tsMs: day0 + 86_400_000 + 5 * 3_600_000, price: 4.0 },
  ]);
  const jetton = [
    { openTimeMs: day0, close: 1.0 } as any,
    { openTimeMs: day0 + 86_400_000, close: 8.0 } as any,
  ];
  const bars = crossRates(ton, jetton);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].priceTon, 0.5);
  assert.equal(bars[1].priceTon, 2);
  assert.equal(bars[0].ts, day0);
});

test("writeBarsNdjson round-trips through loadBars", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-fetch-"));
  const file = path.join(dir, "bars.ndjson");
  const bars = new Map<string, any[]>([
    ["EQA-cex:not", [{ ts: 1, priceTon: 0.1 }, { ts: 2, priceTon: 0.11 }]],
    ["EQA-cex:hmstr", [{ ts: 1, priceTon: 0.02 }, { ts: 2, priceTon: 0.021 }]],
  ]);
  writeBarsNdjson(bars as any, file);
  const loaded = loadBars(file);
  assert.equal(loaded.size, 2);
  assert.equal(loaded.get("EQA-cex:not")!.length, 2);
  assert.ok(Math.abs(loaded.get("EQA-cex:hmstr")![1].priceTon - 0.021) < 1e-12);
});

test("replayFromBars runs momentum signals on real-style bars", () => {
  // import here to avoid pulling fetch into the other tests
  const { replayFromBars } = require("./replay") as typeof import("./replay");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-rb-"));
  const file = path.join(dir, "bars.ndjson");
  const bars: Array<{ tokenAddress: string; ts: number; priceTon: number }> = [];
  // 60 daily bars trending up the whole way so momentum crosses fire
  // (a rise-then-fall series would put every signal past the peak → score 55 → gated)
  let price = 0.1;
  for (let i = 0; i < 60; i++) {
    price *= 1 + 0.01;
    bars.push({ tokenAddress: "EQA-rb:not", ts: 1_752_000_000_000 + i * 86_400_000, priceTon: price });
  }
  fs.writeFileSync(file, bars.map((b) => JSON.stringify(b)).join("\n") + "\n", "utf8");
  const out = replayFromBars({ barsFile: file, mode: "swing" });
  assert.equal(out.signalSource, "momentum-bars");
  assert.equal(out.input.syntheticBars, false);
  assert.ok(out.input.eventsUsed > 0, "momentum signals generated from real bars");
  assert.ok(out.result.trades.length > 0, "signals become costed trades");
  for (const t of out.result.trades) assert.ok(t.feesTon > 0);
});
