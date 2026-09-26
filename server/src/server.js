"use strict";

const crypto = require("crypto");
const express = require("express");
const engine = require("../../shared/engine.js");
const { createDb } = require("./sql.js");
const { Store } = require("./store.js");
const { createPayments } = require("./payments.js");
const { runCheck } = require("./checker.js");

const DAY = 24 * 3600 * 1000;

function bool(v, dflt) {
  if (v == null || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function loadConfig(env) {
  const e = env || process.env;
  return {
    port: Number(e.PORT || 8787),
    databaseUrl: e.DATABASE_URL || "",
    siteUrl: (e.SITE_URL || "http://localhost:8099/deals/index.html").replace(/\/$/, ""),
    apiBaseUrl: (e.API_BASE_URL || "http://localhost:8787").replace(/\/$/, ""),
    allowedOrigins: (e.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean),
    stripeSecretKey: e.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET || "",
    allowDevPayments: bool(e.ALLOW_DEV_PAYMENTS, false),
    seedOnEmpty: bool(e.SEED_ON_EMPTY, true),
    adminToken: e.ADMIN_TOKEN || "",
    cronSecret: e.CRON_SECRET || "",
    trustProxy: bool(e.TRUST_PROXY, false)
  };
}

/* A small fixed-window limiter. Enough to stop a single host hammering
   checkout; put a real edge limiter in front for anything serious. */
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return function (req, res, next) {
    const k = req.ip || "unknown";
    const n = (hits.get(k) || 0) + 1;
    hits.set(k, n);
    if (n > limit) {
      return res.status(429).json({ error: "Too many requests — slow down and try again in a minute." });
    }
    next();
  };
}

/* Stripe signs the exact bytes of the request. Express's raw parser gives us a
   Buffer; a serverless platform that parsed the body first leaves an empty one.
   Returning null here lets the route say which of those happened, instead of
   surfacing it as a mystifying signature failure. */
function rawBodyOf(req) {
  const b = req.body;
  if (Buffer.isBuffer(b) && b.length) return b;
  if (typeof b === "string" && b.length) return Buffer.from(b, "utf8");
  return null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function visitorHash(req) {
  const ua = req.get("user-agent") || "";
  return crypto.createHash("sha256").update((req.ip || "") + "|" + ua).digest("hex").slice(0, 32);
}

/* Takes an already-connected db — creating one is async, and a serverless
   entry point wants to do that once per instance rather than per request. */
function createApp(options) {
  const config = Object.assign(loadConfig(), options && options.config);
  const db = options && options.db;
  if (!db) throw new Error("createApp requires a db — use boot() to build one");
  const store = new Store(db);
  const payments = (options && options.payments) || createPayments(config);

  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const origin = req.get("origin");
    const allowAll = config.allowedOrigins.includes("*");
    if (origin && (allowAll || config.allowedOrigins.includes(origin))) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    } else if (allowAll) {
      res.set("Access-Control-Allow-Origin", "*");
    }
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Stripe needs the unparsed body to verify the signature, so this route is
  // mounted before the JSON parser.
  app.post("/api/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    const raw = rawBodyOf(req);
    if (!raw) {
      console.error("webhook body was not delivered raw — signature cannot be verified");
      return res.status(400).json({
        error: "Webhook body was not delivered raw, so the signature cannot be verified. " +
          "The platform parsed it first — disable body parsing for this function."
      });
    }

    let event;
    try {
      event = payments.verifyWebhook(raw, req.get("stripe-signature"));
    } catch (err) {
      return res.status(400).json({ error: "Signature verification failed: " + err.message });
    }
    if (await store.seenWebhook(event.id, event.type)) return res.json({ received: true, duplicate: true });

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const bidId = (session.metadata && session.metadata.bidId) || session.client_reference_id;
        if (session.payment_status !== "paid") {
          return res.json({ received: true, ignored: "unpaid session" });
        }
        const result = await store.applyPaidBid(bidId, session.payment_intent);
        if (!result.ok && result.code === "superseded") {
          const refund = await payments.refund(session.payment_intent, "board moved during checkout");
          await store.setBidStatus(bidId, "refunded", {
            note: refund.ok ? "auto-refunded " + refund.id : "refund failed: " + refund.error
          });
        }
      } else if (event.type === "checkout.session.expired") {
        const bidId = (event.data.object.metadata || {}).bidId;
        if (bidId) await store.setBidStatus(bidId, "expired");
      } else if (event.type === "charge.dispute.created" || event.type === "charge.refunded") {
        // A payment that came back cannot keep buying a rank.
        const obj = event.data.object;
        const pi = obj.payment_intent || (obj.charge && obj.charge.payment_intent);
        const bid = pi ? await store.bidByPaymentIntent(pi) : null;
        if (bid) {
          const result = await store.reverseBid(bid.id,
            event.type === "charge.dispute.created" ? "payment disputed" : "payment refunded at the processor");
          console.warn("reversed bid " + bid.id + " (" + event.type + "): " + result.action);
        } else {
          console.warn("reversal for an unknown payment intent: " + pi);
        }
      }
      res.json({ received: true });
    } catch (err) {
      // Release the idempotency marker so Stripe's retry can try again; keeping it
      // would turn a transient failure into a payment that never buys its rank.
      await store.forgetWebhook(event.id);
      console.error("webhook handling failed", err);
      res.status(500).json({ error: "handler failed" });
    }
  });

  app.use(express.json({ limit: "16kb" }));
  app.use("/api/", rateLimiter(240, 60 * 1000));

  app.get("/api/health", async (req, res, next) => {
    try {
      res.json({
        ok: true,
        payments: payments.mode,
        webhook: payments.webhookConfigured,
        listings: (await store.boardCounts()).all
      });
    } catch (err) { next(err); }
  });

  app.get("/api/board", async (req, res, next) => {
    try {
      const board = String(req.query.board || "all");
      if (board !== "all" && !engine.retailer(board)) {
        return res.status(400).json({ error: "Unknown board." });
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      // One pass over the board serves both the filtered rows and the overall #1.
      const all = await store.ranked("all");
      const rows = board === "all" ? all : all.filter((l) => l.board === board);
      await store.recordVisit(visitorHash(req));
      res.json({
        board,
        total: rows.length,
        counts: await store.boardCounts(),
        boards: engine.RETAILERS.map((r) => ({ id: r.id, name: r.name, color: r.color, initials: r.initials, example: r.example })),
        top: all.length ? all[0] : null,
        listings: rows.slice(offset, offset + limit),
        rules: { minBid: engine.MIN_BID, maxBid: engine.MAX_BID, topPremium: engine.TOP_PREMIUM }
      });
    } catch (err) { next(err); }
  });

  app.get("/api/activity", async (req, res, next) => {
    try { res.json({ activity: await store.activity(req.query.limit) }); }
    catch (err) { next(err); }
  });

  app.get("/api/stats", async (req, res, next) => {
    try { res.json(await store.stats()); } catch (err) { next(err); }
  });

  app.post("/api/quote", rateLimiter(60, 60 * 1000), async (req, res, next) => {
    const parsed = engine.normalizeUrl(req.body && req.body.url);
    if (!parsed) return res.status(400).json({ error: "Enter the link to the deal you want to rank." });
    if (!parsed.retailer) {
      return res.status(400).json({
        error: "Only " + engine.RETAILERS.map((r) => r.name).join(", ") +
          " product links can be listed — " + parsed.host + " is not one of them."
      });
    }
    try {
      const amount = Number(req.body.amount);
      const quote = await store.quote(parsed, amount);
      if (!quote.ok) return res.status(400).json({ error: quote.message, code: quote.code });
      res.json(Object.assign({ url: "https://" + parsed.host + parsed.path }, quote));
    } catch (err) { next(err); }
  });

  app.post("/api/checkout", rateLimiter(20, 60 * 1000), async (req, res, next) => {
    const body = req.body || {};
    const parsed = engine.normalizeUrl(body.url);
    if (!parsed) return res.status(400).json({ error: "Enter the link to the deal you want to rank." });
    if (!parsed.retailer) {
      return res.status(400).json({
        error: "Only " + engine.RETAILERS.map((r) => r.name).join(", ") +
          " product links can be listed — " + parsed.host + " is not one of them."
      });
    }
    const amount = Number(body.amount);
    const quote = await store.quote(parsed, amount);
    if (!quote.ok) return res.status(400).json({ error: quote.message, code: quote.code });

    const email = typeof body.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim())
      ? body.email.trim().slice(0, 200) : null;

    const bid = await store.createBid({
      key: parsed.key,
      board: parsed.board,
      amount: amount,
      charge: quote.charge,
      basis: quote.basis,
      title: engine.cleanTitle(body.title) || (quote.existing && quote.existing.title) || engine.titleFromPath(parsed.path),
      priceNow: engine.cleanPrice(body.priceNow),
      priceWas: engine.cleanPrice(body.priceWas),
      email: email,
      provider: payments.mode
    });

    try {
      const back = config.siteUrl + (config.siteUrl.includes("?") ? "&" : "?") + "bid=" + bid.id;
      const session = await payments.createCheckout({
        bid,
        productName: "#" + quote.rank + " on outdeals — " + bid.title,
        description: quote.existing
          ? "Raise " + bid.title + " from " + engine.money(quote.basis) + " to " + engine.money(amount)
          : "List " + bid.title + " at " + engine.money(amount) + " (" + quote.boardName + ")",
        successUrl: back + "&status=success",
        cancelUrl: back + "&status=canceled"
      });
      await store.attachSession(bid.id, session.sessionId);
      res.json({
        bidId: bid.id,
        ownerToken: bid.owner_token,
        checkoutUrl: session.url,
        charge: quote.charge,
        amount: amount,
        rank: quote.rank,
        boardRank: quote.boardRank,
        board: quote.board,
        provider: payments.mode
      });
    } catch (err) {
      await store.setBidStatus(bid.id, "failed", { note: err.message });
      if (err.status === 503) return res.status(503).json({ error: err.message });
      next(err);
    }
  });

  app.get("/api/bids/:id", async (req, res, next) => {
    try {
    const bid = await store.getBid(req.params.id);
    if (!bid) return res.status(404).json({ error: "Unknown bid." });
    const listing = await store.listingByKey(bid.listing_key);
    const ranked = await store.ranked("all");
    const row = listing ? ranked.find((l) => l.id === listing.id) : null;
    res.json({
      id: bid.id,
      status: bid.status,
      amount: bid.amount,
      charge: bid.charge,
      board: bid.board,
      title: bid.title,
      note: bid.note,
      ownerToken: bid.status === "applied" ? bid.owner_token : undefined,
      rank: row ? row.rank : null,
      boardRank: row ? row.boardRank : null,
      listingId: listing ? listing.id : null
    });
    } catch (err) { next(err); }
  });

  // ---- local stand-in checkout, only when Stripe is not configured ----
  if (payments.mode === "dev") {
    app.get("/api/dev/checkout/:id", async (req, res, next) => {
      try {
      const bid = await store.getBid(req.params.id);
      if (!bid) return res.status(404).send("Unknown bid");
      const back = config.siteUrl + (config.siteUrl.includes("?") ? "&" : "?") + "bid=" + bid.id;
      res.set("Content-Type", "text/html; charset=utf-8").send(`<!DOCTYPE html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test checkout — outdeals</title>
<style>body{font:17px/1.5 system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 20px;color:#16150f}
h1{font-size:24px;margin:0 0 8px}p{color:#5f5b52}b{font-variant-numeric:tabular-nums}
button{font:inherit;font-weight:600;border:0;border-radius:999px;padding:14px 22px;cursor:pointer;width:100%;margin-top:8px}
.pay{background:#e0836c;color:#fff}.cancel{background:transparent;border:1px solid #ddd;color:#5f5b52}
.warn{background:#fdf3e7;border-radius:12px;padding:12px 16px;font-size:15px}</style>
<h1>Test checkout</h1>
<p>${escapeHtml(bid.title)} — <b>${escapeHtml(engine.money(bid.amount))}</b> bid, charging <b>${escapeHtml(engine.money(bid.charge))}</b>.</p>
<p class="warn">Stripe is not configured on this server, so this stand-in stands in for the real
Checkout page. No card is collected and no money moves.</p>
<button class="pay" id="pay">Pay ${escapeHtml(engine.money(bid.charge))}</button>
<button class="cancel" id="cancel">Cancel</button>
<script>
document.getElementById("pay").onclick = async function () {
  this.disabled = true; this.textContent = "Processing…";
  const r = await fetch(${JSON.stringify(config.apiBaseUrl)} + "/api/dev/confirm", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bidId: ${JSON.stringify(bid.id)} })
  });
  const j = await r.json();
  location.href = ${JSON.stringify(back)} + "&status=" + (j.ok ? "success" : "failed");
};
document.getElementById("cancel").onclick = function () { location.href = ${JSON.stringify(back)} + "&status=canceled"; };
</script>`);
      } catch (err) { next(err); }
    });

    app.post("/api/dev/confirm", async (req, res, next) => {
      try {
        const bidId = (req.body || {}).bidId;
        const bid = await store.getBid(bidId);
        if (!bid) return res.status(404).json({ ok: false, error: "Unknown bid." });
        if (await store.seenWebhook("dev_" + bidId, "dev.paid")) {
          return res.json({ ok: true, duplicate: true, status: (await store.getBid(bidId)).status });
        }
        const result = await store.applyPaidBid(bidId, "dev_pi_" + bidId);
        if (!result.ok && result.code === "superseded") {
          await store.setBidStatus(bidId, "refunded", { note: "auto-refunded (test mode)" });
          return res.status(409).json({ ok: false, code: "superseded", error: "The board moved while you were paying — refunded, nothing charged." });
        }
        res.json({ ok: result.ok, rank: result.rank, status: (await store.getBid(bidId)).status });
      } catch (err) { next(err); }
    });
  }

  // ---- moderation ----
  function requireAdmin(req, res, next) {
    if (!config.adminToken || req.get("x-admin-token") !== config.adminToken) {
      return res.status(401).json({ error: "Unauthorized." });
    }
    next();
  }

  /* The review queue: listings a link check found gone, or whose payment was
     reversed. Nothing here is removed automatically. */
  app.get("/api/admin/flagged", requireAdmin, async (req, res, next) => {
    try { res.json({ flagged: await store.flagged() }); } catch (err) { next(err); }
  });

  app.post("/api/admin/unflag", requireAdmin, async (req, res, next) => {
    const parsed = engine.normalizeUrl((req.body || {}).url);
    if (!parsed) return res.status(400).json({ error: "Bad url." });
    try { res.json({ unflagged: await store.unflag(parsed.key) }); } catch (err) { next(err); }
  });

  app.post("/api/admin/check", requireAdmin, async (req, res, next) => {
    try {
      res.json(await runCheck(store, { limit: Number((req.body || {}).limit) || 25, delayMs: 250 }));
    } catch (err) { next(err); }
  });

  app.post("/api/admin/remove", requireAdmin, async (req, res, next) => {
    const parsed = engine.normalizeUrl((req.body || {}).url);
    if (!parsed) return res.status(400).json({ error: "Bad url." });
    try { res.json({ removed: await store.removeListing(parsed.key) }); } catch (err) { next(err); }
  });

  /* Vercel Cron calls this — serverless has no long-lived process to run an
     interval in. Authenticated with CRON_SECRET, which Vercel sends as a
     bearer token; the admin token is accepted too so it can be run by hand. */
  app.all("/api/cron/maintenance", async (req, res, next) => {
    const auth = req.get("authorization") || "";
    const bearer = auth.replace(/^Bearer\s+/i, "");
    const ok = (config.cronSecret && bearer === config.cronSecret) ||
      (config.adminToken && req.get("x-admin-token") === config.adminToken);
    if (!ok) return res.status(401).json({ error: "Unauthorized." });
    try {
      const expired = await store.expireStalePending(DAY);
      const checked = await runCheck(store, { limit: Number(req.query.limit) || 25, delayMs: 250 });
      res.json({ expired, ...checked });
    } catch (err) { next(err); }
  });

  app.use((req, res) => res.status(404).json({ error: "Not found." }));
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: "Something went wrong on our end." });
  });

  app.locals.store = store;
  app.locals.config = config;
  app.locals.payments = payments;
  app.locals.db = db;
  return app;
}

