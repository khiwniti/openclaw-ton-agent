import test from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker, withRetry, withTimeout, ResilienceManager } from "./resilience";

test("CircuitBreaker: closed state allows execution", async () => {
  const breaker = new CircuitBreaker("test", { failureThreshold: 2 });
  let calls = 0;
  const result = await breaker.execute(async () => {
    calls++;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
  assert.equal(breaker.getState(), "CLOSED");
});

test("CircuitBreaker: opens after threshold failures", async () => {
  const breaker = new CircuitBreaker("test", { failureThreshold: 2, resetTimeoutMs: 100 });
  let calls = 0;
  // First failure
  await assert.rejects(async () => {
    await breaker.execute(async () => {
      calls++;
      throw new Error("fail");
    });
  }, { message: "fail" });
  assert.equal(breaker.getState(), "CLOSED"); // Still closed after 1 failure

  // Second failure - should open
  await assert.rejects(async () => {
    await breaker.execute(async () => {
      calls++;
      throw new Error("fail");
    });
  }, { message: "fail" });
  assert.equal(breaker.getState(), "OPEN"); // Open after 2 failures
});

test("CircuitBreaker: rejects calls when open", async () => {
  const breaker = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 1000 });
  // First call fails to open
  await assert.rejects(async () => {
    await breaker.execute(async () => {
      throw new Error("fail");
    });
  }, { message: "fail" });
  assert.equal(breaker.getState(), "OPEN");

  // Second call should be rejected
  await assert.rejects(
    breaker.execute(async () => "ok"),
    { message: /Circuit breaker 'test' is OPEN/ }
  );
});

test("withRetry: retries on failure then succeeds", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new TypeError("transient");
      return "success";
    },
    { maxRetries: 2, baseDelayMs: 10 }
  );
  assert.equal(result, "success");
  assert.equal(calls, 3);
});

test("withRetry: throws after max retries", async () => {
  await assert.rejects(
    withRetry(async () => {
      throw new Error("persistent");
    }, { maxRetries: 2, baseDelayMs: 10 }),
    { message: "persistent" }
  );
});

test("withTimeout: resolves before timeout", async () => {
  const result = await withTimeout(
    async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "done";
    },
    100
  );
  assert.equal(result, "done");
});

test("withTimeout: rejects after timeout", async () => {
  await assert.rejects(
    withTimeout(
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return "done";
      },
      10
    ),
    { message: "Operation timed out" }
  );
});

test("ResilienceManager: shared breaker instance", async () => {
  const manager = new ResilienceManager();
  const breaker1 = manager.getBreaker("shared");
  const breaker2 = manager.getBreaker("shared");
  assert.equal(breaker1, breaker2);
});