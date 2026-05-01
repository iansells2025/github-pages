/*
 * Stripe direct-API fetcher.
 *
 * Pulls successful charges (→ revenue), payouts (→ deposits), and active
 * subscriptions (→ MRR) for the last LOOKBACK_WEEKS, aggregates into ISO
 * weeks (Monday-anchored), and returns one row per week.
 *
 * Auth: Basic auth with the restricted API key (rk_live_… or rk_test_…).
 * Required key permissions (read-only):
 *   - Charges:        Read
 *   - Balance:        Read
 *   - Customers:      Read
 *   - Subscriptions:  Read
 *
 * MRR by audience type (brand vs creator) is not split here yet — Stripe
 * doesn't know the audience unless we use customer.metadata or a product
 * naming convention. See `splitMrrBy` below for the hook to implement
 * once we know the convention.
 */

const STRIPE_BASE = 'https://api.stripe.com/v1';
const LOOKBACK_WEEKS = 13;

function authHeader() {
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error('STRIPE_API_KEY not set');
  // Basic auth: key as username, empty password
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
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

function unixTimestamp(d) { return Math.floor(d.getTime() / 1000); }

function lookbackBoundsUnix() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - LOOKBACK_WEEKS * 7);
  return { startTs: unixTimestamp(start), endTs: unixTimestamp(end) };
}

