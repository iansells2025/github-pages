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
  async listings() {
    const { rows } = await this.db.query(
      "SELECT * FROM listings WHERE status = 'live' ORDER BY bid DESC, bid_at ASC, id ASC"
    );
    return rows.map(rowToListing);
  }

  /* One global ranking; each row also carries its rank within its own board. */
  async ranked(boardFilter) {
    const all = await this.listings();
    const perBoard = Object.create(null);
    const out = all.map((l, i) => {
      perBoard[l.board] = (perBoard[l.board] || 0) + 1;
      const r = engine.retailer(l.board);
      return Object.assign({}, l, {
        rank: i + 1,
        boardRank: perBoard[l.board],
        boardName: r ? r.name : l.board,
        ownerToken: undefined
      });
    });
    if (boardFilter && boardFilter !== "all") return out.filter((l) => l.board === boardFilter);
    return out;
  }

  async boardCounts() {
    const { rows } = await this.db.query(
      "SELECT board, COUNT(*)::int AS n FROM listings WHERE status = 'live' GROUP BY board"
    );
    const counts = { all: 0 };
    rows.forEach((r) => { counts[r.board] = r.n; counts.all += r.n; });
    engine.RETAILERS.forEach((r) => { if (counts[r.id] == null) counts[r.id] = 0; });
    return counts;
  }

  async listingByKey(key) {
    const { rows } = await this.db.query(
      "SELECT * FROM listings WHERE key = $1 AND status = 'live'", [key]
    );
    return rowToListing(rows[0]);
  }

  async activity(limit) {
    const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const { rows } = await this.db.query(
      "SELECT * FROM activity ORDER BY at DESC, id DESC LIMIT $1", [n]
    );
    return rows.map((a) => ({
      listingId: a.listing_id,
      title: a.title,
      board: a.board,
      boardName: (engine.retailer(a.board) || {}).name || a.board,
      amount: a.amount,
      rank: a.rank,
      at: a.at
    }));
  }

  async stats() {
    const agg = (await this.db.query(
      "SELECT COUNT(*)::int AS listings, COALESCE(SUM(bid), 0)::int AS on_board FROM listings WHERE status = 'live'"
    )).rows[0];
    const paid = (await this.db.query(
      "SELECT COALESCE(SUM(charge), 0)::int AS revenue, COUNT(*)::int AS bids FROM bids WHERE status = 'applied'"
    )).rows[0];
    const visitors = (await this.db.query("SELECT COUNT(DISTINCT visitor)::int AS n FROM visits")).rows[0].n;
    const top = rowToListing((await this.db.query(
      "SELECT * FROM listings WHERE status = 'live' ORDER BY bid DESC, bid_at ASC LIMIT 1"
    )).rows[0]);
    const since = (await this.db.query("SELECT MIN(created_at) AS t FROM listings")).rows[0].t;
    return {
      listings: agg.listings,
      onBoard: agg.on_board,
      revenue: paid.revenue,
      paidBids: paid.bids,
      visitors,
      launchedAt: since || null,
      top: top ? { title: top.title, bid: top.bid, board: top.board, url: top.url } : null,
      boards: await this.boardCounts()
    };
  }

  async recordVisit(visitor) {
    const day = new Date().toISOString().slice(0, 10);
    await this.db.query(
      "INSERT INTO visits (day, visitor, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [day, visitor, Date.now()]
    );
  }

  // ---------- quoting ----------

  /* Price a bid without touching the board. `basis` is the listing bid the
     quote was priced against — payment is only honoured against that state. */
  async quote(parsed, amount) {
    const existing = await this.listingByKey(parsed.key);
    const listings = await this.listings();
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

  async createBid(fields) {
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
    await this.db.query(
      `INSERT INTO bids
        (id, listing_key, board, amount, charge, basis, status, title, price_now, price_was,
         email, owner_token, provider, session_id, payment_intent, created_at, updated_at, applied_at, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [bid.id, bid.listing_key, bid.board, bid.amount, bid.charge, bid.basis, bid.status,
        bid.title, bid.price_now, bid.price_was, bid.email, bid.owner_token, bid.provider,
        bid.session_id, bid.payment_intent, bid.created_at, bid.updated_at, bid.applied_at, bid.note]
    );
    return bid;
  }

  async getBid(bidId) {
    const { rows } = await this.db.query("SELECT * FROM bids WHERE id = $1", [bidId]);
    return rows[0] || null;
  }

  async getBidBySession(sessionId) {
    const { rows } = await this.db.query("SELECT * FROM bids WHERE session_id = $1", [sessionId]);
    return rows[0] || null;
  }

  async bidByPaymentIntent(pi) {
    const { rows } = await this.db.query("SELECT * FROM bids WHERE payment_intent = $1", [pi]);
    return rows[0] || null;
  }

  async attachSession(bidId, sessionId) {
    await this.db.query(
      "UPDATE bids SET session_id = $1, updated_at = $2 WHERE id = $3",
      [sessionId, Date.now(), bidId]
    );
  }

  async setBidStatus(bidId, status, extra) {
    const e = extra || {};
    await this.db.query(
      `UPDATE bids SET status = $1, note = COALESCE($2, note),
         payment_intent = COALESCE($3, payment_intent), updated_at = $4 WHERE id = $5`,
      [status, e.note || null, e.paymentIntent || null, Date.now(), bidId]
    );
  }

  /* Returns true when this event was already handled. */
  async seenWebhook(eventId, type) {
    const { rowCount } = await this.db.query(
      "INSERT INTO webhook_events (id, type, received_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [eventId, type || null, Date.now()]
    );
    return rowCount === 0;
  }

  async forgetWebhook(eventId) {
    await this.db.query("DELETE FROM webhook_events WHERE id = $1", [eventId]);
  }

  /* Apply a paid bid to the board, atomically.

     A payment buys exactly the board state it was quoted against. If the deal
     moved while the payer was in checkout — someone else listed or raised it —
     the bid is marked `superseded` instead of applied, and the caller refunds.
     That keeps "you only pay the difference" honest under concurrency.

     The bid row is locked FOR UPDATE for the whole transaction, so two webhook
     deliveries racing on separate serverless instances cannot both apply it. */
  async applyPaidBid(bidId, paymentIntent) {
    return this.db.tx(async (t) => {
      const bid = (await t.query("SELECT * FROM bids WHERE id = $1 FOR UPDATE", [bidId])).rows[0];
      if (!bid) return { ok: false, code: "unknown_bid" };
      if (bid.status === "applied") return { ok: true, already: true, listingId: null, bid };
      if (bid.status === "superseded" || bid.status === "refunded") {
        return { ok: false, code: bid.status, bid };
      }

      const existing = (await t.query(
        "SELECT * FROM listings WHERE key = $1 AND status = 'live' FOR UPDATE", [bid.listing_key]
      )).rows[0];
      const currentBasis = existing ? existing.bid : 0;

      if (currentBasis !== bid.basis) {
        await t.query(
          `UPDATE bids SET status = 'superseded', payment_intent = COALESCE($1, payment_intent),
             note = $2, updated_at = $3 WHERE id = $4`,
          [paymentIntent || null,
            "board moved during checkout: quoted against " + bid.basis + ", found " + currentBasis,
            Date.now(), bidId]
        );
        const after = (await t.query("SELECT * FROM bids WHERE id = $1", [bidId])).rows[0];
        return { ok: false, code: "superseded", bid: after };
      }

      const now = Date.now();
      let listingId;
      if (existing) {
        listingId = existing.id;
        await t.query(
          `UPDATE listings SET bid = $1, bid_at = $2, owner_token = $3,
             title = COALESCE($4, title), price_now = COALESCE($5, price_now),
             price_was = COALESCE($6, price_was)
           WHERE id = $7`,
          [bid.amount, now, bid.owner_token, bid.title, bid.price_now, bid.price_was, listingId]
        );
      } else {
        const host = bid.listing_key.split("/")[0];
        const path = bid.listing_key.slice(host.length);
        listingId = id("lst_");
        // Another invocation may have inserted this key between the lock above
        // and here; the unique index is what actually decides the winner.
        const ins = await t.query(
          `INSERT INTO listings
             (id, key, board, host, path, title, price_now, price_was, bid, created_at, bid_at, owner_token, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'live')
           ON CONFLICT (key) DO NOTHING
           RETURNING id`,
          [listingId, bid.listing_key, bid.board, host, path,
            bid.title || engine.titleFromPath(path), bid.price_now, bid.price_was,
            bid.amount, now, now, bid.owner_token]
        );
        if (!ins.rows.length) {
          await t.query(
            "UPDATE bids SET status = 'superseded', note = $1, updated_at = $2 WHERE id = $3",
            ["another payment listed this deal first", Date.now(), bidId]
          );
          const after = (await t.query("SELECT * FROM bids WHERE id = $1", [bidId])).rows[0];
          return { ok: false, code: "superseded", bid: after };
        }
      }

      const rank = (await t.query(
        `SELECT COUNT(*)::int + 1 AS n FROM listings
         WHERE status = 'live' AND (bid > $1 OR (bid = $1 AND bid_at < $2))`,
        [bid.amount, now]
      )).rows[0].n;

      const listing = (await t.query("SELECT * FROM listings WHERE id = $1", [listingId])).rows[0];
      await t.query(
        "INSERT INTO activity (listing_id, title, board, amount, rank, at) VALUES ($1,$2,$3,$4,$5,$6)",
        [listingId, listing.title, bid.board, bid.amount, rank, now]
      );
      await t.query(
        `UPDATE bids SET status = 'applied', applied_at = $1,
           payment_intent = COALESCE($2, payment_intent), updated_at = $3 WHERE id = $4`,
        [now, paymentIntent || null, now, bidId]
      );

      const after = (await t.query("SELECT * FROM bids WHERE id = $1", [bidId])).rows[0];
      return { ok: true, listingId, rank, bid: after, listing: rowToListing(listing) };
    });
  }

  /* A disputed or externally refunded payment must not keep buying a rank.

     If the bid being reversed is still the listing's current bid, roll the
     listing back to what it was worth before that payment — its `basis` — or
     take it off the board entirely if the payment created it. If later bids
     stacked on top, unwinding is ambiguous, so the listing is flagged for a
     human instead of silently rewritten. */
  async reverseBid(bidId, reason) {
    return this.db.tx(async (t) => {
      const bid = (await t.query("SELECT * FROM bids WHERE id = $1 FOR UPDATE", [bidId])).rows[0];
      if (!bid) return { ok: false, code: "unknown_bid" };

      const now = Date.now();
      if (bid.status !== "applied") {
        await t.query("UPDATE bids SET status = 'reversed', note = $1, updated_at = $2 WHERE id = $3",
          [reason || "payment reversed", now, bidId]);
        return { ok: true, action: "none", note: "bid was never applied" };
      }

      const listing = (await t.query(
        "SELECT * FROM listings WHERE key = $1 FOR UPDATE", [bid.listing_key]
      )).rows[0];
      await t.query("UPDATE bids SET status = 'reversed', note = $1, updated_at = $2 WHERE id = $3",
        [reason || "payment reversed", now, bidId]);

      if (!listing) return { ok: true, action: "none", note: "listing already gone" };

      if (listing.bid !== bid.amount) {
        await t.query(
          "UPDATE listings SET flagged = true, check_status = 'disputed', check_note = $1 WHERE id = $2",
          ["a payment behind this listing was reversed; later bids stacked on it — needs review", listing.id]
        );
        return { ok: true, action: "flagged", listingId: listing.id };
      }

      if (bid.basis > 0) {
        await t.query(
          `UPDATE listings SET bid = $1, bid_at = $2, flagged = true, check_status = 'disputed',
             check_note = $3 WHERE id = $4`,
          [bid.basis, now, "rolled back after a reversed payment", listing.id]
        );
        return { ok: true, action: "rolled_back", listingId: listing.id, to: bid.basis };
      }

      await t.query(
        `UPDATE listings SET status = 'removed', flagged = true, check_status = 'disputed',
           check_note = $1 WHERE id = $2`,
        [reason || "payment reversed", listing.id]
      );
      return { ok: true, action: "removed", listingId: listing.id };
    });
  }

  // ---------- link checking ----------

  /* Listings that have never been checked, or whose last check is stale. */
  async dueForCheck(limit, staleMs) {
    const cutoff = Date.now() - (staleMs || 24 * 3600 * 1000);
    const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const { rows } = await this.db.query(
      `SELECT * FROM listings
       WHERE status = 'live' AND (last_checked IS NULL OR last_checked < $1)
       ORDER BY (last_checked IS NOT NULL), bid DESC LIMIT $2`,
      [cutoff, n]
    );
    return rows.map(rowToListing);
  }

  async recordCheck(listingId, status, note) {
    // Only a definitive "gone" flags a listing. A retailer blocking the checker
    // says nothing about whether the deal is live.
    const flag = status === "dead";
    await this.db.query(
      `UPDATE listings SET last_checked = $1, check_status = $2, check_note = $3,
         flagged = CASE WHEN $4 THEN true ELSE flagged END
       WHERE id = $5`,
      [Date.now(), status, note || null, flag, listingId]
    );
  }

  async flagged() {
    const { rows } = await this.db.query(
      "SELECT * FROM listings WHERE flagged = true AND status = 'live' ORDER BY bid DESC"
    );
    return rows.map((r) => Object.assign(rowToListing(r), {
      checkStatus: r.check_status, checkNote: r.check_note, lastChecked: r.last_checked
    }));
  }

  async unflag(key) {
    const { rowCount } = await this.db.query(
      "UPDATE listings SET flagged = false, check_note = NULL WHERE key = $1 AND status = 'live'",
      [key]
    );
    return rowCount;
  }

  async expireStalePending(maxAgeMs) {
    const cutoff = Date.now() - (maxAgeMs || 24 * 3600 * 1000);
    const { rowCount } = await this.db.query(
      "UPDATE bids SET status = 'expired', updated_at = $1 WHERE status = 'pending' AND created_at < $2",
      [Date.now(), cutoff]
    );
    return rowCount;
  }

  // ---------- seeding / admin ----------

  async seed(rows) {
    const existing = (await this.db.query("SELECT COUNT(*)::int AS n FROM listings")).rows[0].n;
    if (existing > 0) return 0;

    const now = Date.now();
    let inserted = 0;
    for (const row of rows) {
      const parsed = engine.normalizeUrl(row.url);
      if (!parsed || !parsed.retailer) continue;
      const at = now - (row.age || 1) * 3600 * 1000;
      const lid = id("lst_");
      await this.db.query(
        `INSERT INTO listings
           (id, key, board, host, path, title, price_now, price_was, bid, created_at, bid_at, owner_token, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,'live')
         ON CONFLICT (key) DO NOTHING`,
        [lid, parsed.key, parsed.board, parsed.host, parsed.path, row.title,
          row.now == null ? null : row.now, row.was == null ? null : row.was, row.bid, at, at]
      );
      await this.db.query(
        "INSERT INTO activity (listing_id, title, board, amount, rank, at) VALUES ($1,$2,$3,$4,NULL,$5)",
        [lid, row.title, parsed.board, row.bid, at]
      );
      inserted++;
    }
    return inserted;
  }

  async removeListing(key) {
    const { rowCount } = await this.db.query(
      "UPDATE listings SET status = 'removed', title = title || ' (removed)' WHERE key = $1 AND status = 'live'",
      [key]
    );
    return rowCount;
  }
}

module.exports = { Store, rowToListing, token };
