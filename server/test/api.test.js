"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { createDb } = require("../src/sql.js");
const { Store } = require("../src/store.js");
const { createApp } = require("../src/server.js");

/* Each test gets its own in-memory board and a fake payment provider, so the
   suite exercises the real routes and the real SQL without touching Stripe. */
async function harness(opts) {
  const o = opts || {};
  const db = await createDb({ url: null });
  const refunds = [];
  const payments = {
    mode: "stripe",
    webhookConfigured: true,
    async createCheckout(args) {
      return { url: "https://checkout.test/" + args.bid.id, sessionId: "cs_" + args.bid.id };
    },
    async refund(pi, reason) { refunds.push({ pi, reason }); return { ok: true, id: "re_" + pi }; },
    verifyWebhook(raw) { return JSON.parse(raw.toString("utf8")); }
  };
  const app = createApp({
    db,
    payments,
    config: {
      seedOnEmpty: false,
      siteUrl: "https://site.test/deals/index.html",
      apiBaseUrl: "https://api.test",
      allowedOrigins: ["*"],
      adminToken: "admin-secret"
    }
  });
  const store = new Store(db);
  if (o.seed !== false) {
    await store.seed([
      { url: "amazon.com/dp/B000000001", title: "Top Amazon Deal", now: 10, was: 20, bid: 500, age: 10 },
      { url: "target.com/p/thing/-/A-1", title: "Target Thing", now: 5, was: 9, bid: 300, age: 8 },
      { url: "walmart.com/ip/thing/2", title: "Walmart Thing", now: 7, was: 14, bid: 100, age: 6 },
      { url: "amazon.com/dp/B000000002", title: "Second Amazon Deal", now: 8, was: 16, bid: 100, age: 4 }
    ]);
  }
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

  const webhook = (event) => fetch(base + "/api/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "test" },
    body: JSON.stringify(event)
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const paid = (bidId, sessionId) => webhook({
    id: "evt_" + bidId + "_" + Math.random().toString(36).slice(2),
    type: "checkout.session.completed",
    data: { object: { id: sessionId || "cs_" + bidId, payment_status: "paid", payment_intent: "pi_" + bidId, metadata: { bidId } } }
  });

  return { app, db, store, server, call, webhook, paid, refunds, close: async () => { server.close(); await db.close(); } };
}

test("board returns one global ranking with each row tagged by its board", async (t) => {
  const h = await harness();
  t.after(h.close);
  const { body } = await h.call("GET", "/api/board?board=all");
  assert.equal(body.total, 4);
  assert.deepEqual(body.listings.map((l) => l.rank), [1, 2, 3, 4]);
  assert.deepEqual(body.listings.map((l) => l.board), ["amazon", "target", "walmart", "amazon"]);
  assert.deepEqual(body.listings.map((l) => l.boardRank), [1, 1, 1, 2],
    "board rank counts only that retailer's listings");
  assert.deepEqual(body.listings.map((l) => l.boardName), ["Amazon", "Target", "Walmart", "Amazon"]);
  assert.equal(body.counts.all, 4);
  assert.equal(body.counts.amazon, 2);
});

test("filtering by board keeps the global rank numbers", async (t) => {
  const h = await harness();
  t.after(h.close);
  const { body } = await h.call("GET", "/api/board?board=amazon");
  assert.deepEqual(body.listings.map((l) => l.rank), [1, 4]);
  assert.deepEqual(body.listings.map((l) => l.boardRank), [1, 2]);
  assert.equal(body.total, 2);
});

test("board rejects unknown filters and never leaks owner tokens", async (t) => {
  const h = await harness();
  t.after(h.close);
  assert.equal((await h.call("GET", "/api/board?board=costco")).status, 400);
  const { body } = await h.call("GET", "/api/board");
  assert.ok(body.listings.every((l) => l.ownerToken === undefined));
});

test("quote prices a new listing and refuses a bid just under #1", async (t) => {
  const h = await harness();
  t.after(h.close);
  const near = await h.call("POST", "/api/quote", { url: "walmart.com/ip/new/9", amount: 502 });
  assert.equal(near.status, 400);
  assert.equal(near.body.code, "top_premium");

  const ok = await h.call("POST", "/api/quote", { url: "walmart.com/ip/new/9", amount: 505 });
  assert.equal(ok.body.rank, 1);
  assert.equal(ok.body.charge, 505);
  assert.equal(ok.body.boardRank, 1);
  assert.equal(ok.body.board, "walmart");
});

test("quote on an existing listing charges only the difference", async (t) => {
  const h = await harness();
  t.after(h.close);
  const { body } = await h.call("POST", "/api/quote", { url: "https://www.amazon.com/dp/B000000002?tag=x", amount: 150 });
  assert.equal(body.charge, 50);
  assert.equal(body.basis, 100);
  assert.equal(body.existing.bid, 100);
});

test("unsupported retailers are refused at quote and checkout", async (t) => {
  const h = await harness();
  t.after(h.close);
  const q = await h.call("POST", "/api/quote", { url: "bestbuy.com/site/x", amount: 50 });
  assert.equal(q.status, 400);
  assert.match(q.body.error, /bestbuy\.com is not one of them/);
  assert.equal((await h.call("POST", "/api/checkout", { url: "bestbuy.com/site/x", amount: 50 })).status, 400);
});

test("a bid reaches the board only after the payment webhook", async (t) => {
  const h = await harness();
  t.after(h.close);
  const co = await h.call("POST", "/api/checkout", {
    url: "target.com/p/new/-/A-77", amount: 600, title: "Brand New Deal", priceNow: 20, priceWas: 50
  });
  assert.equal(co.status, 200);
  assert.equal(co.body.charge, 600);
  assert.ok(co.body.checkoutUrl.startsWith("https://checkout.test/"));

  const before = await h.call("GET", "/api/board");
  assert.equal(before.body.total, 4, "nothing on the board before payment");
  assert.equal((await h.call("GET", "/api/bids/" + co.body.bidId)).body.status, "pending");

  await h.paid(co.body.bidId);

  const after = await h.call("GET", "/api/board");
  assert.equal(after.body.total, 5);
  assert.equal(after.body.listings[0].title, "Brand New Deal");
  assert.equal(after.body.listings[0].rank, 1);
  assert.equal(after.body.listings[0].priceNow, 20);

  const status = await h.call("GET", "/api/bids/" + co.body.bidId);
  assert.equal(status.body.status, "applied");
  assert.equal(status.body.rank, 1);
  assert.ok(status.body.ownerToken, "the payer gets their ownership token back");
});

test("an unpaid checkout session is ignored", async (t) => {
  const h = await harness();
  t.after(h.close);
  const co = await h.call("POST", "/api/checkout", { url: "target.com/p/new/-/A-78", amount: 600 });
  await h.webhook({
    id: "evt_unpaid", type: "checkout.session.completed",
    data: { object: { id: "cs_x", payment_status: "unpaid", payment_intent: "pi_x", metadata: { bidId: co.body.bidId } } }
  });
  assert.equal((await h.call("GET", "/api/board")).body.total, 4);
  assert.equal((await h.call("GET", "/api/bids/" + co.body.bidId)).body.status, "pending");
});

test("replayed webhooks apply a bid exactly once", async (t) => {
  const h = await harness();
  t.after(h.close);
  const co = await h.call("POST", "/api/checkout", { url: "walmart.com/ip/dup/3", amount: 600 });
  const event = {
    id: "evt_same", type: "checkout.session.completed",
    data: { object: { id: "cs_dup", payment_status: "paid", payment_intent: "pi_dup", metadata: { bidId: co.body.bidId } } }
  };
  await h.webhook(event);
  const second = await h.webhook(event);
  assert.equal(second.body.duplicate, true);

  const board = await h.call("GET", "/api/board");
  assert.equal(board.body.total, 5);
  assert.equal(board.body.listings.filter((l) => l.host === "walmart.com" && l.path === "/ip/dup/3").length, 1);
  const activity = await h.call("GET", "/api/activity");
  assert.equal(activity.body.activity.filter((a) => a.amount === 600).length, 1);
});

test("a raise that the board outran is refunded, not applied", async (t) => {
  const h = await harness();
  t.after(h.close);
  // Two bidders quote the same listing at $100, then both pay.
  const first = await h.call("POST", "/api/checkout", { url: "amazon.com/dp/B000000002", amount: 150 });
  const second = await h.call("POST", "/api/checkout", { url: "amazon.com/dp/B000000002", amount: 160 });

  await h.paid(first.body.bidId);
  await h.paid(second.body.bidId);

  const status = await h.call("GET", "/api/bids/" + second.body.bidId);
  assert.equal(status.body.status, "refunded",
    "the second payer was quoted against a $100 listing that is now $150");
  assert.equal(h.refunds.length, 1);
  assert.equal(h.refunds[0].pi, "pi_" + second.body.bidId);

  const board = await h.call("GET", "/api/board");
  const row = board.body.listings.find((l) => l.path === "/dp/B000000002");
  assert.equal(row.bid, 150, "the board reflects only the payment it honoured");
});

test("checkout is refused when payments are not configured", async (t) => {
  const db = await createDb({ url: null });
  const app = createApp({
    db,
    config: { seedOnEmpty: false, stripeSecretKey: "", allowDevPayments: false, allowedOrigins: ["*"] }
  });
  const server = app.listen(0);
  t.after(async () => { server.close(); await db.close(); });
  const base = "http://127.0.0.1:" + server.address().port;

  const health = await (await fetch(base + "/api/health")).json();
  assert.equal(health.payments, "disabled");

  const res = await fetch(base + "/api/checkout", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "amazon.com/dp/B0000000AA", amount: 50 })
  });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not configured/);
});

