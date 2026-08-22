# outdeals

A pay-to-rank leaderboard for retail discounts — an [outbid.lol](https://outbid.lol)-style board
rebuilt for consumer products. **One board.** Amazon, Target, Walmart and Altamuta deals all file
into the same ranking, and every listing is tagged with the retailer board it came from plus its
rank within that board. The highest bid is #1. There is no algorithm.

Live at `<pages-url>/deals/`.

## The pieces

| Path | What it is |
| --- | --- |
| `deals/index.html` | Leaderboard, bid form, board filters, trending + activity |
| `deals/rules.html` · `about.html` | The model, written out |
| `deals/app.js` | UI: rendering, bidding, checkout, return-from-payment |
| `deals/backend.js` | Live API client, and the offline demo fallback behind one interface |
| `deals/config.js` | **Point this at your API server** to go live |
| `shared/engine.js` | The ranking rules — shared by the browser and the server |
| `shared/seed.js` | Demo listings a fresh board starts with |
| `server/` | Node + Express + Postgres + Stripe API ([README](../server/README.md)) |
| `api/index.js` | Vercel Function wrapper around that same app |

## Two modes

**Demo mode** (default, and what GitHub Pages serves, since Pages cannot host a backend): the
board lives in this browser's `localStorage` and the checkout takes no money. A banner says so.

**Live mode**: set `apiBase` in `deals/config.js` to your deployed API and the same page becomes
the real thing — submissions and ranking in Postgres, payments through Stripe Checkout, one board
shared by every visitor. [DEPLOY.md](../DEPLOY.md) has the runbook.

Both modes run the exact same rules engine, so ranking behaves identically either way.

## Ranking rules

- Whole US dollars, **$5 minimum**, **$999,999 maximum**, $1 increments.
- **One global ranking** by bid, descending. **Equal bids keep the order they were placed** — the
  older bid ranks higher.
- **Taking #1 costs at least $5 more** than the current top bid. Bidding less still lands you on
  the board at whatever rank the amount earns.
- Re-enter the same deal link to **raise your own listing**: at least $1 over your current bid,
  and you pay only the difference.
- Retailer tabs **filter** the board — they do not renumber it. A row filtered to Target still
  shows its real global rank alongside its Target rank.
- Listings are keyed by normalized host + path, so two products from one retailer never share a
  bid. Tracking parameters (`utm_*`, `tag`, `ref`, `gclid`, …) are stripped before matching.
- Only Amazon, Target, Walmart and Altamuta product links are accepted.

In live mode all of this is enforced server-side. The browser copy is for instant feedback only.

## Money

Bids are one-time payments for a position — no subscription, no cut of your sales. A bid is held
pending while the payer is at the payment page and joins the board only when the charge is
confirmed, so nothing ranks that was not paid for. If the same deal is listed or raised by
someone else mid-checkout, the payment is refunded in full rather than buying a spot at a price
the payer never agreed to.

## Moderation

A link checker (`npm run check-links` in `server/`) probes listing URLs and queues anything that
returns a definitive 404/410 for review. A retailer blocking the checker does **not** count as a
dead deal, and nothing is ever removed automatically — bids are non-refundable on removal, so a
false positive costs someone real money. Disputed or refunded payments reverse the bid behind
them and roll the listing back to what was actually paid for.

## Still missing for a real launch

- **Price verification.** The checker sees whether a URL resolves, not whether the claimed
  discount is honest. Catching an inflated "list price" needs per-retailer scraping or an
  affiliate product API.
- **Accounts**, if you ever want a listing raisable only by whoever created it. The current model
  deliberately lets anyone raise any listing.
- **Notifications.** Nothing tells a bidder they have been outranked.
