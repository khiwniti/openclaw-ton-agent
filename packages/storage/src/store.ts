import Sqlite from "better-sqlite3"
import fs from "node:fs"
import path from "node:path"

const DB_PATH = process.env.SQLITE_PATH || process.env.DATABASE_PATH || "./data/agent.db"

class Store {
  private db: Sqlite.Database

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new Sqlite(file)
    this.db.pragma("journal_mode = WAL")
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        wallet_tier TEXT,
        jetton_master TEXT,
        side TEXT,
        amount_ton REAL,
        tx_hash TEXT,
        status TEXT,
        opened_at INTEGER,
        closed_at INTEGER,
        realized_pnl_ton REAL,
        meta TEXT
      );
      CREATE TABLE IF NOT EXISTS daily_pnl (
        day TEXT PRIMARY KEY,
        pnl_ton REAL
      );
      CREATE TABLE IF NOT EXISTS decision_journal (
        id TEXT PRIMARY KEY,
        cycle_id TEXT,
        agent TEXT,
        input_hash TEXT,
        cap_check_result TEXT,
        final_action TEXT,
        output TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS agentic_wallets (
        address TEXT PRIMARY KEY,
        delegated_public_key TEXT,
        daily_limit TEXT,
        accumulated_spend TEXT,
        last_reset_timestamp INTEGER
      );
    `)
  }

  insert(table: string, row: Record<string, unknown>) {
    const keys = Object.keys(row)
    const placeholders = keys.map(() => "?").join(",")
    const values = keys.map((k) => row[k])
    this.db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${placeholders})`).run(values)
  }

  query(table: string, where?: string, params?: unknown[]) {
    const sql = `SELECT * FROM ${table}${where ? ` WHERE ${where}` : ""}`
    return this.db.prepare(sql).all(...(params || []))
  }
}

export const store = new Store(DB_PATH)
