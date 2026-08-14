import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MACRO_POLL_URL,
  createMacroFeed,
  isMacroRiskOff,
  pollMacroState,
  toMacroState,
} from "./macro-feed";
import type {
  FetchImpl,
  MacroFeedSnapshot,
  MacroState,
  PollResult,
} from "./macro-feed";

const BASE: MacroFeedSnapshot = {
  fearGreedIndex: 50,
  fundingRate: 0.0001,
  priceDeviationPct: 5,
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(
  body: unknown,
  status = 200,
): { fetchImpl: FetchImpl; calls: { url: unknown; options?: RequestInit }[] } {
  const calls: { url: unknown; options?: RequestInit }[] = [];
  const fetchImpl: FetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(body, status);
  };
  return { fetchImpl, calls };
}

const EMPTY_CLOSED: MacroState = { riskOff: false, reason: "", timestamp: 0 };

test("pollMacroState posts to MACRO_POLL_URL with accept header and no API key", async () => {
  const { fetchImpl, calls } = stubFetch(BASE, 200);
  await pollMacroState(fetchImpl);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, MACRO_POLL_URL);
  assert.deepEqual(call.options?.headers, { accept: "application/json" });
});

test("pollMacroState passes the caller's abort signal to fetch", async () => {
  const controller = new AbortController();
  const { fetchImpl, calls } = stubFetch(BASE, 200);
  await pollMacroState(fetchImpl, controller.signal);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.options?.signal, controller.signal);
});

test("pollMacroState returns ok with a healthy state for a healthy snapshot", async () => {
  const { fetchImpl } = stubFetch(BASE, 200);
  const result = await pollMacroState(fetchImpl);
  assert.equal(result.verdict, "ok");
  assert.equal(result.state.riskOff, false);
  assert.equal(result.state.reason, "");
  assert.ok(result.state.timestamp > 0);
});

test("pollMacroState returns closed with an empty state when upstream responds 503", async () => {
  const { fetchImpl } = stubFetch({}, 503);
  const result = await pollMacroState(fetchImpl);
  assert.equal(result.verdict, "closed");
  assert.deepEqual(result.state, EMPTY_CLOSED);
});

test("pollMacroState returns closed with an empty state when fetch rejects", async () => {
  const boom: FetchImpl = async () => {
    throw new Error("network down");
  };
  const result = await pollMacroState(boom);
  assert.equal(result.verdict, "closed");
  assert.deepEqual(result.state, EMPTY_CLOSED);
});

test("pollMacroState returns closed without calling fetch when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const { fetchImpl, calls } = stubFetch(BASE, 200);
  const result = await pollMacroState(fetchImpl, controller.signal);
  assert.equal(result.verdict, "closed");
  assert.deepEqual(result.state, EMPTY_CLOSED);
  assert.equal(calls.length, 0);
});

test("toMacroState flags risk-off when the fear & greed index is below 15", async () => {
  const state = await toMacroState(
    jsonResponse({ ...BASE, fearGreedIndex: 14 }, 200),
  );
  assert.equal(state.riskOff, true);
  assert.match(state.reason, /fear|greed/i);
});

test("toMacroState keeps the market open when the fear & greed index is exactly 15", async () => {
  const state = await toMacroState(
    jsonResponse({ ...BASE, fearGreedIndex: 15 }, 200),
  );
  assert.equal(state.riskOff, false);
  assert.equal(state.reason, "");
});

test("toMacroState flags risk-off when the funding rate is below -0.005%", async () => {
  const state = await toMacroState(
    jsonResponse({ ...BASE, fundingRate: -0.0001 }, 200),
  );
  assert.equal(state.riskOff, true);
  assert.match(state.reason, /funding/i);
});

test("toMacroState keeps the market open when the funding rate is exactly -0.005%", async () => {
  const state = await toMacroState(
    jsonResponse({ ...BASE, fundingRate: -0.00005 }, 200),
  );
  assert.equal(state.riskOff, false);
  assert.equal(state.reason, "");
});

test("toMacroState flags risk-off when the price deviation is above 25%", async () => {
  const state = await toMacroState(
    jsonResponse({ ...BASE, priceDeviationPct: 26 }, 200),
  );
  assert.equal(state.riskOff, true);
  assert.match(state.reason, /price|deviation/i);
});

test("toMacroState keeps the market open when the price deviation is exactly 25%", async () => {
  const state = await toMacroState(
    jsonResponse({ ...BASE, priceDeviationPct: 25 }, 200),
  );
  assert.equal(state.riskOff, false);
  assert.equal(state.reason, "");
});

test("toMacroState reports the first trigger when multiple conditions hold", async () => {
  const state = await toMacroState(
    jsonResponse({ fearGreedIndex: 10, fundingRate: -0.01, priceDeviationPct: 50 }, 200),
  );
  assert.equal(state.riskOff, true);
  assert.match(state.reason, /fear|greed/i);
});

test("toMacroState records a positive timestamp", async () => {
  const state = await toMacroState(jsonResponse(BASE, 200));
  assert.ok(state.timestamp > 0);
});

test("isMacroRiskOff returns a halt verdict with the literal reason when risk-off", () => {
  assert.deepEqual(
    isMacroRiskOff({ riskOff: true, reason: "macro risk-off active", timestamp: 1 }),
    { verdict: "halt", reason: "macro risk-off active" },
  );
});

test("isMacroRiskOff returns a pass verdict with an empty reason when healthy", () => {
  assert.deepEqual(
    isMacroRiskOff({ riskOff: false, reason: "", timestamp: 1 }),
    { verdict: "pass", reason: "" },
  );
});

test("createMacroFeed polls through the injected fetch implementation", async () => {
  const { fetchImpl, calls } = stubFetch(BASE, 200);
  const feed = createMacroFeed(fetchImpl);
  const result: PollResult = await feed.poll();
  assert.equal(calls.length, 1);
  assert.equal(result.verdict, "ok");
});

test("createMacroFeed defaults to the global fetch", () => {
  const feed = createMacroFeed();
  assert.equal(typeof feed.poll, "function");
});
