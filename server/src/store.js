"use strict";

const crypto = require("crypto");
const engine = require("../../shared/engine.js");

const id = (p) => p + crypto.randomBytes(8).toString("hex");
const token = () => crypto.randomBytes(24).toString("hex");

function rowToListing(r) {
  if (!r) return null;
  return {
    id: r.id,
    key: r.key,
    board: r.board,
    host: r.host,
    path: r.path,
    url: "https://" + r.host + r.path,
    title: r.title,
    priceNow: r.price_now,
    priceWas: r.price_was,
    bid: r.bid,
    createdAt: r.created_at,
    bidAt: r.bid_at,
    ownerToken: r.owner_token
  };
}

class Store {
  constructor(db) {
    this.db = db;
  }

  // ---------- reads ----------

  /* The whole live board, already in rank order. It is small enough (thousands
     of rows at most) that ranking in one pass beats window functions here. */
  listings() {
    const rows = this.db.prepare(
      "SELECT * FROM listings WHERE status = 'live' ORDER BY bid DESC, bid_at ASC, id ASC"
    ).all();
    return rows.map(rowToListing);
  }

  /* One global ranking; each row also carries its rank within its own board. */
  ranked(boardFilter) {
    const all = this.listings();
    const perBoard = Object.create(null);
    const out = [];
    all.forEach((l, i) => {
      perBoard[l.board] = (perBoard[l.board] || 0) + 1;
      const r = engine.retailer(l.board);
      out.push(Object.assign({}, l, {
        rank: i + 1,
        boardRank: perBoard[l.board],
        boardName: r ? r.name : l.board,
        ownerToken: undefined
      }));
    });
    if (boardFilter && boardFilter !== "all") return out.filter((l) => l.board === boardFilter);
    return out;
  }

  boardCounts() {
    const rows = this.db.prepare(
      "SELECT board, COUNT(*) n FROM listings WHERE status = 'live' GROUP BY board"
    ).all();
    const counts = { all: 0 };
    rows.forEach((r) => { counts[r.board] = r.n; counts.all += r.n; });
    engine.RETAILERS.forEach((r) => { if (counts[r.id] == null) counts[r.id] = 0; });
    return counts;
  }

  listingByKey(key) {
    return rowToListing(
      this.db.prepare("SELECT * FROM listings WHERE key = ? AND status = 'live'").get(key)
    );
  }

  activity(limit) {
    return this.db.prepare("SELECT * FROM activity ORDER BY at DESC, id DESC LIMIT ?")
      .all(Math.min(Number(limit) || 20, 100))
      .map((a) => ({
        listingId: a.listing_id, title: a.title, board: a.board,
        boardName: (engine.retailer(a.board) || {}).name || a.board,
        amount: a.amount, rank: a.rank, at: a.at
      }));
  }

  stats() {
    const agg = this.db.prepare(
      "SELECT COUNT(*) listings, COALESCE(SUM(bid), 0) onBoard FROM listings WHERE status = 'live'"
    ).get();
    const paid = this.db.prepare(
      "SELECT COALESCE(SUM(charge), 0) revenue, COUNT(*) bids FROM bids WHERE status = 'applied'"
    ).get();
    const visitors = this.db.prepare("SELECT COUNT(DISTINCT visitor) n FROM visits").get().n;
    const top = rowToListing(this.db.prepare(
      "SELECT * FROM listings WHERE status = 'live' ORDER BY bid DESC, bid_at ASC LIMIT 1"
    ).get());
    const since = this.db.prepare("SELECT MIN(created_at) t FROM listings").get().t;
    return {
      listings: agg.listings,
      onBoard: agg.onBoard,
      revenue: paid.revenue,
      paidBids: paid.bids,
      visitors,
      launchedAt: since || null,
      top: top ? { title: top.title, bid: top.bid, board: top.board, url: top.url } : null,
      boards: this.boardCounts()
    };
  }

