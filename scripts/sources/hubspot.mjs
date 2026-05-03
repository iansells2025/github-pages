/*
 * HubSpot direct-API fetcher.
 *
 * Aggregates the following per ISO week (Monday-anchored):
 *   - Marketing email stats (mktgSent, mktgViewed, mktgClicked) — from
 *     /marketing/v3/emails/ + per-email statistics
 *   - newLeads      — Contacts created (CRM)
 *   - newCompanies  — Companies created (CRM)
 *   - newClients    — Deals where hs_is_closed_won is set, by closedate
 *   - lpViews/lpSubs (best-effort) — Landing pages from CMS API
 *
 * Also writes a per-rep breakdown of newClients keyed by HubSpot owner name.
 * Frontend matches owner names against the dashboard's manual rep list to
 * populate the existing per-rep stacked-bar charts.
 *
 * Auth: HubSpot Private App access token via Bearer header.
 *
 * Required scopes (read-only). Each is independent — if a scope is
 * missing, the corresponding fetcher fails silently and is reported in
 * diagnostics.callErrors:
 *   - content                          (legacy CMS read — covers marketing emails)
 *   - marketing-email                  (newer scope name; tick if available)
 *   - crm.objects.contacts.read        (newLeads)
 *   - crm.objects.companies.read       (newCompanies)
 *   - crm.objects.deals.read           (newClients)
 *   - crm.objects.owners.read          (rep name resolution)
 *   - cms.knowledge_base.articles.read OR content (landing pages)
 */

const HUBSPOT_BASE = 'https://api.hubapi.com';
const LOOKBACK_WEEKS = 13;
const LOOKBACK_MS = LOOKBACK_WEEKS * 7 * 86400000;

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

