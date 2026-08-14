import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runPaper } from "./paper";
import { readJournal } from "@openclaw-ton-agent/shared";
import { generateSeries } from "./series";

function tmpBarsFile(series: { ts: number; priceTon: number }[], tokenAddress: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-"));
  const file = path.join(dir, "bars.ndjson");
  fs.writeFileSync(file, series.map((b) => JSON.stringify({ tokenAddress, ts: b.ts, priceTon: b.priceTon })).join("\n") + "\n", "utf8");
  return file;
}

test("runPaper journals every gated-pipeline decision and books deterministic fills", () => {
  const up = generateSeries({ startTon: 10, days: 200, barsPerDay: 1, driftPerDay: 0.03, volPerBar: 0.008, seed: 51 });
  const barsFile = tmpBarsFile(up, "EQA-paper:up");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-journal-"));
  const journalFile = path.join(dir, "decision-journal.ndjson");

  const result = runPaper({
    barsFile,
    journalFile,
    window: 10,
    regimeSlow: 0,
    mode: "diamond",
    volPct: 0.05,
    rrTarget: 5,
  });

  assert.ok(result.events > 0, "rising series generates events");
  assert.ok(result.fills > 0, "gated pipeline books fills on a rising series");
  assert.ok(result.exits >= result.fills, "every fill gets an exit");
  assert.equal(result.journalLines, result.decisions.length, "every decision is journaled");
  assert.equal(result.paperOrderCount, 0, "no executor-format journals when not requested");

  const lines = readJournal(journalFile) as Array<{ kind: string; decision: { kind: string } }>;
  assert.ok(lines.length > 0);
  const kinds = new Set(lines.map((l) => l.decision.kind));
  assert.ok(kinds.has("event"));
  assert.ok(kinds.has("gate_reject") || kinds.has("gate_pass"));
  assert.ok(kinds.has("fill"));
  assert.ok(kinds.has("exit"));
});

test("runPaper with orders/fills journals books executor-format fills (G2 drift input)", () => {
  const up = generateSeries({ startTon: 10, days: 200, barsPerDay: 1, driftPerDay: 0.03, volPerBar: 0.008, seed: 51 });
  const barsFile = tmpBarsFile(up, "EQA-paper:up");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-journal-"));
  const journalFile = path.join(dir, "decision-journal.ndjson");
  const ordersFile = path.join(dir, "orders.ndjson");
  const fillsFile = path.join(dir, "fills.ndjson");

  const result = runPaper({
    barsFile,
    journalFile,
    ordersFile,
    fillsFile,
    window: 10,
    mode: "diamond",
    volPct: 0.05,
    rrTarget: 5,
  });

  assert.ok(result.fills > 0);
  assert.equal(result.paperOrderCount, result.fills, "every fill is booked as an order + fill pair");
  const orders = readJournal(ordersFile) as Array<{ id: string; amountTon: number; entryTon: number }>;
  const fills = readJournal(fillsFile) as Array<{ orderId: string; status: string; mode: string }>;
  assert.equal(orders.length, result.fills);
  assert.equal(fills.length, result.fills);
  assert.ok(fills.every((f) => f.status === "filled" && f.mode === "paper"));
  assert.ok(orders.every((o) => o.amountTon > 0 && o.entryTon > 0));
});

test("runPaper is forward-only: skipping the tune segment cuts its events", () => {
  const up = generateSeries({ startTon: 10, days: 200, barsPerDay: 1, driftPerDay: 0.03, volPerBar: 0.008, seed: 51 });
  const barsFile = tmpBarsFile(up, "EQA-paper:up");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-journal-"));
  const journalFile = path.join(dir, "decision-journal.ndjson");

  const full = runPaper({ barsFile, journalFile, window: 10, mode: "diamond", volPct: 0.05, rrTarget: 5 });
  const tail = runPaper({ barsFile, journalFile, window: 10, mode: "diamond", volPct: 0.05, rrTarget: 5, skipBars: 120 });

  assert.ok(tail.events < full.events, "skipping the tune segment reduces events");
});
