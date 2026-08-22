"use strict";

/* Link checking.

   Big retailers block datacentre traffic aggressively, so a non-200 is weak
   evidence: a 403 from Amazon usually means "you are a bot", not "this deal is
   gone". Only an unambiguous 404/410 is treated as dead, and even that flags
   the listing for a human rather than removing it — bids are non-refundable on
   removal, so getting this wrong costs someone real money.

   Classifications:
     ok       — 2xx
     dead     — 404/410, the only status that flags a listing
     blocked  — 401/403/429, the retailer refused the checker
     error    — timeout, DNS failure, 5xx: tells us nothing either way */

const CLASSIFY = {
  dead: [404, 410],
  blocked: [401, 403, 429]
};

function classify(status) {
  if (status >= 200 && status < 300) return "ok";
  if (CLASSIFY.dead.includes(status)) return "dead";
  if (CLASSIFY.blocked.includes(status)) return "blocked";
  return "error";
}

async function probe(url, opts) {
  const o = opts || {};
  const fetchImpl = o.fetch || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs || 10000);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Identify honestly; a retailer that wants to block this can.
        "User-Agent": o.userAgent || "outdeals-linkcheck/1.0 (+https://github.com/iansells2025/github-pages)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });
    return { status: classify(res.status), note: "HTTP " + res.status, httpStatus: res.status };
  } catch (err) {
    return { status: "error", note: err.name === "AbortError" ? "timed out" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/* Check the listings whose last check is stale, oldest and highest-bid first.
   Sequential on purpose: a handful of requests an hour is polite, and this is
   never on a request path. */
async function runCheck(store, opts) {
  const o = opts || {};
  const due = store.dueForCheck(o.limit || 25, o.staleMs);
  const summary = { checked: 0, ok: 0, dead: 0, blocked: 0, error: 0 };

  for (const listing of due) {
    const result = await probe(listing.url, o);
    store.recordCheck(listing.id, result.status, result.note);
    summary.checked++;
    summary[result.status]++;
    if (o.onResult) o.onResult(listing, result);
    if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
  }
  return summary;
}

module.exports = { probe, runCheck, classify };

if (require.main === module) {
  const { open } = require("./db.js");
  const { Store } = require("./store.js");
  const db = open(process.env.DB_PATH || "./data/outdeals.db");
  const store = new Store(db);
  runCheck(store, {
    limit: Number(process.env.CHECK_LIMIT || 50),
    delayMs: Number(process.env.CHECK_DELAY_MS || 1000),
    onResult: (l, r) => console.log([r.status.padEnd(7), l.url, r.note].join("  "))
  }).then((s) => {
    console.log("\nchecked " + s.checked + " — ok " + s.ok + ", dead " + s.dead +
      " (flagged for review), blocked " + s.blocked + ", error " + s.error);
    db.close();
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
