/**
 * Resilience utilities: circuit breaker, retry with exponential backoff,
 * and timeout wrappers for external API calls.
 */

export type CircuitBreakerOptions = {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenMaxCalls?: number;
};

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private state: CircuitBreakerState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions = {}
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= (this.options.resetTimeoutMs ?? 30_000)) {
        this.state = "HALF_OPEN";
        this.halfOpenCalls = 0;
      } else {
        throw new Error(`Circuit breaker '${this.name}' is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.halfOpenCalls = 0;
    this.state = "CLOSED";
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= (this.options.failureThreshold ?? 5)) {
      this.state = "OPEN";
    } else if (this.state === "HALF_OPEN") {
      this.halfOpenCalls++;
      if (this.halfOpenCalls >= (this.options.halfOpenMaxCalls ?? 3)) {
        this.state = "OPEN";
        this.lastFailureTime = Date.now();
      }
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  reset() {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.halfOpenCalls = 0;
  }
}

export type RetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableStatuses?: number[];
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 100,
    maxDelayMs = 5000,
    backoffMultiplier = 2,
    retryableStatuses = [502, 503, 504, 429],
  } = options;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const status = lastError.status ?? lastError.code;
      const isRetryable = retryableStatuses.includes(status) || lastError.name === "TypeError" || lastError.message.includes("timeout") || lastError.message.includes("Circuit breaker");

      if (!isRetryable || attempt === maxRetries) {
        throw lastError;
      }

      const delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Operation timed out")), timeoutMs)
    ),
  ]);
}

export class ResilienceManager {
  private breakers = new Map<string, CircuitBreaker>();

  getBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, options));
    }
    return this.breakers.get(name)!;
  }

  async executeWithResilience<T>(
    name: string,
    fn: () => Promise<T>,
    options?: RetryOptions & CircuitBreakerOptions
  ): Promise<T> {
    const breaker = this.getBreaker(name, options);
    return breaker.execute(() => withRetry(() => withTimeout(fn, options?.timeoutMs ?? 10_000), options));
  }

  resetAll() {
    this.breakers.forEach((b) => b.reset());
  }
}

export const globalResilience = new ResilienceManager();