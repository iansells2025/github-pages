/*
 * Windsor.ai blended-endpoint configuration.
 *
 * The Windsor "Blended" / `connectors.windsor.ai/all` endpoint returns rows
 * from every connected source in a single feed, distinguished by a
 * `data_source` field. The sync script fetches once and routes rows to the
 * right metric mapping based on that field.
 *
 * Field names below are placeholders based on common Windsor schemas. If
 * numbers look off after a sync, open the workflow log — it prints the
 * sample row keys and discovered Data Source values — and adjust below.
 *
 * agg options:
 *   'sum'  (default — daily values are summed into the week)
 *   'last' (latest daily value in the week — use for snapshot metrics like MRR)
 *   'max'  (peak daily value in the week)
 */

export const DATE_FIELD = 'date';
export const SOURCE_FIELD = 'data_source';

// Keys are the values that appear in the Windsor `data_source` column.
// Anything not listed here is logged and skipped — add a mapping as needed.
export const BLENDED_SOURCES = {
  ga4: {
    label: 'Google Analytics 4',
    metrics: {
      organic: { field: 'organic_sessions',    agg: 'sum' },
      lpViews: { field: 'landing_page_views',  agg: 'sum' },
      lpSubs:  { field: 'form_submissions',    agg: 'sum' },
    },
  },
  googleanalytics: {
    label: 'Google Analytics (Universal)',
    metrics: {
      organic: { field: 'organic_sessions',    agg: 'sum' },
      lpViews: { field: 'landing_page_views',  agg: 'sum' },
    },
  },
  searchconsole: {
    label: 'Google Search Console',
    metrics: {
      organic: { field: 'clicks', agg: 'sum' },
    },
  },
  googleads: {
    label: 'Google Ads',
    metrics: {
      paid:  { field: 'clicks', agg: 'sum' },
      costs: { field: 'spend',  agg: 'sum' },
    },
  },
  facebookads: {
    label: 'Meta Ads',
    metrics: {
      paid:  { field: 'clicks', agg: 'sum' },
      costs: { field: 'spend',  agg: 'sum' },
    },
  },
  facebook: {
    label: 'Meta Ads (alt key)',
    metrics: {
      paid:  { field: 'clicks', agg: 'sum' },
      costs: { field: 'spend',  agg: 'sum' },
    },
  },
  instagram: {
    label: 'Instagram (organic — followers count)',
    metrics: {
      // Tracked but not currently surfaced on the dashboard. Add a new
      // metric like `igFollowers` here + a chart card if needed.
      // followers_count is a snapshot, not a daily delta — use 'last'.
      // Left empty for now so Instagram rows don't pollute paid/costs.
    },
  },
  tiktokads: {
    label: 'TikTok Ads',
    metrics: {
      paid:  { field: 'clicks', agg: 'sum' },
      costs: { field: 'spend',  agg: 'sum' },
    },
  },
  linkedinads: {
    label: 'LinkedIn Ads',
    metrics: {
      paid:  { field: 'clicks', agg: 'sum' },
      costs: { field: 'spend',  agg: 'sum' },
    },
  },
  bingads: {
    label: 'Microsoft Ads',
    metrics: {
      paid:  { field: 'clicks', agg: 'sum' },
      costs: { field: 'spend',  agg: 'sum' },
    },
  },
  stripe: {
    label: 'Stripe',
    metrics: {
      revenue:     { field: 'gross_volume',  agg: 'sum' },
      deposits:    { field: 'net_volume',    agg: 'sum' },
      mrrBrands:   { field: 'mrr_brands',    agg: 'last' },
      mrrCreators: { field: 'mrr_creators',  agg: 'last' },
    },
  },
  hubspot: {
    label: 'HubSpot',
    metrics: {
      mktgSent:    { field: 'emails_sent',    agg: 'sum' },
      mktgViewed:  { field: 'emails_opened',  agg: 'sum' },
      mktgClicked: { field: 'emails_clicked', agg: 'sum' },
    },
  },
  mailchimp: {
    label: 'Mailchimp',
    metrics: {
      mktgSent:    { field: 'emails_sent', agg: 'sum' },
      mktgViewed:  { field: 'opens',       agg: 'sum' },
      mktgClicked: { field: 'clicks',      agg: 'sum' },
    },
  },
  klaviyo: {
    label: 'Klaviyo',
    metrics: {
      mktgSent:    { field: 'delivered', agg: 'sum' },
      mktgViewed:  { field: 'opens',     agg: 'sum' },
      mktgClicked: { field: 'clicks',    agg: 'sum' },
    },
  },
  instantly: {
    label: 'Instantly',
    metrics: {
      coldSent: { field: 'emails_sent', agg: 'sum' },
      coldResp: { field: 'replies',     agg: 'sum' },
    },
  },
  apollo: {
    label: 'Apollo',
    metrics: {
      coldSent: { field: 'emails_sent', agg: 'sum' },
      coldResp: { field: 'replies',     agg: 'sum' },
    },
  },
  smartlead: {
    label: 'Smartlead',
    metrics: {
      coldSent: { field: 'sent',    agg: 'sum' },
      coldResp: { field: 'replies', agg: 'sum' },
    },
  },
};