  recordVisit(visitor) {
    const day = new Date().toISOString().slice(0, 10);
    this.db.prepare("INSERT OR IGNORE INTO visits (day, visitor, at) VALUES (?, ?, ?)")
      .run(day, visitor, Date.now());
  }

  // ---------- quoting ----------

  /* Price a bid without touching the board. `basis` is the listing bid the
     quote was priced against — payment is only honoured against that state. */
  quote(parsed, amount) {
    const existing = this.listingByKey(parsed.key);
    const listings = this.listings();
    const check = engine.validateBid(listings, existing, amount, parsed.board);
    if (!check.ok) return check;
    return {
      ok: true,
      charge: check.charge,
      basis: check.basis,
      rank: check.rank,
      boardRank: check.boardRank,
      board: parsed.board,
      boardName: engine.retailer(parsed.board).name,
      existing: existing ? { bid: existing.bid, title: existing.title } : null,
      topBid: (engine.topOf(listings) || { bid: 0 }).bid
    };
  }

  // ---------- writes ----------

  createBid(fields) {
    const now = Date.now();
    const bid = {
      id: id("bid_"),
      listing_key: fields.key,
      board: fields.board,
      amount: fields.amount,
      charge: fields.charge,
      basis: fields.basis,
      status: "pending",
      title: fields.title || null,
      price_now: fields.priceNow == null ? null : fields.priceNow,
      price_was: fields.priceWas == null ? null : fields.priceWas,
      email: fields.email || null,
      owner_token: token(),
      provider: fields.provider,
      session_id: null,
      payment_intent: null,
      created_at: now,
      updated_at: now,
      applied_at: null,
      note: null
    };
    this.db.prepare(`INSERT INTO bids
      (id, listing_key, board, amount, charge, basis, status, title, price_now, price_was,
       email, owner_token, provider, session_id, payment_intent, created_at, updated_at, applied_at, note)
      VALUES (@id, @listing_key, @board, @amount, @charge, @basis, @status, @title, @price_now, @price_was,
       @email, @owner_token, @provider, @session_id, @payment_intent, @created_at, @updated_at, @applied_at, @note)`)
      .run(bid);
    return bid;
  }

  getBid(bidId) {
    return this.db.prepare("SELECT * FROM bids WHERE id = ?").get(bidId) || null;
  }

  getBidBySession(sessionId) {
    return this.db.prepare("SELECT * FROM bids WHERE session_id = ?").get(sessionId) || null;
  }

  attachSession(bidId, sessionId) {
    this.db.prepare("UPDATE bids SET session_id = ?, updated_at = ? WHERE id = ?")
      .run(sessionId, Date.now(), bidId);
  }

  setBidStatus(bidId, status, extra) {
    const e = extra || {};
    this.db.prepare(
      "UPDATE bids SET status = ?, note = COALESCE(?, note), payment_intent = COALESCE(?, payment_intent), updated_at = ? WHERE id = ?"
    ).run(status, e.note || null, e.paymentIntent || null, Date.now(), bidId);
  }

  seenWebhook(eventId, type) {
    const res = this.db.prepare(
      "INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)"
    ).run(eventId, type || null, Date.now());
    return res.changes === 0; // already handled
  }

