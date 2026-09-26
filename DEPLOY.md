# Deploying outdeals

Two pieces, deployed separately:

- **API** — `server/`, running as a Vercel Function backed by Postgres.
- **Front end** — static files in `deals/`, served by GitHub Pages.

Do the API first: the front end needs its URL.

Everything below runs in **Stripe test mode**, so you can put bids through the
whole flow with a test card and no money moves. Switching to live keys is the
last section.

> **Vercel plan.** The Hobby plan is for non-commercial use, and this site takes
> payments. Use a Pro project for anything beyond testing. Hobby also caps cron
> at one run per day, which is what `vercel.json` is set to.

---

## 1. Create the database

Any Postgres works — [Neon](https://neon.tech) has a free tier and is what the
connection settings assume. Vercel's own Postgres or Supabase are equivalent.

Copy the **pooled** connection string (Neon's host contains `-pooler`). This
matters: each serverless invocation opens its own connection, and a direct
endpoint will run out. It looks like:

```
postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/outdeals?sslmode=require
```

You do not need to create any tables. The app creates its schema on first boot.

## 2. Deploy the API

Import the repository at [vercel.com/new](https://vercel.com/new). Settings:

- **Framework preset:** Other
- **Root directory:** the repository root (not `server/`) — the function needs
  `shared/` too, and the root `package.json` is an npm workspace that installs
  the API's dependencies.
- **Build command:** leave empty. There is nothing to build.

Add environment variables (Settings → Environment Variables):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the pooled connection string from step 1 |
| `SITE_URL` | `https://iansells2025.github.io/github-pages/deals/index.html` |
| `ALLOWED_ORIGINS` | `https://iansells2025.github.io` |
| `STRIPE_SECRET_KEY` | `sk_test_…` |
| `ADMIN_TOKEN` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `SEED_ON_EMPTY` | `1` while testing, `0` before launch |

Deploy. You now have a URL — add one more variable and redeploy so Stripe's
return links point at the right place:

| Variable | Value |
| --- | --- |
| `API_BASE_URL` | `https://<your-project>.vercel.app` |

Check it:

```bash
curl https://<your-project>.vercel.app/api/health
# {"ok":true,"payments":"stripe","webhook":false,"listings":35}
```

`"payments":"stripe"` means the key was read. `"webhook":false` is expected —
that is the next step, and **until it is done, payments will succeed and no bid
will ever be applied.**

## 3. Point Stripe at it

Stripe dashboard → Developers → Webhooks → **Add endpoint**:

- URL: `https://<your-project>.vercel.app/api/webhook`
- Events: `checkout.session.completed`, `checkout.session.expired`,
  `charge.dispute.created`, `charge.refunded`

Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` and redeploy.
`/api/health` should then report `"webhook":true`.

Send a test event from the Stripe dashboard. A **400 saying the body was not
delivered raw** means the platform parsed it before the app saw it — the
function sets `bodyParser: false` for exactly this reason, so check that
`api/index.js` deployed intact.

## 4. Publish the front end

Edit **`deals/config.js`**:

```js
window.OUTDEALS_CONFIG = { apiBase: "https://<your-project>.vercel.app" };
```

Then **merge the branch into `main`**. GitHub Pages serves from `main`, so
nothing is public until it lands. Confirm in **Settings → Pages** that the
source is `main`, folder `/` (root). The board is then at:

```
https://iansells2025.github.io/github-pages/deals/
```

If your Pages URL differs, update `SITE_URL` and `ALLOWED_ORIGINS` to match and
redeploy — a mismatch sends payers back to the wrong place and blocks the
browser from calling the API at all.

## 5. Test the real flow

Open the board. The demo-mode banner should be **gone**; if it is still there,
the page is not seeing `apiBase`.

Place a bid. Use test card `4242 4242 4242 4242`, any future expiry, any CVC.
You should land back on the board at the rank you paid for within a second.

Worth testing deliberately, since these carry money:

| Test | Expected |
| --- | --- |
| Bid $1 over the current #1 | Refused — taking #1 costs at least $5 more |
| Enter the same deal link again and raise | Charged only the difference |
| Cancel at Stripe's checkout | "Nothing was charged", board unchanged |
| Refund the payment in the Stripe dashboard | Listing rolls back or disappears |

```bash
curl https://<your-project>.vercel.app/api/stats
curl -H "x-admin-token: $ADMIN_TOKEN" https://<your-project>.vercel.app/api/admin/flagged
```

## 6. Going live

1. Swap in live keys: `STRIPE_SECRET_KEY=sk_live_…`
2. Add a **separate** webhook endpoint in live mode — its signing secret differs
   from the test one — and update `STRIPE_WEBHOOK_SECRET`.
3. Set `SEED_ON_EMPTY=0` and clear the test board:
   `psql "$DATABASE_URL" -c "TRUNCATE listings, bids, activity, webhook_events, visits"`
4. Optionally set `MIGRATE_ON_BOOT=0` — the tables exist by now, and it saves a
   round trip on every cold start.
5. Have terms of service and a support contact reachable from the site before
   taking a real payment.

---

## Operations

**Logs.** Vercel dashboard → your project → Logs. Webhook handling, payment
reversals and cron summaries all appear there.

**Backups.** Whatever your Postgres provider gives you — Neon has
point-in-time restore. This is the main reason to be on a managed database
rather than a file on a disk.

**Scheduled work.** `vercel.json` calls `/api/cron/maintenance` daily, which
expires abandoned checkouts and link-checks a batch of listings. Run it by hand
with:

```bash
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" \
  https://<your-project>.vercel.app/api/cron/maintenance
```

**Moderation.** Flagged listings (dead links, reversed payments) are queued,
never removed automatically:

```bash
curl -H "x-admin-token: $TOKEN" https://<app>.vercel.app/api/admin/flagged
curl -X POST -H "x-admin-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"amazon.com/dp/B0…","reason":"dead link"}' \
  https://<app>.vercel.app/api/admin/remove
```

**Local development.** No database required — the app falls back to PGlite, an
embedded Postgres, so `npm run dev` works with nothing installed:

```bash
npm install
ALLOW_DEV_PAYMENTS=1 PGLITE_DIR=./server/data/pglite npm run dev
```

`ALLOW_DEV_PAYMENTS=1` replaces Stripe with a local stand-in that mimics the
same redirect-out / redirect-back flow. **It hands out spots for free — never
set it in production.** With neither Stripe keys nor that flag, `/api/checkout`
returns 503 rather than taking bids it cannot charge for.
