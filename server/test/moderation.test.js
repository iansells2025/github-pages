"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { createDb } = require("../src/sql.js");
const { Store } = require("../src/store.js");
const { createApp } = require("../src/server.js");
const { probe, runCheck, classify } = require("../src/checker.js");

async function harness() {
  const db = await createDb({ url: null });
  const refunds = [];
  const payments = {
    mode: "stripe",
    webhookConfigured: true,
    async createCheckout(args) { return { url: "https://checkout.test/" + args.bid.id, sessionId: "cs_" + args.bid.id }; },
    async refund(pi, reason) { refunds.push({ pi, reason }); return { ok: true, id: "re_" + pi }; },
    verifyWebhook(raw) { return JSON.parse(raw.toString("utf8")); }
  };
  const app = createApp({
    db, payments,
    config: { seedOnEmpty: false, allowedOrigins: ["*"], adminToken: "admin-secret" }
  });
  const store = new Store(db);
  await store.seed([
    { url: "amazon.com/dp/B000000001", title: "Existing Deal", now: 10, was: 20, bid: 500, age: 10 }
  ]);
  const server = app.listen(0);
  const base = "http://127.0.0.1:" + server.address().port;

  const call = async (method, path, body, headers) => {
    const res = await fetch(base + path, {
      method,
      headers: Object.assign(body ? { "Content-Type": "application/json" } : {}, headers || {}),
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
  };
  const admin = { "x-admin-token": "admin-secret" };
  const webhook = (event) => fetch(base + "/api/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "t" },
    body: JSON.stringify(event)
  }).then((r) => r.json());
  const paid = (bidId) => webhook({
    id: "evt_" + bidId, type: "checkout.session.completed",
    data: { object: { id: "cs_" + bidId, payment_status: "paid", payment_intent: "pi_" + bidId, metadata: { bidId } } }
  });
  const dispute = (pi, id) => webhook({
    id: id || "evt_dispute_" + pi, type: "charge.dispute.created",
    data: { object: { id: "dp_1", payment_intent: pi } }
  });

  return { db, store, call, admin, webhook, paid, dispute, refunds, close: async () => { server.close(); await db.close(); } };
}

// ---------- chargebacks ----------

test("a disputed payment for a new listing takes it off the board", async (t) => {
  const h = await harness();
  t.after(h.close);
  const co = await h.call("POST", "/api/checkout", { url: "target.com/p/x/-/A-5", amount: 600, title: "Disputed Deal" });
  await h.paid(co.body.bidId);
  assert.equal((await h.call("GET", "/api/board")).body.total, 2);

  await h.dispute("pi_" + co.body.bidId);

  const board = await h.call("GET", "/api/board");
  assert.equal(board.body.total, 1, "the listing the disputed payment created is gone");
  assert.ok(!board.body.listings.some((l) => l.title === "Disputed Deal"));
  assert.equal((await h.call("GET", "/api/bids/" + co.body.bidId)).body.status, "reversed");
});

test("a disputed raise rolls the listing back to what was actually paid for", async (t) => {
  const h = await harness();
  t.after(h.close);
  const first = await h.call("POST", "/api/checkout", { url: "walmart.com/ip/y/6", amount: 600 });
  await h.paid(first.body.bidId);
  const raise = await h.call("POST", "/api/checkout", { url: "walmart.com/ip/y/6", amount: 900 });
  await h.paid(raise.body.bidId);

  let row = (await h.call("GET", "/api/board")).body.listings.find((l) => l.path === "/ip/y/6");
  assert.equal(row.bid, 900);

  await h.dispute("pi_" + raise.body.bidId);

  row = (await h.call("GET", "/api/board")).body.listings.find((l) => l.path === "/ip/y/6");
  assert.equal(row.bid, 600, "back to the bid the undisputed payment bought");
  assert.equal((await h.call("GET", "/api/bids/" + first.body.bidId)).body.status, "applied");
});

test("a dispute on a superseded bid in the chain flags rather than rewrites", async (t) => {
  const h = await harness();
  t.after(h.close);
  const first = await h.call("POST", "/api/checkout", { url: "altamuta.com/deal/z", amount: 600 });
  await h.paid(first.body.bidId);
  const raise = await h.call("POST", "/api/checkout", { url: "altamuta.com/deal/z", amount: 900 });
  await h.paid(raise.body.bidId);

  // The *earlier* payment is disputed, with a later bid stacked on top of it.
  await h.dispute("pi_" + first.body.bidId);

  const row = (await h.call("GET", "/api/board")).body.listings.find((l) => l.path === "/deal/z");
  assert.equal(row.bid, 900, "the later, undisputed bid is left alone");
  const flagged = await h.call("GET", "/api/admin/flagged", null, h.admin);
  assert.equal(flagged.body.flagged.length, 1);
  assert.equal(flagged.body.flagged[0].checkStatus, "disputed");
  assert.match(flagged.body.flagged[0].checkNote, /needs review/);
});

test("an external refund reverses the bid the same way", async (t) => {
  const h = await harness();
  t.after(h.close);
  const co = await h.call("POST", "/api/checkout", { url: "target.com/p/r/-/A-7", amount: 700 });
  await h.paid(co.body.bidId);
  await h.webhook({
    id: "evt_refunded", type: "charge.refunded",
    data: { object: { id: "ch_1", payment_intent: "pi_" + co.body.bidId } }
  });
  assert.equal((await h.call("GET", "/api/bids/" + co.body.bidId)).body.status, "reversed");
  assert.equal((await h.call("GET", "/api/board")).body.total, 1);
});

test("reversed bids stop counting as revenue", async (t) => {
  const h = await harness();
  t.after(h.close);
  const keep = await h.call("POST", "/api/checkout", { url: "target.com/p/keep/-/A-8", amount: 600 });
  const lose = await h.call("POST", "/api/checkout", { url: "walmart.com/ip/lose/9", amount: 700 });
  await h.paid(keep.body.bidId);
  await h.paid(lose.body.bidId);
  assert.equal((await h.call("GET", "/api/stats")).body.revenue, 1300);

  await h.dispute("pi_" + lose.body.bidId);
  assert.equal((await h.call("GET", "/api/stats")).body.revenue, 600);
});

test("a dispute for an unknown payment is ignored, not fatal", async (t) => {
  const h = await harness();
  t.after(h.close);
  const res = await h.dispute("pi_never_seen");
  assert.equal(res.received, true);
  assert.equal((await h.call("GET", "/api/board")).body.total, 1);
});

// ---------- link checking ----------

test("statuses are classified conservatively", () => {
  assert.equal(classify(200), "ok");
  assert.equal(classify(301), "error",
    "redirects are followed, so a raw 3xx is anomalous — inconclusive, and never 'dead'");
  assert.equal(classify(404), "dead");
  assert.equal(classify(410), "dead");
  assert.equal(classify(403), "blocked", "retailers block bots — that is not a dead deal");
  assert.equal(classify(429), "blocked");
  assert.equal(classify(500), "error");
});

test("probe reports timeouts as errors rather than deaths", async () => {
  const result = await probe("https://example.test/x", {
    timeoutMs: 5,
    fetch: () => new Promise((resolve, reject) => {
      const e = new Error("aborted"); e.name = "AbortError";
      setTimeout(() => reject(e), 20);
    })
  });
  assert.equal(result.status, "error");
  assert.equal(result.note, "timed out");
});

test("only a 404 flags a listing for review", async (t) => {
  const h = await harness();
  t.after(h.close);
  const co = await h.call("POST", "/api/checkout", { url: "walmart.com/ip/blocked/1", amount: 600 });
  await h.paid(co.body.bidId);

  const responses = { "amazon.com": 404, "walmart.com": 403 };
  const summary = await runCheck(h.store, {
    limit: 10,
    fetch: async (url) => ({ status: responses[new URL(url).hostname] || 200 })
  });

  assert.equal(summary.checked, 2);
  assert.equal(summary.dead, 1);
  assert.equal(summary.blocked, 1);

  const flagged = (await h.call("GET", "/api/admin/flagged", null, h.admin)).body.flagged;
  assert.equal(flagged.length, 1, "the blocked listing is not flagged");
  assert.equal(flagged[0].host, "amazon.com");
  assert.equal(flagged[0].checkStatus, "dead");
  assert.equal(flagged[0].checkNote, "HTTP 404");

  assert.equal((await h.call("GET", "/api/board")).body.total, 2,
    "flagging never removes a listing on its own");
});

test("checks are not repeated until they go stale", async (t) => {
  const h = await harness();
  t.after(h.close);
  const opts = { limit: 10, fetch: async () => ({ status: 200 }) };
  assert.equal((await runCheck(h.store, opts)).checked, 1);
  assert.equal((await runCheck(h.store, opts)).checked, 0, "already checked recently");
  assert.equal((await runCheck(h.store, Object.assign({ staleMs: -1 }, opts))).checked, 1);
});

test("the review queue needs the admin token and unflagging clears it", async (t) => {
  const h = await harness();
  t.after(h.close);
  await runCheck(h.store, { limit: 10, fetch: async () => ({ status: 404 }) });

  assert.equal((await h.call("GET", "/api/admin/flagged")).status, 401);
  assert.equal((await h.call("POST", "/api/admin/unflag", { url: "amazon.com/dp/B000000001" })).status, 401);

  const before = await h.call("GET", "/api/admin/flagged", null, h.admin);
  assert.equal(before.body.flagged.length, 1);

  const un = await h.call("POST", "/api/admin/unflag", { url: "https://www.amazon.com/dp/B000000001?tag=x" }, h.admin);
  assert.equal(un.body.unflagged, 1, "the url is normalized before matching");
  assert.equal((await h.call("GET", "/api/admin/flagged", null, h.admin)).body.flagged.length, 0);
});

test("removing a flagged listing takes it off the board for good", async (t) => {
  const h = await harness();
  t.after(h.close);
  await runCheck(h.store, { limit: 10, fetch: async () => ({ status: 410 }) });
  const removed = await h.call("POST", "/api/admin/remove",
    { url: "amazon.com/dp/B000000001", reason: "dead link" }, h.admin);
  assert.equal(removed.body.removed, 1);
  assert.equal((await h.call("GET", "/api/board")).body.total, 0);
  assert.equal((await h.call("GET", "/api/admin/flagged", null, h.admin)).body.flagged.length, 0);
});

// ---------- hardening regressions ----------

test("a title taken from the URL path is scrubbed like a supplied one", () => {
  const parsed = require("../../shared/engine.js")
    .normalizeUrl("altamuta.com/deal/<img src=x onerror=alert(1)>");
  const title = require("../../shared/engine.js").titleFromPath(parsed.path);
  assert.ok(!/[<>]/.test(title),
    "angle brackets must not survive into a stored title — the dev checkout page renders it as HTML");
});

test("a listing title cannot inject markup into the test checkout page", async (t) => {
  const db = await createDb({ url: null });
  const app = createApp({
    db,
    config: {
      seedOnEmpty: false, allowedOrigins: ["*"], allowDevPayments: true,
      apiBaseUrl: "http://api.test", siteUrl: "http://site.test/deals/index.html"
    }
  });
  const server = app.listen(0);
  t.after(async () => { server.close(); await db.close(); });
  const base = "http://127.0.0.1:" + server.address().port;

  const co = await (await fetch(base + "/api/checkout", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: 'altamuta.com/deal/<script>alert(1)</script>', amount: 50 })
  })).json();

  const html = await (await fetch(base + "/api/dev/checkout/" + co.bidId)).text();
  assert.ok(!html.includes("<script>alert(1)</script>"), "raw markup reached the page");
  assert.ok(html.includes("&lt;") || !html.includes("alert(1)</"),
    "the title must be escaped where it is rendered");
});

