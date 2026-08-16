/**
 * Scanner config — env-driven, loaded once at startup.
 * The scanner is READ-ONLY by construction: `OBSERVE_ONLY` must be true or
 * the process refuses to start.
 */
import "dotenv/config";

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

const TRUTHY = ["1", "true", "yes", "on"];
const FALSY = ["0", "false", "no", "off"];

/**
 * Strict parser for the one flag that decides whether this process may exist.
 *
 * A lenient parser is dangerous here: it maps typos and empty strings to
 * `false`, which trips the "REFUSING TO START" throw below and reports a
 * safety violation when the real fault is a malformed value. Unrecognised
 * input therefore throws a message naming the offending value.
 */
export function parseObserveOnly(raw: string | undefined): boolean {
  if (raw === undefined) return true; // read-only by default
  const v = raw.trim().toLowerCase();
  if (TRUTHY.includes(v)) return true;
  if (FALSY.includes(v)) return false;
  throw new Error(
    `OBSERVE_ONLY must be one of ${[...TRUTHY, ...FALSY].join("|")}, got ${JSON.stringify(raw)}`
  );
}

/**
 * Refuse to present fixture data as mainnet reality.
 *
 * Without a TONAPI key the scanner falls back to deterministic fixtures. That
 * is correct for tests and testnet, but on mainnet it writes invented tokens
 * into the mainnet journal while logging `MAINNET`. Fixtures on mainnet must be
 * an explicit operator choice (`SCANNER_SOURCE=replay`), never a silent default.
 */
export function assertLiveDataSource(opts: {
  network: string;
  tonapiKey: string;
  source: string | undefined;
}): void {
  if (opts.network !== "mainnet") return;
  if (opts.tonapiKey) return;
  if (opts.source === "replay") return;
  throw new Error(
    "REFUSING TO START: TON_NETWORK=mainnet requires TONAPI_KEY — without it the " +
      "scanner would journal fixture data as mainnet signals. Set TONAPI_KEY, or set " +
      "SCANNER_SOURCE=replay to explicitly opt into fixture data."
  );
}

function str(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const SCANNER_CONFIG = {
  network: (process.env.TON_NETWORK ?? "mainnet") as "mainnet" | "testnet",
  observeOnly: parseObserveOnly(process.env.OBSERVE_ONLY),
  scanRadarIntervalMs: num("SCAN_RADAR_INTERVAL_MS", 60_000),
  scanSniperIntervalMs: num("SCAN_SNIPER_INTERVAL_MS", 10_000),
  scanLimit: num("SCAN_LIMIT", 30),

  tonapi: {
    key: str("TONAPI_KEY", str("TON_API_KEY")),
    base: process.env.TONAPI_BASE ?? "https://tonapi.io",
    maxConcurrent: num("TONAPI_MAX_CONCURRENT", 4),
    minGapMs: num("TONAPI_MIN_GAP_MS", 170),
    timeoutMs: num("TONAPI_TIMEOUT_MS", 8_000),
    maxAttempts: num("TONAPI_MAX_ATTEMPTS", 4),
  },

  signalOut: {
    url: str("SIGNAL_OUT_URL"),
    sharedSecret: str("SIGNAL_OUT_SHARED_SECRET"),
  },

  journalDir: str("JOURNAL_DIR", "./data"),
} as const;

if (!SCANNER_CONFIG.observeOnly) {
  throw new Error(
    "REFUSING TO START: OBSERVE_ONLY=false is forbidden in the scanner layer. " +
      "The scanner is read-only by construction (see docs/architecture.md §5)."
  );
}
