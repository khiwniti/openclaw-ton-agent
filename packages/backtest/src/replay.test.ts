import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateSeries } from "./series";
import { generateEvents, makeFixtureEnvelope } from "./fixture";
import { loadSignals, loadBars, exportBarsToNdjson, loadReplayInput, replayFromFiles } from "./replay";

function writeNdjson(dir: string, file: string, lines: unknown[]): string {
  const p = path.join(dir, file);
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return p;
}

test("loadBars groups and sorts bars per token; export round-trips", () => {
  const bars = generateSeries({ startTon: 10, days: 2, barsPerDay: 24, driftPerDay: 0.01, volPerBar: 0.01, seed: 3 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-bars-"));
  const file = path.join(dir, "bars.ndjson");
  exportBarsToNdjson(bars, "EQA-export", file);
  const loaded = loadBars(file);
  const list = loaded.get("EQA-export")!;
  assert.equal(list.length, bars.length);
  for (let i = 1; i < list.length; i++) assert.ok(list[i].ts >= list[i - 1].ts);
  assert.ok(Math.abs(list[0].priceTon - bars[0].priceTon) < 1e-12);
});

test("loadSignals drops invalid lines from a journal feed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-sig-"));
  const env = makeFixtureEnvelope("EQA-sig", "SIG", 1.2, 1_000, 90);
  const file = writeNdjson(dir, "signals.ndjson", [env, { junk: true }, env]);
  const signals = loadSignals(file);
  assert.equal(signals.length, 2);
});

test("loadReplayInput synthesizes bars for tokens missing from the bar file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-mix-"));
  const envA = makeFixtureEnvelope("EQA-a", "A", 10, 1_000_000, 90);
  const envB = makeFixtureEnvelope("EQA-b", "B", 20, 2_000_000, 90);
  const signalsFile = writeNdjson(dir, "signals.ndjson", [envA, envB]);
  const barsA = generateSeries({ startTon: 10, days: 2, barsPerDay: 48, driftPerDay: 0.01, volPerBar: 0.01, seed: 1 });
  const barsFile = path.join(dir, "bars.ndjson");
  exportBarsToNdjson(barsA, "EQA-a", barsFile);

  const input = loadReplayInput(signalsFile, barsFile);
  assert.ok(input.bars.has("EQA-a"), "token with a bar file keeps real bars");
  assert.ok(input.bars.has("EQA-b"), "missing token gets synthesized bars");
  assert.equal(input.skippedNoBars, 1);
  assert.equal(input.syntheticBars, true);
  assert.equal(input.eventsUsed, 2);
});

test("replayFromFiles runs the real feed through the engine (no bar file → synthetic, labeled)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-replay-"));
  const bars = generateSeries({ startTon: 10, days: 45, barsPerDay: 48, driftPerDay: 0.02, volPerBar: 0.01, seed: 9 });
  const events = generateEvents(bars, "EQA-rp", "RP");
  const signalsFile = writeNdjson(dir, "signals.ndjson", events.map((e) => e.envelope));

  const { result, input, metrics } = replayFromFiles({ signalsFile });
  assert.equal(input.syntheticBars, true, "no bar file must be labeled synthetic");
  assert.ok(input.eventsUsed > 0);
  assert.ok(result.eventsEvaluated === events.length);
  assert.ok(metrics.trades > 0, "replayed signals produce costed trades");
  for (const t of result.trades) assert.ok(t.feesTon > 0);
});

test("replayFromFiles with a real bar file is labeled real (not synthetic)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-replay-real-"));
  const bars = generateSeries({ startTon: 10, days: 45, barsPerDay: 48, driftPerDay: 0.02, volPerBar: 0.01, seed: 10 });
  const events = generateEvents(bars, "EQA-rr", "RR");
  const signalsFile = writeNdjson(dir, "signals.ndjson", events.map((e) => e.envelope));
  const barsFile = path.join(dir, "bars.ndjson");
  exportBarsToNdjson(bars, "EQA-rr", barsFile);

  const { input, result } = replayFromFiles({ signalsFile, barsFile });
  assert.equal(input.syntheticBars, false);
  assert.ok(result.trades.length > 0);
});
