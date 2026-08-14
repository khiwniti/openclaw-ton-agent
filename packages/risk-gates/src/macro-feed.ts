/**
 * Macro risk-off feed.
 *
 * Polls an external macro-risk endpoint and converts the snapshot into a
 * `MacroState` that the risk gates consult before halting trading. The feed
 * fails closed: any poll error, non-OK response, or abort yields an
 * empty "risk off" state rather than throwing, so a dead feed can never
 * halt the gate by accident.
 */

export const MACRO_POLL_URL =
  "https://fapi.binance.com/fapi/v1/macro-feed";

export type FetchImpl = (
  url: string | URL,
  options?: RequestInit,
) => Promise<Response>;

export interface MacroFeedSnapshot {
  fearGreedIndex: number;
  fundingRate: number;
  priceDeviationPct: number;
}

export interface MacroState {
  riskOff: boolean;
  reason: string;
  timestamp: number;
}

export type PollResult =
  | { verdict: "ok"; state: MacroState }
  | { verdict: "closed"; state: MacroState };

export interface MacroFeed {
  poll(): Promise<PollResult>;
}

const EMPTY_CLOSED: MacroState = { riskOff: false, reason: "", timestamp: 0 };

const FEAR_GREED_TRIGGER = 15;
const FUNDING_RATE_TRIGGER = -0.00005;
const PRICE_DEVIATION_TRIGGER_PCT = 25;

function macroRisk(
  snapshot: MacroFeedSnapshot,
): { riskOff: boolean; reason: string } {
  if (snapshot.fearGreedIndex < FEAR_GREED_TRIGGER) {
    return {
      riskOff: true,
      reason: `fear & greed index at extreme fear (${snapshot.fearGreedIndex})`,
    };
  }
  if (snapshot.fundingRate < FUNDING_RATE_TRIGGER) {
    return {
      riskOff: true,
      reason: `funding rate deeply negative (${snapshot.fundingRate})`,
    };
  }
  if (snapshot.priceDeviationPct > PRICE_DEVIATION_TRIGGER_PCT) {
    return {
      riskOff: true,
      reason: `price deviation from oracle exceeds threshold (${snapshot.priceDeviationPct}%)`,
    };
  }
  return { riskOff: false, reason: "" };
}

export async function toMacroState(response: Response): Promise<MacroState> {
  const snapshot = (await response.json()) as MacroFeedSnapshot;
  const { riskOff, reason } = macroRisk(snapshot);
  return { riskOff, reason, timestamp: Date.now() };
}

export async function pollMacroState(
  fetchImpl: FetchImpl,
  signal?: AbortSignal,
): Promise<PollResult> {
  if (signal?.aborted) {
    return { verdict: "closed", state: EMPTY_CLOSED };
  }
  try {
    const response = await fetchImpl(MACRO_POLL_URL, {
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      return { verdict: "closed", state: EMPTY_CLOSED };
    }
    return { verdict: "ok", state: await toMacroState(response) };
  } catch {
    return { verdict: "closed", state: EMPTY_CLOSED };
  }
}

export function isMacroRiskOff(
  state: MacroState,
): { verdict: "pass" | "halt"; reason: string } {
  if (state.riskOff) {
    return { verdict: "halt", reason: "macro risk-off active" };
  }
  return { verdict: "pass", reason: "" };
}

export function createMacroFeed(fetchImpl: FetchImpl = fetch): MacroFeed {
  return {
    poll(): Promise<PollResult> {
      return pollMacroState(fetchImpl);
    },
  };
}
