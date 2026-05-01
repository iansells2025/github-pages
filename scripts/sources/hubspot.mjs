/*
 * HubSpot direct-API fetcher.
 *
 * Lists marketing emails published in the last LOOKBACK_WEEKS, sums each
 * email's sent/opened/clicked stats per ISO week, and returns one row per
 * week with mktgSent/mktgViewed/mktgClicked.
 *
 * Auth: HubSpot Private App access token via Bearer header.
 * Required scopes (read-only):
 *   - content                  (legacy CMS read — covers marketing emails on most accounts)
 *   - marketing-email           (newer scope name; tick if available)
 *   - automation                (optional, if you want automated email stats)
 *
 * If the token lacks scope, HubSpot returns 403 with a clear message which
 * we surface to the workflow log.
 */

const HUBSPOT_BASE = 'https://api.hubapi.com';
const LOOKBACK_WEEKS = 13;

function authHeader() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error('HUBSPOT_PRIVATE_APP_TOKEN not set');
  return `Bearer ${token}`;
}

function toMondayISO(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function lookbackBoundsISO() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - LOOKBACK_WEEKS * 7);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

async function hubspotGet(path, params = {}) {
  const url = new URL(`${HUBSPOT_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/* List marketing emails published in the lookback window. v3 API returns
   summary stats inline when `includeStats=true` is requested. */
async function listMarketingEmails() {
  const { startISO, endISO } = lookbackBoundsISO();
  const all = [];
  let after = null;
  for (let page = 0; page < 50; page++) {
    const params = {
      limit: 100,
      includeStats: true,
      // Filter by publish/send window. HubSpot accepts ISO8601.
      publishedAt__gte: startISO,
      publishedAt__lte: endISO,
    };
    if (after) params.after = after;
    const json = await hubspotGet('/marketing/v3/emails/', params);
    if (Array.isArray(json.results)) all.push(...json.results);
    after = json.paging?.next?.after;
    if (!after) break;
  }
  return all;
}

function emailStats(email) {
  // HubSpot v3 returns stats either at top-level (counters) or under .stats.
  const s = email.stats?.counters || email.stats || email.statistics?.counters || {};
  return {
    sent:    Number(s.sent ?? s.processed ?? s.delivered ?? 0) || 0,
    opened:  Number(s.open ?? s.opened ?? s.uniqueOpen ?? 0) || 0,
    clicked: Number(s.click ?? s.clicked ?? s.uniqueClick ?? 0) || 0,
  };
}

function emailSendDate(email) {
  return email.publishDate
      ?? email.publishedAt
      ?? email.lastUpdated
      ?? email.updated
      ?? email.created;
}

export async function fetchWeeklyMetrics() {
  console.log('[hubspot] listing marketing emails…');
  const emails = await listMarketingEmails();
  console.log(`[hubspot] found ${emails.length} emails in lookback window`);

  const byWeek = new Map();
  function bucket(weekStart) {
    if (!byWeek.has(weekStart)) {
      byWeek.set(weekStart, { weekStart, mktgSent: 0, mktgViewed: 0, mktgClicked: 0 });
    }
    return byWeek.get(weekStart);
  }

  let withStats = 0;
  for (const e of emails) {
    const ws = toMondayISO(emailSendDate(e));
    if (!ws) continue;
    const s = emailStats(e);
    if (s.sent === 0 && s.opened === 0 && s.clicked === 0) continue;
    withStats++;
    const b = bucket(ws);
    b.mktgSent    += s.sent;
    b.mktgViewed  += s.opened;
    b.mktgClicked += s.clicked;
  }
  console.log(`[hubspot] emails with stats: ${withStats}`);

  const weeks = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return {
    weeks,
    diagnostics: {
      emailsListed: emails.length,
      emailsWithStats: withStats,
      sampleEmailKeys: emails.length > 0 ? Object.keys(emails[0]).slice(0, 20) : [],
      sampleStatKeys: emails.length > 0 ? Object.keys(emails[0].stats?.counters || emails[0].stats || {}).slice(0, 20) : [],
    },
  };
}
