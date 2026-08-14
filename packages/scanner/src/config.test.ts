/**
 * Scanner config guards.
 *
 * Regression guards for two production incidents:
 *
 * E3 — `OBSERVE_ONLY` was parsed by a lenient bool() that treated any
 *   unrecognised string (including "" and " true") as FALSE, which trips the
 *   hard "REFUSING TO START" throw. A typo silently became a crash-loop, and
 *   the error blamed the operator's intent rather than the malformed value.
 *
 * E5 — with no TONAPI_KEY the scanner silently fell back to fixture data while
 *   reporting network=MAINNET, writing fake tokens into the mainnet journal.
 *   Fixtures on mainnet must now be an explicit opt-in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseObserveOnly, assertLiveDataSource } from "./config";

test("parseObserveOnly accepts the documented truthy tokens", () => {
  for (const v of ["1", "true", "TRUE", "True", "yes", "on"]) {
    assert.equal(parseObserveOnly(v), true, `${JSON.stringify(v)} should be true`);
  }
});

test("parseObserveOnly accepts the documented falsy tokens", () => {
  for (const v of ["0", "false", "FALSE", "no", "off"]) {
    assert.equal(parseObserveOnly(v), false, `${JSON.stringify(v)} should be false`);
  }
});

test("parseObserveOnly tolerates surrounding whitespace", () => {
  // " true" previously parsed as false and crash-looped the scanner.
  assert.equal(parseObserveOnly(" true "), true);
  assert.equal(parseObserveOnly("\ttrue\n"), true);
});

test("parseObserveOnly defaults to read-only when unset", () => {
  assert.equal(parseObserveOnly(undefined), true);
});

test("parseObserveOnly rejects garbage instead of silently meaning false", () => {
  // The old parser mapped these to false -> "REFUSING TO START", which hid the
  // real problem (a malformed value) behind a safety message.
  for (const v of ["", "observe", "maybe", "2"]) {
    assert.throws(() => parseObserveOnly(v), /OBSERVE_ONLY/, `${JSON.stringify(v)} should throw`);
  }
});

test("assertLiveDataSource rejects mainnet fixtures unless opted in", () => {
  assert.throws(
    () => assertLiveDataSource({ network: "mainnet", tonapiKey: "", source: undefined }),
    /TONAPI_KEY/
  );
});

test("assertLiveDataSource allows mainnet fixtures with an explicit opt-in", () => {
  assert.doesNotThrow(() => assertLiveDataSource({ network: "mainnet", tonapiKey: "", source: "replay" }));
});

test("assertLiveDataSource allows mainnet with a real key", () => {
  assert.doesNotThrow(() => assertLiveDataSource({ network: "mainnet", tonapiKey: "abc123", source: undefined }));
});

test("assertLiveDataSource never blocks testnet", () => {
  assert.doesNotThrow(() => assertLiveDataSource({ network: "testnet", tonapiKey: "", source: undefined }));
});
