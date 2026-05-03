# Sync Pipelines

The dashboard is fed by two parallel sync pipelines, both running hourly via
GitHub Actions:

1. **Windsor.ai blended sync** (`sync-windsor.mjs`) — one URL covering ad
   platforms, search console, and other connected sources.
2. **Direct-API sync** (`sync-direct.mjs`) — per-source fetchers that hit each
   platform's REST API directly, bypassing middleware. Best for sources
   where Windsor's schema is awkward (Stripe revenue/MRR, HubSpot email
   stats, GA4 segments, etc.).

The dashboard merges both feeds with the priority:
**manual entries > direct API > Windsor**, applied per metric per week.

---

# Direct API Sync

Per-source fetchers under `scripts/sources/`. Each module exports
`fetchWeeklyMetrics()` returning `{ weeks: [...], diagnostics: {...} }`.
Sources without a configured secret are skipped.

## Configured sources

### Stripe (`scripts/sources/stripe.mjs`)

- **Secret name:** `STRIPE_API_KEY`
- **Type:** Restricted API key (Developers → API keys → Create restricted key)
- **Required permissions (read-only):** `Charges`, `Balance`, `Customers`,
  `Subscriptions`. Use `rk_live_…` (or `rk_test_…` for testing) — never the
  full secret key.
- **Metrics produced:**
  - `revenue` — sum of successful, non-refunded charges per week (gross
    volume, USD).
  - `deposits` — sum of paid payouts per week (by `arrival_date`).
  - `mrrBrands` / `mrrCreators` — current MRR snapshot, attached to the
    latest week. Split is based on
    `subscription.metadata.account_type === 'brand' | 'creator'`. If you
    don't tag subscriptions, all MRR rolls into `mrrBrands` (look for
    `mrrUnclassified` in the diagnostics to see how much is unclassified).

### HubSpot (`scripts/sources/hubspot.mjs`)

- **Secret name:** `HUBSPOT_PRIVATE_APP_TOKEN`
- **Type:** Private App access token (Settings → Integrations → Private Apps
  → Create private app → **Auth tab** → access token)
- **Required scopes (read-only)** — each fetcher fails independently if its
  scope is missing, so wire them up incrementally:
  - `content` *or* `marketing-email` (marketing email stats)
  - `crm.objects.contacts.read` (new leads)
  - `crm.objects.companies.read` (new companies)
  - `crm.objects.deals.read` (deals closed-won → new clients)
  - `crm.objects.owners.read` (rep name resolution for the per-rep breakdown)
  - `cms.knowledge_base.articles.read` *or* `content` (landing pages — list only for now)
- **Metrics produced:**
  - `mktgSent` / `mktgViewed` / `mktgClicked` — marketing email totals per week.
  - `newLeads` — Contacts created per week.
  - `newCompanies` — Companies created per week.
  - `newClients` — Deals where `hs_is_closed_won = true`, by `closedate`.
  - `newClientsByOwnerName` — same, broken out by HubSpot owner name. The
    dashboard matches owner names against the manual rep list to populate
    the per-rep stacked-bar charts.
  - `lpViews` / `lpSubs` — pending Analytics scope; landing pages are
    listed but not yet aggregated.

## Adding a new source

1. Create `scripts/sources/<name>.mjs` exporting
   `async function fetchWeeklyMetrics()`. Return
   `{ weeks: [{ weekStart: 'YYYY-MM-DD', metricA: …, metricB: … }],
     diagnostics: {…} }`.
2. Add an entry to the `SOURCES` array in `scripts/sync-direct.mjs`.
3. Add the secret env var to `.github/workflows/sync-direct.yml`.
4. Add the secret in repo settings.

The coordinator skips any source whose env var is unset, so you can wire
up sources incrementally.

---

# Windsor.ai Sync

Auto-pulls weekly metrics from Windsor.ai into the dashboard via a single
blended endpoint that covers every connected data source.

## Setup

1. **In Windsor.ai**, finish onboarding so all the connectors you care about
   (GA4, Google Ads, Meta Ads, Stripe, HubSpot, etc.) are connected.

2. **Get the blended URL**: in Windsor's data preview, copy the
   `https://connectors.windsor.ai/all?api_key=...&fields=...` URL at the top
   of the table. Make sure the **Fields** panel includes (at minimum):
   - `Date`, `Data Source`
   - Whatever metric fields the dashboard cares about: `Clicks`, `Spend`,
     `Sessions`, `Page Views`, `Form Submissions`, `Emails Sent / Opens /
     Clicks`, `Replies`, `Gross Volume`, `Net Volume`, `MRR`, etc. (extra
     fields don't hurt — the script ignores anything not mapped).

3. **In this repo**, go to **Settings → Secrets and variables → Actions** and
   add one secret:

   | Secret name           | Value                                               |
   |-----------------------|-----------------------------------------------------|
   | `WINDSOR_BLENDED_URL` | The full Windsor blended URL including the API key |

4. **Trigger the first sync**: Actions → "Sync Windsor.ai Marketing Data" →
   **Run workflow**. The job runs hourly thereafter (cron in
   `.github/workflows/sync-windsor.yml`). It writes `data/windsor.json` and
   commits it to `main`.

## How merging works

- The dashboard loads `data/windsor.json` on page load (read-only baseline).
- Manual entries from the **+ Add / Edit Week** modal override Windsor values
  **per metric per week** (so you can leave the synced columns untouched and
  only fill in metrics Windsor doesn't cover, like sales calls).
- Resetting clears manual entries only — Windsor data persists.

## Per-source mapping

`scripts/windsor-config.mjs` maps Windsor `data_source` values to dashboard
metrics. Common defaults are included for GA4, Google/Meta/TikTok/LinkedIn/Bing
Ads, Search Console, Stripe, HubSpot, Mailchimp, Klaviyo, Instantly, Apollo,
and Smartlead.

When the script runs, it logs:
- A sample row's keys (so you can confirm field names like `clicks` vs `Clicks`)
- The distinct `Data Source` values it discovered, with row counts
- Which sources are mapped vs unmapped (unmapped are skipped)

If you see `⚠ no mapping (skipped)` for a source you care about, add an entry
to `BLENDED_SOURCES` in `windsor-config.mjs`.

## Aggregation rules

Defined per metric in `windsor-config.mjs`:
- `sum` (default) — daily values are summed into the week
- `last` — the most recent daily value in the week (used for snapshot metrics like MRR)
- `max` — peak daily value in the week

When multiple sources contribute to the same dashboard metric (e.g. paid
clicks from Google Ads + Meta Ads + TikTok Ads), the values are added
together. For `last`-type metrics (MRR), the most recent source value wins.

## Output shape

`data/windsor.json` contains:

```jsonc
{
  "updatedAt": "...",
  "source": "windsor.ai",
  "endpoint": "blended",
  "weeks":           [ { "weekStart": "...", "paid": ..., "costs": ..., ... } ],
  "weeksBySource":   { "2026-01-06": { "googleads": { "paid": 240, "costs": 1200 }, "facebookads": { ... } } },
  "sourcesDiscovered": [ "ga4", "googleads", ... ],
  "sourcesMapped":     [ ... ],
  "sourcesUnmapped":   [ ... ],
  "sampleRowKeys":     [ "date", "data_source", "clicks", ... ],
  "rowCount": 1234,
  "usableRowCount": 1100
}
```

The dashboard reads `weeks` for charts and `weeksBySource` for the
per-source audit drawer (when wired up).
