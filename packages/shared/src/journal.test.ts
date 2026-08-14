import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal, readJournal, journalPath } from "./journal";

function tempJournal() {
  const dir = mkdtempSync(join(tmpdir(), "journal-"));
  return new Journal(join(dir, "signals-mainnet.ndjson"));
}

test("journal appends and reads back NDJSON lines", () => {
  const j = tempJournal();
  j.append({ id: "a", n: 1 });
  j.append({ id: "b", n: 2 });
  const rows = readJournal(j.filePath);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { id: "b", n: 2 });
});

test("journal counts lines and stays writeable", () => {
  const j = tempJournal();
  assert.equal(j.lineCountValue, 0);
  j.append("x");
  j.append("y");
  assert.equal(j.lineCountValue, 2);
});

test("journal rotates when exceeding maxBytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "journal-rot-"));
  const j = new Journal(join(dir, "j.ndjson"), { maxBytes: 200 });
  for (let i = 0; i < 200; i++) j.append({ i, pad: "x".repeat(40) });
  // rotated file exists
  const rotated = `${j.filePath}.1`;
  const rotatedExists = readFileSync(rotated, "utf8").length > 0;
  assert.ok(rotatedExists, "rotated journal file should exist");
});

test("readJournal returns [] for a missing file", () => {
  assert.deepEqual(readJournal("/nonexistent/x.ndjson"), []);
});

test("journalPath composes network-specific filename", () => {
  assert.equal(journalPath("/tmp/j", "mainnet"), "/tmp/j/signals-mainnet.ndjson");
});