function lookbackCutoff() {
  return new Date(Date.now() - LOOKBACK_MS);
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

async function hubspotPost(path, body) {
  // HubSpot Search API has a per-second limit (~4 req/s for private apps).
  // Retry transient 429s with exponential backoff so a brief burst doesn't
  // sink the whole run.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${HUBSPOT_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const wait = 500 * Math.pow(2, attempt) + Math.random() * 250;
      console.warn(`[hubspot] 429 on ${path} — backing off ${Math.round(wait)}ms (attempt ${attempt + 1}/5)`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HubSpot POST ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }
  throw new Error(`HubSpot POST ${path}: gave up after 5 retries on 429`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- Marketing emails ---------- */

async function listMarketingEmails() {
  const all = [];
  let after = null;
  for (let page = 0; page < 50; page++) {
    const params = { limit: 100, includeStats: true, sort: '-publishDate' };
    if (after) params.after = after;
    const json = await hubspotGet('/marketing/v3/emails/', params);
    if (Array.isArray(json.results)) all.push(...json.results);
    after = json.paging?.next?.after;
    if (!after) break;
  }
  return all;
}

function emailSendDate(email) {
  return email.publishDate ?? email.publishedAt ?? email.lastUpdated ?? email.updated ?? email.created;
}

function emailStats(email) {
  const s = email.stats?.counters || email.stats || email.statistics?.counters || {};
  return {
    sent:    Number(s.sent ?? s.processed ?? s.delivered ?? 0) || 0,
    opened:  Number(s.open ?? s.opened ?? s.uniqueOpen ?? 0) || 0,
    clicked: Number(s.click ?? s.clicked ?? s.uniqueClick ?? 0) || 0,
  };
}

async function fetchEmailStats() {
  const all = await listMarketingEmails();
  const cutoff = lookbackCutoff();
  const inWindow = all.filter(e => {
    const ts = emailSendDate(e);
    if (!ts) return false;
    const d = new Date(ts);
    return !Number.isNaN(d.getTime()) && d >= cutoff;
  });
  console.log(`[hubspot] emails: ${all.length} total · ${inWindow.length} in window`);

  const byWeek = {};
  let withStats = 0;
  for (const e of inWindow) {
    const ws = toMondayISO(emailSendDate(e));
    if (!ws) continue;
    const s = emailStats(e);
    if (s.sent === 0 && s.opened === 0 && s.clicked === 0) continue;
    withStats++;
    if (!byWeek[ws]) byWeek[ws] = { mktgSent: 0, mktgViewed: 0, mktgClicked: 0 };
    byWeek[ws].mktgSent    += s.sent;
    byWeek[ws].mktgViewed  += s.opened;
    byWeek[ws].mktgClicked += s.clicked;
  }
  return {
    byWeek,
    diagnostics: {
      emailsTotal: all.length,
      emailsInLookback: inWindow.length,
      emailsWithStats: withStats,
      sampleStatKeys: all.length > 0 ? Object.keys(all[0].stats?.counters || all[0].stats || {}).slice(0, 16) : [],
    },
  };
}

/* ---------- CRM Search helper ---------- */

async function searchAll(objectType, body, capPages = 50) {
  // Uses /crm/v3/objects/{type}/search. Pages of up to 100, capped to 5k.
  // Pause briefly between pages to stay under the per-second Search API limit.
  const items = [];
  let after = undefined;
  for (let page = 0; page < capPages; page++) {
    if (page > 0) await sleep(300);
    const json = await hubspotPost(`/crm/v3/objects/${objectType}/search`, {
      ...body,
      limit: 100,
      after,
    });
    if (Array.isArray(json.results)) items.push(...json.results);
    after = json.paging?.next?.after;
    if (!after) break;
  }
  return items;
}

/* ---------- Owners (rep name resolution) ---------- */

async function fetchOwnersMap() {
  const items = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const params = { limit: 100 };
    if (after) params.after = after;
    const json = await hubspotGet('/crm/v3/owners/', params);
    if (Array.isArray(json.results)) items.push(...json.results);
    after = json.paging?.next?.after;
    if (!after) break;
  }
  const byId = {};
  for (const o of items) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(' ').trim() || o.email || `Owner ${o.id}`;
    byId[String(o.id)] = name;
  }
  console.log(`[hubspot] owners: ${items.length}`);
  return byId;
}

/* ---------- Contacts (newLeads) ---------- */

async function fetchContactsByWeek() {
  const cutoffMs = Date.now() - LOOKBACK_MS;
  const items = await searchAll('contacts', {
    filterGroups: [{
      filters: [{
        propertyName: 'createdate',
        operator: 'GTE',
        value: String(cutoffMs),
      }],
    }],
    properties: ['createdate'],
    sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
  });
  console.log(`[hubspot] contacts created in window: ${items.length}`);
  const byWeek = {};
  for (const it of items) {
    const ws = toMondayISO(it.properties?.createdate || it.createdAt);
    if (!ws) continue;
    if (!byWeek[ws]) byWeek[ws] = { newLeads: 0 };
    byWeek[ws].newLeads += 1;
  }
  return { byWeek, count: items.length };
}

/* ---------- Companies (newCompanies) ---------- */

async function fetchCompaniesByWeek() {
  const cutoffMs = Date.now() - LOOKBACK_MS;
  const items = await searchAll('companies', {
    filterGroups: [{
      filters: [{
        propertyName: 'createdate',
        operator: 'GTE',
        value: String(cutoffMs),
      }],
    }],
    properties: ['createdate'],
    sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
  });
  console.log(`[hubspot] companies created in window: ${items.length}`);
  const byWeek = {};
  for (const it of items) {
    const ws = toMondayISO(it.properties?.createdate || it.createdAt);
    if (!ws) continue;
    if (!byWeek[ws]) byWeek[ws] = { newCompanies: 0 };
    byWeek[ws].newCompanies += 1;
  }
  return { byWeek, count: items.length };
}

/* ---------- Deals (newClients per week + per-owner) ---------- */

async function fetchDealsByWeek(ownersMap) {
  const cutoffMs = Date.now() - LOOKBACK_MS;
  // Filter to deals that closed (won) in the window.
  const items = await searchAll('deals', {
    filterGroups: [{
      filters: [
        { propertyName: 'closedate',         operator: 'GTE', value: String(cutoffMs) },
        { propertyName: 'hs_is_closed_won',  operator: 'EQ',  value: 'true' },
      ],
    }],
    properties: ['closedate', 'amount', 'hubspot_owner_id', 'dealstage'],
    sorts: [{ propertyName: 'closedate', direction: 'DESCENDING' }],
  });
  console.log(`[hubspot] deals closed-won in window: ${items.length}`);

  const byWeek = {};
  let unknownOwner = 0;
  for (const d of items) {
    const ws = toMondayISO(d.properties?.closedate);
    if (!ws) continue;
    const ownerId = d.properties?.hubspot_owner_id;
    const ownerName = (ownerId && ownersMap[String(ownerId)]) || null;
    if (!ownerName) unknownOwner++;
    if (!byWeek[ws]) byWeek[ws] = { newClients: 0, newClientsByOwnerName: {} };
    byWeek[ws].newClients += 1;
    if (ownerName) {
      byWeek[ws].newClientsByOwnerName[ownerName] = (byWeek[ws].newClientsByOwnerName[ownerName] || 0) + 1;
    }
  }
  return { byWeek, count: items.length, unknownOwner };
}

/* ---------- Landing pages (best-effort: CMS endpoint + analytics) ---------- */

async function fetchLandingPagesByWeek() {
  // Best-effort: list pages, then fetch analytics per page. Only include
  // pages with traffic in the window.
  const cutoffISO = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const allPages = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const params = { limit: 100 };
    if (after) params.after = after;
    const json = await hubspotGet('/cms/v3/pages/landing-pages', params);
    if (Array.isArray(json.results)) allPages.push(...json.results);
    after = json.paging?.next?.after;
    if (!after) break;
  }
  console.log(`[hubspot] landing pages listed: ${allPages.length}`);

  // We don't have a stable per-page analytics endpoint we can hit without
  // additional scopes. Return zero-pop weeks for now and surface the page
  // count so the user can see the listing worked. Detailed views/submissions
  // require enabling Analytics scope and is a follow-up.
  return {
    byWeek: {},
    diagnostics: {
      pagesListed: allPages.length,
      note: 'Analytics integration pending — requires HubSpot Analytics API scope',
    },
  };
}

