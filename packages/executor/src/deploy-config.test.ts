/**
 * Deployment-config guard.
 *
 * `fly.toml` [env] is the production environment. Nothing previously verified
 * that those literal values actually parse — so `EXECUTION_MODE="trade"`
 * shipped to production and crash-looped the executor on boot (an invalid
 * mode throws at module load in config.ts).
 *
 * These tests read the real fly.toml and assert every safety-critical value
 * is one the code accepts, so a bad deploy value fails CI instead of prod.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseExecutionMode } from "./config";

/** Minimal [env] reader for fly.toml — quoted scalars only, comments stripped. */
function readFlyEnv(): Record<string, string> {
  const text = readFileSync(join(import.meta.dirname, "../../../fly.toml"), "utf8");
  const env: Record<string, string> = {};
  let inEnv = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inEnv = trimmed === "[env]";
      continue;
    }
    if (!inEnv || !trimmed || trimmed.startsWith("#")) continue;
    const m = /^([A-Z0-9_]+)\s*=\s*"([^"]*)"/.exec(trimmed);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

test("fly.toml [env] is parseable and non-empty", () => {
  const env = readFlyEnv();
  assert.ok(Object.keys(env).length > 5, "expected fly.toml [env] to be readable");
});

test("fly.toml EXECUTION_MODE is a value the executor accepts", () => {
  const env = readFlyEnv();
  // Regression guard for E1: "trade" is not a valid mode and threw on boot.
  assert.doesNotThrow(
    () => parseExecutionMode(env.EXECUTION_MODE),
    `fly.toml EXECUTION_MODE="${env.EXECUTION_MODE}" is not notify_only|paper|auto`
  );
});

test("fly.toml OBSERVE_ONLY is exactly a truthy token the bool parser accepts", () => {
  const env = readFlyEnv();
  // Regression guard for E3: the scanner hard-refuses to start unless this
  // parses truthy, and the parser only accepts 1|true|yes|on (no whitespace).
  assert.ok(
    ["1", "true", "yes", "on"].includes((env.OBSERVE_ONLY ?? "").toLowerCase()),
    `fly.toml OBSERVE_ONLY="${env.OBSERVE_ONLY}" would make the scanner refuse to start`
  );
});

test("live execution is not enabled by accident in fly.toml", () => {
  const env = readFlyEnv();
  // auto mode requires an explicit gate ack; asserting both together prevents
  // a half-configured live-trading deploy.
  if (parseExecutionMode(env.EXECUTION_MODE) === "auto") {
    assert.equal(env.GATES_G1_G3_ACK, "1", "EXECUTION_MODE=auto requires GATES_G1_G3_ACK=1");
  } else {
    assert.notEqual(env.GATES_G1_G3_ACK, "1", "GATES_G1_G3_ACK=1 set without auto mode is misleading");
  }
});
