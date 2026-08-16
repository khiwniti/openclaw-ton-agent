const LEVEL_COLOR = {
  info: "\x1b[36m",
  ok: "\x1b[32m",
  warn: "\x1b[33m",
  err: "\x1b[31m",
  trade: "\x1b[35m",
}

export function log(module: string, level: "info" | "ok" | "warn" | "err" | "trade", message: string) {
  const ts = new Date().toISOString()
  const color = LEVEL_COLOR[level] || ""
  const reset = "\x1b[0m"
  console.log(`${color}[${ts}][${module}][${level.toUpperCase()}] ${message}${reset}`)
}

export const logger = {
  info: (module: string, message: string) => log(module, "info", message),
  ok: (module: string, message: string) => log(module, "ok", message),
  warn: (module: string, message: string) => log(module, "warn", message),
  err: (module: string, message: string) => log(module, "err", message),
  trade: (module: string, message: string) => log(module, "trade", message),
}
