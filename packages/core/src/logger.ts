/**
 * Structured logger for OpenClaw.
 *
 * In production (LOG_FORMAT=json or non-TTY stdout) emits newline-delimited
 * JSON for log aggregators (Fly.io log drain → Grafana Loki / Datadog).
 * In development emits human-readable ANSI-colored lines.
 *
 * Log levels: err > warn > trade > ok > info
 * Set LOG_LEVEL=warn to suppress info/ok/trade in production.
 */

const LEVELS = { err: 0, warn: 1, trade: 2, ok: 3, info: 4 } as const
type Level = keyof typeof LEVELS

const RAW_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level
const MIN_LEVEL: number = LEVELS[RAW_LEVEL] ?? LEVELS.info

const USE_JSON =
  process.env.LOG_FORMAT === "json" ||
  (!process.stdout.isTTY && process.env.LOG_FORMAT !== "text")

const LEVEL_COLOR: Record<Level, string> = {
  info: "\x1b[36m",
  ok: "\x1b[32m",
  warn: "\x1b[33m",
  err: "\x1b[31m",
  trade: "\x1b[35m",
}

export function log(module: string, level: Level, message: string): void {
  if (LEVELS[level] > MIN_LEVEL) return

  const ts = new Date().toISOString()

  if (USE_JSON) {
    // One JSON object per line — parseable by any log aggregator
    process.stdout.write(
      JSON.stringify({ ts, module, level, message }) + "\n"
    )
  } else {
    const color = LEVEL_COLOR[level]
    const reset = "\x1b[0m"
    process.stdout.write(
      `${color}[${ts}][${module}][${level.toUpperCase()}] ${message}${reset}\n`
    )
  }
}

export const logger = {
  info:  (module: string, message: string) => log(module, "info", message),
  ok:    (module: string, message: string) => log(module, "ok", message),
  warn:  (module: string, message: string) => log(module, "warn", message),
  err:   (module: string, message: string) => log(module, "err", message),
  trade: (module: string, message: string) => log(module, "trade", message),
}

