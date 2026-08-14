/**
 * TONAPI HTTP helper (fetch-based) with token-bucket rate limiting and
 * exponential backoff + jitter. Port of ton-agent `http/tonapi.ts`, minus
 * axios. Failures surface to callers; retriable statuses retry up to
 * `maxAttempts`.
 */
import { SCANNER_CONFIG } from "./config";

const BASE_DELAYS_MS = [250, 750, 2250];
let inflight = 0;
let lastRelease = 0;
const queue: Array<() => void> = [];

function tryDrain(): void {
  if (queue.length === 0 || inflight >= SCANNER_CONFIG.tonapi.maxConcurrent) return;
  const sinceLast = Date.now() - lastRelease;
  if (sinceLast < SCANNER_CONFIG.tonapi.minGapMs) {
    setTimeout(tryDrain, SCANNER_CONFIG.tonapi.minGapMs - sinceLast);
    return;
  }
  inflight++;
  const resolve = queue.shift()!;
  resolve();
}

function release(): void {
  inflight--;
  lastRelease = Date.now();
  setTimeout(tryDrain, SCANNER_CONFIG.tonapi.minGapMs);
}

function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    queue.push(resolve);
    tryDrain();
  });
}

function jitter(base: number): number {
  const delta = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + delta));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldRetryStatus(status: number | undefined): boolean {
  if (!status) return true; // network error / no response
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/**
 * Join a TONAPI base + path into an absolute URL, passing through `/v2` exactly
 * once.
 *
 * Callers pass paths like "/jettons"; operators may set TONAPI_BASE with or
 * without a "/v2" suffix and with or without a trailing slash. Normalising both
 * sides here keeps `/v2` from being doubled or — because a leading-slash path is
 * absolute and would discard the base's own path — dropped altogether.
 */
export function buildTonapiUrl(
  base: string,
  path: string,
  params: Record<string, string | number | boolean> = {}
): URL {
  const root = base.replace(/\/+$/, "").replace(/\/v2$/, "");
  const rel = path.replace(/^\/+/, "");
  const url = new URL(`${root}/v2/${rel}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url;
}

export interface TonapiGetOpts {
  params?: Record<string, string | number | boolean>;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface TonapiResponse {
  status: number;
  data: any;
}

/** GET a TONAPI path with retries on 429 / 5xx / network errors. */
export async function tonapiGet(path: string, opts: TonapiGetOpts = {}): Promise<TonapiResponse> {
  const { timeoutMs = SCANNER_CONFIG.tonapi.timeoutMs, maxAttempts = SCANNER_CONFIG.tonapi.maxAttempts } = opts;
  const url = buildTonapiUrl(SCANNER_CONFIG.tonapi.base, path, opts.params ?? {});
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SCANNER_CONFIG.tonapi.key) headers["Authorization"] = `Bearer ${SCANNER_CONFIG.tonapi.key}`;

  await acquireSlot();
  try {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) return { status: res.status, data: await res.json() };
        lastErr = new Error(`TONAPI ${res.status} ${url.pathname}`);
        const retriable = shouldRetryStatus(res.status);
        const isLast = attempt >= maxAttempts;
        if (!retriable || isLast) throw lastErr;
        const retryAfter = parseRetryAfter(res.headers);
        const baseIdx = Math.min(attempt - 1, BASE_DELAYS_MS.length - 1);
        await sleep(Math.max(retryAfter ?? 0, jitter(BASE_DELAYS_MS[baseIdx])));
      } catch (e: any) {
        lastErr = e;
        if (!(e instanceof Error && /TONAPI \d/.test(e.message))) {
          // network-level error (fetch threw): retriable unless last attempt
          if (attempt >= maxAttempts) throw e;
          const baseIdx = Math.min(attempt - 1, BASE_DELAYS_MS.length - 1);
          await sleep(jitter(BASE_DELAYS_MS[baseIdx]));
        } else {
          throw e;
        }
      }
    }
    throw lastErr;
  } finally {
    release();
  }
}

/**
 * Holder total for a jetton master, or `null` when TONAPI is not configured
 * or unusable. Fail soft — never fabricate a count (feeds audit gaps).
 */
export async function fetchHoldersTotal(master: string): Promise<number | null> {
  if (!SCANNER_CONFIG.tonapi.key) return null;
  try {
    const r = await tonapiGet(`/jettons/${master}/holders`, { timeoutMs: 8_000 });
    return Number.isFinite(r.data?.total) ? r.data.total : null;
  } catch {
    return null;
  }
}
