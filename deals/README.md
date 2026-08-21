# outdeals

A pay-to-rank leaderboard for retail discounts — an [outbid.lol](https://outbid.lol)-style board
rebuilt for consumer products instead of startups. Four separate boards: **Amazon**, **Target**,
**Walmart** and **Altamuta**. The highest bid on a board ranks #1. There is no algorithm.

Live at `<pages-url>/deals/`.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Leaderboard, bid form, board tabs, trending + activity feeds |
| `rules.html` | Ranking, listing, removal and payment rules |
| `about.html` | What the project is, plus live counters off the board state |
| `app.js` | URL normalization, the ranking/rules engine, rendering, checkout |
| `seed.js` | The demo listings the board starts with |
| `styles.css` | Light + dark theme |

No build step, no dependencies, no framework — drop the folder on any static host.

## Ranking rules

- Whole US dollars, **$5 minimum**, **$999,999 maximum**, $1 increments.
- Rank is bid, descending. **Equal bids keep the order they were placed** — the older bid ranks higher.
- **Taking #1 costs at least $5 more** than that board's current top bid. Bidding less still lands you
  on the board at whatever rank the amount earns.
- Re-enter the same deal link to **raise your own listing**: at least $1 over your current bid, and you
  pay only the difference.
- Listings are keyed by normalized host + path, so two products from one retailer never share a bid.
  Tracking parameters (`utm_*`, `tag`, `ref`, `gclid`, …) are stripped before matching.
- Only Amazon, Target, Walmart and Altamuta product links are accepted.

## What is real and what is not

The leaderboard, the ranking rules, the raise-only-pay-the-difference pricing, URL normalization and the
activity feed all work for real. Everything else is a front-end demo:

- **State is `localStorage`.** Bids are per-browser and private to whoever placed them. There is no server
  and no shared board.
- **Checkout is simulated.** No card is collected and no payment is taken.
- **Counters are synthetic.** Visitors, online count and clicks/hour are derived from board state, not analytics.

Making this a live product means adding a backend (listings + bids in a database), a real payment processor
for the bid charges, and moderation for dead links and inflated list prices. The rules engine in `app.js`
(`validate` / `commit`) is the part that would move server-side unchanged.
