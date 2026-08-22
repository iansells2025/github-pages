# outdeals API

Submissions, ranking and payments for the [outdeals board](../deals). Node + Express +
SQLite + Stripe Checkout. No ORM, no build step.

The ranking rules live in [`../shared/engine.js`](../shared/engine.js) and are shared verbatim
with the browser, so the page and the server can never disagree about what a bid buys. The
server is the authority: every quote and checkout is re-validated here, and the front end
cannot talk it into a cheaper spot.

## Run it locally

```bash
cd server
npm install
cp .env.example .env          # optional; the defaults below work as-is
ALLOW_DEV_PAYMENTS=1 npm run dev
```

Then point the front end at it by editing `deals/config.js`:

```js
window.OUTDEALS_CONFIG = { apiBase: "http://localhost:8787" };
```

`ALLOW_DEV_PAYMENTS=1` swaps Stripe for a local stand-in that mimics the same redirect-out /
redirect-back flow so you can exercise the whole path without keys. **It hands out spots for
free — never set it in production.** With neither Stripe keys nor that flag, `/api/checkout`
returns 503 rather than taking bids it cannot charge for.

```bash
npm test      # 41 tests: rules engine, payment lifecycle, chargebacks, link checking
```

## Deploy

Any host that runs a Node process with a persistent disk — Fly.io, Render, Railway, a VPS.
There is a `Dockerfile` at the repo root of this folder's parent build context:

```bash
docker build -f server/Dockerfile -t outdeals-api .   # run from the repo root
docker run -p 8787:8787 -v outdeals-data:/data --env-file server/.env outdeals-api
```

SQLite keeps the whole board in one file (`DB_PATH`), so **mount a volume** — a container
filesystem loses every listing on redeploy. One process only: SQLite in WAL mode handles this
workload comfortably, but do not run several replicas against one file. Moving to Postgres
means rewriting `src/store.js` alone; nothing else touches SQL.

### Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port (default 8787) |
| `DB_PATH` | SQLite file (default `./data/outdeals.db`) |
| `SITE_URL` | Where payers are returned after checkout — the board's full URL |
| `API_BASE_URL` | This server's public origin |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist, or `*` |
| `TRUST_PROXY` | `1` behind a proxy, so rate limits see the real client IP |
| `STRIPE_SECRET_KEY` | Live/test secret key |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/webhook` |
| `ALLOW_DEV_PAYMENTS` | Local testing only — free spots, no charge |
| `SEED_ON_EMPTY` | Fill a brand-new database with the demo listings (default on) |
| `ADMIN_TOKEN` | Required by every `/api/admin/*` route |
| `CHECK_LINKS_INTERVAL_MIN` | Run a background link check every N minutes (0 = off) |

### Stripe setup

1. Add a webhook endpoint pointing at `https://your-api/api/webhook`.
2. Subscribe it to `checkout.session.completed`, `checkout.session.expired`,
   `charge.dispute.created` and `charge.refunded`.
3. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.

Without the webhook secret, payments succeed and **no bid is ever applied** — the server logs a
warning at boot. Locally: `stripe listen --forward-to localhost:8787/api/webhook`.

## API

| Route | What it does |
| --- | --- |
| `GET /api/health` | Status, payment mode, listing count |
| `GET /api/board?board=all\|amazon\|…&limit&offset` | The global ranking; each row carries `rank`, `boardRank`, `board`, `boardName`. Filtering keeps the global rank numbers |
| `GET /api/activity?limit` | Recent applied bids |
| `GET /api/stats` | Listings, money collected, distinct visitors, top listing |
| `POST /api/quote` | `{url, amount}` → charge, rank, board rank. Touches nothing |
| `POST /api/checkout` | `{url, amount, title?, priceNow?, priceWas?, email?}` → `{bidId, checkoutUrl}`. Creates a **pending** bid |
| `POST /api/webhook` | Stripe events. Applies, refunds or reverses a bid |
| `GET /api/bids/:id` | Status of one bid — what the page polls after checkout |
| `GET /api/admin/flagged` | The review queue — listings a check found gone, or whose payment was reversed |
| `POST /api/admin/unflag` | `{url}`. Clears a flag you have judged a false positive |
| `POST /api/admin/check` | `{limit}`. Runs a link check now |
| `POST /api/admin/remove` | `{url, reason}` with `x-admin-token`. Takes a listing off the board |

## How a bid becomes a rank

```
POST /api/quote      → priced against the board as it is right now
POST /api/checkout   → bid row written as `pending`, Stripe session created
   ↓ (payer is redirected to Stripe)
POST /api/webhook    → signature verified, event id recorded (replays are no-ops)
   ↓
applyPaidBid()       → one SQL transaction: upsert listing, log activity, mark bid `applied`
```

Two properties this buys:

- **Nothing ranks unpaid.** The board only ever reads `listings`, and rows land there inside
  `applyPaidBid`, which runs only from a verified webhook.
- **A payment buys the state it was quoted.** Each bid stores the `basis` — the listing's bid at
  quote time. If that changed while the payer was in checkout, the bid is marked `superseded`,
  refunded through Stripe, and never applied. Without this, two people raising the same listing
  concurrently could each pay a $1 difference and one would silently get a spot they underpaid
  for.

Webhook replays are idempotent via the `webhook_events` table, and `applyPaidBid` is a no-op on
an already-applied bid, so Stripe's at-least-once delivery cannot double-charge or double-apply.

## Chargebacks and refunds

A payment that comes back cannot keep buying a rank. On `charge.dispute.created` or
`charge.refunded`, the bid behind that payment intent is marked `reversed` and:

- if it is still the listing's current bid, the listing rolls back to its `basis` — the bid the
  previous, undisputed payment bought — or comes off the board entirely if that payment created it;
- if later bids stacked on top of it, unwinding is ambiguous, so the listing is **flagged for
  review** rather than silently rewritten.

Reversed bids stop counting toward revenue in `/api/stats`.

## Link checking

```bash
npm run check-links                     # or POST /api/admin/check, or CHECK_LINKS_INTERVAL_MIN
```

Big retailers block datacentre traffic, so a non-200 is weak evidence — a 403 from Amazon means
"you look like a bot", not "this deal is gone". Results are bucketed as `ok`, `dead` (404/410),
`blocked` (401/403/429) or `error` (timeout, 5xx, DNS), and **only `dead` flags a listing**. Even
then it goes to the review queue rather than being removed: bids are non-refundable on removal, so
a false positive costs someone real money.

```bash
curl -H "x-admin-token: $ADMIN_TOKEN" https://your-api/api/admin/flagged
```

## Moderation

```bash
curl -X POST https://your-api/api/admin/remove \
  -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"amazon.com/dp/B0…","reason":"dead link"}'
```

Removal is a soft delete (`status='removed'`), so the payment history behind a listing survives.

## What is deliberately not here

- **No accounts.** A listing is identified by its URL and anyone can raise it, which is how the
  ranking model works. The payer gets an `ownerToken` so their own browser can mark the row.
- **No price verification.** The checker tells you whether a URL still resolves, not whether the
  listing's claimed price is honest. Catching an inflated "list price" needs per-retailer
  scraping or an affiliate product API, and stays a moderation job until then.
- **No automatic removals.** Everything the checker and the dispute handler find lands in the
  review queue for a human. Deliberate: bids are non-refundable on removal.
- **In-memory rate limiting only.** Fine for one process; put a real limiter at the edge if this
  gets attention.
- **No email.** Receipts come from Stripe; nothing notifies a bidder that they were outranked.
