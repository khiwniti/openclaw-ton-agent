/**
 * Journal — NDJSON append-only store for SignalEnvelope stream.
 * Mirrors the `decision_journal` concept from ton-agent. Thread-safe for a
 * single writer process (node fs append is atomic for small writes).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export interface JournalOptions {
  /** Rotate to `<file>.1` once size exceeds this (bytes). Default 16MB. */
  maxBytes?: number;
}

export class Journal {
  readonly filePath: string;
  private readonly maxBytes: number;
  private lineCount = 0;

  constructor(filePath: string, opts: JournalOptions = {}) {
    this.filePath = filePath;
    this.maxBytes = opts.maxBytes ?? 16 * 1024 * 1024;
    if (!existsSync(filePath)) {
      mkdirSync(dirname(filePath), { recursive: true });
      appendFileSync(filePath, "", { flag: "a" });
    }
    this.lineCount = this.countLines(filePath);
  }

  private countLines(p: string): number {
    try {
      return readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0).length;
    } catch {
      return 0;
    }
  }

  append(value: unknown): void {
    const line = JSON.stringify(value);
    if (line === undefined) throw new Error("journal: value is not JSON-serializable");
    appendFileSync(this.filePath, line + "\n", { flag: "a" });
    this.lineCount++;
    this.maybeRotate();
  }

  private maybeRotate(): void {
    let size = 0;
    try {
      size = statSync(this.filePath).size;
    } catch {
      return;
    }
    if (size > this.maxBytes) {
      renameSync(this.filePath, `${this.filePath}.1`);
      appendFileSync(this.filePath, "", { flag: "a" });
      this.lineCount = 0;
    }
  }

  get lineCountValue(): number {
    return this.lineCount;
  }
}

/** Read an NDJSON journal into an array (for tests, replay, backtest input). */
export function readJournal(filePath: string): unknown[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

export function journalPath(dir: string, network: string): string {
  return join(dir, `signals-${network}.ndjson`);
}