test("a bad webhook signature is rejected", async (t) => {
  const db = await createDb({ url: null });
  const app = createApp({
    db,
    payments: {
      mode: "stripe", webhookConfigured: true,
      async createCheckout() { return { url: "x", sessionId: "y" }; },
      async refund() { return { ok: true }; },
      verifyWebhook() { throw new Error("no signatures found matching the expected signature"); }
    },
    config: { seedOnEmpty: false, allowedOrigins: ["*"] }
  });
  const server = app.listen(0);
  t.after(async () => { server.close(); await db.close(); });
  const res = await fetch("http://127.0.0.1:" + server.address().port + "/api/webhook", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Signature verification failed/);
});

test("stats count real money and real listings", async (t) => {
  const h = await harness();
  t.after(h.close);
  await h.call("GET", "/api/board"); // visits are counted when the board is viewed
  const co = await h.call("POST", "/api/checkout", { url: "target.com/p/stat/-/A-9", amount: 700 });
  await h.paid(co.body.bidId);
  const { body } = await h.call("GET", "/api/stats");
  assert.equal(body.listings, 5);
  assert.equal(body.revenue, 700, "seeded listings were never paid for, so only the real bid counts");
  assert.equal(body.paidBids, 1);
  assert.equal(body.top.bid, 700);
  assert.ok(body.visitors >= 1);
});

test("admin removal needs the token and takes the listing off the board", async (t) => {
  const h = await harness();
  t.after(h.close);
  const denied = await h.call("POST", "/api/admin/remove", { url: "amazon.com/dp/B000000001" });
  assert.equal(denied.status, 401);

  const ok = await h.call("POST", "/api/admin/remove",
    { url: "amazon.com/dp/B000000001", reason: "dead link" }, { "x-admin-token": "admin-secret" });
  assert.equal(ok.body.removed, 1);
  const board = await h.call("GET", "/api/board");
  assert.equal(board.body.total, 3);
  assert.ok(!board.body.listings.some((l) => l.path === "/dp/B000000001"));
});

test("checkout rejects bids that break the rules before charging anything", async (t) => {
  const h = await harness();
  t.after(h.close);
  for (const amount of [4, 1000000, 12.5, 502]) {
    const res = await h.call("POST", "/api/checkout", { url: "walmart.com/ip/x/44", amount });
    assert.equal(res.status, 400, "amount " + amount + " should be refused");
  }
  assert.equal((await h.call("GET", "/api/board")).body.total, 4);
});
