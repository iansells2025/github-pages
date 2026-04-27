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
