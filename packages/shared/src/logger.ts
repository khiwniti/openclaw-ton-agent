/**
 * Structured logger with correlation IDs for distributed tracing.
 * All services use this for consistent JSON logging.
 */
import { randomUUID } from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  correlationId?: string;
  tokenAddress?: string;
  orderId?: string;
  envelopeId?: string;
  tradeId?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  ts: number;
  correlationId: string;
  service: string;
  msg: string;
  err?: { message: string; stack?: string };
  context: LogContext;
}

export class Logger {
  private correlationId: string;
  private service: string;
  private baseContext: LogContext;

  constructor(service: string, context: LogContext = {}) {
    this.service = service;
    this.correlationId = context.correlationId ?? randomUUID();
    this.baseContext = context;
  }

  child(context: LogContext): Logger {
    const logger = new Logger(this.service, { ...this.baseContext, ...context, correlationId: this.correlationId });
    return logger;
  }

  withCorrelationId(correlationId: string): Logger {
    const logger = new Logger(this.service, { ...this.baseContext, correlationId });
    return logger;
  }

  private log(level: LogLevel, msg: string, meta: LogContext = {}, err?: Error): void {
    const entry: LogEntry = {
      level,
      ts: Date.now(),
      correlationId: this.correlationId,
      service: this.service,
      msg,
      context: { ...this.baseContext, ...meta },
    };
    if (err) {
      entry.err = { message: err.message, stack: err.stack };
    }
    const output = JSON.stringify(entry);
    if (level === "error" || level === "warn") {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  debug(msg: string, meta?: LogContext): void { this.log("debug", msg, meta); }
  info(msg: string, meta?: LogContext): void { this.log("info", msg, meta); }
  warn(msg: string, meta?: LogContext): void { this.log("warn", msg, meta); }
  error(msg: string, err: Error | unknown, meta?: LogContext): void {
    const error = err instanceof Error ? err : new Error(String(err));
    this.log("error", msg, meta, error);
  }
}

/** Create a logger for a specific service */
export function createLogger(service: string, context?: LogContext): Logger {
  return new Logger(service, context);
}

/** Extract correlation ID from incoming request headers */
export function extractCorrelationId(headers: Record<string, string | undefined>): string | undefined {
  return headers["x-correlation-id"] ?? headers["x-request-id"] ?? undefined;
}