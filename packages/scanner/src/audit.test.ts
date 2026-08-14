import { test } from "node:test";
import assert from "node:assert/strict";
import { auditJetton } from "./audit";

test("audit without TONAPI key fails soft with audit_source_unavailable", async () => {
  // SCANNER_CONFIG.tonapi.key is read at import; with no key in test env the
  // audit must fail soft — never fabricate.
  const r = await auditJetton("EQA-whatever");
  if (!process.env.TONAPI_KEY) {
    assert.equal(r.ok, false);
    assert.ok(r.flags.includes("audit_source_unavailable"));
  }
});
