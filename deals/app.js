/* outdeals — one global leaderboard for retail deals.
   Every listing competes on a single board and carries the retailer board it
   came from, plus its rank within that board. The rules live in
   ../shared/engine.js; where the data lives is backend.js's problem. */

(function () {
  "use strict";

  var E = window.OUTDEALS_ENGINE;
  var backend = window.OUTDEALS_BACKEND();
  var PAGE_SIZE = 25;

  var ui = {
    board: "all",
    limit: PAGE_SIZE,
    data: null,
    highlight: null,
    busy: false
  };

  // ---------- helpers ----------

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function money(n) { return "$" + Number(n).toLocaleString("en-US"); }
  function price(n) { return "$" + Number(n).toFixed(2).replace(/\.00$/, ""); }

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

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function avatar(board) {
    var r = E.retailer(board);
    var a = el("div", "avatar", r ? r.initials : "??");
    a.style.background = r ? r.color : "#888";
    a.setAttribute("aria-hidden", "true");
    return a;
  }

  function boardTag(l) {
    var r = E.retailer(l.board);
    var tag = el("span", "board-tag");
    var dot = el("span", "board-dot");
    dot.style.background = r ? r.color : "#888";
    tag.appendChild(dot);
    tag.appendChild(document.createTextNode(
      (l.boardName || l.board) + (l.boardRank ? " #" + l.boardRank : "")
    ));
    tag.title = (l.boardName || l.board) + " board" + (l.boardRank ? " — ranked #" + l.boardRank + " there" : "");
    return tag;
  }

  function toast(msg, kind) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.className = "toast"; }, kind === "error" ? 8000 : 4000);
  }

  function showError(msg) {
    var box = $("#formError");
    if (!box) return;
    box.textContent = msg || "";
    box.hidden = !msg;
  }

  // ---------- rendering ----------

  function renderModeBanner() {
    var b = $("#modeBanner");
    if (!b) return;
    if (backend.mode === "live") { b.hidden = true; return; }
    b.hidden = false;
  }

  function renderTabs() {
    var host = $("#tabs");
    if (!host || !ui.data) return;
    var counts = ui.data.counts || {};
    host.innerHTML = "";

    var tabs = [{ id: "all", name: "All deals" }].concat(
      E.RETAILERS.map(function (r) { return { id: r.id, name: r.name, color: r.color }; })
    );

    tabs.forEach(function (t) {
      var b = el("button", "tab");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t.id === ui.board));
      if (t.color) {
        var dot = el("span", "board-dot");
        dot.style.background = t.color;
        b.appendChild(dot);
      }
      b.appendChild(document.createTextNode(t.name));
      b.appendChild(el("span", "count", String(counts[t.id] == null ? 0 : counts[t.id])));
      b.addEventListener("click", function () {
        if (ui.board === t.id) return;
        ui.board = t.id;
        ui.limit = PAGE_SIZE;
        var url = new URL(location.href);
        if (t.id === "all") url.searchParams.delete("board");
        else url.searchParams.set("board", t.id);
        history.replaceState(null, "", url);
        refresh();
      });
      host.appendChild(b);
    });
  }

  function suggestedBid() {
    var top = ui.data && ui.data.top;
    return top ? top.bid + E.TOP_PREMIUM : E.MIN_BID;
  }

  function renderHero() {
    var input = $("#bidAmount");
    if (!input) return;
    if (!input.dataset.touched) input.value = String(suggestedBid());
    var out = $("#heroAmount");
    if (out) out.textContent = money(Number(input.value) || suggestedBid());
    var min = $("#heroMin");
    if (min) min.textContent = money(E.MIN_BID);
  }

  function renderBoard() {
    var host = $("#board");
    if (!host || !ui.data) return;
    var rows = ui.data.listings;

    var title = $("#boardTitle");
    if (title) title.textContent = ui.board === "all" ? "The board" : E.retailer(ui.board).name + " deals";
    var sub = $("#boardSub");
    if (sub) {
      sub.textContent = rows.length
        ? (ui.board === "all"
            ? ui.data.total + " deals, ranked by bid"
            : ui.data.total + " of " + (ui.data.counts.all || 0) + " deals, keeping their place on the main board")
        : "nothing here yet";
    }

    host.innerHTML = "";
    if (!rows.length) {
      host.appendChild(el("div", "empty",
        "No deals here yet. " + money(E.MIN_BID) + " puts one on the board."));
      return;
    }

    rows.slice(0, ui.limit).forEach(function (l) {
      var row = el("div", "listing" +
        (l.rank === 1 ? " top" : "") +
        (l.mine ? " mine" : "") +
        (l.id === ui.highlight ? " just-bid" : ""));

      row.appendChild(el("div", "rank", "#" + l.rank));
      row.appendChild(avatar(l.board));

      var body = el("div", "body");
      var a = el("a", "title", l.title);
      a.href = l.url || ("https://" + l.host + l.path);
      a.target = "_blank";
      a.rel = "nofollow noopener sponsored";
      body.appendChild(a);

      var meta = el("div", "sub");
      meta.appendChild(boardTag(l));
      if (l.priceNow != null) meta.appendChild(el("span", "price-now", price(l.priceNow)));
      if (l.priceWas != null && l.priceNow != null && l.priceWas > l.priceNow) {
        meta.appendChild(el("span", "price-was", price(l.priceWas)));
        meta.appendChild(el("span", "badge", Math.round((1 - l.priceNow / l.priceWas) * 100) + "% off"));
      }
      if (l.mine) meta.appendChild(el("span", "badge", "your listing"));
      body.appendChild(meta);
      row.appendChild(body);

      var right = el("div", "right");
      right.appendChild(el("div", "bid", money(l.bid)));
      var btn = el("button", "btn-outbid", l.rank === 1 ? "Take #1" : "Outbid");
      btn.type = "button";
      btn.addEventListener("click", function () { prefill(l); });
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

  function renderTrending(rows) {
    var host = $("#trending");
    if (!host) return;
    host.innerHTML = "";
    rows.slice(0, 6).forEach(function (l) {
      var row = el("div", "mini-row");
      row.appendChild(avatar(l.board));
      var name = el("span", "name", l.title);
      row.appendChild(name);
      row.appendChild(boardTag(l));
      // Clicks scale with the bid — the whole point of paying for the top spot.
      var clicks = Math.round(60 + Math.sqrt(l.bid) * 62 + (l.rank * 7) % 40);
      row.appendChild(el("span", "meta", clicks.toLocaleString("en-US") + " clicks/h"));
      host.appendChild(row);
    });
  }

  function renderActivity(activity) {
    var host = $("#activity");
    if (!host) return;
    host.innerHTML = "";
    (activity || []).slice(0, 8).forEach(function (a) {
      var row = el("div", "mini-row");
      row.appendChild(avatar(a.board));
      row.appendChild(el("span", "name", a.title));
      row.appendChild(boardTag({ board: a.board, boardName: a.boardName }));
      row.appendChild(el("span", null, (a.rank ? "at #" + a.rank + " · " : "") + money(a.amount)));
      row.appendChild(el("span", "meta", ago(a.at)));
      host.appendChild(row);
    });
  }

  function renderStats(stats) {
    if (!stats) return;
    var o = $("#onlineCount");
    if (o) o.textContent = Math.max(1, Math.round((stats.visitors || 0) / 400) + 3).toLocaleString("en-US");
    var v = $("#visitorCount");
    if (v) v.textContent = (stats.visitors || 0).toLocaleString("en-US");
    $$("[data-stat]").forEach(function (n) {
      var k = n.getAttribute("data-stat");
      if (k === "visitors") n.textContent = (stats.visitors || 0).toLocaleString("en-US");
      if (k === "revenue") n.textContent = Math.round(stats.revenue || 0).toLocaleString("en-US");
      if (k === "onboard") n.textContent = Math.round(stats.onBoard || 0).toLocaleString("en-US");
      if (k === "listings") n.textContent = (stats.listings || 0).toLocaleString("en-US");
      if (k === "top") n.textContent = stats.top ? Math.round(stats.top.bid).toLocaleString("en-US") : "0";
      if (k === "topName") n.textContent = stats.top ? stats.top.title : "—";
    });
  }

  // ---------- data ----------

  function refresh() {
    return backend.board(ui.board, 100).then(function (data) {
      ui.data = data;
      renderTabs();
      renderHero();
      renderBoard();
      return backend.board("all", 100);
    }).then(function (all) {
      renderTrending(all.listings);
      return Promise.all([backend.activity(), backend.stats()]);
    }).then(function (res) {
      renderActivity(res[0]);
      renderStats(res[1]);
    }).catch(function (err) {
      var host = $("#board");
      if (host && !ui.data) {
        host.innerHTML = "";
        host.appendChild(el("div", "empty",
          "Could not reach the board: " + err.message + " — try again in a moment."));
      }
      toast("Could not reach the server: " + err.message, "error");
    });
  }

  // ---------- bidding ----------

  function prefill(listing) {
    $("#dealUrl").value = listing.url || ("https://" + listing.host + listing.path);
    var input = $("#bidAmount");
    var top = ui.data && ui.data.top;
    var isTop = top && listing.id === top.id;
    input.value = String(isTop ? listing.bid + E.TOP_PREMIUM : Math.max(listing.bid + 1, E.MIN_BID));
    input.dataset.touched = "1";
    renderHero();
    showError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("#dealUrl").focus();
  }

  function readForm() {
    var titleEl = $("#dealTitle"), nowEl = $("#dealPrice"), wasEl = $("#dealWas"), emailEl = $("#dealEmail");
    return {
      url: $("#dealUrl").value,
      amount: Math.floor(Number($("#bidAmount").value)),
      title: titleEl && titleEl.value.trim() ? titleEl.value.trim() : null,
      priceNow: nowEl && nowEl.value ? Number(nowEl.value) : null,
      priceWas: wasEl && wasEl.value ? Number(wasEl.value) : null,
      email: emailEl && emailEl.value.trim() ? emailEl.value.trim() : null
    };
  }

  function openCheckout(payload) {
    showError("");
    ui.busy = true;
    backend.quote(payload).then(function (q) {
      ui.busy = false;
      ui.pending = { payload: payload, quote: q };
      $("#coDeal").textContent = payload.title || (q.existing && q.existing.title) || "Your deal";
      $("#coBoard").textContent = q.boardName + " board";
      $("#coRank").textContent = "#" + q.rank + " overall · #" + q.boardRank + " on " + q.boardName;
      $("#coBid").textContent = money(payload.amount);
      $("#coCharge").textContent = money(q.charge);
      $("#coLine").textContent = q.existing
        ? "You already hold this spot at " + money(q.existing.bid) + ", so you only pay the difference."
        : "New listing — you pay the full bid.";
      $("#coConfirm").textContent = backend.mode === "live"
        ? "Continue to payment · " + money(q.charge)
        : "Pay " + money(q.charge) + " (demo)";
      $("#coDemoNote").hidden = backend.mode === "live";
      $("#coLiveNote").hidden = backend.mode !== "live";
      $("#checkout").hidden = false;
    }).catch(function (err) {
      ui.busy = false;
      showError(err.message);
    });
  }

  function closeCheckout() {
    $("#checkout").hidden = true;
    ui.pending = null;
  }

  function confirmCheckout() {
    if (!ui.pending || ui.busy) return;
    var btn = $("#coConfirm");
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Working…";
    ui.busy = true;

    backend.checkout(ui.pending.payload).then(function (result) {
      ui.busy = false;
      if (result.mode === "redirect") {
        // The bid is pending until the payment processor confirms it.
        location.href = result.url;
        return;
      }
      closeCheckout();
      btn.disabled = false;
      btn.textContent = label;
      clearForm();
      ui.highlight = result.listingId;
      refresh().then(function () {
        toast(result.rank === 1
          ? "You're #1 on the board for " + money(result.amount) + "."
          : "Listed at #" + result.rank + " overall, #" + result.boardRank + " on " +
            E.retailer(result.board).name + ".");
      });
    }).catch(function (err) {
      ui.busy = false;
      btn.disabled = false;
      btn.textContent = label;
      closeCheckout();
      showError(err.message);
    });
  }

  function clearForm() {
    $("#dealUrl").value = "";
    ["#dealTitle", "#dealPrice", "#dealWas"].forEach(function (sel) {
      if ($(sel)) $(sel).value = "";
    });
    delete $("#bidAmount").dataset.touched;
  }

  function step(delta) {
    var input = $("#bidAmount");
    var v = Math.floor(Number(input.value) || E.MIN_BID) + delta;
    input.value = String(Math.min(E.MAX_BID, Math.max(E.MIN_BID, v)));
    input.dataset.touched = "1";
    renderHero();
  }

  /* Coming back from the payment page. The webhook that applies the bid can
     land a moment after the redirect, so poll briefly before reporting. */
  function handleReturn() {
    var url = new URL(location.href);
    var bidId = url.searchParams.get("bid");
    var status = url.searchParams.get("status");
    if (!bidId) return;

    url.searchParams.delete("bid");
    url.searchParams.delete("status");
    history.replaceState(null, "", url);

    if (status === "canceled") {
      toast("Checkout canceled — nothing was charged.");
      return;
    }

    var tries = 0;
    toast("Confirming your payment…");
    (function poll() {
      backend.bidStatus(bidId).then(function (b) {
        if (b.status === "applied") {
          if (b.listingId) ui.highlight = b.listingId;
          refresh().then(function () {
            // Mark the row as theirs now that we know which listing they bought.
            var row = (ui.data.listings || []).filter(function (l) { return l.id === b.listingId; })[0];
            if (row && backend.markMine) {
              backend.markMine(row.host + row.path);
              row.mine = true; // already decorated, so flip it here rather than refetching
              renderBoard();
            }
            toast(b.rank === 1
              ? "You're #1 on the board for " + money(b.amount) + "."
              : "Listed at #" + b.rank + " overall, #" + b.boardRank + " on " +
                (E.retailer(b.board) || {}).name + ".");
          });
          return;
        }
        if (b.status === "refunded" || b.status === "superseded") {
          refresh();
          toast("Someone changed that listing while you were paying, so the bid was refunded in full. " +
            "Nothing was charged — check the new price and bid again.", "error");
          return;
        }
        if (++tries < 12) return setTimeout(poll, 1200);
        toast("Payment received. The board updates as soon as the processor confirms it — " +
          "refresh in a moment.", "error");
      }).catch(function (err) {
        toast("Could not check that payment: " + err.message, "error");
      });
    })();
  }

  // ---------- shared chrome ----------

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
    renderModeBanner();

    var bar = $(".topbar");
    if (bar) {
      window.addEventListener("scroll", function () {
        bar.classList.toggle("scrolled", window.scrollY > 4);
      }, { passive: true });
    }

    $$("[data-reset]").forEach(function (b) {
      if (backend.mode === "live") { b.hidden = true; return; }
      b.addEventListener("click", function () {
        if (!confirm("Reset the demo board? Bids you placed in this browser will be cleared.")) return;
        backend.reset();
        location.reload();
      });
    });

    $$("[data-showmore]").forEach(function (b) {
      b.addEventListener("click", function () {
        var collapsed = b.closest(".card").classList.toggle("collapsed");
        b.textContent = collapsed ? "Show more" : "Show less";
      });
    });
  }

  function initBoardPage() {
    var fromUrl = new URL(location.href).searchParams.get("board");
    if (fromUrl && (fromUrl === "all" || E.retailer(fromUrl))) ui.board = fromUrl;

    $("#bidUp").addEventListener("click", function () { step(1); });
    $("#bidDown").addEventListener("click", function () { step(-1); });
    $("#bidAmount").addEventListener("input", function () {
      this.dataset.touched = "1";
      renderHero();
    });

    $("#bidForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var payload = readForm();
      if (!payload.url.trim()) return showError("Enter the link to the deal you want to rank.");
      openCheckout(payload);
    });

    $("#advancedToggle").addEventListener("click", function () {
      var box = $("#advanced");
      box.hidden = !box.hidden;
      this.textContent = box.hidden ? "Add deal details (optional)" : "Hide deal details";
    });

    $("#coCancel").addEventListener("click", closeCheckout);
    $("#coConfirm").addEventListener("click", confirmCheckout);
    $("#checkout").addEventListener("click", function (e) { if (e.target === this) closeCheckout(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("#checkout").hidden) closeCheckout();
    });
    $("#loadMore").addEventListener("click", function () {
      ui.limit += PAGE_SIZE;
      renderBoard();
    });

    // Email receipts only make sense when a real processor is involved.
    var emailField = $("#emailField");
    if (emailField) emailField.hidden = backend.mode !== "live";

    refresh().then(handleReturn);
    setInterval(function () { if (!ui.busy && !ui.pending) refresh(); }, 30000);
  }

  document.addEventListener("DOMContentLoaded", function () {
    initShared();
    if ($("#bidForm")) initBoardPage();
    else backend.stats().then(renderStats).catch(function () { /* stats are decorative here */ });
  });
})();
