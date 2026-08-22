"use strict";

/* The Vercel entry point is a thin wrapper, but everything it does wrong fails
   in production only — so exercise it the way the platform does: hand the
   exported handler a real request from a plain http server. */

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");

const handler = require("../../api/index.js");

function serve() {
  const server = http.createServer((req, res) => handler(req, res));
  return new Promise((resolve) => {
    server.listen(0, () => resolve({
      server,
      base: "http://127.0.0.1:" + server.address().port,
      close: () => new Promise((r) => server.close(r))
    }));
  });
}

test("the handler boots the app and serves the API", async (t) => {
  const s = await serve();
  t.after(s.close);

  const res = await fetch(s.base + "/api/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.payments, "disabled", "no Stripe key configured in tests");
  assert.ok(body.listings > 0, "the board seeded on first boot");
});

test("a request arriving without the /api prefix is still routed", async (t) => {
  const s = await serve();
  t.after(s.close);

  // Some rewrite configurations strip the prefix before invoking the function.
  const res = await fetch(s.base + "/health");
  assert.equal(res.status, 200, "the wrapper puts the prefix back");
  assert.equal((await res.json()).ok, true);
});

test("the app is booted once and reused across requests", async (t) => {
  const s = await serve();
  t.after(s.close);

  const first = await (await fetch(s.base + "/api/stats")).json();
  const second = await (await fetch(s.base + "/api/stats")).json();
  assert.equal(first.listings, second.listings);
  assert.ok(first.listings > 0, "a second boot would have started from an empty board");
});

test("body parsing is disabled so Stripe can verify the signature", () => {
  assert.equal(handler.config.api.bodyParser, false,
    "the platform must not consume the request body before the webhook route sees it");
});

test("a webhook whose body was parsed away is refused with a clear reason", async (t) => {
  const s = await serve();
  t.after(s.close);

  // An empty body is what the route sees when something upstream already
  // consumed the stream — it must not read as a signature problem.
  const res = await fetch(s.base + "/api/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    body: ""
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /not delivered raw/);
  assert.doesNotMatch(body.error, /Signature verification failed/);
});

test("unknown routes 404 as JSON rather than crashing the function", async (t) => {
  const s = await serve();
  t.after(s.close);
  const res = await fetch(s.base + "/api/nope");
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "Not found.");
});