test("a failed webhook handler leaves the event retryable", async (t) => {
  const db = await createDb({ url: null });
  let failNext = true;
  const app = createApp({
    db,
    payments: {
      mode: "stripe", webhookConfigured: true,
      async createCheckout(args) { return { url: "u", sessionId: "cs_" + args.bid.id }; },
      async refund() { return { ok: true, id: "re" }; },
      verifyWebhook(raw) { return JSON.parse(raw.toString("utf8")); }
    },
    config: { seedOnEmpty: false, allowedOrigins: ["*"] }
  });
  const store = new Store(db);
  // Make the first apply throw, as a transient database error would.
  const realApply = store.applyPaidBid.bind(store);
  app.locals.store.applyPaidBid = function (...args) {
    if (failNext) { failNext = false; throw new Error("database is locked"); }
    return realApply(...args);
  };
  const server = app.listen(0);
  t.after(async () => { server.close(); await db.close(); });
  const base = "http://127.0.0.1:" + server.address().port;

  const co = await (await fetch(base + "/api/checkout", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "target.com/p/retry/-/A-1", amount: 50 })
  })).json();

  const event = {
    id: "evt_retry", type: "checkout.session.completed",
    data: { object: { id: "cs_x", payment_status: "paid", payment_intent: "pi_x", metadata: { bidId: co.bidId } } }
  };
  const send = () => fetch(base + "/api/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "t" },
    body: JSON.stringify(event)
  });

  assert.equal((await send()).status, 500, "handler failed");
  const retry = await send();
  assert.equal(retry.status, 200);
  assert.notEqual((await retry.json()).duplicate, true,
    "the retry must be processed, not swallowed as a duplicate");

  const board = await (await fetch(base + "/api/board")).json();
  assert.equal(board.total, 1, "the paid bid reached the board on retry");
});

test("a negative limit cannot turn LIMIT into unbounded", async (t) => {
  const h = await harness();
  t.after(h.close);
  const res = await h.call("GET", "/api/activity?limit=-1");
  assert.ok(Array.isArray(res.body.activity));
  assert.ok(res.body.activity.length <= 100);
});
