/*
 * Windsor.ai connector configuration.
 *
 * Each connector pulls a Windsor JSON URL from an env var (set as a GitHub
 * Actions secret), then maps that connector's fields onto dashboard metrics.
 *
 * Field names below are PLACEHOLDERS based on common Windsor schemas.
 * Visit your Windsor URL once in a browser to confirm the actual field names
 * for your account, then tweak `field` values accordingly.
 *
 * `agg` options: 'sum' (default — sums daily values into the week)
 *                'last' (takes the most recent value in the week — use for MRR-style metrics)
 *                'max'  (peak value in the week)
 */

export const CONNECTORS = [
  {
    name: 'ga4',
    envUrl: 'WINDSOR_GA4_URL',
    dateField: 'date',
    metrics: {
      organic: { field: 'organic_sessions', agg: 'sum' },
      lpViews: { field: 'landing_page_views', agg: 'sum' },
      lpSubs:  { field: 'form_submissions',   agg: 'sum' },
    },
  },
  {
    name: 'google_ads',
    envUrl: 'WINDSOR_GOOGLE_ADS_URL',
    dateField: 'date',
    metrics: {
      paid:  { field: 'clicks', agg: 'sum' },
      costs: { field: 'spend',  agg: 'sum' },
    },
  },
  {
    name: 'meta_ads',
    envUrl: 'WINDSOR_META_ADS_URL',
    dateField: 'date',
    metrics: {
      // Adds onto Google Ads totals via additive merge across connectors.
      paid:  { field: 'clicks', agg: 'sum' },
      costs: { field: 'spend',  agg: 'sum' },
    },
  },
  {
    name: 'stripe',
    envUrl: 'WINDSOR_STRIPE_URL',
    dateField: 'date',
    metrics: {
      revenue:     { field: 'gross_volume',   agg: 'sum' },
      deposits:    { field: 'net_volume',     agg: 'sum' },
      mrrBrands:   { field: 'mrr_brands',     agg: 'last' },
      mrrCreators: { field: 'mrr_creators',   agg: 'last' },
    },
  },
  {
    name: 'hubspot',
    envUrl: 'WINDSOR_HUBSPOT_URL',
    dateField: 'date',
    metrics: {
      mktgSent:    { field: 'emails_sent',    agg: 'sum' },
      mktgViewed:  { field: 'emails_opened',  agg: 'sum' },
      mktgClicked: { field: 'emails_clicked', agg: 'sum' },
    },
  },
  {
    name: 'mailchimp',
    envUrl: 'WINDSOR_MAILCHIMP_URL',
    dateField: 'date',
    metrics: {
      mktgSent:    { field: 'emails_sent',    agg: 'sum' },
      mktgViewed:  { field: 'opens',          agg: 'sum' },
      mktgClicked: { field: 'clicks',         agg: 'sum' },
    },
  },
  {
    name: 'klaviyo',
    envUrl: 'WINDSOR_KLAVIYO_URL',
    dateField: 'date',
    metrics: {
      mktgSent:    { field: 'delivered',  agg: 'sum' },
      mktgViewed:  { field: 'opens',      agg: 'sum' },
      mktgClicked: { field: 'clicks',     agg: 'sum' },
    },
  },
  {
    name: 'instantly',
    envUrl: 'WINDSOR_INSTANTLY_URL',
    dateField: 'date',
    metrics: {
      coldSent: { field: 'emails_sent', agg: 'sum' },
      coldResp: { field: 'replies',     agg: 'sum' },
    },
  },
  {
    name: 'apollo',
    envUrl: 'WINDSOR_APOLLO_URL',
    dateField: 'date',
    metrics: {
      coldSent: { field: 'emails_sent', agg: 'sum' },
      coldResp: { field: 'replies',     agg: 'sum' },
    },
  },
  {
    name: 'smartlead',
    envUrl: 'WINDSOR_SMARTLEAD_URL',
    dateField: 'date',
    metrics: {
      coldSent: { field: 'sent',    agg: 'sum' },
      coldResp: { field: 'replies', agg: 'sum' },
    },
  },
  {
    // Internal app data — point this at a Windsor "Custom API" / webhook source
    // that returns one row per day with these fields.
    name: 'internal',
    envUrl: 'WINDSOR_INTERNAL_URL',
    dateField: 'date',
    metrics: {
      salesCalls: { field: 'sales_calls',          agg: 'sum' },
      newClients: { field: 'new_paying_clients',   agg: 'sum' },
      creators:   { field: 'creators_signed_up',   agg: 'sum' },
      brands:     { field: 'brands_signed_up',     agg: 'sum' },
      campaigns:  { field: 'campaigns_over_1k',    agg: 'sum' },
      gmv:        { field: 'creator_gmv',          agg: 'sum' },
      videos:     { field: 'shop_videos_produced', agg: 'sum' },
    },
  },
];
