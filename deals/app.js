/* outdeals — a pay-to-rank leaderboard for retail deals.
   Everything runs in the browser: state lives in localStorage, so bids you
   place are visible to you only and no money ever moves. */

(function () {
  "use strict";

  var STORE_KEY = "outdeals.v1";
  var MIN_BID = 5;
  var MAX_BID = 999999;
  var TOP_PREMIUM = 5; // taking #1 costs at least this much over the current top bid
  var PAGE_SIZE = 12;

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

  var TRACKING_PARAMS = /^(utm_|gclid|fbclid|msclkid|ref_?$|ref=|tag$|linkCode$|ascsubtag$|psc$|th$|sourceid$|irgwc$|clickid$|athbdg$|athcpid$|athena)/i;

  // ---------- helpers ----------

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function money(n) { return "$" + Number(n).toLocaleString("en-US"); }
  function price(n) { return "$" + Number(n).toFixed(2).replace(/\.00$/, ""); }
  function retailer(id) {
    for (var i = 0; i < RETAILERS.length; i++) if (RETAILERS[i].id === id) return RETAILERS[i];
    return null;
  }

  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return "just now";
    var m = Math.round(s / 60);
    if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
    var h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    var d = Math.round(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }

  /* Strip protocol, www, tracking query strings and trailing slashes so the same
     deal entered twice always resolves to the same listing. */
  function normalizeUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    var hashless = s.split("#")[0];
    var parts = hashless.split("?");
    var path = parts[0].replace(/\/+$/, "");
    var host = path.split("/")[0].toLowerCase();
    if (!host || host.indexOf(".") === -1) return null;

    var rest = path.slice(host.length);
    var kept = [];
    if (parts[1]) {
      parts[1].split("&").forEach(function (pair) {
        if (pair && !TRACKING_PARAMS.test(pair) && !TRACKING_PARAMS.test(pair.split("=")[0])) kept.push(pair);
      });
    }

    var r = null;
    for (var i = 0; i < RETAILERS.length; i++) if (RETAILERS[i].match.test(host)) { r = RETAILERS[i]; break; }
    if (!r) return { host: host, path: rest, key: host + rest, retailer: null };

    // Platform links are keyed by their product path, so two deals never share a bid.
    if (r.id === "amazon") {
      var asin = rest.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
      if (asin) rest = "/dp/" + asin[1].toUpperCase();
    } else if (r.id === "target") {
      var tcode = rest.match(/\/A-(\d+)/i);
      if (tcode) rest = rest.toLowerCase();
    } else if (r.id === "walmart") {
      rest = rest.toLowerCase();
    } else {
      rest = rest.toLowerCase();
    }
    if (kept.length) rest += "?" + kept.join("&");

    return { host: r.host, path: rest, key: r.host + rest, retailer: r };
  }

  function titleFromPath(path) {
    var seg = String(path || "").split("?")[0].split("/").filter(Boolean);
    for (var i = seg.length - 1; i >= 0; i--) {
      var s = seg[i];
      if (/^(dp|ip|p|deal|A-\d+|\d+|[A-Z0-9]{10})$/i.test(s)) continue;
      return s.replace(/[-_]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 70);
    }
    return "Untitled deal";
  }

  // ---------- state ----------

  var state = { listings: [], activity: [], visitors: 0, revenue: 0, launched: 0 };

  function newId() { return "l" + Math.random().toString(36).slice(2, 10); }

  function seed() {
    var now = Date.now();
    var hour = 3600 * 1000;
    var listings = (window.OUTDEALS_SEED || []).map(function (row) {
      var parsed = normalizeUrl(row.url);
      var at = now - row.age * hour;
      return {
        id: newId(),
        category: parsed.retailer.id,
        key: parsed.key,
        host: parsed.host,
        path: parsed.path,
        title: row.title,
        now: row.now,
        was: row.was,
        bid: row.bid,
        createdAt: at,
        bidAt: at,
        mine: false
      };
    });
    var activity = listings.slice().sort(function (a, b) { return b.bidAt - a.bidAt; }).slice(0, 8)
      .map(function (l) { return { id: l.id, title: l.title, category: l.category, bid: l.bid, at: l.bidAt }; });
    var revenue = listings.reduce(function (sum, l) { return sum + l.bid; }, 0);
    return {
      listings: listings,
      activity: activity,
      visitors: 214877,
      revenue: revenue,
      launched: now - 52 * hour
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.listings) && parsed.listings.length) return parsed;
      }
    } catch (e) { /* corrupt or unavailable storage — fall through to a fresh board */ }
    var fresh = seed();
    save(fresh);
    return fresh;
  }

  function save(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s || state)); } catch (e) { /* private mode */ }
  }

  // ---------- ranking ----------

  function board(category) {
    return state.listings
      .filter(function (l) { return l.category === category; })
      .sort(function (a, b) { return b.bid - a.bid || a.bidAt - b.bidAt; });
  }

  function topBid(category) {
    var b = board(category);
    return b.length ? b[0] : null;
  }

  function findListing(category, key) {
    for (var i = 0; i < state.listings.length; i++) {
      var l = state.listings[i];
      if (l.category === category && l.key === key) return l;
    }
    return null;
  }

  /* Where a bid of `amount` would land, given the tie rule that an existing
     equal bid keeps the higher rank. */
  function rankFor(category, amount, ignoreId) {
    var above = board(category).filter(function (l) {
      return l.id !== ignoreId && l.bid >= amount;
    });
    return above.length + 1;
  }

  /* The rules engine. Returns {ok:true, charge, rank} or {ok:false, message}. */
  function validate(category, key, amount, existing) {
    if (!Number.isFinite(amount) || Math.floor(amount) !== amount) {
      return { ok: false, message: "Bids are whole US dollars — no cents." };
    }
    if (amount < MIN_BID) return { ok: false, message: "New spots start at " + money(MIN_BID) + "." };
    if (amount > MAX_BID) return { ok: false, message: "The maximum bid is " + money(MAX_BID) + "." };

    var top = topBid(category);
    var isTop = top && existing && top.id === existing.id;

    if (existing) {
      if (amount < existing.bid + 1) {
        return { ok: false, message: "That listing is already at " + money(existing.bid) +
          ". Raising it costs at least " + money(existing.bid + 1) + " — you only pay the difference." };
      }
    }

    // Taking #1 from someone else always carries the premium.
    if (top && !isTop && amount > top.bid && amount < top.bid + TOP_PREMIUM) {
      return { ok: false, message: "Taking #1 costs at least " + money(top.bid + TOP_PREMIUM) +
        ". Bid " + money(top.bid) + " or less to join the board below #1." };
    }

    return {
      ok: true,
      charge: existing ? amount - existing.bid : amount,
      rank: rankFor(category, amount, existing ? existing.id : null)
    };
  }

  function commit(category, parsed, amount, extra) {
    var existing = findListing(category, parsed.key);
    var check = validate(category, parsed.key, amount, existing);
    if (!check.ok) return check;

    if (existing) {
      existing.bid = amount;
      existing.bidAt = Date.now();
      existing.mine = true;
      if (extra.title) existing.title = extra.title;
      if (extra.now != null) existing.now = extra.now;
      if (extra.was != null) existing.was = extra.was;
    } else {
      existing = {
        id: newId(),
        category: category,
        key: parsed.key,
        host: parsed.host,
        path: parsed.path,
        title: extra.title || titleFromPath(parsed.path),
        now: extra.now,
        was: extra.was,
        bid: amount,
        createdAt: Date.now(),
        bidAt: Date.now(),
        mine: true
      };
      state.listings.push(existing);
    }

    state.revenue += check.charge;
    state.activity.unshift({
      id: existing.id, title: existing.title, category: category,
      bid: amount, at: existing.bidAt
    });
    state.activity = state.activity.slice(0, 40);
    save();
    var placed = board(category).findIndex(function (x) { return x.id === existing.id; }) + 1;
    return { ok: true, charge: check.charge, listing: existing, rank: placed };
  }

  // ---------- rendering ----------

  var ui = {
    category: "amazon",
    limit: PAGE_SIZE,
    lastBidId: null,
    pending: null
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function avatar(l) {
    var r = retailer(l.category);
    var a = el("div", "avatar", r ? r.initials : "??");
    a.style.background = r ? r.color : "#888";
    a.setAttribute("aria-hidden", "true");
    return a;
  }

  function discount(l) {
    if (!l.now || !l.was || l.was <= l.now) return null;
    return Math.round((1 - l.now / l.was) * 100);
  }

  function renderTabs() {
    var host = $("#tabs");
    if (!host) return;
    host.innerHTML = "";
    RETAILERS.forEach(function (r) {
      var count = state.listings.filter(function (l) { return l.category === r.id; }).length;
      var b = el("button", "tab");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(r.id === ui.category));
      b.appendChild(document.createTextNode(r.name + " deals"));
      b.appendChild(el("span", "count", String(count)));
      b.addEventListener("click", function () {
        ui.category = r.id;
        ui.limit = PAGE_SIZE;
        delete $("#bidAmount").dataset.touched;
        renderAll();
        var url = new URL(location.href);
        url.searchParams.set("board", r.id);
        history.replaceState(null, "", url);
      });
      host.appendChild(b);
    });
  }

  function renderHero() {
    var top = topBid(ui.category);
    var r = retailer(ui.category);
    var target = top ? top.bid + TOP_PREMIUM : MIN_BID;
    var input = $("#bidAmount");
    if (input && !input.dataset.touched) input.value = String(target);
    var out = $("#heroAmount");
    if (out) out.textContent = money(input ? Number(input.value || target) : target);
    var min = $("#heroMin");
    if (min) min.textContent = money(MIN_BID);
    var label = $("#heroBoard");
    if (label) label.textContent = r.name;
    var ph = $("#dealUrl");
    if (ph) ph.placeholder = "Your " + r.name + " deal link — " + r.example;
  }

  function renderBoard() {
    var host = $("#board");
    if (!host) return;
    host.innerHTML = "";
    var rows = board(ui.category);
    var r = retailer(ui.category);

    var head = $("#boardSub");
    if (head) {
      head.textContent = rows.length
        ? rows.length + " deal" + (rows.length === 1 ? "" : "s") + " ranked by bid"
        : "no deals yet";
    }
    var title = $("#boardTitle");
    if (title) title.textContent = r.name + " deals";

    if (!rows.length) {
      host.appendChild(el("div", "empty", "No one has claimed a spot on this board yet. " + money(MIN_BID) + " takes #1."));
      return;
    }

    rows.slice(0, ui.limit).forEach(function (l, i) {
      var row = el("div", "listing" + (i === 0 ? " top" : "") + (l.mine ? " mine" : "") +
        (l.id === ui.lastBidId ? " just-bid" : ""));

      row.appendChild(el("div", "rank", "#" + (i + 1)));
      row.appendChild(avatar(l));

      var body = el("div", "body");
      var a = el("a", "title", l.title);
      a.href = "https://" + l.host + l.path;
      a.target = "_blank";
      a.rel = "nofollow noopener sponsored";
      body.appendChild(a);

      var sub = el("div", "sub");
      sub.appendChild(el("span", null, l.host));
      if (l.now != null) sub.appendChild(el("span", "price-now", price(l.now)));
      if (l.was != null && l.now != null && l.was > l.now) sub.appendChild(el("span", "price-was", price(l.was)));
      var off = discount(l);
      if (off) sub.appendChild(el("span", "badge", off + "% off"));
      if (l.mine) sub.appendChild(el("span", "badge", "your listing"));
      body.appendChild(sub);
      row.appendChild(body);

      var right = el("div", "right");
      right.appendChild(el("div", "bid", money(l.bid)));
      var btn = el("button", "btn-outbid", i === 0 ? "Take #1" : "Outbid");
      btn.type = "button";
      btn.addEventListener("click", function () { prefillOutbid(l, i === 0); });
      right.appendChild(btn);
      row.appendChild(right);

      host.appendChild(row);
    });

    var more = $("#loadMore");
    if (more) {
      more.hidden = rows.length <= ui.limit;
      more.textContent = "Show " + Math.min(PAGE_SIZE, rows.length - ui.limit) + " more";
    }
  }

  function renderTrending() {
    var host = $("#trending");
    if (!host) return;
    host.innerHTML = "";
    var rows = state.listings.slice().sort(function (a, b) { return b.bid - a.bid; }).slice(0, 6);
    rows.forEach(function (l) {
      var row = el("div", "mini-row");
      row.appendChild(avatar(l));
      row.appendChild(el("span", "name", l.title));
      // Clicks scale with the bid — the whole point of paying for the top spot.
      var clicks = Math.round(60 + Math.sqrt(l.bid) * 62 + (l.id.charCodeAt(1) % 40));
      row.appendChild(el("span", "meta", clicks.toLocaleString("en-US") + " clicks/h"));
      host.appendChild(row);
    });
  }

  function renderActivity() {
    var host = $("#activity");
    if (!host) return;
    host.innerHTML = "";
    state.activity.slice(0, 8).forEach(function (a) {
      var l = state.listings.filter(function (x) { return x.id === a.id; })[0];
      var row = el("div", "mini-row");
      row.appendChild(avatar(l || { category: a.category }));
      row.appendChild(el("span", "name", a.title));
      var rank = l ? board(l.category).findIndex(function (x) { return x.id === l.id; }) + 1 : null;
      row.appendChild(el("span", null, rank ? "at #" + rank + " · " + money(a.bid) : money(a.bid)));
      row.appendChild(el("span", "meta", ago(a.at)));
      host.appendChild(row);
    });
  }

  function renderStats() {
    var online = 380 + (Math.floor(Date.now() / 9000) % 240);
    var o = $("#onlineCount");
    if (o) o.textContent = online.toLocaleString("en-US");
    var v = $("#visitorCount");
    if (v) v.textContent = state.visitors.toLocaleString("en-US");
    $$("[data-stat]").forEach(function (n) {
      var k = n.getAttribute("data-stat");
      if (k === "visitors") n.textContent = state.visitors.toLocaleString("en-US");
      if (k === "revenue") n.textContent = Math.round(state.revenue).toLocaleString("en-US");
      if (k === "listings") n.textContent = state.listings.length.toLocaleString("en-US");
      if (k === "top") {
        var best = state.listings.slice().sort(function (a, b) { return b.bid - a.bid; })[0];
        n.textContent = best ? Math.round(best.bid).toLocaleString("en-US") : "0";
      }
      if (k === "topName") {
        var b2 = state.listings.slice().sort(function (a, b) { return b.bid - a.bid; })[0];
        n.textContent = b2 ? b2.title : "—";
      }
    });
  }

  function renderAll() {
    renderTabs();
    renderHero();
    renderBoard();
    renderTrending();
    renderActivity();
    renderStats();
  }

  // ---------- interactions ----------

  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

  function showError(msg) {
    var box = $("#formError");
    if (!box) return;
    box.textContent = msg || "";
    box.hidden = !msg;
  }

  function prefillOutbid(listing, isTop) {
    ui.category = listing.category;
    var top = topBid(listing.category);
    var amount = isTop ? listing.bid + TOP_PREMIUM : Math.max(listing.bid + 1, MIN_BID);
    $("#dealUrl").value = "https://" + listing.host + listing.path;
    var input = $("#bidAmount");
    input.value = String(amount);
    input.dataset.touched = "1";
    renderAll();
    showError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("#dealUrl").focus();
  }

  function readForm() {
    var raw = $("#dealUrl").value;
    var parsed = normalizeUrl(raw);
    if (!parsed) return { error: "Enter the link to the deal you want to rank." };
    if (!parsed.retailer) {
      return { error: "Only Amazon, Target, Walmart, and Altamuta product links can be listed — " +
        parsed.host + " is not one of them." };
    }
    var amount = Math.floor(Number($("#bidAmount").value));
    var titleEl = $("#dealTitle"), nowEl = $("#dealPrice"), wasEl = $("#dealWas");
    return {
      parsed: parsed,
      amount: amount,
      extra: {
        title: titleEl && titleEl.value.trim() ? titleEl.value.trim().slice(0, 90) : null,
        now: nowEl && nowEl.value ? Number(nowEl.value) : null,
        was: wasEl && wasEl.value ? Number(wasEl.value) : null
      }
    };
  }

  function openCheckout(form) {
    var category = form.parsed.retailer.id;
    var existing = findListing(category, form.parsed.key);
    var check = validate(category, form.parsed.key, form.amount, existing);
    if (!check.ok) { showError(check.message); return; }
    showError("");

    ui.pending = { form: form, category: category, existing: existing, check: check };

    $("#coDeal").textContent = form.extra.title || (existing && existing.title) || titleFromPath(form.parsed.path);
    $("#coBoard").textContent = form.parsed.retailer.name + " deals";
    $("#coRank").textContent = "#" + check.rank;
    $("#coBid").textContent = money(form.amount);
    $("#coCharge").textContent = money(check.charge);
    $("#coLine").textContent = existing
      ? "You already hold this spot at " + money(existing.bid) + ", so you only pay the difference."
      : "New listing — you pay the full bid.";
    $("#checkout").hidden = false;
  }

  function closeCheckout() {
    $("#checkout").hidden = true;
    ui.pending = null;
  }

  function confirmCheckout() {
    if (!ui.pending) return;
    var p = ui.pending;
    var result = commit(p.category, p.form.parsed, p.form.amount, p.form.extra);
    closeCheckout();
    if (!result.ok) { showError(result.message); return; }

    ui.category = p.category;
    ui.lastBidId = result.listing.id;
    ui.limit = Math.max(ui.limit, result.rank);
    $("#dealUrl").value = "";
    if ($("#dealTitle")) $("#dealTitle").value = "";
    if ($("#dealPrice")) $("#dealPrice").value = "";
    if ($("#dealWas")) $("#dealWas").value = "";
    delete $("#bidAmount").dataset.touched;
    renderAll();
    toast(result.rank === 1
      ? "You're #1 on " + retailer(p.category).name + " deals for " + money(p.form.amount) + "."
      : "Listed at #" + result.rank + " for " + money(p.form.amount) + ".");
    var row = $$(".listing")[result.rank - 1];
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function step(delta) {
    var input = $("#bidAmount");
    var v = Math.floor(Number(input.value) || MIN_BID) + delta;
    input.value = String(Math.min(MAX_BID, Math.max(MIN_BID, v)));
    input.dataset.touched = "1";
    renderHero();
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem("outdeals.theme"); } catch (e) {}
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", saved || (prefersDark ? "dark" : "light"));
    var btn = $("#themeBtn");
    if (btn) btn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("outdeals.theme", next); } catch (e) {}
    });
  }

  function initShared() {
    initTheme();
    var bar = $(".topbar");
    if (bar) {
      window.addEventListener("scroll", function () {
        bar.classList.toggle("scrolled", window.scrollY > 4);
      }, { passive: true });
    }
    $$("[data-reset]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!confirm("Reset the board to its demo state? Your bids in this browser will be cleared.")) return;
        try { localStorage.removeItem(STORE_KEY); } catch (e) {}
        location.reload();
      });
    });
    $$("[data-showmore]").forEach(function (b) {
      b.addEventListener("click", function () {
        var card = b.closest(".card");
        var collapsed = card.classList.toggle("collapsed");
        b.textContent = collapsed ? "Show more" : "Show less";
      });
    });
  }

  function initBoardPage() {
    var fromUrl = new URL(location.href).searchParams.get("board");
    if (fromUrl && retailer(fromUrl)) ui.category = fromUrl;

    $("#bidUp").addEventListener("click", function () { step(1); });
    $("#bidDown").addEventListener("click", function () { step(-1); });
    $("#bidAmount").addEventListener("input", function () {
      this.dataset.touched = "1";
      renderHero();
    });

    $("#bidForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var form = readForm();
      if (form.error) { showError(form.error); return; }
      openCheckout(form);
    });

    $("#advancedToggle").addEventListener("click", function () {
      var box = $("#advanced");
      box.hidden = !box.hidden;
      this.textContent = box.hidden ? "Add deal details (optional)" : "Hide deal details";
    });

    $("#coCancel").addEventListener("click", closeCheckout);
    $("#coConfirm").addEventListener("click", confirmCheckout);
    $("#checkout").addEventListener("click", function (e) {
      if (e.target === this) closeCheckout();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("#checkout").hidden) closeCheckout();
    });

    $("#loadMore").addEventListener("click", function () {
      ui.limit += PAGE_SIZE;
      renderBoard();
    });

    renderAll();

    // Keep relative timestamps and the live counters honest.
    setInterval(function () {
      state.visitors += Math.floor(Math.random() * 4);
      renderActivity();
      renderStats();
      save();
    }, 5000);
  }

  document.addEventListener("DOMContentLoaded", function () {
    state = load();
    initShared();
    if ($("#bidForm")) initBoardPage();
    else renderStats();
  });
})();
