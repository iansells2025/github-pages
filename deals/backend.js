/* Two backends behind one interface.

   ApiBackend talks to the real server: submissions and ranking live in its
   database and bids only land after Stripe confirms the payment.

   LocalBackend is the offline demo the static site falls back to. Same rules
   engine, same shapes — but the board lives in this browser and the checkout
   is simulated. */
(function (root) {
  "use strict";

  var E = root.OUTDEALS_ENGINE;
  var STORE_KEY = "outdeals.v2";
  var MINE_KEY = "outdeals.mine";

  // ---------- ownership marks (both backends) ----------

  function mineSet() {
    try { return JSON.parse(localStorage.getItem(MINE_KEY)) || {}; } catch (e) { return {}; }
  }
  function markMine(key) {
    try {
      var m = mineSet();
      m[key] = Date.now();
      localStorage.setItem(MINE_KEY, JSON.stringify(m));
    } catch (e) { /* private mode */ }
  }

  function decorate(listings) {
    var mine = mineSet();
    return listings.map(function (l) {
      var r = E.retailer(l.board);
      return Object.assign({}, l, {
        boardName: l.boardName || (r ? r.name : l.board),
        color: r ? r.color : "#888",
        initials: r ? r.initials : "??",
        mine: !!mine[l.host + l.path]
      });
    });
  }

  // ---------- live API ----------

  function ApiBackend(base) {
    var root_ = base.replace(/\/$/, "");

    function call(method, path, body) {
      return fetch(root_ + path, {
        method: method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (!res.ok) {
            var err = new Error(json.error || "The server rejected that (" + res.status + ").");
            err.code = json.code;
            err.status = res.status;
            throw err;
          }
          return json;
        });
      });
    }

    return {
      mode: "live",

      board: function (filter, limit) {
        return call("GET", "/api/board?board=" + encodeURIComponent(filter) + "&limit=" + (limit || 25))
          .then(function (d) {
            d.listings = decorate(d.listings);
            return d;
          });
      },
      activity: function () {
        return call("GET", "/api/activity?limit=20").then(function (d) { return d.activity; });
      },
      stats: function () { return call("GET", "/api/stats"); },
      quote: function (payload) { return call("POST", "/api/quote", payload); },

      /* Returns a redirect to the payment page — the bid is not on the board
         until the processor confirms it. */
      checkout: function (payload) {
        return call("POST", "/api/checkout", payload).then(function (d) {
          return { mode: "redirect", url: d.checkoutUrl, bidId: d.bidId };
        });
      },
      bidStatus: function (bidId) { return call("GET", "/api/bids/" + encodeURIComponent(bidId)); },
      markMine: markMine
    };
  }

  // ---------- offline demo ----------

  function LocalBackend() {
    var state = null;

    function newId() { return "l" + Math.random().toString(36).slice(2, 10); }

    function seed() {
      var now = Date.now();
      var hour = 3600 * 1000;
      var listings = (root.OUTDEALS_SEED || []).map(function (row) {
        var p = E.normalizeUrl(row.url);
        var at = now - row.age * hour;
        return {
          id: newId(), key: p.key, board: p.board, host: p.host, path: p.path,
          title: row.title, priceNow: row.now, priceWas: row.was,
          bid: row.bid, createdAt: at, bidAt: at
        };
      });
      return {
        listings: listings,
        activity: listings.slice().sort(function (a, b) { return b.bidAt - a.bidAt; }).slice(0, 10)
          .map(function (l) {
            return { listingId: l.id, title: l.title, board: l.board, amount: l.bid, at: l.bidAt };
          }),
        revenue: 0,
        visitors: 214877
      };
    }

    function load() {
      try {
        var raw = JSON.parse(localStorage.getItem(STORE_KEY));
        if (raw && Array.isArray(raw.listings) && raw.listings.length) return raw;
      } catch (e) { /* fall through to a fresh board */ }
      var fresh = seed();
      save(fresh);
      return fresh;
    }

    function save(s) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(s || state)); } catch (e) { /* private mode */ }
    }

    function ranked() {
      var all = E.ordered(state.listings);
      var per = {};
      return all.map(function (l, i) {
        per[l.board] = (per[l.board] || 0) + 1;
        return Object.assign({}, l, { rank: i + 1, boardRank: per[l.board] });
      });
    }

    function counts() {
      var c = { all: state.listings.length };
      E.RETAILERS.forEach(function (r) { c[r.id] = 0; });
      state.listings.forEach(function (l) { c[l.board] = (c[l.board] || 0) + 1; });
      return c;
    }

    function quoteFor(payload) {
      var parsed = E.normalizeUrl(payload.url);
      if (!parsed) throw new Error("Enter the link to the deal you want to rank.");
      if (!parsed.retailer) {
        throw new Error("Only " + E.RETAILERS.map(function (r) { return r.name; }).join(", ") +
          " product links can be listed — " + parsed.host + " is not one of them.");
      }
      var existing = state.listings.filter(function (l) { return l.key === parsed.key; })[0] || null;
      var check = E.validateBid(state.listings, existing, Number(payload.amount), parsed.board);
      if (!check.ok) {
        var err = new Error(check.message);
        err.code = check.code;
        throw err;
      }
      return {
        parsed: parsed, existing: existing,
        quote: Object.assign({
          board: parsed.board,
          boardName: E.retailer(parsed.board).name,
          existing: existing ? { bid: existing.bid, title: existing.title } : null
        }, check)
      };
    }

    return {
      mode: "demo",

      board: function (filter) {
        state = state || load();
        var rows = ranked();
        return Promise.resolve({
          board: filter,
          total: filter === "all" ? rows.length : rows.filter(function (l) { return l.board === filter; }).length,
          counts: counts(),
          top: rows[0] || null,
          listings: decorate(filter === "all" ? rows : rows.filter(function (l) { return l.board === filter; })),
          rules: { minBid: E.MIN_BID, maxBid: E.MAX_BID, topPremium: E.TOP_PREMIUM }
        });
      },

      activity: function () {
        state = state || load();
        var rows = ranked();
        return Promise.resolve(state.activity.slice(0, 20).map(function (a) {
          var row = rows.filter(function (l) { return l.id === a.listingId; })[0];
          return Object.assign({}, a, {
            rank: row ? row.rank : a.rank,
            boardName: (E.retailer(a.board) || {}).name || a.board
          });
        }));
      },

      stats: function () {
        state = state || load();
        var rows = ranked();
        return Promise.resolve({
          listings: rows.length,
          onBoard: rows.reduce(function (s, l) { return s + l.bid; }, 0),
          revenue: state.revenue,
          visitors: state.visitors,
          top: rows[0] ? { title: rows[0].title, bid: rows[0].bid, board: rows[0].board } : null,
          boards: counts()
        });
      },

      quote: function (payload) {
        state = state || load();
        try { return Promise.resolve(quoteFor(payload).quote); }
        catch (e) { return Promise.reject(e); }
      },

      /* No processor to redirect to, so the demo applies the bid straight away
         and says so. */
      checkout: function (payload) {
        state = state || load();
        var q;
        try { q = quoteFor(payload); } catch (e) { return Promise.reject(e); }

        var now = Date.now();
        var listing = q.existing;
        if (listing) {
          listing.bid = Number(payload.amount);
          listing.bidAt = now;
          if (payload.title) listing.title = E.cleanTitle(payload.title);
          if (payload.priceNow != null) listing.priceNow = E.cleanPrice(payload.priceNow);
          if (payload.priceWas != null) listing.priceWas = E.cleanPrice(payload.priceWas);
        } else {
          listing = {
            id: newId(), key: q.parsed.key, board: q.parsed.board,
            host: q.parsed.host, path: q.parsed.path,
            title: E.cleanTitle(payload.title) || E.titleFromPath(q.parsed.path),
            priceNow: E.cleanPrice(payload.priceNow), priceWas: E.cleanPrice(payload.priceWas),
            bid: Number(payload.amount), createdAt: now, bidAt: now
          };
          state.listings.push(listing);
        }
        markMine(listing.key);
        state.revenue += q.quote.charge;
        state.activity.unshift({
          listingId: listing.id, title: listing.title, board: listing.board,
          amount: listing.bid, at: now
        });
        state.activity = state.activity.slice(0, 40);
        save();

        var rows = ranked();
        var placed = rows.filter(function (l) { return l.id === listing.id; })[0];
        return Promise.resolve({
          mode: "applied",
          rank: placed.rank,
          boardRank: placed.boardRank,
          board: listing.board,
          amount: listing.bid,
          charge: q.quote.charge,
          listingId: listing.id
        });
      },

      bidStatus: function () { return Promise.resolve({ status: "applied" }); },

      reset: function () {
        try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(MINE_KEY); } catch (e) {}
        state = null;
      },

      markMine: markMine
    };
  }

  root.OUTDEALS_BACKEND = function () {
    var cfg = root.OUTDEALS_CONFIG || {};
    return cfg.apiBase ? ApiBackend(cfg.apiBase) : LocalBackend();
  };
})(typeof self !== "undefined" ? self : this);
