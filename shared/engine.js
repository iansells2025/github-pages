/* outdeals ranking rules — the single source of truth.
   Loaded by the browser as a <script> and required by the API server, so the
   board can never disagree with itself about what a bid buys. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OUTDEALS_ENGINE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MIN_BID = 5;
  var MAX_BID = 999999;
  var TOP_PREMIUM = 5;   // taking #1 costs at least this much over the current top bid
  var MAX_TITLE = 90;

  var RETAILERS = [
    { id: "amazon", name: "Amazon", host: "amazon.com", color: "#e08b18", initials: "AZ",
      match: /(^|\.)amazon\.(com|ca|co\.uk|de)$/, example: "amazon.com/dp/B0CHX3QBCH" },
    { id: "target", name: "Target", host: "target.com", color: "#cc0000", initials: "TG",
      match: /(^|\.)target\.com$/, example: "target.com/p/…/-/A-88259231" },
    { id: "walmart", name: "Walmart", host: "walmart.com", color: "#0071dc", initials: "WM",
      match: /(^|\.)walmart\.com$/, example: "walmart.com/ip/…/1567890123" },
    { id: "altamuta", name: "Altamuta", host: "altamuta.com", color: "#7b5bd6", initials: "AL",
      match: /(^|\.)altamuta\.com$/, example: "altamuta.com/deal/…" }
  ];

  var TRACKING = /^(utm_[a-z]*|gclid|fbclid|msclkid|ref|ref_|tag|linkcode|linkid|ascsubtag|psc|th|sourceid|irgwc|clickid|athbdg|athcpid|athena|sid|cmp)$/i;

  function retailer(id) {
    for (var i = 0; i < RETAILERS.length; i++) if (RETAILERS[i].id === id) return RETAILERS[i];
    return null;
  }

  function retailerForHost(host) {
    for (var i = 0; i < RETAILERS.length; i++) if (RETAILERS[i].match.test(host)) return RETAILERS[i];
    return null;
  }

  /* Strip protocol, www, tracking query strings and trailing slashes so the same
     deal entered twice always resolves to the same listing key. */
  function normalizeUrl(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s || s.length > 2048) return null;
    s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    var parts = s.split("#")[0].split("?");
    var path = parts[0].replace(/\/+$/, "");
    var host = path.split("/")[0].toLowerCase();
    if (!host || host.indexOf(".") === -1 || /[^a-z0-9.-]/.test(host)) return null;

    var rest = path.slice(host.length);
    var r = retailerForHost(host);
    if (!r) return { host: host, path: rest, key: host + rest, retailer: null, board: null };

    // Platform links are keyed by their product path, so two deals never share a bid.
    if (r.id === "amazon") {
      var asin = rest.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
      rest = asin ? "/dp/" + asin[1].toUpperCase() : rest.toLowerCase();
    } else {
      rest = rest.toLowerCase();
    }

    var kept = [];
    if (parts[1]) {
      parts[1].split("&").forEach(function (pair) {
        var name = pair.split("=")[0];
        if (pair && name && !TRACKING.test(name)) kept.push(pair.toLowerCase());
      });
      kept.sort();
    }
    if (kept.length) rest += "?" + kept.join("&");

    return { host: r.host, path: rest, key: r.host + rest, retailer: r, board: r.id };
  }

  function titleFromPath(path) {
    var seg = String(path || "").split("?")[0].split("/").filter(Boolean);
    for (var i = seg.length - 1; i >= 0; i--) {
      var s = seg[i];
      if (/^(dp|ip|p|deal|A-\d+|\d+|[A-Z0-9]{10})$/i.test(s)) continue;
      return s.replace(/[-_]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, MAX_TITLE);
    }
    return "Untitled deal";
  }

  function cleanTitle(t) {
    if (t == null) return null;
    var s = String(t).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
    return s ? s.slice(0, MAX_TITLE) : null;
  }

  function cleanPrice(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    if (!isFinite(n) || n < 0 || n > 1000000) return null;
    return Math.round(n * 100) / 100;
  }

  /* One global ranking: highest bid first, and an equal bid placed earlier
     keeps the higher rank. Every listing carries the board it came from. */
  function ordered(listings) {
    return listings.slice().sort(function (a, b) {
      return b.bid - a.bid || a.bidAt - b.bidAt || (a.id < b.id ? -1 : 1);
    });
  }

  /* Where a bid of `amount` placed now would land, ignoring the bidder's own
     current listing. Existing equal bids are older, so they stay above. */
  function rankFor(listings, amount, ignoreId) {
    var above = 0;
    for (var i = 0; i < listings.length; i++) {
      var l = listings[i];
      if (l.id === ignoreId) continue;
      if (l.bid >= amount) above++;
    }
    return above + 1;
  }

  function boardRankFor(listings, amount, board, ignoreId) {
    var above = 0;
    for (var i = 0; i < listings.length; i++) {
      var l = listings[i];
      if (l.id === ignoreId || l.board !== board) continue;
      if (l.bid >= amount) above++;
    }
    return above + 1;
  }

  function topOf(listings) {
    var best = null;
    for (var i = 0; i < listings.length; i++) {
      var l = listings[i];
      if (!best || l.bid > best.bid || (l.bid === best.bid && l.bidAt < best.bidAt)) best = l;
    }
    return best;
  }

  function money(n) { return "$" + Number(n).toLocaleString("en-US"); }

  /* The rules engine. `listings` is the whole board; `existing` is the bidder's
     current listing for this deal, if any. Returns {ok, charge, rank, boardRank}
     or {ok:false, code, message}. */
  function validateBid(listings, existing, amount, board) {
    if (typeof amount !== "number" || !isFinite(amount) || Math.floor(amount) !== amount) {
      return { ok: false, code: "not_whole", message: "Bids are whole US dollars — no cents." };
    }
    if (amount < MIN_BID) {
      return { ok: false, code: "below_min", message: "New spots start at " + money(MIN_BID) + "." };
    }
    if (amount > MAX_BID) {
      return { ok: false, code: "above_max", message: "The maximum bid is " + money(MAX_BID) + "." };
    }

    var top = topOf(listings);
    var holdsTop = !!(top && existing && top.id === existing.id);

    if (existing && amount < existing.bid + 1) {
      return { ok: false, code: "raise_too_small",
        message: "That listing is already at " + money(existing.bid) + ". Raising it costs at least " +
          money(existing.bid + 1) + " — you only pay the difference." };
    }

    // Taking #1 from someone else always carries the premium.
    if (top && !holdsTop && amount > top.bid && amount < top.bid + TOP_PREMIUM) {
      return { ok: false, code: "top_premium",
        message: "Taking #1 costs at least " + money(top.bid + TOP_PREMIUM) + ". Bid " + money(top.bid) +
          " or less to join the board below #1." };
    }

    return {
      ok: true,
      charge: existing ? amount - existing.bid : amount,
      basis: existing ? existing.bid : 0,
      rank: rankFor(listings, amount, existing ? existing.id : null),
      boardRank: boardRankFor(listings, amount, board, existing ? existing.id : null)
    };
  }

  return {
    MIN_BID: MIN_BID, MAX_BID: MAX_BID, TOP_PREMIUM: TOP_PREMIUM, MAX_TITLE: MAX_TITLE,
    RETAILERS: RETAILERS,
    retailer: retailer, retailerForHost: retailerForHost,
    normalizeUrl: normalizeUrl, titleFromPath: titleFromPath,
    cleanTitle: cleanTitle, cleanPrice: cleanPrice,
    ordered: ordered, rankFor: rankFor, boardRankFor: boardRankFor, topOf: topOf,
    validateBid: validateBid, money: money
  };
});
