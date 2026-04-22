# Windsor.ai Sync

Auto-pulls weekly metrics from Windsor.ai connectors into the dashboard.

## Setup

1. In Windsor.ai, create a connector for each data source (GA4, Google Ads, Meta Ads, Stripe, HubSpot, etc.). Pick the **JSON / API** destination — Windsor will give you a unique URL per source that already includes your API key.

2. In this repo, go to **Settings → Secrets and variables → Actions** and add a secret for each connector you want to sync. Only set the ones you have; the script silently skips the rest.

   | Secret name             | Source              | Drives metrics                                |
   |-------------------------|---------------------|-----------------------------------------------|
   | `WINDSOR_GA4_URL`       | Google Analytics 4  | `organic`, `lpViews`, `lpSubs`                |
   | `WINDSOR_GOOGLE_ADS_URL`| Google Ads          | `paid`, `costs`                               |
   | `WINDSOR_META_ADS_URL`  | Meta Ads            | `paid`, `costs` (additive with Google Ads)    |
   | `WINDSOR_STRIPE_URL`    | Stripe              | `revenue`, `deposits`, `mrrBrands`, `mrrCreators` |
   | `WINDSOR_HUBSPOT_URL`   | HubSpot             | `mktgSent`, `mktgViewed`, `mktgClicked`       |
   | `WINDSOR_MAILCHIMP_URL` | Mailchimp           | `mktgSent`, `mktgViewed`, `mktgClicked`       |
   | `WINDSOR_KLAVIYO_URL`   | Klaviyo             | `mktgSent`, `mktgViewed`, `mktgClicked`       |
   | `WINDSOR_INSTANTLY_URL` | Instantly           | `coldSent`, `coldResp`                        |
   | `WINDSOR_APOLLO_URL`    | Apollo              | `coldSent`, `coldResp`                        |
   | `WINDSOR_SMARTLEAD_URL` | Smartlead           | `coldSent`, `coldResp`                        |
   | `WINDSOR_INTERNAL_URL`  | Custom internal API | `salesCalls`, `newClients`, `creators`, `brands`, `campaigns`, `gmv`, `videos` |

3. Verify the field names. The connector mapping in `windsor-config.mjs` uses common Windsor field names (e.g. `clicks`, `spend`, `emails_sent`), but Windsor lets you customize fields per source. Open one of your Windsor URLs in a browser, look at the JSON keys, and adjust `field:` values in the config if they differ.

4. Trigger a first run: **Actions → Sync Windsor.ai Marketing Data → Run workflow**. The job runs hourly thereafter (cron in `.github/workflows/sync-windsor.yml`). It writes `data/windsor.json` and commits it to the branch.

## How merging works

- The dashboard loads `data/windsor.json` on page load (read-only baseline).
- Manual entries from the **+ Add / Edit Week** modal override Windsor values **per metric per week** (so you can leave the synced columns untouched and only fill in metrics Windsor doesn't cover, like sales calls).
- Resetting clears manual entries only — Windsor data persists.

## Aggregation rules

Defined per metric in `windsor-config.mjs`:
- `sum` (default) — daily values are summed into the week
- `last` — the most recent daily value in the week (used for snapshot metrics like MRR)
- `max` — peak daily value in the week
