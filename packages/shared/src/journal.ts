import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const JOURNAL_DIR = process.env.JOURNAL_DIR || process.env.DATA_DIR || "./data"

export class Journal {
  private file: string
  private maxBytes: number | null

  constructor(fileOrDir?: string, opts?: { maxBytes?: number }) {
    const input = fileOrDir ?? "";
    if (input.includes(path.sep) || input.endsWith(".ndjson")) {
      this.file = input
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
    } else {
      this.file = path.join(JOURNAL_DIR, input)
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
    }
    this.maxBytes = typeof opts?.maxBytes === "number" ? opts.maxBytes : null
  }

  get filePath() {
    return this.file
  }

  get lineCountValue(): number {
    if (!fs.existsSync(this.file)) return 0
    const data = fs.readFileSync(this.file, "utf8")
    return data.split("\n").filter(Boolean).length
  }

  append(event: Record<string, unknown> | string) {
    const payload = typeof event === "string" ? event : JSON.stringify(event)
    if (this.maxBytes !== null && fs.existsSync(this.file)) {
      const stat = fs.statSync(this.file)
      if (stat.size >= this.maxBytes) {
        const rotated = `${this.file}.1`
        if (fs.existsSync(rotated)) fs.rmSync(rotated)
        fs.renameSync(this.file, rotated)
      }
    }
    fs.appendFileSync(this.file, payload + "\n", "utf8")
  }

  tail(max = 200): Record<string, unknown>[] {
    if (!fs.existsSync(this.file)) return []
    const data = fs.readFileSync(this.file, "utf8")
    const lines = data.split("\n").filter(Boolean).slice(-max)
    return lines.map((l) => JSON.parse(l))
  }
}

export function readJournal(file: string, max = 200): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return []
  const data = fs.readFileSync(file, "utf8")
  const lines = data.split("\n").filter(Boolean).slice(-max)
  return lines.map((l) => JSON.parse(l))
}

export function journalPath(name: string, dir = JOURNAL_DIR): string {
  if (dir && dir !== "./data" && !dir.includes(path.sep)) {
    return path.join(name, `signals-${dir}.ndjson`)
  }
  return path.join(dir, name)
}

export function journalEventId(): string {
  return randomUUID()
}

export type JournalOptions = { dir?: string; maxBytes?: number }