async function listAll(path, params = {}) {
  // Stripe pagination via `starting_after` cursor; loop until !has_more.
  const items = [];
  let startingAfter = null;
  for (let page = 0; page < 100; page++) {
    const url = new URL(`${STRIPE_BASE}${path}`);
    url.searchParams.set('limit', '100');
    for (const [k, v] of Object.entries(params)) {
      // Stripe expects array params using `key[]=value` notation. Pass an
      // array for any param that should serialize that way (e.g. `expand`).
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(`${k}[]`, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
    if (startingAfter) url.searchParams.set('starting_after', startingAfter);
    const res = await fetch(url, { headers: { Authorization: authHeader() } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stripe ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    if (!Array.isArray(json.data)) throw new Error(`Stripe ${path}: unexpected response shape`);
    items.push(...json.data);
    if (!json.has_more || json.data.length === 0) break;
    startingAfter = json.data[json.data.length - 1].id;
  }
  return items;
}

async function fetchCharges() {
  const { startTs, endTs } = lookbackBoundsUnix();
  // Stripe filters: charges created in window
  const charges = await listAll('/charges', {
    'created[gte]': startTs,
    'created[lte]': endTs,
  });
  // Filter to successful, non-refunded
  return charges.filter(c => c.status === 'succeeded' && !c.refunded);
}

async function fetchPayouts() {
  const { startTs, endTs } = lookbackBoundsUnix();
  const payouts = await listAll('/payouts', {
    'arrival_date[gte]': startTs,
    'arrival_date[lte]': endTs,
  });
  return payouts.filter(p => p.status === 'paid');
}

async function fetchActiveSubscriptions() {
  // MRR is a current snapshot — doesn't matter that lookback doesn't apply.
  // SubscriptionItem.price is included by default, so no `expand` needed.
  return listAll('/subscriptions', { status: 'active' });
}

function chargeAmountUSD(charge) {
  // Stripe amounts are in the smallest currency unit. Net amount = amount - fees not exposed
  // on charge; gross = amount. We'll report gross volume for "revenue".
  return (charge.amount || 0) / 100;
}

function payoutAmountUSD(payout) {
  return (payout.amount || 0) / 100;
}

function subscriptionMonthlyAmountUSD(sub) {
  // Sum of (unit_amount * quantity) across items, converted to monthly.
  let total = 0;
  for (const item of sub.items?.data || []) {
    const price = item.price || {};
    const unit = (price.unit_amount || 0) / 100;
    const qty = item.quantity || 1;
    const interval = price.recurring?.interval;
    const intervalCount = price.recurring?.interval_count || 1;
    let monthly = unit * qty;
    if (interval === 'year')  monthly /= 12 * intervalCount;
    if (interval === 'week')  monthly *= 4.345 / intervalCount;
    if (interval === 'day')   monthly *= 30.42 / intervalCount;
    if (interval === 'month') monthly /= intervalCount;
    total += monthly;
  }
  return total;
}

// Hook for splitting MRR into brands vs creators. Returns { brands, creators, other }.
// Customize this once we know the convention (e.g., customer.metadata.account_type).
function splitMrrBy(subscriptions) {
  let brands = 0;
  let creators = 0;
  let other = 0;
  for (const sub of subscriptions) {
    const monthly = subscriptionMonthlyAmountUSD(sub);
    const tag = (sub.metadata?.account_type
              ?? sub.customer_metadata?.account_type
              ?? '').toLowerCase();
    if (tag === 'brand')        brands += monthly;
    else if (tag === 'creator') creators += monthly;
    else                        other += monthly;
  }
  return { brands, creators, other, total: brands + creators + other };
}

export async function fetchWeeklyMetrics() {
  console.log('[stripe] fetching charges, payouts, subscriptions…');
  // Settle each call independently so a failure in one (e.g. a key missing
  // a single permission) doesn't sink the others.
  const [chargesR, payoutsR, subsR] = await Promise.allSettled([
    fetchCharges(),
    fetchPayouts(),
    fetchActiveSubscriptions(),
  ]);
  const charges = chargesR.status === 'fulfilled' ? chargesR.value : [];
  const payouts = payoutsR.status === 'fulfilled' ? payoutsR.value : [];
  const subs    = subsR.status    === 'fulfilled' ? subsR.value    : [];
  const callErrors = {};
  if (chargesR.status === 'rejected') { console.error(`[stripe] charges failed: ${chargesR.reason.message}`); callErrors.charges = chargesR.reason.message; }
  if (payoutsR.status === 'rejected') { console.error(`[stripe] payouts failed: ${payoutsR.reason.message}`); callErrors.payouts = payoutsR.reason.message; }
  if (subsR.status    === 'rejected') { console.error(`[stripe] subscriptions failed: ${subsR.reason.message}`); callErrors.subscriptions = subsR.reason.message; }
  console.log(`[stripe] charges=${charges.length} payouts=${payouts.length} subs=${subs.length}`);

  const byWeek = new Map();
  function bucket(weekStart) {
    if (!byWeek.has(weekStart)) byWeek.set(weekStart, { weekStart, revenue: 0, deposits: 0 });
    return byWeek.get(weekStart);
  }

  for (const c of charges) {
    const ws = toMondayISO(new Date((c.created || 0) * 1000));
    if (!ws) continue;
    bucket(ws).revenue += chargeAmountUSD(c);
  }
  for (const p of payouts) {
    const ws = toMondayISO(new Date((p.arrival_date || 0) * 1000));
    if (!ws) continue;
    bucket(ws).deposits += payoutAmountUSD(p);
  }

  // MRR = current snapshot. Apply to the most recent week in the lookback so
  // the dashboard's "latest" KPI picks it up.
  const mrr = splitMrrBy(subs);
  console.log(`[stripe] MRR snapshot: total=$${mrr.total.toFixed(0)} brands=$${mrr.brands.toFixed(0)} creators=$${mrr.creators.toFixed(0)} other=$${mrr.other.toFixed(0)}`);

  // Sort weeks ascending; attach MRR to the latest week
  const weeks = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (weeks.length > 0) {
    const latest = weeks[weeks.length - 1];
    latest.mrrBrands = +mrr.brands.toFixed(2);
    latest.mrrCreators = +mrr.creators.toFixed(2);
    if (mrr.other > 0) {
      // If we couldn't classify, dump it into mrrBrands so the total isn't lost.
      // User should set customer.metadata.account_type = 'brand' | 'creator' to fix.
      latest.mrrBrands += +mrr.other.toFixed(2);
    }
  }

  // Round monetary values
  for (const w of weeks) {
    w.revenue = +(w.revenue || 0).toFixed(2);
    w.deposits = +(w.deposits || 0).toFixed(2);
  }

  return {
    weeks,
    diagnostics: {
      chargeCount: charges.length,
      payoutCount: payouts.length,
      activeSubscriptionCount: subs.length,
      mrrTotal: +mrr.total.toFixed(2),
      mrrBrands: +mrr.brands.toFixed(2),
      mrrCreators: +mrr.creators.toFixed(2),
      mrrUnclassified: +mrr.other.toFixed(2),
      callErrors: Object.keys(callErrors).length ? callErrors : undefined,
    },
  };
}