/* Connect, migrate, seed, and build the app. Serverless entry points call this
   once per instance; the long-running server calls it at startup. */
async function boot(options) {
  const o = options || {};
  const config = Object.assign(loadConfig(), o.config);

  /* PGlite is an in-memory fallback for local work. On a serverless platform it
     would give every instance its own empty board and silently lose paid bids,
     so refuse to start rather than look healthy while dropping money. */
  if (!o.db && !config.databaseUrl && (process.env.VERCEL || process.env.NODE_ENV === "production")) {
    throw new Error(
      "DATABASE_URL is not set. Refusing to start on an ephemeral in-memory database — " +
      "paid bids would be lost. Set DATABASE_URL to a pooled Postgres connection string."
    );
  }

  // Without a DATABASE_URL this runs on PGlite. Point PGLITE_DIR at a folder to
  // keep a local board between restarts; in memory otherwise.
  const db = o.db || await createDb({
    url: config.databaseUrl || undefined,
    dataDir: process.env.PGLITE_DIR || undefined,
    // The schema is CREATE ... IF NOT EXISTS, so re-running it is harmless — but
    // it costs a round trip on every cold start. Set MIGRATE_ON_BOOT=0 once the
    // tables exist.
    migrate: !/^(0|false|no)$/i.test(process.env.MIGRATE_ON_BOOT || "")
  });
  const app = createApp({ db, payments: o.payments, config });

  if (config.seedOnEmpty) {
    try {
      await app.locals.store.seed(require("../../shared/seed.js"));
    } catch (err) {
      console.warn("seed skipped:", err.message);
    }
  }
  return app;
}

if (require.main === module) {
  boot().then((app) => {
    const config = app.locals.config;
    const store = app.locals.store;

    // Only meaningful when running as a persistent process; on Vercel the cron
    // route does this instead.
    setInterval(() => store.expireStalePending(DAY).catch(() => {}), 3600 * 1000).unref();
    const checkEvery = Number(process.env.CHECK_LINKS_INTERVAL_MIN || 0);
    if (checkEvery > 0) {
      setInterval(() => {
        runCheck(store, { limit: 25, delayMs: 2000 })
          .then((s) => console.log("link check: " + JSON.stringify(s)))
          .catch((err) => console.error("link check failed", err));
      }, checkEvery * 60 * 1000).unref();
    }

    app.listen(config.port, () => {
      console.log("outdeals api on :" + config.port +
        " — db: " + app.locals.db.driver + ", payments: " + app.locals.payments.mode +
        (app.locals.payments.mode === "stripe" && !app.locals.payments.webhookConfigured
          ? " (WARNING: STRIPE_WEBHOOK_SECRET unset — paid bids will never be applied)" : ""));
    });
  }).catch((err) => {
    console.error("failed to start:", err);
    process.exit(1);
  });
}

module.exports = { createApp, boot, loadConfig };
