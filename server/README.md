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
npm test      # 29 tests: rules engine + full payment lifecycle over the real routes
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
| `ADMIN_TOKEN` | Required by `POST /api/admin/remove` |

### Stripe setup

1. Add a webhook endpoint pointing at `https://your-api/api/webhook`.
2. Subscribe it to `checkout.session.completed` and `checkout.session.expired`.
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
| `POST /api/webhook` | Stripe events. Applies or refunds a paid bid |
| `GET /api/bids/:id` | Status of one bid — what the page polls after checkout |
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
- **No automatic link checking.** Dead links and inflated list prices are caught by moderation,
  not code. A crawler that verifies price and availability is the obvious next piece.
- **No fraud/chargeback handling.** `charge.dispute.created` is not subscribed to; a disputed
  payment leaves its listing on the board until someone removes it by hand.
- **In-memory rate limiting only.** Fine for one process; put a real limiter at the edge if this
  gets attention.