  /* Apply a paid bid to the board, atomically.

     A payment buys exactly the board state it was quoted against. If the deal
     moved while the payer was in checkout — someone else listed or raised it —
     the bid is marked `superseded` instead of applied, and the caller refunds.
     That keeps "you only pay the difference" honest under concurrency. */
  applyPaidBid(bidId, paymentIntent) {
    const run = this.db.transaction(() => {
      const bid = this.getBid(bidId);
      if (!bid) return { ok: false, code: "unknown_bid" };
      if (bid.status === "applied") {
        return { ok: true, already: true, listingId: null, bid };
      }
      if (bid.status === "superseded" || bid.status === "refunded") {
        return { ok: false, code: bid.status, bid };
      }

      const existing = this.listingByKey(bid.listing_key);
      const currentBasis = existing ? existing.bid : 0;
      if (currentBasis !== bid.basis) {
        this.db.prepare(
          "UPDATE bids SET status = 'superseded', payment_intent = COALESCE(?, payment_intent), note = ?, updated_at = ? WHERE id = ?"
        ).run(paymentIntent || null,
          "board moved during checkout: quoted against " + bid.basis + ", found " + currentBasis,
          Date.now(), bidId);
        return { ok: false, code: "superseded", bid: this.getBid(bidId) };
      }

      const now = Date.now();
      let listingId;
      if (existing) {
        listingId = existing.id;
        this.db.prepare(`UPDATE listings SET bid = ?, bid_at = ?, owner_token = ?,
            title = COALESCE(?, title), price_now = COALESCE(?, price_now), price_was = COALESCE(?, price_was)
          WHERE id = ?`)
          .run(bid.amount, now, bid.owner_token, bid.title, bid.price_now, bid.price_was, listingId);
      } else {
        const parsedHost = bid.listing_key.split("/")[0];
        const parsedPath = bid.listing_key.slice(parsedHost.length);
        listingId = id("lst_");
        this.db.prepare(`INSERT INTO listings
          (id, key, board, host, path, title, price_now, price_was, bid, created_at, bid_at, owner_token, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live')`)
          .run(listingId, bid.listing_key, bid.board, parsedHost, parsedPath,
            bid.title || engine.titleFromPath(parsedPath), bid.price_now, bid.price_was,
            bid.amount, now, now, bid.owner_token);
      }

      const rank = this.db.prepare(
        "SELECT COUNT(*) + 1 n FROM listings WHERE status = 'live' AND (bid > ? OR (bid = ? AND bid_at < ?))"
      ).get(bid.amount, bid.amount, now).n;

      const listing = this.db.prepare("SELECT * FROM listings WHERE id = ?").get(listingId);
      this.db.prepare("INSERT INTO activity (listing_id, title, board, amount, rank, at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(listingId, listing.title, bid.board, bid.amount, rank, now);

      this.db.prepare(
        "UPDATE bids SET status = 'applied', applied_at = ?, payment_intent = COALESCE(?, payment_intent), updated_at = ? WHERE id = ?"
      ).run(now, paymentIntent || null, now, bidId);

      return { ok: true, listingId, rank, bid: this.getBid(bidId), listing: rowToListing(listing) };
    });
    return run();
  }

  /* A disputed or externally refunded payment must not keep buying a rank.

     If the bid being reversed is still the listing's current bid, roll the
     listing back to what it was worth before that payment — its `basis` — or
     take it off the board entirely if the payment created it. If later bids
     stacked on top, unwinding is ambiguous, so the listing is flagged for a
     human instead of silently rewritten. */
  reverseBid(bidId, reason) {
    const run = this.db.transaction(() => {
      const bid = this.getBid(bidId);
      if (!bid) return { ok: false, code: "unknown_bid" };
      if (bid.status !== "applied") {
        this.setBidStatus(bidId, "reversed", { note: reason });
        return { ok: true, action: "none", note: "bid was never applied" };
      }

      const listing = this.db.prepare("SELECT * FROM listings WHERE key = ?").get(bid.listing_key);
      const now = Date.now();
      this.db.prepare("UPDATE bids SET status = 'reversed', note = ?, updated_at = ? WHERE id = ?")
        .run(reason || "payment reversed", now, bidId);

      if (!listing) return { ok: true, action: "none", note: "listing already gone" };

      if (listing.bid !== bid.amount) {
        this.db.prepare("UPDATE listings SET flagged = 1, check_status = 'disputed', check_note = ? WHERE id = ?")
          .run("a payment behind this listing was reversed; later bids stacked on it — needs review", listing.id);
        return { ok: true, action: "flagged", listingId: listing.id };
      }

      if (bid.basis > 0) {
        this.db.prepare("UPDATE listings SET bid = ?, bid_at = ?, flagged = 1, check_status = 'disputed', check_note = ? WHERE id = ?")
          .run(bid.basis, now, "rolled back after a reversed payment", listing.id);
        return { ok: true, action: "rolled_back", listingId: listing.id, to: bid.basis };
      }

      this.db.prepare("UPDATE listings SET status = 'removed', flagged = 1, check_status = 'disputed', check_note = ? WHERE id = ?")
        .run(reason || "payment reversed", listing.id);
      return { ok: true, action: "removed", listingId: listing.id };
    });
    return run();
  }

  bidByPaymentIntent(pi) {
    return this.db.prepare("SELECT * FROM bids WHERE payment_intent = ?").get(pi) || null;
  }

  // ---------- link checking ----------

  /* Listings that have never been checked, or whose last check is stale. */
  dueForCheck(limit, staleMs) {
    const cutoff = Date.now() - (staleMs || 24 * 3600 * 1000);
    return this.db.prepare(
      `SELECT * FROM listings WHERE status = 'live' AND (last_checked IS NULL OR last_checked < ?)
       ORDER BY last_checked IS NOT NULL, bid DESC LIMIT ?`
    ).all(cutoff, Math.min(Number(limit) || 50, 500)).map(rowToListing);
  }

  recordCheck(listingId, status, note) {
    // Only a definitive "gone" flags a listing. A retailer blocking the checker
    // says nothing about whether the deal is live.
    const flag = status === "dead" ? 1 : 0;
    this.db.prepare(
      `UPDATE listings SET last_checked = ?, check_status = ?, check_note = ?,
         flagged = CASE WHEN ? = 1 THEN 1 ELSE flagged END WHERE id = ?`
    ).run(Date.now(), status, note || null, flag, listingId);
  }

  flagged() {
    return this.db.prepare(
      "SELECT * FROM listings WHERE flagged = 1 AND status = 'live' ORDER BY bid DESC"
    ).all().map((r) => Object.assign(rowToListing(r), {
      checkStatus: r.check_status, checkNote: r.check_note, lastChecked: r.last_checked
    }));
  }

  unflag(key) {
    return this.db.prepare(
      "UPDATE listings SET flagged = 0, check_note = NULL WHERE key = ? AND status = 'live'"
    ).run(key).changes;
  }

  expireStalePending(maxAgeMs) {
    const cutoff = Date.now() - (maxAgeMs || 24 * 3600 * 1000);
    return this.db.prepare(
      "UPDATE bids SET status = 'expired', updated_at = ? WHERE status = 'pending' AND created_at < ?"
    ).run(Date.now(), cutoff).changes;
  }

  // ---------- seeding / admin ----------

  seed(rows) {
    if (this.db.prepare("SELECT COUNT(*) n FROM listings").get().n > 0) return 0;
    const now = Date.now();
    const insert = this.db.prepare(`INSERT INTO listings
      (id, key, board, host, path, title, price_now, price_was, bid, created_at, bid_at, owner_token, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'live')`);
    const act = this.db.prepare(
      "INSERT INTO activity (listing_id, title, board, amount, rank, at) VALUES (?, ?, ?, ?, NULL, ?)"
    );
    const tx = this.db.transaction(() => {
      rows.forEach((row) => {
        const parsed = engine.normalizeUrl(row.url);
        if (!parsed || !parsed.retailer) return;
        const at = now - (row.age || 1) * 3600 * 1000;
        const lid = id("lst_");
        insert.run(lid, parsed.key, parsed.board, parsed.host, parsed.path, row.title,
          row.now == null ? null : row.now, row.was == null ? null : row.was, row.bid, at, at);
        act.run(lid, row.title, parsed.board, row.bid, at);
      });
    });
    tx();
    return rows.length;
  }

  removeListing(key, reason) {
    return this.db.prepare(
      "UPDATE listings SET status = 'removed', title = title || ' (removed)' WHERE key = ? AND status = 'live'"
    ).run(key).changes;
  }
}

module.exports = { Store, rowToListing, token };