/* ---------- Coordinator ---------- */

export async function fetchWeeklyMetrics() {
  console.log('[hubspot] starting…');

  // Fetch owners first (used by deals). Each call is independent so a
  // failure in one (e.g. missing scope) doesn't kill the others.
  const ownersR = await Promise.allSettled([fetchOwnersMap()]);
  const ownersMap = ownersR[0].status === 'fulfilled' ? ownersR[0].value : {};

  // Email + landing pages don't hit the Search API, safe to parallelize.
  // Contacts/Companies/Deals all hit /crm/v3/objects/{type}/search which
  // shares a per-second rate limit, so run them serially with delays.
  const [emailR, lpR] = await Promise.allSettled([
    fetchEmailStats(),
    fetchLandingPagesByWeek(),
  ]);

  async function settled(fn) {
    try { return { status: 'fulfilled', value: await fn() }; }
    catch (err) { return { status: 'rejected', reason: err }; }
  }
  const contactsR  = await settled(fetchContactsByWeek);
  await sleep(500);
  const companiesR = await settled(fetchCompaniesByWeek);
  await sleep(500);
  const dealsR     = await settled(() => fetchDealsByWeek(ownersMap));

  const callErrors = {};
  if (ownersR[0].status === 'rejected') callErrors.owners    = ownersR[0].reason.message;
  if (emailR.status   === 'rejected')   callErrors.emails    = emailR.reason.message;
  if (contactsR.status === 'rejected')  callErrors.contacts  = contactsR.reason.message;
  if (companiesR.status === 'rejected') callErrors.companies = companiesR.reason.message;
  if (dealsR.status   === 'rejected')   callErrors.deals     = dealsR.reason.message;
  if (lpR.status      === 'rejected')   callErrors.landingPages = lpR.reason.message;

  for (const [k, v] of Object.entries(callErrors)) console.error(`[hubspot] ${k} failed: ${v}`);

  const emailRes     = emailR.status     === 'fulfilled' ? emailR.value     : { byWeek: {}, diagnostics: {} };
  const contactsRes  = contactsR.status  === 'fulfilled' ? contactsR.value  : { byWeek: {}, count: 0 };
  const companiesRes = companiesR.status === 'fulfilled' ? companiesR.value : { byWeek: {}, count: 0 };
  const dealsRes     = dealsR.status     === 'fulfilled' ? dealsR.value     : { byWeek: {}, count: 0, unknownOwner: 0 };
  const lpRes        = lpR.status        === 'fulfilled' ? lpR.value        : { byWeek: {}, diagnostics: {} };

  // Merge per-week buckets.
  const byWeek = {};
  function merge(wsRecord) {
    for (const [ws, m] of Object.entries(wsRecord)) {
      if (!byWeek[ws]) byWeek[ws] = { weekStart: ws };
      Object.assign(byWeek[ws], m);
    }
  }
  merge(emailRes.byWeek);
  merge(contactsRes.byWeek);
  merge(companiesRes.byWeek);
  merge(dealsRes.byWeek);
  merge(lpRes.byWeek);

  const weeks = Object.values(byWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return {
    weeks,
    diagnostics: {
      ...emailRes.diagnostics,
      ownersCount: Object.keys(ownersMap).length,
      contactsCreated:  contactsRes.count,
      companiesCreated: companiesRes.count,
      dealsClosedWon:   dealsRes.count,
      dealsWithUnknownOwner: dealsRes.unknownOwner,
      landingPages:     lpRes.diagnostics?.pagesListed ?? 0,
      landingPagesNote: lpRes.diagnostics?.note,
      callErrors: Object.keys(callErrors).length ? callErrors : undefined,
    },
  };
}
