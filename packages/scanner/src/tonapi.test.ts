/**
 * TONAPI URL construction.
 *
 * Regression guard for E4: `TONAPI_BASE` was set to "https://tonapi.io/v2" in
 * fly.toml while the code appended "/v2" itself AND used a leading-slash path.
 * A leading "/" makes the path absolute, so `new URL("/jettons", ".../v2/v2")`
 * discarded the base path entirely and every live call hit
 * `https://tonapi.io/jettons` — a 404, silently retried 4x.
 *
 * The builder must therefore be correct for a base with OR without /v2, with
 * or without a trailing slash, and for paths with or without a leading slash.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTonapiUrl } from "./tonapi";

const EXPECTED = "https://tonapi.io/v2/jettons";

test("builds a /v2 URL when the base omits /v2", () => {
  assert.equal(buildTonapiUrl("https://tonapi.io", "/jettons").toString(), EXPECTED);
  assert.equal(buildTonapiUrl("https://tonapi.io/", "/jettons").toString(), EXPECTED);
});

test("does not double /v2 when the base already includes it", () => {
  // This is the exact fly.toml value that caused the production 404s.
  assert.equal(buildTonapiUrl("https://tonapi.io/v2", "/jettons").toString(), EXPECTED);
  assert.equal(buildTonapiUrl("https://tonapi.io/v2/", "/jettons").toString(), EXPECTED);
});

test("a leading slash on the path never discards the base path", () => {
  assert.equal(buildTonapiUrl("https://tonapi.io/v2", "jettons").toString(), EXPECTED);
  assert.equal(buildTonapiUrl("https://tonapi.io", "jettons").toString(), EXPECTED);
});

test("preserves nested paths and encodes params", () => {
  const url = buildTonapiUrl("https://tonapi.io/v2", "/jettons/EQA-abc/holders", { limit: 30, verified: "false" });
  assert.equal(url.pathname, "/v2/jettons/EQA-abc/holders");
  assert.equal(url.searchParams.get("limit"), "30");
  assert.equal(url.searchParams.get("verified"), "false");
});

test("tolerates a custom host and proxy prefix", () => {
  assert.equal(
    buildTonapiUrl("https://proxy.internal/tonapi", "/jettons").toString(),
    "https://proxy.internal/tonapi/v2/jettons"
  );
});
