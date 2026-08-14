import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { postSignal } from "./signal-out";
import { newId, type SignalEnvelope } from "@openclaw-ton-agent/shared";

function envelope(): SignalEnvelope {
  return {
    id: newId("sig"),
    ts: 1_752_000_000_000,
    source: "radar",
    token: { address: "EQA-x", name: "X", ticker: "X", decimals: 9, priceTon: 0.001, curvePct: 50, liquidityTon: 100, holders: 50 },
    audit: { verified: 70, renounced: true, locked: true, honeypot: false },
    score: { soft: 60, risk: 40 },
  };
}

function startMockBus() {
  const received: Array<{ body: string; headers: Record<string, string | undefined> }> = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ body: raw, headers: { ...(req.headers as Record<string, string | undefined>) } });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise<{ server: Server; received: typeof received; port: number }>((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, received, port });
    });
  });
}

test("postSignal signs the body with HMAC and sends the envelope", async () => {
  const { server, received, port } = await startMockBus();
  const secret = "test-secret";
  const e = envelope();
  const result = await postSignal(e, { url: `http://127.0.0.1:${port}/signal`, sharedSecret: secret });
  server.close();

  assert.equal(result.sent, true);
  assert.equal(received.length, 1);
  const { body, headers } = received[0];
  const parsed = JSON.parse(body);
  assert.equal(parsed.kind, "signal_envelope");
  assert.equal(parsed.id, e.id);
  assert.equal(parsed.payload.id, e.id);
  const expectedSig = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(headers["x-agent-secret"], expectedSig);
});

test("postSignal without URL reports sent:false", async () => {
  const result = await postSignal(envelope(), { url: "", sharedSecret: "x" });
  assert.equal(result.sent, false);
  assert.match(result.reason ?? "", /URL not set/);
});
