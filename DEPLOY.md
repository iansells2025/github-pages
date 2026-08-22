# Deploying outdeals

Two pieces, deployed separately:

- **Front end** — static files in `deals/`, served by GitHub Pages.
- **API** — `server/`, a Node process with a SQLite file on a Fly.io volume.

Do the API first: the front end needs its URL.

Everything below runs in **Stripe test mode**, so you can put real bids through the
whole flow with a test card and no money moves. Switching to live keys is the last
section.

---

## 1. Deploy the API to Fly

Prerequisites: a [Fly.io](https://fly.io) account and `flyctl`
(`curl -L https://fly.io/install.sh | sh`), plus a Stripe account.

```bash
cd /path/to/github-pages          # the repo root, NOT server/
fly auth login
```

Pick an app name — it decides your URL (`https://<name>.fly.dev`) and must be
globally unique. Then edit **`fly.toml`**: set `app`, and set `API_BASE_URL` to
that same `https://<name>.fly.dev`.

```bash
fly apps create <your-app-name>

# The board lives in this volume. Same region as `primary_region` in fly.toml.
fly volumes create outdeals_data --region iad --size 1

# Secrets — never put these in fly.toml, it is committed.
fly secrets set \
  STRIPE_SECRET_KEY=sk_test_... \
  ADMIN_TOKEN="$(openssl rand -hex 32)"

fly deploy
```

`fly deploy` builds `server/Dockerfile` with the repo root as context — that is
why `fly.toml` lives at the root. Check it came up:

```bash
curl https://<your-app-name>.fly.dev/api/health
# {"ok":true,"payments":"stripe","webhook":false,"listings":35}
```

`"payments":"stripe"` means your key was read. `"webhook":false` is expected —
that is the next step, and **until it is done, payments will succeed and no bid
will ever be applied.** The server logs the same warning at boot.

### Traps

- **Do not scale past one machine.** The volume attaches to a single machine and
  SQLite takes a single writer. `fly launch` sometimes creates two; if you see
  two in `fly status`, `fly scale count 1`.
- **`fly launch` will offer to overwrite `fly.toml`.** Decline — the committed one
  has the volume mount, the health check and the single-machine deploy strategy.
- **The volume is not a backup.** See *Backups* below.

## 2. Point Stripe at it

In the Stripe dashboard → Developers → Webhooks → **Add endpoint**:

- URL: `https://<your-app-name>.fly.dev/api/webhook`
- Events: `checkout.session.completed`, `checkout.session.expired`,
  `charge.dispute.created`, `charge.refunded`

Copy the endpoint's **signing secret** (`whsec_...`) and give it to the app:

```bash
fly secrets set STRIPE_WEBHOOK_SECRET=whsec_...   # this restarts the machine
curl https://<your-app-name>.fly.dev/api/health   # "webhook":true
```

## 3. Publish the front end

Edit **`deals/config.js`**:

```js
window.OUTDEALS_CONFIG = { apiBase: "https://<your-app-name>.fly.dev" };
```

Then — and this is the step that actually makes it public — **merge the branch
into `main`**. GitHub Pages serves from `main`; the work currently sits on
`claude/product-deals-bidding-site-xdulbs`, so nothing is live until it lands.

Confirm in the repo's **Settings → Pages** that the source is `main`, folder `/`
(root). The board is then at:

```
https://iansells2025.github.io/github-pages/deals/
```

If your Pages URL differs from that, update `SITE_URL` and `ALLOWED_ORIGINS` in
`fly.toml` to match and redeploy — a mismatch means payers get returned to the
wrong place, and the browser is blocked from calling the API at all.

## 4. Test the real flow

Open the board. The demo-mode banner should be **gone** — if it is still there,
the page is not seeing `apiBase`.

Place a bid. At Stripe's checkout use test card `4242 4242 4242 4242`, any future
expiry, any CVC. You should be returned to the board and see your listing at the
rank you paid for within a second or two.

Worth testing deliberately, since these are the paths that carry money:

| Test | Expected |
| --- | --- |
| Bid $1 over the current #1 | Refused — taking #1 costs at least $5 more |
| Enter the same deal link again and raise | Charged only the difference |
| Cancel at Stripe's checkout | "Nothing was charged", board unchanged |
| Refund the payment in the Stripe dashboard | Listing rolls back or disappears within seconds |

Check what the server actually recorded:

```bash
curl https://<your-app-name>.fly.dev/api/stats
curl -H "x-admin-token: $ADMIN_TOKEN" https://<your-app-name>.fly.dev/api/admin/flagged
```

## 5. Going live

1. Swap in live keys: `fly secrets set STRIPE_SECRET_KEY=sk_live_...`
2. Add a **separate** webhook endpoint in live mode — the signing secret differs
   from the test one — and set `STRIPE_WEBHOOK_SECRET` to it.
3. Set `SEED_ON_EMPTY = "0"` in `fly.toml` so the board does not start with demo
   listings, and wipe the test board: `fly ssh console -C "rm /data/outdeals.db"`,
   then redeploy.
4. Have terms of service and a support contact reachable from the site before you
   take a real payment.

---

## Operations

**Logs.** `fly logs`. Webhook handling, reversals and link-check summaries all
log here.

**Backups.** The entire board is one file. A volume snapshot is not enough on its
own — take a copy off the machine:

```bash
fly ssh console -C "sqlite3 /data/outdeals.db '.backup /data/backup.db'"
fly sftp get /data/backup.db ./outdeals-backup-$(date +%F).db
```

Do this before every deploy until you trust it.

**Moderation.** Flagged listings (dead links, reversed payments) are queued, never
removed automatically:

```bash
curl -H "x-admin-token: $TOKEN" https://<app>.fly.dev/api/admin/flagged
curl -X POST -H "x-admin-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"amazon.com/dp/B0…","reason":"dead link"}' \
  https://<app>.fly.dev/api/admin/remove
```

**Cost.** One `shared-cpu-1x` 512MB machine plus a 1GB volume is a few dollars a
month at the time of writing. The machine is deliberately always-on so the
periodic link check and pending-bid expiry actually run.
