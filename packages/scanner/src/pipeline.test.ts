import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal, readJournal, validateIngested, type IngestedEnvelope } from "@openclaw-ton-agent/shared";
import { runScanTick } from "./pipeline";
import { replaySource } from "./replay";
import type { ScannerSource, JettonView } from "./replay";

function tempJournal(): Journal {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-"));
  return new Journal(join(dir, "signals-test.ndjson"));
}

test("replay pipeline emits validated envelopes and journals them", async () => {
  const journal = tempJournal();
  const emitted: unknown[] = [];
  const result = await runScanTick({
    source: replaySource,
    journal,
    emit: async (e) => { emitted.push(e); return { sent: true, id: e.id }; },
  });

  assert.equal(result.scanned, 4);
  assert.equal(result.emitted, 4);
  assert.equal(result.dropped, 0);

  const rows = readJournal(journal.filePath);
  const envelopes = rows.filter((r) => (r as any).kind === undefined || (r as any).status);
  assert.equal(envelopes.length, 4);
  for (const row of envelopes) {
    const v = validateIngested(row);
    assert.ok(v.ok, `journal row invalid: ${v.ok ? "" : v.reason}`);
    assert.equal((row as IngestedEnvelope).status, "validated");
  }
  assert.equal(emitted.length, 4);
});

test("pipeline dedupes already-seen masters", async () => {
  const journal = tempJournal();
  const seen = new Set(["EQA-replay-alpha", "EQB-replay-beta", "EQC-replay-gamma", "EQD-replay-delta"]);
  const result = await runScanTick({ source: replaySource, journal, seen, emit: async () => ({ sent: true }) });
  assert.equal(result.scanned, 0);
  assert.equal(result.emitted, 0);
});

test("pipeline journals missing quotes as incomplete, never fabricates", async () => {
  const journal = tempJournal();
  const noQuoteSource: ScannerSource = {
    name: "noquote",
    listRecent: async (): Promise<JettonView[]> => [
      {
        master: "EQD-noquote-1",
        symbol: "NQ",
        name: "No Quote",
        decimals: 9,
        priceTon: null,
        liquidityTon: null,
        curvePct: null,
        poolAddress: null,
      },
    ],
    auditMaster: async () => ({
      ok: true,
      verified: 70,
      renounced: true,
      locked: false,
      honeypot: false,
      holders: 200,
      ageHours: 3,
      flags: ["lp_lock_unchecked", "honeypot_unchecked"],
    }),
  };

  const result = await runScanTick({ source: noQuoteSource, journal, emit: async () => ({ sent: true }) });
  assert.equal(result.emitted, 1);
  assert.equal(result.incomplete, 1);
  const rows = readJournal(journal.filePath).filter((r) => (r as any).status);
  const ingested = rows[0] as IngestedEnvelope;
  assert.equal(ingested.status, "incomplete");
  assert.ok(ingested.flags.includes("quote_unavailable"));
});

test("pipeline drops candidates whose audit source is unavailable", async () => {
  const journal = tempJournal();
  const badAuditSource: ScannerSource = {
    name: "badaudit",
    listRecent: async (): Promise<JettonView[]> => [
      {
        master: "EQD-badaudit-1",
        symbol: "BA",
        name: "Bad Audit",
        decimals: 9,
        priceTon: 0.001,
        liquidityTon: 10,
        curvePct: 50,
        poolAddress: "EQD-badaudit-pool",
      },
    ],
    auditMaster: async () => null,
  };

  const result = await runScanTick({ source: badAuditSource, journal, emit: async () => ({ sent: true }) });
  assert.equal(result.dropped, 1);
  assert.equal(result.emitted, 0);
  const rows = readJournal(journal.filePath);
  assert.ok(rows.some((r) => (r as any).kind === "scan.audit_failed"));
});

test("source failure is journaled as scan.error and yields empty tick", async () => {
  const journal = tempJournal();
  const failingSource: ScannerSource = {
    name: "explode",
    listRecent: async () => { throw new Error("429 storm"); },
    auditMaster: async () => null,
  };
  const result = await runScanTick({ source: failingSource, journal, emit: async () => ({ sent: true }) });
  assert.equal(result.scanned, 0);
  const rows = readJournal(journal.filePath);
  assert.ok(rows.some((r) => (r as any).kind === "scan.error"));
});
